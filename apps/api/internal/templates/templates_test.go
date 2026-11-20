package templates

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"codeberg.org/go-pdf/fpdf"
	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/signatures"
	"helvetly.com/api/internal/signpdf"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// ---- fakes ----

type fakeStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (f *fakeStorage) Put(_ context.Context, key string, body io.Reader, _ int64, _, _ string) error {
	b, err := io.ReadAll(body)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[key] = b
	return err
}

func (f *fakeStorage) Get(_ context.Context, key string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("get %s: missing", key)
	}
	return b, nil
}

func (f *fakeStorage) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	b, err := f.Get(ctx, key)
	return nopCloser{bytes.NewReader(b)}, err
}

type nopCloser struct{ io.ReadSeeker }

func (nopCloser) Close() error { return nil }

func (f *fakeStorage) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.objects, key)
	return nil
}

type fakeMail struct {
	mu   sync.Mutex
	sent []mail.Message
	fail bool
}

func (m *fakeMail) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail {
		return errors.New("smtp down")
	}
	m.sent = append(m.sent, msg)
	return nil
}

// ---- the test server ----

type env struct {
	t     *testing.T
	st    *store.Store
	raw   *pgxpool.Pool
	srv   *httptest.Server
	files *fakeStorage
	mail  *fakeMail
}

// newEnv starts the API; without mail it runs as a server with no mail server.
func newEnv(t *testing.T, withMail bool) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, st: st, raw: raw, files: &fakeStorage{objects: map[string][]byte{}}, mail: &fakeMail{}}
	var tm Mailer
	var sm signatures.Mailer
	if withMail {
		tm, sm = e.mail, e.mail
	}
	sign := signatures.New(st, a, e.files, sm, "https://helvetly.example.com", discard)
	mux := http.NewServeMux()
	a.Register(mux)
	sign.Register(mux)
	New(st, a, e.files, tm, sign, discard).Register(mux)
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

type browser struct{ token, csrf, workspace, user string }

func (e *env) workspace() *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna Owner"}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: auth.NewID("wsp"), user: u.ID}
	sum := sha256.Sum256([]byte(b.token))
	for _, err := range []error{
		e.st.CreateWorkspace(ctx, store.Workspace{ID: b.workspace, Name: "Acme AG"}, "Europe/Zurich", now),
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, b.workspace, u.ID, "owner", now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), b.csrf, u.ID, b.workspace, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	return b
}

func samplePDF(t *testing.T, pages int) []byte {
	t.Helper()
	pdf := fpdf.New("P", "mm", "A4", "")
	for i := range pages {
		pdf.AddPage()
		pdf.SetFont("Helvetica", "", 14)
		pdf.Text(20, 30, fmt.Sprintf("Agreement page %d", i+1))
	}
	var b bytes.Buffer
	if err := pdf.Output(&b); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// document puts a file into the workspace's Documents and returns its id.
func (e *env) document(b *browser, content []byte, contentType string) string {
	e.t.Helper()
	id := auth.NewID("doc")
	key := "workspaces/" + b.workspace + "/documents/" + id + "/agreement.pdf"
	e.files.objects[key] = content
	if err := e.st.CreateDocument(context.Background(), b.workspace, b.user, store.Document{ID: id, Name: "Agreement " + id + ".pdf",
		Size: int64(len(content)), ContentType: contentType, ObjectKey: key, CreatedAt: time.Now()}); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *env) client(b *browser) string {
	e.t.Helper()
	id := auth.NewID("cli")
	if err := e.st.CreateClient(context.Background(), b.workspace, id, map[string]any{"name": "Müller AG"}, time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *env) send(b *browser, method, path string, body any) (int, []byte) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			e.t.Fatal(err)
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, e.srv.URL+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, raw
}

func (e *env) do(b *browser, method, path string, body any, want int, out any) {
	e.t.Helper()
	status, raw := e.send(b, method, path, body)
	if status != want {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, status, want, raw)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatalf("%s %s: %v: %s", method, path, err, raw)
		}
	}
}

type apiError struct {
	Code    string `json:"code"`
	Details struct {
		Fields map[string]string `json:"fields"`
	} `json:"details"`
}

func (e *env) fail(b *browser, method, path string, body any, want int) apiError {
	e.t.Helper()
	var out struct{ Error apiError }
	e.do(b, method, path, body, want, &out)
	return out.Error
}

func (e *env) count(sql string, args ...any) int {
	e.t.Helper()
	var n int
	if err := e.raw.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

type obj = map[string]any

// templateInput: a two-page template with the client's name and address, a custom field and, per role, a signature.
func templateInput(docID string, roles ...string) obj {
	fields := []obj{
		{"kind": "client.name", "signer": nil, "page": 1, "x": 0.1, "y": 0.1, "w": 0.4, "h": 0.03, "label": nil},
		{"kind": "client.address", "signer": nil, "page": 1, "x": 0.1, "y": 0.15, "w": 0.4, "h": 0.06, "label": nil},
		{"kind": "custom", "signer": nil, "page": 2, "x": 0.1, "y": 0.3, "w": 0.4, "h": 0.03, "label": "Project"},
	}
	signers := []obj{}
	for i, role := range roles {
		signers = append(signers, obj{"label": role, "fill": "client"})
		fields = append(fields,
			obj{"kind": "signature", "signer": i, "page": 2, "x": 0.1, "y": 0.8, "w": 0.3, "h": 0.06, "label": nil},
			obj{"kind": "text", "signer": i, "page": 2, "x": 0.5, "y": 0.8, "w": 0.3, "h": 0.03, "label": "Place"})
	}
	return obj{"name": "Service agreement", "description": "  ", "document_id": docID, "signers": signers, "fields": fields}
}

type template struct {
	store.Template
	Document *store.FolderRef `json:"document"`
}

func (e *env) create(b *browser, body obj) template {
	e.t.Helper()
	var out struct{ Data template }
	e.do(b, "POST", "/api/v1/templates", body, http.StatusCreated, &out)
	return out.Data
}

// values: every client data field filled.
func values(t template) map[string]string {
	v := map[string]string{}
	for _, f := range t.Fields {
		if isData(f.Kind) {
			v[f.ID] = "Müller AG"
		}
		if f.Kind == "client.address" {
			v[f.ID] = "Seestrasse 1\n8000 Zürich"
		}
	}
	return v
}

func generate(clientID string, t template, delivery obj) obj {
	return obj{"client_id": clientID, "title": "Agreement Müller", "values": values(t), "delivery": delivery}
}

type generatedOut struct {
	Document           store.FolderRef `json:"document"`
	SignatureRequestID *string         `json:"signature_request_id"`
	EmailedTo          *string         `json:"emailed_to"`
}

func (e *env) generate(b *browser, t template, body obj) generatedOut {
	e.t.Helper()
	var out struct{ Data generatedOut }
	e.do(b, "POST", "/api/v1/templates/"+t.ID+"/documents", body, http.StatusCreated, &out)
	return out.Data
}

// ---- tests ----

func TestTemplateLifecycle(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	doc := e.document(b, samplePDF(t, 2), "application/pdf")

	tpl := e.create(b, templateInput(doc, "Client"))
	if !strings.HasPrefix(tpl.ID, "tpl_") || tpl.Document == nil || tpl.Document.ID != doc || tpl.Description != nil ||
		len(tpl.Fields) != 5 || len(tpl.Signers) != 1 || tpl.UsedCount != 0 || tpl.LastUsedAt != nil {
		t.Fatalf("created: %+v", tpl)
	}
	for _, f := range tpl.Fields {
		if !strings.HasPrefix(f.ID, "tfd_") || isData(f.Kind) != (f.Signer == nil) || (f.Label != nil) != (f.Kind == "custom" || f.Kind == "text") {
			t.Fatalf("field: %+v", f)
		}
	}
	second := e.create(b, templateInput(doc))

	var list struct{ Data []template }
	e.do(b, "GET", "/api/v1/templates", nil, http.StatusOK, &list)
	if len(list.Data) != 2 || list.Data[0].ID != second.ID {
		t.Fatalf("list, last changed first: %+v", list.Data)
	}

	body := templateInput(doc)
	body["name"] = "Renamed"
	var updated struct{ Data template }
	e.do(b, "PUT", "/api/v1/templates/"+tpl.ID, body, http.StatusOK, &updated)
	if updated.Data.Name != "Renamed" || len(updated.Data.Signers) != 0 || len(updated.Data.Fields) != 3 ||
		updated.Data.Fields[0].ID == tpl.Fields[0].ID || !updated.Data.CreatedAt.Equal(tpl.CreatedAt) {
		t.Fatalf("fields are replaced: %+v", updated.Data)
	}
	e.do(b, "GET", "/api/v1/templates", nil, http.StatusOK, &list)
	if list.Data[0].ID != tpl.ID {
		t.Fatal("the changed template comes first")
	}

	// Another workspace sees none of it.
	other := e.workspace()
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/v1/templates/" + tpl.ID}, {"PUT", "/api/v1/templates/" + tpl.ID}, {"DELETE", "/api/v1/templates/" + tpl.ID},
		{"POST", "/api/v1/templates/" + tpl.ID + "/documents"},
	} {
		if code := e.fail(other, c.method, c.path, templateInput(e.document(other, samplePDF(t, 2), "application/pdf")), http.StatusNotFound).Code; code != "not_found" {
			t.Fatalf("%s %s: %s", c.method, c.path, code)
		}
	}
	e.do(other, "GET", "/api/v1/templates", nil, http.StatusOK, &list)
	if len(list.Data) != 0 {
		t.Fatal("another workspace's templates are listed")
	}
	// A template can't be built on another workspace's PDF.
	if f := e.fail(other, "POST", "/api/v1/templates", templateInput(doc), http.StatusUnprocessableEntity).Details.Fields; f["document_id"] == "" {
		t.Fatalf("foreign PDF: %v", f)
	}

	e.do(b, "DELETE", "/api/v1/templates/"+tpl.ID, nil, http.StatusNoContent, nil)
	e.fail(b, "GET", "/api/v1/templates/"+tpl.ID, nil, http.StatusNotFound)
	e.fail(b, "DELETE", "/api/v1/templates/"+tpl.ID, nil, http.StatusNotFound)
	if e.count(`SELECT count(*) FROM documents WHERE id = $1 AND deleted_at IS NULL`, doc) != 1 {
		t.Fatal("deleting a template keeps its PDF")
	}

	// The PDF deleted forever: the template stays, without a document, and can't make documents.
	if _, err := e.raw.Exec(context.Background(), `DELETE FROM documents WHERE id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	var got struct{ Data template }
	e.do(b, "GET", "/api/v1/templates/"+second.ID, nil, http.StatusOK, &got)
	if got.Data.Document != nil {
		t.Fatalf("document after purge: %+v", got.Data.Document)
	}
	if f := e.fail(b, "POST", "/api/v1/templates/"+second.ID+"/documents", generate(e.client(b), second, obj{"type": "save"}),
		http.StatusUnprocessableEntity).Details.Fields; f["document_id"] == "" {
		t.Fatalf("purged PDF: %v", f)
	}
}

func TestTemplateValidation(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	doc := e.document(b, samplePDF(t, 2), "application/pdf")
	trashed := e.document(b, samplePDF(t, 2), "application/pdf")
	if _, err := e.raw.Exec(context.Background(), `UPDATE documents SET deleted_at = now() WHERE id = $1`, trashed); err != nil {
		t.Fatal(err)
	}
	text := e.document(b, []byte("hello"), "text/plain")
	broken := e.document(b, []byte("%PDF-1.4 not really"), "application/pdf")

	field := func(i int) obj { return templateInput(doc, "Client")["fields"].([]obj)[i] }
	with := func(change func(obj)) obj {
		body := templateInput(doc, "Client")
		change(body)
		return body
	}
	setField := func(i int, key string, v any) obj {
		return with(func(body obj) { body["fields"].([]obj)[i][key] = v })
	}
	many := func(n int) []obj {
		out := make([]obj, n)
		for i := range out {
			out[i] = field(0)
		}
		return out
	}
	cases := []struct {
		name string
		body obj
		key  string
	}{
		{"no name", with(func(b obj) { b["name"] = " " }), "name"},
		{"long name", with(func(b obj) { b["name"] = strings.Repeat("x", 201) }), "name"},
		{"long description", with(func(b obj) { b["description"] = strings.Repeat("x", 501) }), "description"},
		{"unknown document", with(func(b obj) { b["document_id"] = "doc_nope" }), "document_id"},
		{"trashed document", with(func(b obj) { b["document_id"] = trashed }), "document_id"},
		{"not a PDF", with(func(b obj) { b["document_id"] = text }), "document_id"},
		{"damaged PDF", with(func(b obj) { b["document_id"] = broken }), "document_id"},
		{"no fields", with(func(b obj) { b["fields"] = []obj{}; b["signers"] = []obj{} }), "fields"},
		{"too many fields", with(func(b obj) { b["fields"] = many(201); b["signers"] = []obj{} }), "fields"},
		{"unknown kind", setField(0, "kind", "client.iban"), "fields.0"},
		{"data with a signer", setField(0, "signer", 0), "fields.0"},
		{"signing field without a signer", setField(3, "signer", nil), "fields.3"},
		{"signing field of no role", setField(3, "signer", 1), "fields.3"},
		{"page past the end", setField(0, "page", 3), "fields.0"},
		{"off the page", setField(0, "x", 0.9), "fields.0"},
		{"custom without a label", setField(2, "label", " "), "fields.2.label"},
		{"text label too long", setField(4, "label", strings.Repeat("x", 101)), "fields.4.label"},
		{"role without a signature", setField(3, "kind", "date"), "signers.0"},
		{"role without a label", with(func(b obj) { b["signers"].([]obj)[0]["label"] = "" }), "signers.0.label"},
		{"role with a bad fill", with(func(b obj) { b["signers"].([]obj)[0]["fill"] = "auto" }), "signers.0.fill"},
		{"too many roles", with(func(b obj) {
			for range 10 {
				b["signers"] = append(b["signers"].([]obj), obj{"label": "Witness", "fill": "manual"})
			}
		}), "signers"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := e.fail(b, "POST", "/api/v1/templates", c.body, http.StatusUnprocessableEntity).Details.Fields
			if f[c.key] == "" {
				t.Fatalf("want %s in %v", c.key, f)
			}
		})
	}
	if n := e.count(`SELECT count(*) FROM templates`); n != 0 {
		t.Fatalf("%d templates saved from invalid input", n)
	}
	// A description is trimmed, and a blank one is null.
	tpl := e.create(b, with(func(b obj) { b["description"] = "  For new clients " }))
	if tpl.Description == nil || *tpl.Description != "For new clients" {
		t.Fatalf("description: %v", tpl.Description)
	}
}

func TestGenerateSave(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	original := samplePDF(t, 2)
	doc := e.document(b, original, "application/pdf")
	client := e.client(b)
	tpl := e.create(b, templateInput(doc))

	first := e.generate(b, tpl, generate(client, tpl, obj{"type": "save"}))
	if first.Document.Name != "Agreement Müller.pdf" || first.SignatureRequestID != nil || first.EmailedTo != nil {
		t.Fatalf("generated: %+v", first)
	}
	again := e.generate(b, tpl, generate(client, tpl, obj{"type": "save"}))
	if again.Document.Name == first.Document.Name || !strings.HasPrefix(again.Document.Name, "Agreement Müller") {
		t.Fatalf("keep both: %q and %q", first.Document.Name, again.Document.Name)
	}

	filed, err := e.st.Document(context.Background(), b.workspace, first.Document.ID)
	if err != nil {
		t.Fatal(err)
	}
	// a client's documents go to Clients/<client>/Documents/<year>
	if filed.Folder == nil || filed.Folder.SystemKind == nil || *filed.Folder.SystemKind != "year" || len(filed.Links) != 1 || filed.Links[0].Type != "client" ||
		filed.Links[0].ID != client || filed.ContentType != "application/pdf" {
		t.Fatalf("filed: %+v", filed)
	}
	stamped := e.files.objects[filed.ObjectKey]
	sum := sha256.Sum256(stamped)
	if filed.SHA256 == nil || *filed.SHA256 != hex.EncodeToString(sum[:]) || filed.Size != int64(len(stamped)) {
		t.Fatal("the filed document's hash and size are its bytes'")
	}
	if pages, err := signpdf.PageCount(stamped); err != nil || pages != 2 || bytes.Equal(stamped, original) {
		t.Fatalf("stamped copy: %d pages, %v", pages, err)
	}
	if !bytes.Equal(e.files.objects[e.mustDoc(b, doc).ObjectKey], original) {
		t.Fatal("the template's PDF is never changed")
	}

	var got struct{ Data template }
	e.do(b, "GET", "/api/v1/templates/"+tpl.ID, nil, http.StatusOK, &got)
	if got.Data.UsedCount != 2 || got.Data.LastUsedAt == nil {
		t.Fatalf("usage: %d, %v", got.Data.UsedCount, got.Data.LastUsedAt)
	}
	if n := e.count(`SELECT count(*) FROM clients WHERE id = $1 AND name = 'Müller AG'`, client); n != 1 {
		t.Fatal("the client record is never changed")
	}
}

func (e *env) mustDoc(b *browser, id string) store.Document {
	e.t.Helper()
	d, err := e.st.Document(context.Background(), b.workspace, id)
	if err != nil {
		e.t.Fatal(err)
	}
	return d
}

func TestGenerateValidation(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	doc := e.document(b, samplePDF(t, 2), "application/pdf")
	client := e.client(b)
	plain := e.create(b, templateInput(doc))
	signed := e.create(b, templateInput(doc, "Client", "Director"))
	foreign := e.client(e.workspace())
	custom := ""
	for _, f := range plain.Fields {
		if f.Kind == "custom" {
			custom = f.ID
		}
	}

	change := func(tpl template, edit func(obj)) obj {
		body := generate(client, tpl, obj{"type": "save"})
		edit(body)
		return body
	}
	signers := func(n int) []obj {
		out := []obj{}
		for i := range n {
			out = append(out, obj{"name": fmt.Sprintf("Signer %d", i), "email": fmt.Sprintf("s%d@example.com", i)})
		}
		return out
	}
	cases := []struct {
		name string
		tpl  template
		body obj
		key  string
	}{
		{"no title", plain, change(plain, func(b obj) { b["title"] = "" }), "title"},
		{"unknown client", plain, change(plain, func(b obj) { b["client_id"] = "cli_nope" }), "client_id"},
		{"another workspace's client", plain, change(plain, func(b obj) { b["client_id"] = foreign }), "client_id"},
		{"missing value", plain, change(plain, func(b obj) { delete(b["values"].(map[string]string), custom) }), "values." + custom},
		{"empty custom value", plain, change(plain, func(b obj) { b["values"].(map[string]string)[custom] = " " }), "values." + custom},
		{"value too long", plain, change(plain, func(b obj) { b["values"].(map[string]string)[custom] = strings.Repeat("x", 501) }), "values." + custom},
		{"unknown value", plain, change(plain, func(b obj) { b["values"].(map[string]string)["tfd_nope"] = "x" }), "values"},
		{"unknown delivery", plain, change(plain, func(b obj) { b["delivery"] = obj{"type": "fax"} }), "delivery.type"},
		{"email without an address", plain, change(plain, func(b obj) { b["delivery"] = obj{"type": "email", "to": "nope"} }), "delivery.to"},
		{"signature without roles", plain, change(plain, func(b obj) {
			b["delivery"] = obj{"type": "signature", "signers": signers(1), "signing_order": "parallel", "expires_in_days": 30}
		}), "delivery.type"},
		{"one signer for two roles", signed, change(signed, func(b obj) {
			b["delivery"] = obj{"type": "signature", "signers": signers(1), "signing_order": "parallel", "expires_in_days": 30}
		}), "delivery.signers"},
		{"a signer's bad email", signed, change(signed, func(b obj) {
			list := signers(2)
			list[1]["email"] = "nope"
			b["delivery"] = obj{"type": "signature", "signers": list, "signing_order": "parallel", "expires_in_days": 30}
		}), "delivery.signers.1.email"},
		{"bad order", signed, change(signed, func(b obj) {
			b["delivery"] = obj{"type": "signature", "signers": signers(2), "signing_order": "random", "expires_in_days": 30}
		}), "delivery.signing_order"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := e.fail(b, "POST", "/api/v1/templates/"+c.tpl.ID+"/documents", c.body, http.StatusUnprocessableEntity).Details.Fields
			if f[c.key] == "" {
				t.Fatalf("want %s in %v", c.key, f)
			}
		})
	}

	// The PDF in the Trash: the template can't make documents.
	if _, err := e.raw.Exec(context.Background(), `UPDATE documents SET deleted_at = now() WHERE id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	if f := e.fail(b, "POST", "/api/v1/templates/"+plain.ID+"/documents", generate(client, plain, obj{"type": "save"}),
		http.StatusUnprocessableEntity).Details.Fields; f["document_id"] == "" {
		t.Fatalf("trashed PDF: %v", f)
	}
	if n := e.count(`SELECT count(*) FROM documents WHERE workspace_id = $1`, b.workspace); n != 1 {
		t.Fatalf("%d documents: nothing is filed for a refused request", n)
	}
	if n := e.count(`SELECT coalesce(sum(used_count), 0) FROM templates WHERE workspace_id = $1`, b.workspace); n != 0 {
		t.Fatalf("used %d times by refused requests", n)
	}
}

func TestGenerateEmail(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	tpl := e.create(b, templateInput(e.document(b, samplePDF(t, 2), "application/pdf")))
	client := e.client(b)

	out := e.generate(b, tpl, generate(client, tpl, obj{"type": "email", "to": " Ana@Example.com ", "message": "Here it is."}))
	if out.EmailedTo == nil || *out.EmailedTo != "ana@example.com" {
		t.Fatalf("emailed to: %v", out.EmailedTo)
	}
	if len(e.mail.sent) != 1 {
		t.Fatalf("%d emails", len(e.mail.sent))
	}
	m := e.mail.sent[0]
	filed := e.mustDoc(b, out.Document.ID)
	if m.To[0] != "ana@example.com" || len(m.Attachments) != 1 || m.Attachments[0].Name != out.Document.Name ||
		!bytes.Equal(m.Attachments[0].Data, e.files.objects[filed.ObjectKey]) || !strings.Contains(m.Text, "Here it is.") ||
		!strings.Contains(m.Subject, "Agreement Müller") {
		t.Fatalf("email: %+v", m)
	}

	// A failing mail server: the document stays.
	e.mail.fail = true
	if code := e.fail(b, "POST", "/api/v1/templates/"+tpl.ID+"/documents", generate(client, tpl, obj{"type": "email", "to": "ana@example.com"}),
		http.StatusServiceUnavailable).Code; code != "mail_failed" {
		t.Fatal(code)
	}
	if n := e.count(`SELECT count(*) FROM document_links WHERE target_type = 'client' AND target_id = $1`, client); n != 2 {
		t.Fatalf("%d documents for the client", n)
	}
}

func TestGenerateWithoutMail(t *testing.T) {
	e := newEnv(t, false)
	b := e.workspace()
	tpl := e.create(b, templateInput(e.document(b, samplePDF(t, 2), "application/pdf"), "Client"))
	client := e.client(b)

	// Email: the document is filed first and stays.
	if code := e.fail(b, "POST", "/api/v1/templates/"+tpl.ID+"/documents", generate(client, tpl, obj{"type": "email", "to": "ana@example.com"}),
		http.StatusServiceUnavailable).Code; code != "mail_unavailable" {
		t.Fatal(code)
	}
	// Signature: nothing could be sent, so nothing is filed.
	if code := e.fail(b, "POST", "/api/v1/templates/"+tpl.ID+"/documents", generate(client, tpl, obj{"type": "signature",
		"signers": []obj{{"name": "Ana", "email": "ana@example.com"}}, "signing_order": "parallel", "expires_in_days": 30}),
		http.StatusServiceUnavailable).Code; code != "mail_unavailable" {
		t.Fatal(code)
	}
	if n := e.count(`SELECT count(*) FROM document_links WHERE target_type = 'client' AND target_id = $1`, client); n != 1 {
		t.Fatalf("%d documents for the client", n)
	}
	e.generate(b, tpl, generate(client, tpl, obj{"type": "save"}))
}

func TestGenerateSignature(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	tpl := e.create(b, templateInput(e.document(b, samplePDF(t, 2), "application/pdf"), "Client", "Director"))
	client := e.client(b)

	out := e.generate(b, tpl, generate(client, tpl, obj{"type": "signature", "message": "Please sign.", "signing_order": "sequential",
		"expires_in_days": 14, "signers": []obj{{"name": "Ana Client", "email": "ana@example.com"}, {"name": "Bo Director", "email": "bo@example.com"}}}))
	if out.SignatureRequestID == nil || out.EmailedTo != nil {
		t.Fatalf("generated: %+v", out)
	}
	req, err := e.st.SignatureRequest(context.Background(), b.workspace, *out.SignatureRequestID)
	if err != nil {
		t.Fatal(err)
	}
	if req.Document == nil || req.Document.ID != out.Document.ID || req.Title != "Agreement Müller" || req.SigningOrder != "sequential" ||
		len(req.Signers) != 2 || req.Signers[1].Email != "bo@example.com" || len(req.Fields) != 4 || req.PageCount != 2 {
		t.Fatalf("signature request: %+v", req)
	}
	for _, f := range req.Fields {
		if f.Page != 2 || (f.Kind == "text" && (f.Label == nil || *f.Label != "Place")) {
			t.Fatalf("field: %+v", f)
		}
	}
	original, err := e.files.Get(context.Background(), req.OriginalKey)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(original, e.files.objects[e.mustDoc(b, out.Document.ID).ObjectKey]) {
		t.Fatal("the request freezes the filled copy")
	}
	// Sequential: only the first signer has a link so far.
	if len(e.mail.sent) != 1 || e.mail.sent[0].To[0] != "ana@example.com" {
		t.Fatalf("invitations: %d", len(e.mail.sent))
	}
}

// A failure after the filled PDF is stored rolls the filing back and removes the stored copy: no orphan in the bucket.
func TestGenerateFailureLeavesNoObject(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	doc := e.document(b, samplePDF(t, 2), "application/pdf")
	client := e.client(b)
	tpl := e.create(b, templateInput(doc))
	if _, err := e.raw.Exec(context.Background(), `CREATE FUNCTION refuse_documents() RETURNS trigger LANGUAGE plpgsql AS
			$$BEGIN RAISE EXCEPTION 'injected failure'; END$$;
		CREATE TRIGGER refuse_documents BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION refuse_documents()`); err != nil {
		t.Fatal(err)
	}
	before := len(e.files.objects)
	if status, raw := e.send(b, "POST", "/api/v1/templates/"+tpl.ID+"/documents", generate(client, tpl, obj{"type": "save"})); status != 500 {
		t.Fatalf("generate with a failing insert: %d %s", status, raw)
	}
	if len(e.files.objects) != before {
		t.Fatalf("objects %d, want %d: the filled copy was left in the bucket", len(e.files.objects), before)
	}
	if n := e.count(`SELECT count(*) FROM documents WHERE workspace_id = $1`, b.workspace); n != 1 {
		t.Fatalf("documents %d, want only the template's PDF", n)
	}
}
