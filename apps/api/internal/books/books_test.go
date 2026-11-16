package books

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type env struct {
	t    *testing.T
	st   *store.Store
	pool *pgxpool.Pool
	srv  *httptest.Server
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, pool := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.Register(mux)
	New(st, a).Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, pool: pool, srv: srv}
}

type browser struct{ token, csrf, workspace, user, name string }

func (e *env) workspace() *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, "UTC", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return e.join(ws, "owner")
}

func (e *env) join(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna " + role}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws, user: u.ID, name: u.Name}
	sum := sha256.Sum256([]byte(b.token))
	for _, err := range []error{
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, role, now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), b.csrf, u.ID, ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	return b
}

func (e *env) client(ws string) string {
	e.t.Helper()
	id := auth.NewID("cli")
	if err := e.st.CreateClient(context.Background(), ws, id, map[string]any{"name": "Supplier AG"}, time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *env) send(b *browser, method, path string, body any) (*http.Response, []byte) {
	e.t.Helper()
	var rd io.Reader
	switch v := body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(v)
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			e.t.Fatal(err)
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, e.srv.URL+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	if rd != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
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

func (e *env) fails(b *browser, method, path string, body any, status int, code string, fields ...string) {
	e.t.Helper()
	var out struct {
		Error struct {
			Code    string `json:"code"`
			Details struct {
				Fields map[string]string `json:"fields"`
			} `json:"details"`
		} `json:"error"`
	}
	e.do(b, method, path, body, status, &out)
	if out.Error.Code != code {
		e.t.Fatalf("%s %s: code %q, want %q", method, path, out.Error.Code, code)
	}
	got := []string{}
	for f := range out.Error.Details.Fields {
		got = append(got, f)
	}
	slices.Sort(got)
	slices.Sort(fields)
	if !slices.Equal(got, append([]string{}, fields...)) {
		e.t.Fatalf("%s %s: fields %v, want %v", method, path, got, fields)
	}
}

func (e *env) logEvents(ws string, actor *string, subjects ...string) {
	e.t.Helper()
	for _, s := range subjects {
		if err := e.st.LogEvent(context.Background(), store.FinancialEvent{WorkspaceID: ws, Kind: "invoice.issued",
			SubjectType: "invoice", SubjectID: s, ActorID: actor, At: time.Now(),
			Payload: json.RawMessage(`{"number": "2026-001"}`)}); err != nil {
			e.t.Fatal(err)
		}
	}
}

type eventOut struct {
	Seq         int64           `json:"seq"`
	Kind        string          `json:"kind"`
	SubjectType string          `json:"subject_type"`
	SubjectID   string          `json:"subject_id"`
	Actor       *person         `json:"actor"`
	Payload     json.RawMessage `json:"payload"`
	PrevHash    string          `json:"prev_hash"`
	Hash        string          `json:"hash"`
}

type logPage struct {
	Data []eventOut `json:"data"`
	Meta struct {
		NextCursor *string `json:"next_cursor"`
	} `json:"meta"`
}

func TestPeriodsCloseReopenLogged(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	member := e.join(owner.workspace, "member")

	var closed struct {
		Data struct {
			Month    string  `json:"month"`
			ClosedAt string  `json:"closed_at"`
			ClosedBy *person `json:"closed_by"`
		} `json:"data"`
	}
	e.do(owner, "POST", "/api/v1/periods", map[string]string{"month": "2025-09"}, 201, nil)
	e.do(owner, "POST", "/api/v1/periods", map[string]string{"month": "2025-10"}, 201, &closed)
	if closed.Data.Month != "2025-10" || closed.Data.ClosedBy == nil || closed.Data.ClosedBy.Name != owner.name ||
		closed.Data.ClosedAt == "" {
		t.Fatalf("closed: %+v", closed.Data)
	}
	e.fails(owner, "POST", "/api/v1/periods", map[string]string{"month": "2025-10"}, 409, "conflict")
	current := time.Now().UTC().Format("2006-01")
	for _, m := range []string{"2026-1", "2026-13", "x", "", current} {
		e.fails(owner, "POST", "/api/v1/periods", map[string]string{"month": m}, 422, "validation_failed", "month")
	}
	e.fails(owner, "POST", "/api/v1/periods", `{"month": "2025-08", "x": 1}`, 400, "invalid_request")

	var list struct {
		Data []struct {
			Month string `json:"month"`
		} `json:"data"`
	}
	e.do(member, "GET", "/api/v1/periods", nil, 200, &list)
	if len(list.Data) != 2 || list.Data[0].Month != "2025-10" || list.Data[1].Month != "2025-09" {
		t.Fatalf("periods: %+v", list.Data)
	}

	var reopened struct {
		Data struct {
			Month string `json:"month"`
		} `json:"data"`
	}
	e.do(owner, "POST", "/api/v1/periods/2025-10/reopen", nil, 200, &reopened)
	if reopened.Data.Month != "2025-10" {
		t.Fatalf("reopened: %+v", reopened.Data)
	}
	e.fails(owner, "POST", "/api/v1/periods/2025-10/reopen", nil, 404, "not_found")
	e.fails(owner, "POST", "/api/v1/periods/2026-1/reopen", nil, 400, "invalid_request")

	var page logPage
	e.do(owner, "GET", "/api/v1/audit-log", nil, 200, &page)
	kinds := []string{}
	for _, ev := range page.Data {
		if ev.SubjectType != "period" || ev.Actor == nil || ev.Actor.ID != owner.user || ev.Actor.Name != owner.name {
			t.Fatalf("event: %+v", ev)
		}
		kinds = append(kinds, ev.Kind+" "+ev.SubjectID)
	}
	if want := []string{"period.closed 2025-09", "period.closed 2025-10", "period.reopened 2025-10"}; !slices.Equal(kinds, want) {
		t.Fatalf("events %v, want %v", kinds, want)
	}
}

// TestAuditLogReaders: no role check in the handler; a member's read:audit-log is the guard's (permissions).
func TestAuditLogReaders(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	admin := e.join(owner.workspace, "admin")
	member := e.join(owner.workspace, "member")
	e.logEvents(owner.workspace, &owner.user, "inv_1", "inv_2")
	e.logEvents(owner.workspace, nil, "inv_3")

	for _, path := range []string{"/api/v1/audit-log", "/api/v1/audit-log/export", "/api/v1/audit-log/verify"} {
		e.do(member, "GET", path, nil, 200, nil)
		e.do(admin, "GET", path, nil, 200, nil)
	}

	var page logPage
	e.do(admin, "GET", "/api/v1/audit-log?limit=2", nil, 200, &page)
	if len(page.Data) != 2 || page.Data[0].Seq != 1 || page.Data[1].Seq != 2 || page.Meta.NextCursor == nil ||
		*page.Meta.NextCursor != "2" {
		t.Fatalf("first page: %+v", page)
	}
	if a := page.Data[0].Actor; a == nil || a.ID != owner.user || a.Name != owner.name {
		t.Fatalf("actor: %+v", a)
	}
	if page.Data[0].PrevHash != "" || page.Data[1].PrevHash != page.Data[0].Hash || string(page.Data[0].Payload) != `{"number":"2026-001"}` {
		t.Fatalf("chain: %+v", page.Data)
	}
	page = logPage{}
	e.do(admin, "GET", "/api/v1/audit-log?cursor=2&limit=2", nil, 200, &page)
	if len(page.Data) != 1 || page.Data[0].Seq != 3 || page.Data[0].Actor != nil || page.Meta.NextCursor != nil {
		t.Fatalf("last page: %+v", page)
	}
	for _, q := range []string{"cursor=x", "cursor=-1", "limit=0", "limit=201", "limit=a"} {
		e.fails(owner, "GET", "/api/v1/audit-log?"+q, nil, 400, "invalid_request")
	}
}

func TestExportCSV(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	e.logEvents(owner.workspace, &owner.user, "=HYPERLINK(1)", "inv_2")

	resp, raw := e.send(owner, "GET", "/api/v1/audit-log/export", nil)
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/csv") {
		t.Fatalf("export: %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	if want := `attachment; filename="audit-log-` + time.Now().UTC().Format(time.DateOnly) + `.csv"`; resp.Header.Get("Content-Disposition") != want {
		t.Fatalf("disposition %q, want %q", resp.Header.Get("Content-Disposition"), want)
	}
	body, ok := bytes.CutPrefix(raw, []byte("\ufeff"))
	if !ok {
		t.Fatal("no BOM")
	}
	rows, err := csv.NewReader(bytes.NewReader(body)).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"seq", "at", "kind", "subject_type", "subject_id", "actor", "payload", "prev_hash", "hash"}; !slices.Equal(rows[0], want) {
		t.Fatalf("header %v", rows[0])
	}
	if len(rows) != 3 {
		t.Fatalf("rows: %v", rows)
	}
	r := rows[1]
	if r[0] != "1" || r[2] != "invoice.issued" || r[4] != "'=HYPERLINK(1)" || r[5] != owner.name ||
		r[6] != `{"number": "2026-001"}` || r[7] != "" || len(r[8]) != 64 || rows[2][7] != r[8] {
		t.Fatalf("row: %v", r)
	}
	if _, err := time.Parse(time.RFC3339, r[1]); err != nil {
		t.Fatalf("at: %v", err)
	}
}

func TestVerifyEndpoint(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	type verify struct {
		Data struct {
			OK       bool   `json:"ok"`
			BrokenAt *int64 `json:"broken_at"`
		} `json:"data"`
	}
	var v verify
	e.do(owner, "GET", "/api/v1/audit-log/verify", nil, 200, &v)
	if !v.Data.OK || v.Data.BrokenAt != nil {
		t.Fatalf("empty chain: %+v", v.Data)
	}
	e.logEvents(owner.workspace, &owner.user, "inv_1", "inv_2", "inv_3")
	v = verify{}
	e.do(owner, "GET", "/api/v1/audit-log/verify", nil, 200, &v)
	if !v.Data.OK || v.Data.BrokenAt != nil {
		t.Fatalf("intact chain: %+v", v.Data)
	}
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `ALTER TABLE financial_events DISABLE TRIGGER financial_events_append_only`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `UPDATE financial_events SET payload = '{"number": "X"}' WHERE seq = 2`); err != nil {
		t.Fatal(err)
	}
	v = verify{}
	e.do(owner, "GET", "/api/v1/audit-log/verify", nil, 200, &v)
	if v.Data.OK || v.Data.BrokenAt == nil || *v.Data.BrokenAt != 2 {
		t.Fatalf("tampered chain: %+v", v.Data)
	}
}

type agreementOut struct {
	ID          string  `json:"id"`
	ClientID    string  `json:"client_id"`
	StartsOn    string  `json:"starts_on"`
	EndsOn      *string `json:"ends_on"`
	AcceptedAt  *string `json:"accepted_at"`
	AcceptedBy  *string `json:"accepted_by"`
	Note        *string `json:"note"`
	FirstUsedAt *string `json:"first_used_at"`
	CreatedAt   string  `json:"created_at"`
}

func TestAgreementsCRUDAndRoles(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	admin := e.join(owner.workspace, "admin")
	member := e.join(owner.workspace, "member")
	path := "/api/v1/clients/" + e.client(owner.workspace) + "/self-billing-agreements"

	var created struct{ Data agreementOut }
	e.do(owner, "POST", path, map[string]any{"starts_on": "2026-01-01", "ends_on": "2026-12-31",
		"accepted_at": "2025-12-20T10:00:00+01:00", "accepted_by": " Max Muster ", "note": "Signed by email"}, 201, &created)
	a := created.Data
	if !strings.HasPrefix(a.ID, "sba_") || a.StartsOn != "2026-01-01" || a.EndsOn == nil || *a.EndsOn != "2026-12-31" ||
		a.AcceptedBy == nil || *a.AcceptedBy != "Max Muster" || a.AcceptedAt == nil || a.FirstUsedAt != nil {
		t.Fatalf("created: %+v", a)
	}
	var open struct{ Data agreementOut }
	e.do(admin, "POST", path, map[string]any{"starts_on": "2027-01-01"}, 201, &open)
	if open.Data.EndsOn != nil || open.Data.AcceptedAt != nil || open.Data.Note != nil {
		t.Fatalf("open-ended: %+v", open.Data)
	}

	e.fails(owner, "POST", path, map[string]any{}, 422, "validation_failed", "starts_on")
	e.fails(owner, "POST", path, map[string]any{"starts_on": "2026-02-30"}, 422, "validation_failed", "starts_on")
	e.fails(owner, "POST", path, map[string]any{"starts_on": "2026-02-01", "ends_on": "2026-01-31",
		"accepted_at": "yesterday", "accepted_by": strings.Repeat("a", 201), "note": strings.Repeat("n", 1001)},
		422, "validation_failed", "ends_on", "accepted_at", "accepted_by", "note")
	e.fails(owner, "POST", path, `{"starts_on": "2026-01-01", "kind": "x"}`, 400, "invalid_request")
	e.fails(member, "POST", path, map[string]any{"starts_on": "2026-01-01"}, 403, "forbidden")

	var list struct{ Data []agreementOut }
	e.do(member, "GET", path, nil, 200, &list)
	if len(list.Data) != 2 || list.Data[0].ID != open.Data.ID || list.Data[1].ID != a.ID {
		t.Fatalf("list: %+v", list.Data)
	}

	e.fails(member, "DELETE", path+"/"+open.Data.ID, nil, 403, "forbidden")
	e.do(admin, "DELETE", path+"/"+open.Data.ID, nil, 204, nil)
	e.fails(owner, "DELETE", path+"/"+open.Data.ID, nil, 404, "not_found")
	if err := e.st.MarkAgreementUsed(context.Background(), owner.workspace, a.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	e.fails(owner, "DELETE", path+"/"+a.ID, nil, 409, "invalid_state")
	list.Data = nil
	e.do(owner, "GET", path, nil, 200, &list)
	if len(list.Data) != 1 || list.Data[0].FirstUsedAt == nil {
		t.Fatalf("after delete: %+v", list.Data)
	}
}

func TestOtherWorkspace404(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	other := e.workspace()
	theirs := e.client(other.workspace)
	theirPath := "/api/v1/clients/" + theirs + "/self-billing-agreements"
	var a struct{ Data agreementOut }
	e.do(other, "POST", theirPath, map[string]any{"starts_on": "2026-01-01"}, 201, &a)
	e.do(other, "POST", "/api/v1/periods", map[string]string{"month": "2025-10"}, 201, nil)
	e.logEvents(other.workspace, &other.user, "inv_1")

	e.fails(owner, "GET", theirPath, nil, 404, "not_found")
	e.fails(owner, "POST", theirPath, map[string]any{"starts_on": "2026-01-01"}, 404, "not_found")
	e.fails(owner, "DELETE", theirPath+"/"+a.Data.ID, nil, 404, "not_found")
	e.fails(owner, "GET", "/api/v1/clients/cli_nope/self-billing-agreements", nil, 404, "not_found")
	// the agreement exists in the owner's workspace only under another client
	mine := "/api/v1/clients/" + e.client(owner.workspace) + "/self-billing-agreements"
	var m struct{ Data agreementOut }
	e.do(owner, "POST", mine, map[string]any{"starts_on": "2026-01-01"}, 201, &m)
	e.fails(owner, "DELETE", "/api/v1/clients/"+e.client(owner.workspace)+"/self-billing-agreements/"+m.Data.ID, nil, 404, "not_found")

	e.fails(owner, "POST", "/api/v1/periods/2025-10/reopen", nil, 404, "not_found")
	var periods struct{ Data []any }
	e.do(owner, "GET", "/api/v1/periods", nil, 200, &periods)
	var page logPage
	e.do(owner, "GET", "/api/v1/audit-log", nil, 200, &page)
	if len(periods.Data) != 0 || len(page.Data) != 0 {
		t.Fatalf("leaked: %v %v", periods.Data, page.Data)
	}
	e.do(owner, "POST", "/api/v1/periods", map[string]string{"month": "2025-10"}, 201, nil)
}

func TestReopenReasonLogged(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	e.do(owner, "POST", "/api/v1/periods", map[string]string{"month": "2025-10"}, 201, nil)
	e.fails(owner, "POST", "/api/v1/periods/2025-10/reopen", map[string]string{"reason": strings.Repeat("x", 501)},
		422, "validation_failed", "reason")
	e.do(owner, "POST", "/api/v1/periods/2025-10/reopen", map[string]string{"reason": "  Late supplier invoice  "}, 200, nil)
	var page logPage
	e.do(owner, "GET", "/api/v1/audit-log", nil, 200, &page)
	last := page.Data[len(page.Data)-1]
	var payload map[string]string
	if err := json.Unmarshal(last.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if last.Kind != "period.reopened" || payload["reason"] != "Late supplier invoice" || payload["month"] != "2025-10" {
		t.Fatalf("event %s %v", last.Kind, payload)
	}
}

func TestPeriodActivityEndpoint(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	for _, query := range []string{"", "?from=2026-01", "?from=2026-1&to=2026-02", "?from=2026-03&to=2026-02",
		"?from=2023-01&to=2026-01"} {
		e.fails(owner, "GET", "/api/v1/periods/activity"+query, nil, 400, "invalid_request")
	}
	var out struct {
		Data []struct {
			Month    string `json:"month"`
			Invoices *struct {
				Recorded int               `json:"recorded"`
				Drafts   int               `json:"drafts"`
				Totals   []json.RawMessage `json:"totals"`
			} `json:"invoices"`
			Expenses *struct {
				Recorded int `json:"recorded"`
			} `json:"expenses"`
		} `json:"data"`
	}
	e.do(owner, "GET", "/api/v1/periods/activity?from=2025-11&to=2026-02", nil, 200, &out)
	months := []string{}
	for _, m := range out.Data {
		if m.Invoices == nil || m.Expenses == nil || m.Invoices.Totals == nil || m.Invoices.Recorded != 0 {
			t.Fatalf("month %+v", m)
		}
		months = append(months, m.Month)
	}
	if want := []string{"2025-11", "2025-12", "2026-01", "2026-02"}; !slices.Equal(months, want) {
		t.Fatalf("months %v, want %v", months, want)
	}
}
