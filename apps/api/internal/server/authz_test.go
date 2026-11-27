package server_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/avatars"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/books"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/dashboard"
	"helvetly.com/api/internal/dataexport"
	"helvetly.com/api/internal/delivery"
	"helvetly.com/api/internal/documents"
	"helvetly.com/api/internal/dunning"
	"helvetly.com/api/internal/einvoice"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/expenses"
	"helvetly.com/api/internal/feedback"
	"helvetly.com/api/internal/heidi"
	"helvetly.com/api/internal/imports"
	"helvetly.com/api/internal/instalments"
	"helvetly.com/api/internal/invitations"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/ledger"
	"helvetly.com/api/internal/mcp"
	"helvetly.com/api/internal/members"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/portal"
	"helvetly.com/api/internal/portalscope"
	"helvetly.com/api/internal/products"
	"helvetly.com/api/internal/quotes"
	"helvetly.com/api/internal/server"
	"helvetly.com/api/internal/signatures"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
	"helvetly.com/api/internal/templates"
	"helvetly.com/api/internal/vatreturn"
	"helvetly.com/api/internal/workspaces"
)

// memStorage is every storage method any service uses, in memory.
type memStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (m *memStorage) Put(_ context.Context, key string, body io.Reader, _ int64, _, _ string) error {
	b, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objects[key] = b
	return nil
}
func (m *memStorage) Get(_ context.Context, key string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.objects[key]
	if !ok {
		return nil, fs.ErrNotExist
	}
	return b, nil
}
func (m *memStorage) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	b, err := m.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	return nopCloser{bytes.NewReader(b)}, nil
}
func (m *memStorage) PresignDownload(_ context.Context, key string, _ time.Duration, _ string) (string, error) {
	return "https://s3.example.com/" + key, nil
}
func (m *memStorage) ProxyDownloads() bool { return false }
func (m *memStorage) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	delete(m.objects, key)
	m.mu.Unlock()
	return nil
}
func (m *memStorage) Copy(ctx context.Context, src, dst string) error {
	b, err := m.Get(ctx, src)
	if err != nil {
		return err
	}
	return m.Put(ctx, dst, bytes.NewReader(b), int64(len(b)), "", "")
}

type nopCloser struct{ *bytes.Reader }

func (nopCloser) Close() error { return nil }

// app wires every service exactly as cmd/helvetly does (no mail server, no background jobs).
func app(t *testing.T) (http.Handler, *store.Store, *pgxpool.Pool) {
	t.Helper()
	st, pool := storetest.New(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{PublicURL: "https://app.example.com", PortalURL: "https://portal.example.com",
		SecretKey: bytes.Repeat([]byte{7}, 32), SessionTTL: time.Hour, DocumentsMaxUpload: 10 << 20}
	a, err := auth.New(cfg, st, log)
	if err != nil {
		t.Fatal(err)
	}
	a.BearerRoutes = openapi.BearerRoutes("POST /api/mcp")
	a.BearerMember = permissions.MayUseAPI
	for _, r := range openapi.Resources() {
		a.TokenResources = append(a.TokenResources, r.Name)
	}
	files := &memStorage{objects: map[string][]byte{}}
	cl := clients.New(st, a, files, log)
	inv := invoices.New(st, a, files, nil, log)
	qs := quotes.New(st, a, inv, files, nil, log)
	mem := members.New(st, a, log)
	invs := invitations.New(st, a, nil, cfg.PublicURL, log)
	prod := products.New(st, a, log)
	eng := engagements.New(st, a, inv, log)
	inst := instalments.New(st, a, inv, files, log)
	bill, err := billing.New(context.Background(), st, a, cfg, log)
	if err != nil {
		t.Fatal(err)
	}
	st.SetAdmission(bill.AllowResource)
	mem.SetSeats(bill)
	invs.SetSeats(bill)
	inst.SetLimits(bill)
	dun := dunning.New(st, a, inv, files, log)
	ein := einvoice.New(st, a, files)
	inv.SetEInvoice(ein.Export)
	del, err := delivery.New(st, a, ein.Export, cfg.SecretKey, log, delivery.FileExport{})
	if err != nil {
		t.Fatal(err)
	}
	sig := signatures.New(st, a, files, nil, cfg.PublicURL, log)
	opts := heidi.Options{Provider: aimodel.Fake{}, Allowance: bill.AITokens, AllowStorage: bill.AllowStorage}
	m := mcp.New(a, openapi.Operations)
	wsSvc := workspaces.New(st, a, bill, files, log)
	wsSvc.SetPortal(portalscope.New(cfg.PortalURL, st.Q))
	services := []interface{ Register(*http.ServeMux) }{
		m, a, dataexport.New(st, a, files, log), cl, portal.New(st, a, files, portalscope.New(cfg.PortalURL, st.Q), portal.Config{SessionTTL: time.Hour}, log),
		inv, qs, dun, mem, invs, prod, eng, inst, books.New(st, a), vatreturn.New(st, a), ledger.New(st, a), ein, del,
		expenses.New(st, a, files, log), documents.New(st, a, files, cfg.DocumentsMaxUpload, log), sig,
		templates.New(st, a, files, nil, sig, log), bill, wsSvc, dashboard.New(st, a),
		heidi.New(st, a, files, eng, opts), feedback.New(st, a, files, nil, "", log), avatars.New(st, a, files, log),
		imports.New(st, a, files, log, imports.Options{Provider: aimodel.Fake{}, Allowance: bill.AITokens, AllowStorage: bill.AllowStorage}),
		notifications.New(st, a, nil, cfg.PublicURL, cfg.SecretKey, log),
	}
	h := permissions.Guard(a, bill.Guard(server.New(http.NotFoundHandler(), func(mux *http.ServeMux) {
		openapi.Register(mux)
		for _, s := range services {
			s.Register(mux)
		}
	})))
	m.SetAPI(h)
	return h, st, pool
}

var routeLiteral = regexp.MustCompile(`"((?:GET|POST|PUT|PATCH|DELETE) /api/[^"]*)"`)

// registeredRoutes is every route pattern written in the API's source (a few are guard rules, which simply 404 here):
// a new route is covered by the tests below without being listed.
func registeredRoutes(t *testing.T) []string {
	t.Helper()
	var found []string
	err := filepath.WalkDir("..", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return err
		}
		src, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		for _, m := range routeLiteral.FindAllSubmatch(src, -1) {
			if r := string(m[1]); !slices.Contains(found, r) {
				found = append(found, r)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(found)
	if len(found) < 200 {
		t.Fatalf("found only %d routes: is the source walk broken?", len(found))
	}
	return found
}

type person struct{ userID, token, csrf, workspace string }

func signIn(t *testing.T, st *store.Store, pool *pgxpool.Pool, workspace, role string, scopes []string) person {
	t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Tester " + role}
	p := person{userID: u.ID, token: rand.Text(), csrf: rand.Text(), workspace: workspace}
	sum := sha256.Sum256([]byte(p.token))
	for _, err := range []error{
		st.CreateUser(ctx, u, now),
		st.AddMember(ctx, workspace, u.ID, role, now),
		st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), p.csrf, u.ID, workspace, now, now.Add(time.Hour)),
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if scopes != nil {
		if _, err := pool.Exec(ctx, `UPDATE workspace_members SET scopes = $3 WHERE workspace_id = $1 AND user_id = $2`,
			workspace, u.ID, scopes); err != nil {
			t.Fatal(err)
		}
	}
	return p
}

func newWorkspace(t *testing.T, st *store.Store, pool *pgxpool.Pool, name string) person {
	t.Helper()
	ws := auth.NewID("wsp")
	if err := st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: name}, "Europe/Zurich", time.Now()); err != nil {
		t.Fatal(err)
	}
	return signIn(t, st, pool, ws, "owner", nil)
}

func call(h http.Handler, p person, method, path string, body io.Reader, contentType string) (int, []byte) {
	req := httptest.NewRequest(method, path, body)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: p.token})
	req.Header.Set("X-CSRF-Token", p.csrf)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}

func jsonCall(t *testing.T, h http.Handler, p person, method, path string, body any, want int) map[string]any {
	t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	code, raw := call(h, p, method, path, rd, "application/json")
	if code != want {
		t.Fatalf("%s %s: %d, want %d: %s", method, path, code, want, raw)
	}
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return out
}

func dataID(t *testing.T, out map[string]any) string {
	t.Helper()
	d, _ := out["data"].(map[string]any)
	id, _ := d["id"].(string)
	if id == "" {
		t.Fatalf("no data.id in %v", out)
	}
	return id
}

// seeded is workspace A's records, by the path parameter that names them.
type seeded struct {
	ids     map[string]string // "<collection>" for {id} under /api/v1/<collection>, or the parameter name
	secrets []string          // strings only A's data contains
}

func seedA(t *testing.T, h http.Handler, pool *pgxpool.Pool, owner person) seeded {
	t.Helper()
	const secret = "Zyxwvut Alpha Secret"
	s := seeded{ids: map[string]string{}, secrets: []string{secret}}
	jsonCall(t, h, owner, "PUT", "/api/v1/invoice-settings", map[string]any{
		"seller": map[string]any{"name": "Alpha GmbH", "street": "Bahnhofstrasse", "street_number": "1", "zip": "8001",
			"city": "Zürich", "country": "CH", "vat_number": "CHE-109.322.551 MWST", "email": "billing@alpha.example.com"},
		"iban": "CH44 3199 9123 0008 8901 2", "bank_name": "ZKB"}, 200)
	client := dataID(t, jsonCall(t, h, owner, "POST", "/api/v1/clients", map[string]any{"name": secret + " AG",
		"email": "alpha-secret@example.com", "street": "Rue du Lac", "street_number": "12", "zip": "1003", "city": "Lausanne",
		"country": "CH"}, 201))
	s.ids["clients"] = client
	s.ids["contact_id"] = dataID(t, jsonCall(t, h, owner, "POST", "/api/v1/clients/"+client+"/contacts",
		map[string]any{"name": secret + " Contact", "email": "alpha-contact@example.com"}, 201))
	s.ids["products"] = dataID(t, jsonCall(t, h, owner, "POST", "/api/v1/products", map[string]any{"name": secret + " Product", "unit_price": "10"}, 201))
	s.ids["expenses"] = dataID(t, jsonCall(t, h, owner, "POST", "/api/v1/expenses", map[string]any{"supplier_name": secret + " Supplier", "document_date": "2026-11-02"}, 201))
	s.ids["expense-categories"] = dataID(t, jsonCall(t, h, owner, "POST", "/api/v1/expense-categories", map[string]any{"name": "Alpha cat", "account_code": "6010"}, 201))
	line := map[string]any{"description": secret + " line", "quantity": "1", "unit": "hour", "unit_price": "100.00"}
	s.ids["invoices"] = dataID(t, jsonCall(t, h, owner, "POST", "/api/v1/invoices", map[string]any{"client_id": client, "lines": []any{line}}, 201))
	s.ids["quotes"] = dataID(t, jsonCall(t, h, owner, "POST", "/api/v1/quotes", map[string]any{"client_id": client, "lines": []any{line}}, 201))
	s.ids["engagements"] = dataID(t, jsonCall(t, h, owner, "POST", "/api/v1/engagements", map[string]any{"client_id": client, "title": secret + " work",
		"quantity": "30", "unit_price": "100", "unit": "hour", "start_date": "2026-11-01", "recurrence": "monthly", "vat_category": "Z"}, 201))

	issued := dataID(t, jsonCall(t, h, owner, "POST", "/api/v1/invoices", map[string]any{"client_id": client, "lines": []any{line}}, 201))
	jsonCall(t, h, owner, "POST", "/api/v1/invoices/"+issued+"/issue", nil, 200)
	paid := jsonCall(t, h, owner, "POST", "/api/v1/invoices/"+issued+"/payments", map[string]any{"amount": "1", "method": "cash"}, 201)
	if d, _ := paid["data"].(map[string]any); d != nil {
		if ps, _ := d["payments"].([]any); len(ps) > 0 {
			s.ids["payment_id"], _ = ps[0].(map[string]any)["id"].(string)
		}
	}
	entry := jsonCall(t, h, owner, "POST", "/api/v1/engagements/"+s.ids["engagements"]+"/entries",
		map[string]any{"quantity": "2", "date": "2026-11-02", "note": secret + " entry"}, 201)
	s.ids["entry_id"] = dataID(t, map[string]any{"data": entry["data"].(map[string]any)["entry"]})
	s.ids["folders"] = dataID(t, jsonCall(t, h, owner, "POST", "/api/v1/documents/folders", map[string]any{"name": "Alpha folder"}, 201))
	s.ids["invitations"] = dataID(t, jsonCall(t, h, owner, "POST", "/api/v1/members/invitations",
		map[string]any{"email": "alpha-invitee@example.com", "role": "member"}, 201))
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	w, _ := mw.CreateFormFile("file", "alpha-secret.pdf")
	_, _ = w.Write([]byte("%PDF-1.4\n% " + secret + "\n%%EOF\n"))
	_ = mw.Close()
	code, raw := call(h, owner, "POST", "/api/v1/documents", &buf, mw.FormDataContentType())
	if code != 201 {
		t.Fatalf("upload: %d %s", code, raw)
	}
	var doc map[string]any
	_ = json.Unmarshal(raw, &doc)
	s.ids["documents"] = dataID(t, doc)
	jsonCall(t, h, owner, "POST", "/api/v1/documents/"+s.ids["documents"]+"/shares", map[string]any{"client_id": client}, 204)
	s.ids["members"] = owner.userID
	s.ids["user_id"] = owner.userID

	ctx := context.Background()
	var period string
	if err := pool.QueryRow(ctx, `SELECT id FROM engagement_periods WHERE engagement_id = $1 LIMIT 1`, s.ids["engagements"]).Scan(&period); err == nil {
		s.ids["period_id"] = period
	}
	var notification int64
	if err := pool.QueryRow(ctx, `INSERT INTO notifications (workspace_id, user_id, event, data, in_app, created_at)
		VALUES ($1, $2, 'client.change_requested', '{}', true, now()) RETURNING id`, owner.workspace, owner.userID).Scan(&notification); err != nil {
		t.Fatal(err)
	}
	s.ids["notifications"] = fmt.Sprint(notification)
	if _, err := pool.Exec(ctx, `INSERT INTO heidi_conversations (workspace_id, user_id, id, created_at, updated_at)
		VALUES ($1, $2, 'conv_alpha_secret', now(), now())`, owner.workspace, owner.userID); err != nil {
		t.Fatal(err)
	}
	s.ids["heidi"] = "conv_alpha_secret"
	for param, q := range map[string]string{
		"file_id": `SELECT id FROM documents WHERE workspace_id = $1 LIMIT 1`,
	} {
		var id string
		if pool.QueryRow(ctx, q, owner.workspace).Scan(&id) == nil {
			s.ids[param] = id
		}
	}
	s.secrets = append(s.secrets, client, s.ids["invoices"], s.ids["quotes"], s.ids["engagements"], s.ids["documents"],
		s.ids["products"], s.ids["expenses"], s.ids["contact_id"], s.ids["expense-categories"], owner.userID, owner.workspace,
		s.ids["entry_id"], s.ids["folders"], s.ids["invitations"], issued, "conv_alpha_secret")
	if id := s.ids["payment_id"]; id != "" {
		s.secrets = append(s.secrets, id)
	}
	return s
}

var param = regexp.MustCompile(`\{([A-Za-z_]+)\}`)

// fill puts A's record ids into a route's path parameters; ok is false when some parameter has no seeded record.
func (s seeded) fill(path string) (string, bool) {
	segs := strings.Split(path, "/")
	ok := true
	for i, seg := range segs {
		m := param.FindStringSubmatch(seg)
		if m == nil {
			continue
		}
		key := m[1]
		if key == "id" && i > 0 {
			key = segs[i-1]
		}
		switch key {
		case "conversations":
			key = "heidi"
		case "client_id":
			key = "clients"
		}
		id, found := s.ids[key]
		if !found {
			id, ok = "x_unseeded", false
		}
		segs[i] = id
	}
	return strings.Join(segs, "/"), ok
}

// bodies: an empty object, then one body per foreign reference a handler might accept (unknown fields are refused
// with 400, so each reference is tried alone).
func (s seeded) bodies() []map[string]any {
	out := []map[string]any{{}}
	for _, f := range []struct{ field, key string }{
		{"client_id", "clients"}, {"invoice_id", "invoices"}, {"quote_id", "quotes"}, {"product_id", "products"},
		{"expense_id", "expenses"}, {"engagement_id", "engagements"}, {"document_id", "documents"},
		{"category_id", "expense-categories"}, {"contact_id", "contact_id"}, {"user_id", "members"},
		{"workspace_id", "workspace"}, {"source_invoice_id", "invoices"}, {"corrects_invoice_id", "invoices"},
	} {
		out = append(out, map[string]any{f.field: s.ids[f.key]})
	}
	for _, f := range []struct{ field, key string }{{"ids", "clients"}, {"prepayment_ids", "invoices"}, {"document_ids", "documents"},
		{"invoice_ids", "invoices"}, {"client_ids", "clients"}} {
		out = append(out, map[string]any{f.field: []string{s.ids[f.key]}})
	}
	return out
}

// publicRoute: no staff session involved (sign-in, portal, public signing, webhooks); covered by their packages.
func publicRoute(path string) bool {
	return strings.HasPrefix(path, "/api/v1/public/") || strings.HasPrefix(path, "/api/v1/auth/") ||
		strings.HasPrefix(path, "/api/webhooks/") || path == "/api/health" || path == "/api/v1/openapi.json"
}

// TestCrossWorkspaceIsolation: the owner of workspace B, who has every scope, replays workspace A's record ids on
// every route the API serves (path, query and body references). No answer may be a success on A's ids or carry A's
// data, and A's records must be unchanged afterwards.
func TestCrossWorkspaceIsolation(t *testing.T) {
	h, st, pool := app(t)
	a := newWorkspace(t, st, pool, "Alpha")
	b := newWorkspace(t, st, pool, "Beta")
	s := seedA(t, h, pool, a)
	s.ids["workspace"] = a.workspace

	snapshot := func() map[string]string {
		out := map[string]string{}
		for _, p := range []string{"/api/v1/clients/" + s.ids["clients"], "/api/v1/clients/" + s.ids["clients"] + "/contacts",
			"/api/v1/invoices/" + s.ids["invoices"], "/api/v1/quotes/" + s.ids["quotes"], "/api/v1/products/" + s.ids["products"],
			"/api/v1/expenses/" + s.ids["expenses"], "/api/v1/engagements/" + s.ids["engagements"],
			"/api/v1/documents/" + s.ids["documents"], "/api/v1/documents/" + s.ids["documents"] + "/shares",
			"/api/v1/members", "/api/v1/members/invitations", "/api/v1/expense-categories",
			"/api/v1/engagements/" + s.ids["engagements"] + "/entries", "/api/v1/notifications", "/api/v1/invoice-settings"} {
			code, raw := call(h, a, "GET", p, nil, "")
			out[p] = fmt.Sprintf("%d %s", code, raw)
		}
		return out
	}
	before := snapshot()

	query := "?client_id=" + s.ids["clients"] + "&invoice_id=" + s.ids["invoices"] + "&engagement_id=" + s.ids["engagements"] +
		"&document_id=" + s.ids["documents"] + "&folder_id=" + s.ids["documents"] + "&workspace_id=" + a.workspace
	statuses, unseeded := replay(t, h, b, s, query, func(route, target string, body map[string]any, idRoute bool, code int, raw []byte) {
		if idRoute && code >= 200 && code < 300 && !idempotent[route] {
			t.Errorf("%s with A's ids %s body %v: %d %s", route, target, body, code, truncate(raw))
		}
		for _, secret := range s.secrets {
			if bytes.Contains(raw, []byte(secret)) {
				t.Errorf("%s %s body %v: answer carries A's %q: %d %s", route, target, body, secret, code, truncate(raw))
			}
		}
	})
	// B cannot move their session into A's workspace.
	if code, raw := call(h, b, "POST", "/api/v1/session/workspace", strings.NewReader(`{"workspace_id":"`+a.workspace+`"}`),
		"application/json"); code < 400 || bytes.Contains(raw, []byte(a.workspace)) {
		t.Errorf("B switched into A: %d %s", code, raw)
	}
	if statuses[401] > 1 {
		t.Errorf("B was signed out during the replay: %v", statuses)
	}

	// MCP: B's write:* API token calls every tool with A's ids in its path parameters and body references.
	tok := jsonCall(t, h, b, "POST", "/api/v1/account/tokens", map[string]any{"name": "beta", "scopes": []string{"write:*"}}, 201)
	secret, _ := tok["data"].(map[string]any)["token"].(string)
	for i, op := range openapi.Operations {
		args := map[string]any{}
		path, seededAll := s.fill(op.Path)
		pathSegs, opSegs := strings.Split(path, "/"), strings.Split(op.Path, "/")
		for _, prm := range op.Params {
			switch {
			case prm.In == "path":
				args[prm.Name] = pathSegs[slices.Index(opSegs, "{"+prm.Name+"}")]
			case strings.HasSuffix(prm.Name, "client_id"):
				args[prm.Name] = s.ids["clients"]
			}
		}
		bodies := []map[string]any{nil}
		if op.Body != nil && !op.Upload {
			bodies = s.bodies()
		}
		for _, body := range bodies {
			if body != nil {
				args["body"] = body
			}
			raw, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": i, "method": "tools/call",
				"params": map[string]any{"name": op.ID, "arguments": args}})
			req := httptest.NewRequest("POST", "/api/mcp", bytes.NewReader(raw))
			req.Header.Set("Authorization", "Bearer "+secret)
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			out := rec.Body.Bytes()
			if strings.Contains(op.Path, "{") && seededAll && !idempotent[op.Method+" "+op.Path] && bytes.Contains(out, []byte(`"isError":false`)) {
				t.Errorf("MCP %s with A's ids %v: success %s", op.ID, args, truncate(out))
			}
			for _, sec := range s.secrets {
				if bytes.Contains(out, []byte(sec)) {
					t.Errorf("MCP %s %v: answer carries A's %q: %s", op.ID, args, sec, truncate(out))
				}
			}
		}
	}

	after := snapshot()
	for p, v := range before {
		if after[p] != v {
			t.Errorf("A's %s changed:\nbefore %s\nafter  %s", p, truncate([]byte(v)), truncate([]byte(after[p])))
		}
	}
	// Guard against a vacuous pass (B signed out everywhere): B's own reads must succeed.
	if statuses[200] < 40 || statuses[401] > 1 { // the one 401: passkeys/finish with an unparsable credential
		t.Errorf("B's answers look wrong (signed out?): %v", statuses)
	}
	t.Logf("statuses: %v", statuses)
	t.Logf("routes whose parameters had no seeded record in A (checked for leaks only): %d %v", len(unseeded), unseeded)
}

// replay sends every registered staff route as actor, with s's ids in path, query and body references, and hands
// each answer to check. It returns the status counts and the routes some of whose parameters had no seeded record.
func replay(t *testing.T, h http.Handler, actor person, s seeded, query string,
	check func(route, target string, body map[string]any, idRoute bool, code int, raw []byte)) (map[int]int, []string) {
	t.Helper()
	var unseeded []string
	statuses := map[int]int{}
	for _, route := range registeredRoutes(t) {
		method, pattern, _ := strings.Cut(route, " ")
		if publicRoute(pattern) || pattern == "/api/mcp" || route == "DELETE /api/v1/session" || route == "DELETE /api/v1/account" ||
			route == "DELETE /api/v1/account/sessions" || route == "DELETE /api/v1/workspace" ||
			route == "POST /api/v1/session/workspace" || route == "POST /api/v1/workspaces" {
			continue // ends or moves the actor's own session: checked on their own below and in their packages
		}
		path, seededAll := s.fill(pattern)
		if !seededAll {
			unseeded = append(unseeded, route)
		}
		bodies := []map[string]any{nil}
		if method != "GET" {
			bodies = s.bodies()
		}
		for _, body := range bodies {
			var rd io.Reader
			if body != nil {
				raw, _ := json.Marshal(body)
				rd = bytes.NewReader(raw)
			}
			code, raw := call(h, actor, method, path+query, rd, "application/json")
			statuses[code]++
			check(route, path+query, body, strings.Contains(pattern, "{") && seededAll, code, raw)
		}
	}
	return statuses, unseeded
}

// TestScopesAcrossRoutes: a member of workspace A whose only scope is read:products replays every route on A's own
// records. Apart from their own account, session and inbox, nothing may succeed as a write, and no answer may carry
// A's clients, invoices, quotes, engagements, documents, expenses or members.
func TestScopesAcrossRoutes(t *testing.T) {
	h, st, pool := app(t)
	a := newWorkspace(t, st, pool, "Alpha")
	s := seedA(t, h, pool, a)
	s.ids["workspace"] = a.workspace
	m := signIn(t, st, pool, a.workspace, "member", []string{"read:products"})
	hidden := []string{"alpha-secret@example.com", "alpha-contact@example.com", s.ids["clients"], s.ids["invoices"],
		s.ids["quotes"], s.ids["engagements"], s.ids["documents"], s.ids["expenses"], s.ids["entry_id"], s.ids["folders"],
		s.ids["invitations"], "alpha-invitee@example.com", s.ids["contact_id"]}
	query := "?client_id=" + s.ids["clients"] + "&invoice_id=" + s.ids["invoices"] + "&engagement_id=" + s.ids["engagements"]
	statuses, _ := replay(t, h, m, s, query, func(route, target string, body map[string]any, _ bool, code int, raw []byte) {
		method, pattern, _ := strings.Cut(route, " ")
		if method != "GET" && code >= 200 && code < 300 && !anyMember(pattern) {
			t.Errorf("read:products member: %s %s body %v: %d %s", route, target, body, code, truncate(raw))
		}
		for _, secret := range hidden {
			if bytes.Contains(raw, []byte(secret)) {
				t.Errorf("read:products member: %s %s body %v: answer carries %q: %d %s", route, target, body, secret, code, truncate(raw))
			}
		}
	})
	if statuses[200] < 15 || statuses[403] < 100 || statuses[401] > 1 {
		t.Errorf("the member's answers look wrong: %v", statuses)
	}
	t.Logf("statuses: %v", statuses)
}

// anyMember: routes every member may write whatever their scopes: their own account, session, inbox, feedback,
// Heidi conversation, and creating a workspace of their own.
func anyMember(pattern string) bool {
	for _, p := range []string{"/api/v1/account", "/api/v1/session", "/api/v1/notifications", "/api/v1/feedback",
		"/api/v1/heidi", "/api/v1/workspaces"} {
		if pattern == p || strings.HasPrefix(pattern, p+"/") {
			return true
		}
	}
	return false
}

// idempotent: removals that answer 204 whether or not the row exists in the caller's workspace (scoped by
// workspace in SQL); the snapshot proves A's row survives.
var idempotent = map[string]bool{"DELETE /api/v1/documents/{id}/shares": true}

func truncate(b []byte) string {
	if len(b) > 400 {
		return string(b[:400]) + "…"
	}
	return string(b)
}

// TestPortalAndStaffSessionsDoNotCross: a client's portal session never opens a staff route (whatever cookie name it
// is sent under), and a staff session never opens the portal.
func TestPortalAndStaffSessionsDoNotCross(t *testing.T) {
	h, st, pool := app(t)
	a := newWorkspace(t, st, pool, "Alpha")
	s := seedA(t, h, pool, a)
	ctx, now := context.Background(), time.Now()
	if _, err := pool.Exec(ctx, `UPDATE clients SET portal_enabled = true WHERE id = $1`, s.ids["clients"]); err != nil {
		t.Fatal(err)
	}
	token, csrf := rand.Text(), rand.Text()
	sum := sha256.Sum256([]byte(token))
	if err := st.CreatePortalSession(ctx, auth.NewID("pse"), hex.EncodeToString(sum[:]), csrf, "alpha-secret@example.com",
		s.ids["clients"], "", a.workspace, true, now, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	// Portal sessions live at a workspace's own address only.
	if _, err := pool.Exec(ctx, `INSERT INTO portal_slugs (slug, workspace_id, created_at) VALUES ('alpha-authz', $1, now())`, a.workspace); err != nil {
		t.Fatal(err)
	}
	portalCookie := "helvetly_portal_session_" + a.workspace
	// The scope resolver in front, as in main: /w/<slug>/api/… reaches the handlers scoped.
	h = portalscope.New("https://portal.example.com", st.Q).Handler(h)
	send := func(cookie, value, method, path string) int {
		req := httptest.NewRequest(method, path, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", csrf)
		req.AddCookie(&http.Cookie{Name: cookie, Value: value})
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if code := send(portalCookie, token, "GET", "/w/alpha-authz/api/v1/public/portal/invoices"); code != 200 {
		t.Fatalf("the portal session itself does not work: %d", code)
	}
	for _, route := range registeredRoutes(t) {
		method, pattern, _ := strings.Cut(route, " ")
		if publicRoute(pattern) {
			continue
		}
		path, _ := s.fill(pattern)
		for _, cookie := range []string{portalCookie, "helvetly_portal_session", "helvetly_session"} {
			if code := send(cookie, token, method, path); code < 400 {
				t.Errorf("portal session as %s opened %s: %d", cookie, route, code)
			}
		}
	}
	staff := a.token
	for _, path := range []string{"/api/v1/public/portal/session", "/api/v1/public/portal/invoices", "/api/v1/public/portal/documents"} {
		for _, cookie := range []string{"helvetly_portal_session", "helvetly_session"} {
			if code := send(cookie, staff, "GET", path); code != http.StatusUnauthorized {
				t.Errorf("staff session as %s opened %s: %d", cookie, path, code)
			}
		}
	}
}

// TestListLimitsMatchSpec: every documented page size maximum (page_size, limit) is enforced: one above it is
// refused or capped.
func TestListLimitsMatchSpec(t *testing.T) {
	h, st, pool := app(t)
	a := newWorkspace(t, st, pool, "Alpha")
	checked := 0
	for _, op := range openapi.Operations {
		for _, prm := range op.Params {
			if prm.In != "query" || (prm.Name != "limit" && prm.Name != "page_size") || strings.Contains(op.Path, "{") {
				continue
			}
			checked++
			var schema struct{ Maximum int }
			if err := json.Unmarshal(prm.Schema, &schema); err != nil || schema.Maximum == 0 {
				t.Errorf("%s: limit without a maximum", op.ID)
				continue
			}
			code, raw := call(h, a, "GET", fmt.Sprintf("%s?%s=%d&q=a", op.Path, prm.Name, schema.Maximum+1), nil, "")
			if code >= 400 && code < 500 {
				continue
			}
			var out struct {
				Meta map[string]any `json:"meta"`
			}
			_ = json.Unmarshal(raw, &out)
			size, _ := out.Meta["limit"].(float64)
			if s, ok := out.Meta["page_size"].(float64); ok {
				size = s
			}
			if code != 200 || size == 0 || int(size) > schema.Maximum {
				t.Errorf("%s ?%s=%d: %d meta %v %s", op.ID, prm.Name, schema.Maximum+1, code, out.Meta, truncate(raw))
			}
		}
	}
	if checked < 8 {
		t.Errorf("only %d documented page sizes found", checked)
	}
}

func bearer(h http.Handler, secret, method, path string) int {
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Authorization", "Bearer "+secret)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func tokenFor(t *testing.T, h http.Handler, p person, scopes ...string) (id, secret string) {
	t.Helper()
	out := jsonCall(t, h, p, "POST", "/api/v1/account/tokens", map[string]any{"name": "ci", "scopes": scopes}, 201)
	d, _ := out["data"].(map[string]any)
	id, _ = d["id"].(string)
	secret, _ = d["token"].(string)
	return id, secret
}

// TestAccessChangesApplyImmediately: a narrowed scope, a revoked session or token and a removal take effect on the
// very next request of an existing session or API token.
func TestAccessChangesApplyImmediately(t *testing.T) {
	h, st, pool := app(t)
	a := newWorkspace(t, st, pool, "Alpha")
	m := signIn(t, st, pool, a.workspace, "member", nil)
	revoked, revokedSecret := tokenFor(t, h, m, "read:*")
	_, kept := tokenFor(t, h, m, "read:*")
	reads := func(want int, what string) {
		t.Helper()
		if code, _ := call(h, m, "GET", "/api/v1/clients", nil, ""); code != want {
			t.Errorf("%s: session read %d, want %d", what, code, want)
		}
		if code := bearer(h, kept, "GET", "/api/v1/clients"); code != want {
			t.Errorf("%s: token read %d, want %d", what, code, want)
		}
	}
	reads(200, "full access")

	jsonCall(t, h, a, "PATCH", "/api/v1/members/"+m.userID, map[string]any{"scopes": []string{"read:products", "read:api"}}, 200)
	reads(403, "scopes narrowed")
	if code := bearer(h, kept, "GET", "/api/v1/products"); code != 200 {
		t.Errorf("token within narrowed scopes: %d", code)
	}

	jsonCall(t, h, m, "DELETE", "/api/v1/account/tokens/"+revoked, nil, 204)
	if code := bearer(h, revokedSecret, "GET", "/api/v1/products"); code != 401 {
		t.Errorf("revoked token: %d", code)
	}

	other := m
	other.token = rand.Text()
	sum := sha256.Sum256([]byte(other.token))
	sid := auth.NewID("ses")
	ctx, now := context.Background(), time.Now()
	if err := st.CreateSession(ctx, sid, hex.EncodeToString(sum[:]), other.csrf, m.userID, a.workspace, now, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	jsonCall(t, h, m, "DELETE", "/api/v1/account/sessions/"+sid, nil, 204)
	if code, _ := call(h, other, "GET", "/api/v1/session", nil, ""); code != 401 {
		t.Errorf("revoked session: %d", code)
	}

	// without the api area the person's tokens stop working, though the scopes behind them are unchanged
	jsonCall(t, h, a, "PATCH", "/api/v1/members/"+m.userID, map[string]any{"scopes": []string{"read:products"}}, 200)
	if code := bearer(h, kept, "GET", "/api/v1/products"); code != 403 {
		t.Errorf("token without the api area: %d", code)
	}
	if code, _ := call(h, m, "GET", "/api/v1/products", nil, ""); code != 200 {
		t.Errorf("session without the api area: %d", code)
	}

	jsonCall(t, h, a, "DELETE", "/api/v1/members/"+m.userID, nil, 204)
	if code, _ := call(h, m, "GET", "/api/v1/session", nil, ""); code != 401 {
		t.Errorf("removed member's session: %d", code)
	}
	if code := bearer(h, kept, "GET", "/api/v1/products"); code != 401 {
		t.Errorf("removed member's token: %d", code)
	}
}

func TestClientCollectionsFollowTheActiveWorkspace(t *testing.T) {
	h, st, pool := app(t)
	alpha := newWorkspace(t, st, pool, "Alpha")
	beta := newWorkspace(t, st, pool, "Beta")
	if err := st.AddMember(t.Context(), beta.workspace, alpha.userID, "member", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE workspace_members SET scopes = ARRAY['read:clients'] WHERE workspace_id=$1 AND user_id=$2`, beta.workspace, alpha.userID); err != nil {
		t.Fatal(err)
	}
	const path = "/api/v1/clients"
	create := func(owner person, name string) string {
		t.Helper()
		return dataID(t, jsonCall(t, h, owner, "POST", path, map[string]any{"name": name}, http.StatusCreated))
	}
	wantAlpha := []string{create(alpha, "Alpha one"), create(alpha, "Alpha two")}
	wantBeta := []string{create(beta, "Beta only")}
	check := func(actor person, want []string) {
		t.Helper()
		code, raw := call(h, actor, "GET", path, nil, "")
		var list struct {
			Data []struct{ ID string }
			Meta struct{ Total int }
		}
		if code != http.StatusOK || json.Unmarshal(raw, &list) != nil || list.Meta.Total != len(want) {
			t.Fatalf("list status %d, body %s", code, raw)
		}
		var ids []string
		for _, client := range list.Data {
			ids = append(ids, client.ID)
		}
		slices.Sort(ids)
		slices.Sort(want)
		if !slices.Equal(ids, want) {
			t.Fatalf("clients = %v, want %v", ids, want)
		}
	}
	check(alpha, wantAlpha)
	req := httptest.NewRequest("POST", "/api/v1/session/workspace", strings.NewReader(`{"workspace_id":"`+beta.workspace+`"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", alpha.csrf)
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: alpha.token})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var switched struct {
		CSRF string `json:"csrf_token"`
	}
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &switched) != nil || switched.CSRF == "" || len(rec.Result().Cookies()) != 1 {
		t.Fatalf("switch status %d, body %s", rec.Code, rec.Body)
	}
	current := person{token: rec.Result().Cookies()[0].Value, csrf: switched.CSRF}
	check(current, wantBeta)
	jsonCall(t, h, current, "POST", path, map[string]any{"name": "Member draft"}, http.StatusForbidden)
	jsonCall(t, h, alpha, "GET", path, nil, http.StatusUnauthorized)
	if _, err := pool.Exec(t.Context(), `UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`, alpha.userID); err != nil {
		t.Fatal(err)
	}
	jsonCall(t, h, current, "GET", path, nil, http.StatusUnauthorized)
	check(beta, wantBeta)
}

// TestDocumentedStatusesForReads: each catalogue read, called by A's owner on A's own records, answers a status the
// spec documents for it (an error answer is covered by a documented "default"), never a 5xx.
func TestDocumentedStatusesForReads(t *testing.T) {
	h, st, pool := app(t)
	a := newWorkspace(t, st, pool, "Alpha")
	s := seedA(t, h, pool, a)
	_, raw := call(h, a, "GET", "/api/v1/openapi.json", nil, "")
	var doc struct {
		Paths map[string]map[string]struct {
			Responses map[string]any `json:"responses"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	for _, op := range openapi.Operations {
		path, ok := s.fill(op.Path)
		if op.Method != "GET" || !ok {
			continue
		}
		code, body := call(h, a, "GET", path, nil, "")
		responses := doc.Paths[op.Path]["get"].Responses
		_, documented := responses[fmt.Sprint(code)]
		if _, errors := responses["default"]; code >= 400 && errors {
			documented = true
		}
		if !documented || code >= 500 {
			t.Errorf("%s GET %s: %d is not documented: %s", op.ID, path, code, truncate(body))
		}
	}
}
