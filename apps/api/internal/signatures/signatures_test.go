package signatures

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"codeberg.org/go-pdf/fpdf"
	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/signpdf"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// ---- fakes ----

type fakeStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
	gets    int // whole-object reads (Get), to keep downloads streamed
	retain  func(key string)
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
	f.gets++
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("get %s: missing", key)
	}
	return b, nil
}

func (f *fakeStorage) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("open %s: missing", key)
	}
	return nopCloser{bytes.NewReader(b)}, nil
}

type nopCloser struct{ io.ReadSeeker }

func (nopCloser) Close() error { return nil }

func (f *fakeStorage) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.objects, key)
	return nil
}

func (f *fakeStorage) RetentionMode() string { return "COMPLIANCE" }

func (f *fakeStorage) RetainUntil(requested time.Time, deadline *time.Time) time.Time {
	if deadline != nil {
		return *deadline
	}
	return requested.AddDate(0, 0, 1)
}

func (f *fakeStorage) Retain(_ context.Context, key string, until time.Time) (storage.Lock, error) {
	if f.retain != nil {
		f.retain(key)
	}
	return storage.Lock{VersionID: "v1", Mode: "COMPLIANCE", Until: until}, nil
}

type fakeMail struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (m *fakeMail) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return nil
}

var linkPattern = regexp.MustCompile(`/sign#([A-Z2-7]+)`)

// link: the newest signing link emailed to the address ("" when none).
func (m *fakeMail) link(to string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := len(m.sent) - 1; i >= 0; i-- {
		if m.sent[i].To[0] == to {
			if match := linkPattern.FindStringSubmatch(m.sent[i].Text); match != nil {
				return match[1]
			}
		}
	}
	return ""
}

func (m *fakeMail) to(addr string) []mail.Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []mail.Message
	for _, msg := range m.sent {
		if msg.To[0] == addr {
			out = append(out, msg)
		}
	}
	return out
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

func newEnv(t *testing.T) *env {
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
	svc := New(st, a, e.files, e.mail, "https://helvetly.example.com", discard)
	mux := http.NewServeMux()
	a.Register(mux)
	svc.Register(mux)
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

type browser struct{ token, csrf, workspace, user, email string }

func (e *env) workspace() *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	ws := auth.NewID("wsp")
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna Owner"}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws, user: u.ID, email: u.Email}
	sum := sha256.Sum256([]byte(b.token))
	for _, err := range []error{
		e.st.CreateWorkspace(ctx, store.Workspace{ID: ws, Name: "Acme AG"}, "Europe/Zurich", now),
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, "owner", now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), b.csrf, u.ID, ws, now, now.Add(time.Hour)),
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
		pdf.Text(20, 30, fmt.Sprintf("Contract page %d", i+1))
	}
	var b bytes.Buffer
	if err := pdf.Output(&b); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// pdfDocument puts a file into the workspace's Documents (in a folder) and returns its id and folder id.
func (e *env) pdfDocument(b *browser, content []byte, contentType string) (string, string) {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	folder, id := auth.NewID("fld"), auth.NewID("doc")
	key := "workspaces/" + b.workspace + "/documents/" + id + "/contract.pdf"
	e.files.objects[key] = content
	if err := e.st.CreateFolder(ctx, b.workspace, folder, "Contracts "+folder, nil, b.user, now); err != nil {
		e.t.Fatal(err)
	}
	if err := e.st.CreateDocument(ctx, b.workspace, b.user, store.Document{ID: id, FolderID: &folder, Name: "Contract.pdf",
		Size: int64(len(content)), ContentType: contentType, ObjectKey: key, CreatedAt: now}); err != nil {
		e.t.Fatal(err)
	}
	return id, folder
}

func (e *env) send(b *browser, method, path string, body any) (*http.Response, []byte) {
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
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("User-Agent", "signatures-test")
	if b != nil {
		req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
		req.Header.Set("X-CSRF-Token", b.csrf)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp, raw
}

func (e *env) do(b *browser, method, path string, body any, want int, out any) {
	e.t.Helper()
	resp, raw := e.send(b, method, path, body)
	if resp.StatusCode != want {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, want, raw)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatalf("%s %s: %v: %s", method, path, err, raw)
		}
	}
}

// code: the error code of a response, checked against the status.
func (e *env) code(b *browser, method, path string, body any, want int) string {
	e.t.Helper()
	resp, raw := e.send(b, method, path, body)
	if resp.StatusCode != want {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, want, raw)
	}
	var out struct {
		Error struct {
			Code    string         `json:"code"`
			Details map[string]any `json:"details"`
		} `json:"error"`
	}
	_ = json.Unmarshal(raw, &out)
	return out.Error.Code
}

type requestBody = map[string]any

func newRequest(docID, order string, signers ...string) requestBody {
	list, fields := []map[string]string{}, []map[string]any{}
	for i, email := range signers {
		list = append(list, map[string]string{"name": "Signer " + string(rune('A'+i)), "email": email})
		fields = append(fields,
			map[string]any{"signer": i, "page": 1 + i%2, "kind": "signature", "x": 0.1, "y": 0.8, "w": 0.3, "h": 0.06},
			map[string]any{"signer": i, "page": 2, "kind": "date", "x": 0.6, "y": 0.8, "w": 0.2, "h": 0.03},
			map[string]any{"signer": i, "page": 2, "kind": "name", "x": 0.6, "y": 0.85, "w": 0.2, "h": 0.03})
	}
	return requestBody{"document_id": docID, "title": "Consulting agreement", "message": "Please sign by Friday.",
		"signing_order": order, "signers": list, "fields": fields}
}

type sigReq struct {
	ID             string `json:"id"`
	Status         string `json:"status"`
	OriginalSHA256 string `json:"original_sha256"`
	FinalSHA256    string `json:"final_sha256"`
	PageCount      int    `json:"page_count"`
	SignedDocument *struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"signed_document"`
	Signers []struct {
		ID     string `json:"id"`
		Email  string `json:"email"`
		Status string `json:"status"`
	} `json:"signers"`
	Fields []struct {
		Kind  string  `json:"kind"`
		Value *string `json:"value"`
	} `json:"fields"`
	Events []struct {
		Type string `json:"type"`
	} `json:"events"`
}

func (e *env) create(b *browser, body requestBody) sigReq {
	e.t.Helper()
	var out struct{ Data sigReq }
	e.do(b, "POST", "/api/v1/signatures", body, http.StatusCreated, &out)
	return out.Data
}

func (e *env) get(b *browser, id string) sigReq {
	e.t.Helper()
	var out struct{ Data sigReq }
	e.do(b, "GET", "/api/v1/signatures/"+id, nil, http.StatusOK, &out)
	return out.Data
}

func signatureDataURL(t *testing.T) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 400, 120))
	for x := range 400 {
		img.Set(x, 60+x%25, color.NRGBA{A: 255})
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
}

func (e *env) sign(token string, want int) {
	e.t.Helper()
	e.do(nil, "POST", "/api/v1/public/sign/"+token, map[string]any{"consent": true,
		"signature": map[string]string{"method": "drawn", "image": signatureDataURL(e.t)}, "values": map[string]string{}}, want, nil)
}

func statuses(r sigReq) string {
	var out []string
	for _, s := range r.Signers {
		out = append(out, s.Status)
	}
	return strings.Join(out, ",")
}

// ---- tests ----

func TestParallelSigningCompletesWithCertificate(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, folder := e.pdfDocument(b, samplePDF(t, 3), "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "one@example.com", "two@example.com"))
	if req.Status != "pending" || req.PageCount != 3 || statuses(req) != "sent,sent" {
		t.Fatalf("created %+v", req)
	}
	one, two := e.mail.link("one@example.com"), e.mail.link("two@example.com")
	if one == "" || two == "" || one == two {
		t.Fatalf("links %q %q", one, two)
	}

	var v struct {
		Data struct {
			Signer struct{ Status string } `json:"signer"`
			Fields []struct {
				SignerID string `json:"signer_id"`
			} `json:"fields"`
			ConsentText string `json:"consent_text"`
		}
	}
	e.do(nil, "GET", "/api/v1/public/sign/"+one, nil, http.StatusOK, &v)
	e.do(nil, "GET", "/api/v1/public/sign/"+one, nil, http.StatusOK, nil) // a second view tells nobody again
	if v.Data.Signer.Status != "viewed" || len(v.Data.Fields) != 3 || v.Data.ConsentText != ConsentText {
		t.Fatalf("view %+v", v.Data)
	}
	for _, f := range v.Data.Fields {
		if f.SignerID != req.Signers[0].ID {
			t.Fatal("the view shows another signer's field")
		}
	}
	e.sign(one, http.StatusOK)
	if got := e.get(b, req.ID); got.Status != "pending" || statuses(got) != "signed,sent" {
		t.Fatalf("after one signature: %s %s", got.Status, statuses(got))
	}
	e.sign(one, http.StatusConflict) // twice
	e.sign(two, http.StatusOK)

	got := e.get(b, req.ID)
	if got.Status != "completed" || got.SignedDocument == nil || got.SignedDocument.Name != "Consulting agreement – signed.pdf" {
		t.Fatalf("completed %+v", got)
	}
	bell, err := e.st.Notifications(context.Background(), b.workspace, b.user, store.NotificationFilter{Limit: 10})
	if err != nil || len(bell) != 3 || bell[0].Event != "signature.completed" || bell[1].Event != "signature.signed" ||
		bell[2].Event != "signature.viewed" || !strings.Contains(string(bell[1].Data), `"remaining": 1`) {
		t.Fatalf("the sender's bell: %+v %v", bell, err)
	}
	for _, f := range got.Fields {
		if f.Kind != "signature" && (f.Value == nil || *f.Value == "") {
			t.Fatalf("field %s has no value", f.Kind)
		}
	}
	var types []string
	for _, ev := range got.Events {
		types = append(types, ev.Type)
	}
	if want := "created,sent,sent,viewed,signed,signed,completed"; strings.Join(types, ",") != want {
		t.Fatalf("events %v, want %s", types, want)
	}
	events, err := e.st.SignatureEvents(context.Background(), req.ID)
	if err != nil || !verifyChain(req.ID, events) {
		t.Fatalf("audit chain does not verify: %v", err)
	}

	// Filed in Documents, in the source's folder, as a business record linked to the request.
	d, err := e.st.Document(context.Background(), b.workspace, got.SignedDocument.ID)
	if err != nil {
		t.Fatal(err)
	}
	if d.FolderID == nil || *d.FolderID != folder || d.RetainedUntil == nil || len(d.Links) != 1 || d.Links[0].Type != "signature" ||
		!d.Links[0].Retains || d.SHA256 == nil || *d.SHA256 != got.FinalSHA256 {
		t.Fatalf("signed document %+v", d)
	}
	final := e.files.objects[d.ObjectKey]
	if sum := sha256.Sum256(final); hex.EncodeToString(sum[:]) != got.FinalSHA256 {
		t.Fatal("final_sha256 is not the stored file's")
	}
	if n, err := signpdf.PageCount(final); err != nil || n != 4 {
		t.Fatalf("signed PDF: %d pages (%v), want 3 + certificate", n, err)
	}
	// Everyone gets the signed PDF.
	for _, addr := range []string{"one@example.com", "two@example.com", b.email} {
		msgs := e.mail.to(addr)
		if len(msgs) == 0 || len(msgs[len(msgs)-1].Attachments) != 1 {
			t.Fatalf("%s got no signed PDF", addr)
		}
	}
	// The original stays as sent.
	if sum := sha256.Sum256(e.files.objects["workspaces/"+b.workspace+"/signatures/"+req.ID+"/original.pdf"]); hex.EncodeToString(sum[:]) != req.OriginalSHA256 {
		t.Fatal("the frozen original changed")
	}
}

func TestSequentialOrder(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	req := e.create(b, newRequest(doc, "sequential", "first@example.com", "second@example.com"))
	if statuses(req) != "sent,waiting" || e.mail.link("second@example.com") != "" {
		t.Fatalf("the second signer was emailed before their turn: %s", statuses(req))
	}
	e.sign(e.mail.link("first@example.com"), http.StatusOK)
	second := e.mail.link("second@example.com")
	if second == "" {
		t.Fatal("the second signer got no link after the first signed")
	}
	if got := e.get(b, req.ID); statuses(got) != "signed,sent" {
		t.Fatalf("statuses %s", statuses(got))
	}
	e.sign(second, http.StatusOK)
	if got := e.get(b, req.ID); got.Status != "completed" {
		t.Fatalf("status %s", got.Status)
	}
}

func TestTokensAreHashedAndExpire(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "one@example.com"))
	token := e.mail.link("one@example.com")
	ctx := context.Background()

	var stored string
	if err := e.raw.QueryRow(ctx, `SELECT token_hash FROM signature_signers WHERE request_id = $1`, req.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == token || stored != hashToken(token) {
		t.Fatal("the database must hold only the token's SHA-256")
	}
	var leaks int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM signature_events WHERE data::text LIKE '%' || $1 || '%'`, token).Scan(&leaks); err != nil || leaks != 0 {
		t.Fatalf("the token is in the audit trail (%v)", err)
	}

	for _, tc := range []struct{ name, token string }{
		{"unknown", strings.Repeat("A", 26)},
		{"lowercase", strings.ToLower(token)},
		{"too short", "ABC"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if code := e.code(nil, "GET", "/api/v1/public/sign/"+tc.token, nil, http.StatusNotFound); code != "link_invalid" {
				t.Fatalf("code %s", code)
			}
		})
	}

	if _, err := e.raw.Exec(ctx, `UPDATE signature_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, req.ID); err != nil {
		t.Fatal(err)
	}
	var v struct {
		Data struct {
			Request struct{ Status string } `json:"request"`
		}
	}
	e.do(nil, "GET", "/api/v1/public/sign/"+token, nil, http.StatusOK, &v)
	if v.Data.Request.Status != "expired" {
		t.Fatalf("status %s", v.Data.Request.Status)
	}
	e.sign(token, http.StatusGone)
	e.do(nil, "GET", "/api/v1/public/sign/"+token+"/document", nil, http.StatusGone, nil)
	if code := e.code(b, "POST", "/api/v1/signatures/"+req.ID+"/remind", nil, http.StatusConflict); code != "not_pending" {
		t.Fatalf("remind an expired request: %s", code)
	}
}

func TestDeclineStopsTheRequest(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "one@example.com", "two@example.com"))
	one := e.mail.link("one@example.com")
	// The sender turned "signature.viewed" off: viewing tells them nothing.
	if err := e.st.SetUserNotificationPrefs(context.Background(), b.user,
		store.NotificationPrefs{"signature.viewed": {Email: false, InApp: false}}, time.Now()); err != nil {
		t.Fatal(err)
	}
	e.do(nil, "GET", "/api/v1/public/sign/"+one, nil, http.StatusOK, nil)
	if code := e.code(nil, "POST", "/api/v1/public/sign/"+one+"/decline", map[string]string{"reason": " "}, http.StatusUnprocessableEntity); code != "validation_failed" {
		t.Fatalf("empty reason: %s", code)
	}
	e.do(nil, "POST", "/api/v1/public/sign/"+one+"/decline", map[string]string{"reason": "Wrong amount in clause 4."}, http.StatusOK, nil)
	got := e.get(b, req.ID)
	if got.Status != "declined" || statuses(got) != "declined,sent" {
		t.Fatalf("after decline: %s %s", got.Status, statuses(got))
	}
	if code := e.code(nil, "POST", "/api/v1/public/sign/"+e.mail.link("two@example.com"), map[string]any{"consent": true,
		"signature": map[string]string{"method": "drawn", "image": signatureDataURL(t)}, "values": map[string]string{}},
		http.StatusConflict); code != "not_signable" {
		t.Fatalf("signing a declined request: %s", code)
	}
	if msgs := e.mail.to(b.email); len(msgs) != 1 || !strings.Contains(msgs[0].Text, "Wrong amount") {
		t.Fatalf("the sender was not told: %+v", msgs)
	}
	bell, err := e.st.Notifications(context.Background(), b.workspace, b.user, store.NotificationFilter{Limit: 10})
	if err != nil || len(bell) != 1 || bell[0].Event != "signature.declined" || !strings.Contains(string(bell[0].Data), "Wrong amount") {
		t.Fatalf("the sender's bell: %+v %v", bell, err)
	}
}

func TestReminderReplacesTheLinkAndRevokeStopsIt(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "one@example.com"))
	old := e.mail.link("one@example.com")
	e.do(b, "POST", "/api/v1/signatures/"+req.ID+"/remind", nil, http.StatusOK, nil)
	fresh := e.mail.link("one@example.com")
	if fresh == old {
		t.Fatal("the reminder sent the same link")
	}
	e.do(nil, "GET", "/api/v1/public/sign/"+old, nil, http.StatusNotFound, nil)
	e.do(nil, "GET", "/api/v1/public/sign/"+fresh, nil, http.StatusOK, nil)
	for range remindPerHour - 1 {
		e.do(b, "POST", "/api/v1/signatures/"+req.ID+"/remind", nil, http.StatusOK, nil)
	}
	if code := e.code(b, "POST", "/api/v1/signatures/"+req.ID+"/remind", nil, http.StatusTooManyRequests); code != "rate_limited" {
		t.Fatalf("sixth reminder in an hour: %s", code)
	}

	e.do(b, "POST", "/api/v1/signatures/"+req.ID+"/revoke", nil, http.StatusOK, nil)
	latest := e.mail.link("one@example.com")
	e.sign(latest, http.StatusConflict)
	e.do(nil, "GET", "/api/v1/public/sign/"+latest+"/document", nil, http.StatusGone, nil)
	if code := e.code(b, "POST", "/api/v1/signatures/"+req.ID+"/revoke", nil, http.StatusConflict); code != "not_pending" {
		t.Fatalf("revoke twice: %s", code)
	}
}

// TestEmailsFromTemplates: with a language, the invitation carries the sender's message under the template's subject,
// and the reminder the workspace's own reminder template; the button, expiry and SES note follow the language.
func TestEmailsFromTemplates(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	if _, err := e.raw.Exec(context.Background(), `INSERT INTO email_templates (workspace_id, kind, language, subject, body, updated_at)
		SELECT workspace_id, 'signature_reminder', 'de', 'Bitte {document} unterschreiben', 'Noch offen: {document}', now()
		FROM documents WHERE id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	body := newRequest(doc, "parallel", "one@example.com")
	body["title"], body["message"], body["language"] = "Vertrag", "Guten Tag\n\nBitte unterschreiben.", "de"
	req := e.create(b, body)
	invite := e.mail.to("one@example.com")[0]
	if invite.Language != "de" || !strings.Contains(invite.Subject, "«Vertrag» zur Unterschrift") ||
		!strings.Contains(invite.HTML, "<p>Guten Tag</p>") || !strings.Contains(invite.HTML, "Prüfen und unterschreiben") ||
		!strings.Contains(invite.HTML, "ZertES") || !strings.Contains(invite.Text, "Bitte unterschreiben.") {
		t.Fatalf("invitation: %+v", invite)
	}
	e.do(b, "POST", "/api/v1/signatures/"+req.ID+"/remind", nil, http.StatusOK, nil)
	reminder := e.mail.to("one@example.com")[1]
	if reminder.Subject != "Bitte Vertrag unterschreiben" || !strings.Contains(reminder.Text, "Noch offen: Vertrag") ||
		strings.Contains(reminder.Text, "Bitte unterschreiben.") {
		t.Fatalf("reminder: %+v", reminder)
	}

	var preview struct {
		Data struct{ Subject, HTML string }
	}
	e.do(b, "POST", "/api/v1/signatures/email-preview", map[string]any{"title": "Offerte", "message": "Hallo", "language": "fr"}, http.StatusOK, &preview)
	if !strings.Contains(preview.Data.Subject, "« Offerte »") || !strings.Contains(preview.Data.HTML, "Vérifier et signer") ||
		!strings.Contains(preview.Data.HTML, "<p>Hallo</p>") {
		t.Fatalf("preview: %+v", preview.Data)
	}
	e.code(b, "POST", "/api/v1/signatures/email-preview", map[string]any{"title": "x", "language": "pl"}, http.StatusUnprocessableEntity)
}

func TestWorkspaceIsolation(t *testing.T) {
	e := newEnv(t)
	a, other := e.workspace(), e.workspace()
	doc, _ := e.pdfDocument(a, samplePDF(t, 2), "application/pdf")
	req := e.create(a, newRequest(doc, "parallel", "one@example.com"))
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/v1/signatures/" + req.ID},
		{"GET", "/api/v1/signatures/" + req.ID + "/original"},
		{"POST", "/api/v1/signatures/" + req.ID + "/remind"},
		{"POST", "/api/v1/signatures/" + req.ID + "/revoke"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			e.do(other, tc.method, tc.path, nil, http.StatusNotFound, nil)
		})
	}
	var list struct{ Data []sigReq }
	e.do(other, "GET", "/api/v1/signatures", nil, http.StatusOK, &list)
	if len(list.Data) != 0 {
		t.Fatal("another workspace's request is listed")
	}
	e.code(other, "POST", "/api/v1/signatures", newRequest(doc, "parallel", "x@example.com"), http.StatusUnprocessableEntity)
	e.do(nil, "GET", "/api/v1/signatures", nil, http.StatusUnauthorized, nil)
}

func TestCreateValidation(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	notPDF, _ := e.pdfDocument(b, []byte("not a pdf at all"), "application/pdf")
	image, _ := e.pdfDocument(b, []byte("\x89PNG"), "image/png")
	with := func(change func(requestBody)) requestBody {
		body := newRequest(doc, "parallel", "one@example.com")
		change(body)
		return body
	}
	for _, tc := range []struct {
		name  string
		body  requestBody
		field string
	}{
		{"no title", with(func(b requestBody) { b["title"] = " " }), "title"},
		{"bad order", with(func(b requestBody) { b["signing_order"] = "random" }), "signing_order"},
		{"unknown language", with(func(b requestBody) { b["language"] = "pl" }), "language"},
		{"long message", with(func(b requestBody) { b["message"] = strings.Repeat("x", 2501) }), "message"},
		{"expiry", with(func(b requestBody) { b["expires_in_days"] = 400 }), "expires_in_days"},
		{"broken pdf", with(func(b requestBody) { b["document_id"] = notPDF }), "document_id"},
		{"not a pdf", with(func(b requestBody) { b["document_id"] = image }), "document_id"},
		{"duplicate signer", newRequest(doc, "parallel", "one@example.com", "ONE@example.com"), "signers.1.email"},
		{"bad email", newRequest(doc, "parallel", "nope"), "signers.0.email"},
		{"off the page", with(func(b requestBody) {
			b["fields"] = []map[string]any{{"signer": 0, "page": 1, "kind": "signature", "x": 0.9, "y": 0.5, "w": 0.3, "h": 0.05}}
		}), "fields.0"},
		{"page beyond the end", with(func(b requestBody) {
			b["fields"] = []map[string]any{{"signer": 0, "page": 3, "kind": "signature", "x": 0.1, "y": 0.5, "w": 0.3, "h": 0.05}}
		}), "fields.0"},
		{"no signature field", with(func(b requestBody) {
			b["fields"] = []map[string]any{{"signer": 0, "page": 1, "kind": "date", "x": 0.1, "y": 0.5, "w": 0.3, "h": 0.05}}
		}), "signers.0"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp, raw := e.send(b, "POST", "/api/v1/signatures", tc.body)
			var out struct {
				Error struct {
					Details struct{ Fields map[string]string } `json:"details"`
				} `json:"error"`
			}
			_ = json.Unmarshal(raw, &out)
			if resp.StatusCode != http.StatusUnprocessableEntity || out.Error.Details.Fields[tc.field] == "" {
				t.Fatalf("status %d, want 422 on %s: %s", resp.StatusCode, tc.field, raw)
			}
		})
	}
}

func TestSigningValidation(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	body := newRequest(doc, "parallel", "one@example.com")
	body["fields"] = append(body["fields"].([]map[string]any),
		map[string]any{"signer": 0, "page": 1, "kind": "text", "x": 0.1, "y": 0.1, "w": 0.3, "h": 0.04, "label": "Job title"})
	e.create(b, body)
	token := e.mail.link("one@example.com")
	sig := signatureDataURL(t)
	for _, tc := range []struct {
		name  string
		body  map[string]any
		field string
	}{
		{"no consent", map[string]any{"consent": false, "signature": map[string]string{"method": "drawn", "image": sig},
			"values": map[string]string{}}, "consent"},
		{"not a png", map[string]any{"consent": true, "signature": map[string]string{"method": "typed", "image": "data:image/jpeg;base64,AAAA"},
			"values": map[string]string{}}, "signature"},
		{"text missing", map[string]any{"consent": true, "signature": map[string]string{"method": "drawn", "image": sig},
			"values": map[string]string{}}, "values."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp, raw := e.send(nil, "POST", "/api/v1/public/sign/"+token, tc.body)
			if resp.StatusCode != http.StatusUnprocessableEntity || !strings.Contains(string(raw), `"`+tc.field) {
				t.Fatalf("status %d, want 422 on %s: %s", resp.StatusCode, tc.field, raw)
			}
		})
	}
}

func TestPublicRateLimit(t *testing.T) {
	e := newEnv(t)
	token := strings.Repeat("A", 26)
	for range publicPerMin {
		e.do(nil, "GET", "/api/v1/public/sign/"+token, nil, http.StatusNotFound, nil)
	}
	resp, _ := e.send(nil, "GET", "/api/v1/public/sign/"+token, nil)
	if resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("status %d after %d requests, want 429 with Retry-After", resp.StatusCode, publicPerMin)
	}
}

func TestAuditTrailIsAppendOnly(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "one@example.com"))
	ctx := context.Background()
	if _, err := e.raw.Exec(ctx, `UPDATE signature_events SET type = 'signed' WHERE request_id = $1`, req.ID); err == nil {
		t.Fatal("an event was changed")
	}
	if _, err := e.raw.Exec(ctx, `DELETE FROM signature_events WHERE request_id = $1`, req.ID); err == nil {
		t.Fatal("an event was deleted")
	}
	events, err := e.st.SignatureEvents(ctx, req.ID)
	if err != nil || !verifyChain(req.ID, events) {
		t.Fatal("the chain does not verify")
	}
	events[0].Type = "revoked"
	if verifyChain(req.ID, events) {
		t.Fatal("a changed event still verifies")
	}
}

func TestNoMailServer(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	open := e.create(b, newRequest(doc, "parallel", "one@example.com"))
	token := e.mail.link("one@example.com")
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, e.st, discard)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	New(e.st, a, e.files, nil, "https://helvetly.example.com", discard).Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	e.srv = srv
	if code := e.code(b, "POST", "/api/v1/signatures", newRequest(doc, "parallel", "one@example.com"), http.StatusServiceUnavailable); code != "mail_unavailable" {
		t.Fatalf("code %s", code)
	}
	e.sign(token, http.StatusServiceUnavailable)
	e.code(nil, "POST", "/api/v1/public/sign/"+token+"/decline", map[string]string{"reason": "Incorrect amount"}, http.StatusServiceUnavailable)
	if got := e.get(b, open.ID); got.Status != "pending" || statuses(got) != "sent" {
		t.Fatalf("mail unavailable changed the request: %+v", got)
	}
}

func TestPDFIsStreamedWithItsHeaders(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	content := samplePDF(t, 2)
	doc, _ := e.pdfDocument(b, content, "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "one@example.com"))
	token := e.mail.link("one@example.com")
	e.files.mu.Lock()
	e.files.gets = 0
	e.files.mu.Unlock()
	for _, tt := range []struct {
		name string
		b    *browser
		path string
	}{
		{"signed in", b, "/api/v1/signatures/" + req.ID + "/original"},
		{"public", nil, "/api/v1/public/sign/" + token + "/document"},
	} {
		resp, body := e.send(tt.b, "GET", tt.path, nil)
		h := resp.Header
		if resp.StatusCode != http.StatusOK || !bytes.Equal(body, content) || h.Get("Content-Type") != "application/pdf" ||
			h.Get("Content-Disposition") != `inline; filename="Consulting agreement.pdf"` || h.Get("Cache-Control") != "private, no-store" ||
			h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Last-Modified") == "" {
			t.Fatalf("%s: %d %v (%d bytes)", tt.name, resp.StatusCode, h, len(body))
		}
	}
	if e.files.gets != 0 {
		t.Fatalf("the PDF was read whole into memory %d times", e.files.gets)
	}
}

// The last two signers sign at the same moment: exactly one request completes it, with one signed document.
func TestConcurrentLastSignaturesCompleteOnce(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 3), "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "one@example.com", "two@example.com"))
	body, err := json.Marshal(map[string]any{"consent": true,
		"signature": map[string]string{"method": "drawn", "image": signatureDataURL(t)}, "values": map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}
	tokens := []string{e.mail.link("one@example.com"), e.mail.link("two@example.com")}
	codes := make([]int, len(tokens))
	errs := make([]error, len(tokens))
	var wg sync.WaitGroup
	for i, token := range tokens {
		wg.Go(func() {
			resp, err := http.Post(e.srv.URL+"/api/v1/public/sign/"+token, "application/json", bytes.NewReader(body))
			if err != nil {
				errs[i] = err
				return
			}
			_ = resp.Body.Close()
			codes[i] = resp.StatusCode
		})
	}
	wg.Wait()
	for i := range tokens {
		if errs[i] != nil || codes[i] != http.StatusOK {
			t.Fatalf("signer %d: %d %v", i, codes[i], errs[i])
		}
	}
	got := e.get(b, req.ID)
	completed := 0
	for _, ev := range got.Events {
		if ev.Type == "completed" {
			completed++
		}
	}
	if got.Status != "completed" || completed != 1 {
		t.Fatalf("status %s with %d completed events", got.Status, completed)
	}
	var signed int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM document_links WHERE target_type = 'signature' AND target_id = $1`,
		req.ID).Scan(&signed); err != nil || signed != 1 {
		t.Fatalf("%d signed documents (%v)", signed, err)
	}
	events, err := e.st.SignatureEvents(context.Background(), req.ID)
	if err != nil || !verifyChain(req.ID, events) {
		t.Fatalf("audit chain does not verify: %v", err)
	}
}

// A frozen original whose bytes no longer match original_sha256 is never stamped and filed as the signed record.
func TestCompletionRefusesAChangedOriginal(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 3), "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "one@example.com"))
	e.files.mu.Lock()
	for key := range e.files.objects {
		if strings.Contains(key, "/signatures/"+req.ID+"/") {
			e.files.objects[key] = samplePDF(t, 4)
		}
	}
	e.files.mu.Unlock()
	if code := e.code(nil, "POST", "/api/v1/public/sign/"+e.mail.link("one@example.com"), map[string]any{"consent": true,
		"signature": map[string]string{"method": "drawn", "image": signatureDataURL(t)}, "values": map[string]string{}},
		http.StatusConflict); code != "original_changed" {
		t.Fatalf("code %q", code)
	}
	if got := e.get(b, req.ID); got.Status != "pending" || got.SignedDocument != nil {
		t.Fatalf("after a changed original: %s %+v", got.Status, got.SignedDocument)
	}
}

// A browser's User-Agent is evidence, not trusted text: bytes that aren't UTF-8 (or a long one cut mid-character)
// must not keep the signer from viewing and signing.
func TestSigningWithANonUTF8UserAgent(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 3), "application/pdf")
	e.create(b, newRequest(doc, "parallel", "one@example.com"))
	token := e.mail.link("one@example.com")
	for _, ua := range []string{"Mozilla/5.0 \xff\xfe", strings.Repeat("a", 499) + "é"} {
		r, err := http.NewRequest("GET", e.srv.URL+"/api/v1/public/sign/"+token, nil)
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("User-Agent", ua)
		resp, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("view with User-Agent %q: %d", ua, resp.StatusCode)
		}
	}
}
