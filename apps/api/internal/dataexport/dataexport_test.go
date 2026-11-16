package dataexport

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"helvetly.com/api/internal/auth"

	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// fakeAuth signs every request in as sess and writes errors like the real API.
type fakeAuth struct {
	*auth.Service
	sess *store.Session
}

func (a fakeAuth) SignedIn(fn func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { fn(w, r, *a.sess) }
}

type fakeFiles map[string]string

func (f fakeFiles) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	body, ok := f[key]
	if !ok {
		return nil, errors.New("no such object")
	}
	return struct {
		io.ReadSeeker
		io.Closer
	}{strings.NewReader(body), io.NopCloser(nil)}, nil
}

type env struct {
	t    *testing.T
	st   *store.Store
	sess *store.Session
	mux  *http.ServeMux
	svc  *Service
}

func newEnv(t *testing.T, files fakeFiles) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	ctx, now := context.Background(), time.Now()
	sess := &store.Session{User: store.User{ID: "usr_a", Email: "anna@example.test", Name: "Anna"},
		Workspace: store.Workspace{ID: "ws_a", Name: "Muster AG", Timezone: "Europe/Zurich"}, Role: "owner"}
	other := store.Workspace{ID: "ws_b", Name: "Other GmbH", Timezone: "Europe/Zurich"}
	for _, err := range []error{
		st.CreateUser(ctx, sess.User, now), st.CreateWorkspace(ctx, sess.Workspace, sess.Workspace.Timezone, now),
		st.AddMember(ctx, sess.Workspace.ID, sess.User.ID, "owner", now),
		st.CreateWorkspace(ctx, other, other.Timezone, now), st.AddMember(ctx, other.ID, sess.User.ID, "owner", now),
		st.CreateClient(ctx, sess.Workspace.ID, "cli_a", map[string]any{"name": "Kunde A"}, now),
		st.CreateClient(ctx, other.ID, "cli_b", map[string]any{"name": "Secret Kunde B"}, now),
		st.CreateDocument(ctx, sess.Workspace.ID, sess.User.ID, store.Document{ID: "doc_a", Name: "../../contract.pdf", ObjectKey: "k/doc_a",
			Size: 4, ContentType: "application/pdf", CreatedAt: now}),
		st.CreateDocument(ctx, sess.Workspace.ID, sess.User.ID, store.Document{ID: "doc_gone", Name: "gone.pdf", ObjectKey: "k/gone",
			Size: 4, ContentType: "application/pdf", CreatedAt: now}),
		st.CreateDocument(ctx, other.ID, sess.User.ID, store.Document{ID: "doc_b", Name: "other.pdf", ObjectKey: "k/doc_b",
			Size: 4, ContentType: "application/pdf", CreatedAt: now}),
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := raw.Exec(ctx, `INSERT INTO workspace_invitations (id, workspace_id, email, role, token_hash, created_at, expires_at)
		VALUES ('inv_a', 'ws_a', 'ben@example.test', 'member', 'secret-token-hash', now(), now() + interval '1 day')`); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(ctx, `INSERT INTO sessions (id, token_hash, csrf_token, user_id, workspace_id, created_at, expires_at, last_active_at)
		VALUES ('ses_a', 'secret-session-hash', 'secret-csrf', 'usr_a', 'ws_a', now(), now() + interval '1 day', now())`); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(ctx, `INSERT INTO quotes (id, workspace_id, client_id, status, number, issue_date, valid_until, currency,
			language, vat_mode, discount_percent, lines, subtotal, discount_amount, net_total, vat_total, total, rounding_amount,
			vat_breakdown, pdf_key, created_at, updated_at)
		VALUES ('quo_a', 'ws_a', 'cli_a', 'sent', 'Q-2026-1', '2026-03-01', '2026-03-31', 'CHF', 'de', 'none', 0, '[]', 0, 0, 0,
			0, 0, 0, '[]', 'k/quo_a', now(), now())`); err != nil {
		t.Fatal(err)
	}
	api, err := auth.New(config.Config{PublicURL: "http://localhost:8000", DevSignIn: true}, st, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	svc := New(st, fakeAuth{api, sess}, files, slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.Register(mux)
	return &env{t: t, st: st, sess: sess, mux: mux, svc: svc}
}

func (e *env) get(path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	e.mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

func TestWorkspaceExport(t *testing.T) {
	e := newEnv(t, fakeFiles{"k/doc_a": "%PDF", "k/doc_b": "%PDF other", "k/quo_a": "%PDF quote"})
	w := e.get("/api/v1/workspace/export")
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "application/zip" {
		t.Fatalf("export: %d %s", w.Code, w.Header())
	}
	z, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string]string{}
	var all strings.Builder
	for _, f := range z.File {
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(r)
		_ = r.Close()
		entries[f.Name] = string(b)
		all.Write(b)
	}
	for _, name := range []string{"data/workspace.json", "data/clients.json", "data/documents.json", "data/invoices.json", "README.txt"} {
		if _, ok := entries[name]; !ok {
			t.Fatalf("missing %s in %v", name, keys(entries))
		}
	}
	for name, body := range entries {
		if strings.HasPrefix(name, "data/") && !json.Valid([]byte(body)) {
			t.Fatalf("%s is not valid JSON: %s", name, body)
		}
	}
	var clients []map[string]any
	_ = json.Unmarshal([]byte(entries["data/clients.json"]), &clients)
	if len(clients) != 1 || clients[0]["name"] != "Kunde A" {
		t.Fatalf("clients: %v", clients)
	}
	if entries["files/documents/doc_a-.._.._contract.pdf"] != "%PDF" {
		t.Fatalf("stored file, kept inside its folder: %v", keys(entries))
	}
	if entries["files/quotes/Q-2026-1.pdf"] != "%PDF quote" {
		t.Fatalf("a sent quote's PDF: %v", keys(entries))
	}
	if !strings.Contains(entries["README.txt"], "documents/doc_gone-gone.pdf") {
		t.Fatalf("a missing object is listed: %s", entries["README.txt"])
	}
	for _, leak := range []string{"Secret Kunde B", "%PDF other", "secret-token-hash", "secret-session-hash", "secret-csrf"} {
		if strings.Contains(all.String(), leak) {
			t.Fatalf("export leaks %q", leak)
		}
	}

	e.sess.Role = "admin"
	if w := e.get("/api/v1/workspace/export"); w.Code != http.StatusForbidden {
		t.Fatalf("admin export: %d", w.Code)
	}
}

func TestAccountExport(t *testing.T) {
	e := newEnv(t, fakeFiles{})
	e.sess.Role = "member" // anyone may export their own data
	w := e.get("/api/v1/account/export")
	var doc map[string]json.RawMessage
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &doc) != nil {
		t.Fatalf("account export: %d %s", w.Code, w.Body)
	}
	for _, key := range []string{"user", "sign_in_identities", "passkeys", "two_factor", "sessions", "api_tokens", "memberships", "heidi_messages", "exported_at"} {
		if _, ok := doc[key]; !ok {
			t.Fatalf("missing %s: %s", key, w.Body)
		}
	}
	var memberships []map[string]any
	_ = json.Unmarshal(doc["memberships"], &memberships)
	var sessions []map[string]any
	_ = json.Unmarshal(doc["sessions"], &sessions)
	if len(memberships) != 2 || len(sessions) != 1 || !strings.Contains(string(doc["user"]), "anna@example.test") {
		t.Fatalf("contents: %s", w.Body)
	}
	if body := w.Body.String(); strings.Contains(body, "secret-session-hash") || strings.Contains(body, "secret-csrf") {
		t.Fatalf("account export leaks session secrets: %s", body)
	}
}

func keys(m map[string]string) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	return out
}

// TestExportCoversEveryTable fails when a migration adds a table that neither export reads nor
// store.ExportExcluded names with its reason, so new workspace or personal data cannot silently miss the exports.
func TestExportCoversEveryTable(t *testing.T) {
	t.Parallel()
	_, raw := storetest.New(t)
	rows, err := raw.Query(context.Background(), `SELECT table_name FROM information_schema.tables
		WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'goose_db_version' ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	tables, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	var queries strings.Builder
	for _, q := range slices.Concat(store.WorkspaceExportTables, store.UserExportTables, store.HRExportTables) {
		queries.WriteString(q.Query + "\n")
	}
	exported := regexp.MustCompile(`(?:FROM|JOIN)\s+(\w+)`).FindAllStringSubmatch(queries.String(), -1)
	read := map[string]bool{}
	for _, m := range exported {
		read[m[1]] = true
	}
	var missing []string
	for _, table := range tables {
		_, excluded := store.ExportExcluded[table]
		if read[table] && excluded {
			t.Errorf("%s is both exported and excluded", table)
		}
		if !read[table] && !excluded {
			missing = append(missing, table)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("tables neither exported nor in store.ExportExcluded: %v", missing)
	}
	for table := range store.ExportExcluded {
		if !slices.Contains(tables, table) {
			t.Errorf("store.ExportExcluded names %s, which is not a table", table)
		}
	}
}

// TestWorkspaceExportCountsAgainstItsSnapshotAllowance: an export is admitted before any byte and settles what it
// sent; a refusal answers with the allowance's error and no ZIP.
func TestWorkspaceExportCountsAgainstItsSnapshotAllowance(t *testing.T) {
	e := newEnv(t, fakeFiles{"k/doc_a": "%PDF", "k/quo_a": "%PDF quote"})
	var sent int64 = -1
	e.svc.SetSnapshots(func(_ context.Context, ws string) (func(int64), error) {
		if ws != "ws_a" {
			t.Errorf("reserved for %s", ws)
		}
		return func(n int64) { sent = n }, nil
	})
	w := e.get("/api/v1/workspace/export")
	if w.Code != http.StatusOK || sent != int64(w.Body.Len()) {
		t.Fatalf("export: %d, settled %d of %d bytes", w.Code, sent, w.Body.Len())
	}
	e.svc.SetSnapshots(func(context.Context, string) (func(int64), error) {
		return nil, auth.Error(http.StatusTooManyRequests, "export_weekly", "Once a week.", nil)
	})
	w = e.get("/api/v1/workspace/export")
	if w.Code != http.StatusTooManyRequests || !strings.Contains(w.Body.String(), "export_weekly") || w.Header().Get("Content-Type") == "application/zip" {
		t.Fatalf("refused export: %d %s", w.Code, w.Body.String())
	}
}
