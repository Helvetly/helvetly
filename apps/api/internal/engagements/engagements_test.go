package engagements

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// today in every test: 2026-11-16 (Europe/Zurich).
var fixedNow = time.Date(2026, 11, 16, 9, 0, 0, 0, time.UTC)

type env struct {
	t    *testing.T
	st   *store.Store
	pool *pgxpool.Pool
	svc  *Service
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
	svc := New(st, a, nil, discard)
	svc.now = func() time.Time { return fixedNow }
	mux := http.NewServeMux()
	a.Register(mux)
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, pool: pool, svc: svc, srv: srv}
}

type browser struct{ token, csrf, workspace string }

func (e *env) workspace() *browser {
	e.t.Helper()
	return e.workspaceIn("Europe/Zurich")
}

func (e *env) workspaceIn(timezone string) *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, timezone, time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return e.join(ws, "owner")
}

func (e *env) join(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna " + role}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws}
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

func (e *env) client(b *browser) string {
	e.t.Helper()
	id := auth.NewID("cli")
	if err := e.st.CreateClient(context.Background(), b.workspace, id, map[string]any{"name": "Müller AG"}, time.Now()); err != nil {
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
	if len(fields) > 0 && len(out.Error.Details.Fields) != len(fields) {
		e.t.Fatalf("%s %s: fields %v, want %v", method, path, out.Error.Details.Fields, fields)
	}
	for _, f := range fields {
		if out.Error.Details.Fields[f] == "" {
			e.t.Fatalf("%s %s: no message for %q: %v", method, path, f, out.Error.Details.Fields)
		}
	}
}

type view struct {
	ID            string   `json:"id"`
	Number        int      `json:"number"`
	Status        string   `json:"status"`
	Title         string   `json:"title"`
	Quantity      string   `json:"quantity"`
	UnitPriceNet  string   `json:"unit_price_net"`
	CancelledOn   *string  `json:"cancelled_on"`
	Attention     []string `json:"attention"`
	CurrentPeriod *struct {
		ID        string `json:"id"`
		Index     int    `json:"index"`
		StartsOn  string `json:"starts_on"`
		EndsOn    string `json:"ends_on"`
		Quantity  string `json:"quantity"`
		Used      string `json:"used"`
		Remaining string `json:"remaining"`
		State     string `json:"state"`
	} `json:"current_period"`
}

type one struct {
	Data view `json:"data"`
}

func input(clientID string, extra map[string]any) map[string]any {
	m := map[string]any{"client_id": clientID, "title": "German", "quantity": "30", "unit_price": "100", "unit": "hour",
		"start_date": "2026-11-01", "recurrence": "monthly", "vat_category": "Z"}
	for k, v := range extra {
		m[k] = v
	}
	return m
}

func (e *env) create(b *browser, body map[string]any) view {
	e.t.Helper()
	var out one
	e.do(b, "POST", "/api/v1/engagements", body, http.StatusCreated, &out)
	return out.Data
}

func (e *env) periodRows(id string) []string {
	e.t.Helper()
	rows, err := e.pool.Query(context.Background(), `SELECT idx || ':' || quantity FROM engagement_periods WHERE engagement_id = $1 ORDER BY idx`, id)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			e.t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func (e *env) entry(engagementID, date string, qty int) {
	e.t.Helper()
	_, err := e.pool.Exec(context.Background(), `INSERT INTO engagement_entries (id, engagement_id, period_id, date, quantity, created_at)
		SELECT $1, $2, id, $3::date, $4, now() FROM engagement_periods WHERE engagement_id = $2 AND starts_on <= $3::date
		ORDER BY idx DESC LIMIT 1`, auth.NewID("ent"), engagementID, date, qty)
	if err != nil {
		e.t.Fatal(err)
	}
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func TestCreateAndGet(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	v := e.create(b, input(c, nil))
	if !strings.HasPrefix(v.ID, "eng_") || v.Number != 1 || v.Status != "active" || v.UnitPriceNet != "100.00" {
		t.Fatalf("%+v", v)
	}
	p := v.CurrentPeriod
	if p == nil || p.Index != 1 || p.StartsOn != "2026-11-01" || p.EndsOn != "2026-11-30" || p.Quantity != "30" ||
		p.Used != "0" || p.Remaining != "30" || p.State != "open" {
		t.Fatalf("%+v", p)
	}
	for _, a := range []string{"under_pace", "ending_soon", "to_invoice"} {
		if !contains(v.Attention, a) {
			t.Fatalf("attention %v lacks %s", v.Attention, a)
		}
	}
	var got one
	e.do(b, "GET", "/api/v1/engagements/"+v.ID, nil, http.StatusOK, &got)
	if got.Data.ID != v.ID {
		t.Fatalf("%+v", got)
	}
	// a future start still gets its first period, but no current one
	f := e.create(b, input(c, map[string]any{"start_date": "2027-01-01"}))
	if f.Status != "scheduled" || f.CurrentPeriod != nil || len(e.periodRows(f.ID)) != 1 {
		t.Fatalf("%+v", f)
	}
}

func TestCreateValidation(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	other := e.client(e.workspace())
	e.fails(b, "POST", "/api/v1/engagements", map[string]any{}, 422, "validation_failed", "client_id", "title", "quantity", "unit_price", "end_date")
	e.fails(b, "POST", "/api/v1/engagements", input(c, map[string]any{"quantity": "0"}), 422, "validation_failed", "quantity")
	e.fails(b, "POST", "/api/v1/engagements", input(c, map[string]any{"quantity": "1.0001"}), 422, "validation_failed", "quantity")
	e.fails(b, "POST", "/api/v1/engagements", input(c, map[string]any{"recurrence": "none"}), 422, "validation_failed", "end_date")
	e.fails(b, "POST", "/api/v1/engagements", input(c, map[string]any{"end_date": "2026-10-01"}), 422, "validation_failed", "end_date")
	e.fails(b, "POST", "/api/v1/engagements", input(other, nil), 422, "validation_failed", "client_id")
	e.fails(b, "POST", "/api/v1/engagements", input(c, map[string]any{"bogus": 1}), 400, "invalid_request")
	e.fails(b, "GET", "/api/v1/engagements/eng_missing", nil, 404, "not_found")
}

func TestEnsurePeriodsIdempotent(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"start_date": "2026-08-31"}))
	if rows := e.periodRows(v.ID); len(rows) != 3 { // 31 Aug, 30 Sep (clamped from 31), 31 Oct; 30 Nov is still ahead
		t.Fatalf("%v", rows)
	}
	for range 2 {
		err := e.st.Tx(context.Background(), func(q store.Q) error {
			eng, err := q.Engagement(context.Background(), b.workspace, v.ID, false)
			if err != nil {
				return err
			}
			ps, err := ensurePeriods(context.Background(), q, eng, e.svc.today(store.Workspace{Timezone: "Europe/Zurich"}))
			if err == nil && len(ps) != 3 {
				t.Errorf("%d periods", len(ps))
			}
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if rows := e.periodRows(v.ID); len(rows) != 3 {
		t.Fatalf("%v", rows)
	}
}

func TestPatchScheduleLocked(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), nil))
	e.entry(v.ID, "2026-11-10", 2000)
	path := "/api/v1/engagements/" + v.ID
	e.fails(b, "PATCH", path, map[string]any{"start_date": "2026-10-01"}, 409, "engagement_locked")
	e.fails(b, "PATCH", path, map[string]any{"recurrence": "weekly"}, 409, "engagement_locked")
	e.fails(b, "PATCH", path, map[string]any{"end_date": "2026-11-05"}, 422, "validation_failed", "end_date")
	e.do(b, "PATCH", path, map[string]any{"title": "French", "start_date": "2026-11-01", "end_date": "2026-12-31"}, 200, nil)
	// no entry yet: the schedule is free (the unchanged value is never a conflict)
	w := e.create(b, input(e.client(b), nil))
	e.do(b, "PATCH", "/api/v1/engagements/"+w.ID, map[string]any{"start_date": "2026-11-01", "interval": 2}, 200, nil)
}

func TestPatchQuantityUpdatesOpenPeriodOnly(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"start_date": "2026-09-01"}))
	if rows := e.periodRows(v.ID); strings.Join(rows, ",") != "1:30000,2:30000,3:30000" {
		t.Fatalf("%v", rows)
	}
	var out one
	e.do(b, "PATCH", "/api/v1/engagements/"+v.ID, map[string]any{"quantity": "40"}, 200, &out)
	if rows := e.periodRows(v.ID); strings.Join(rows, ",") != "1:30000,2:30000,3:40000" {
		t.Fatalf("%v", rows)
	}
	if out.Data.Quantity != "40" || out.Data.CurrentPeriod.Quantity != "40" || out.Data.CurrentPeriod.Remaining != "40" {
		t.Fatalf("%+v", out.Data)
	}
	// a period quantity can be edited on its own, until an advance invoice covers it
	var ps struct {
		Data []struct {
			ID    string `json:"id"`
			Index int    `json:"index"`
		} `json:"data"`
	}
	e.do(b, "GET", "/api/v1/engagements/"+v.ID+"/periods", nil, 200, &ps)
	if len(ps.Data) != 3 || ps.Data[0].Index != 3 {
		t.Fatalf("%+v", ps)
	}
	e.do(b, "PATCH", "/api/v1/engagements/"+v.ID+"/periods/"+ps.Data[2].ID, map[string]any{"quantity": "12.5"}, 200, nil)
	e.fails(b, "PATCH", "/api/v1/engagements/"+v.ID+"/periods/"+ps.Data[2].ID, map[string]any{"quantity": "0"}, 422, "validation_failed", "quantity")
	e.fails(b, "PATCH", "/api/v1/engagements/"+v.ID+"/periods/epr_nope", map[string]any{"quantity": "1"}, 404, "not_found")
	e.invoice(b, v.ID, ps.Data[1].ID, "draft")
	e.fails(b, "PATCH", "/api/v1/engagements/"+v.ID+"/periods/"+ps.Data[1].ID, map[string]any{"quantity": "1"}, 409, "period_invoiced")
}

// invoice links a bare invoice to a period as its advance invoice.
func (e *env) invoice(b *browser, engagementID, periodID, status string) {
	e.t.Helper()
	ctx, id := context.Background(), auth.NewID("inv")
	cli := e.client(b)
	number := "NULL"
	if status != "draft" {
		number = "'" + id + "'"
	}
	_, err := e.pool.Exec(ctx, `INSERT INTO invoices (id, workspace_id, kind, status, number, client_id, issue_date, due_date,
		currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount,
		vat_breakdown, created_at, updated_at) VALUES ($1, $2, 'invoice', $3, `+number+`, $4, '2026-02-01', '2026-03-01', 'CHF',
		'en', 'exclusive', 0, 0, 0, 0, 0, 0, 0, '[]', now(), now())`, id, b.workspace, status, cli)
	if err == nil {
		_, err = e.pool.Exec(ctx, `INSERT INTO engagement_invoices (period_id, invoice_id, kind, created_at) VALUES ($1, $2, 'advance', now())`, periodID, id)
	}
	if err != nil {
		e.t.Fatal(err)
	}
}

// Shortly after midnight in Zurich it is still the day before in New York: "today" is the workspace's date.
func TestTodayIsTheWorkspaceDate(t *testing.T) {
	e := newEnv(t)
	e.svc.now = func() time.Time { return time.Date(2026, 11, 17, 3, 30, 0, 0, time.UTC) }
	for _, c := range []struct {
		zone string
		code int
	}{{"America/New_York", 200}, {"Europe/Zurich", 422}} {
		b := e.workspaceIn(c.zone)
		v := e.create(b, input(e.client(b), nil))
		e.do(b, "POST", "/api/v1/engagements/"+v.ID+"/cancel", map[string]any{"cancelled_on": "2026-11-16"}, c.code, nil)
	}
}

func TestMemberCannotCancel403(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	member := e.join(owner.workspace, "member")
	v := e.create(member, input(e.client(owner), nil)) // members create and edit
	path := "/api/v1/engagements/" + v.ID
	e.do(member, "PATCH", path, map[string]any{"title": "x"}, 200, nil)
	e.fails(member, "POST", path+"/cancel", nil, 403, "forbidden")
	e.fails(member, "POST", path+"/resume", nil, 403, "forbidden")
	e.fails(member, "DELETE", path, nil, 403, "forbidden")

	var out one
	e.do(owner, "POST", path+"/cancel", nil, 200, &out) // default: the end of the current period
	if out.Data.CancelledOn == nil || *out.Data.CancelledOn != "2026-11-30" || out.Data.Status != "active" {
		t.Fatalf("%+v", out.Data)
	}
	e.fails(owner, "POST", path+"/cancel", map[string]any{"cancelled_on": "2026-11-01"}, 422, "validation_failed", "cancelled_on")
	e.do(owner, "POST", path+"/resume", nil, 200, &out)
	if out.Data.CancelledOn != nil {
		t.Fatalf("%+v", out.Data)
	}
	e.fails(owner, "POST", path+"/resume", nil, 409, "not_resumable")
	e.do(owner, "POST", path+"/cancel", map[string]any{"cancelled_on": "2026-11-20"}, 200, &out)
	if *out.Data.CancelledOn != "2026-11-20" || out.Data.CurrentPeriod.EndsOn != "2026-11-20" {
		t.Fatalf("%+v", out.Data)
	}
	e.entry(v.ID, "2026-11-15", 1000)
	e.do(owner, "POST", path+"/cancel", map[string]any{"cancelled_on": "2026-11-16"}, 200, nil) // today, after the entry
}

func TestListAttentionFilterAndPaging(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	a := e.create(b, input(c, map[string]any{"title": "A monthly"}))
	e.create(b, input(c, map[string]any{"title": "B yearly", "recurrence": "yearly", "start_date": "2026-01-01", "billing": "arrears"}))
	e.create(b, input(c, map[string]any{"title": "C later", "start_date": "2027-01-01"}))
	e.create(b, input(c, map[string]any{"title": "D past", "recurrence": "none", "start_date": "2026-01-01", "end_date": "2026-02-01"}))

	var list struct {
		Data []view         `json:"data"`
		Meta map[string]int `json:"meta"`
	}
	e.do(b, "GET", "/api/v1/engagements", nil, 200, &list) // default: scheduled and active
	if len(list.Data) != 3 || list.Data[0].Title != "A monthly" || list.Meta["total"] != 3 {
		t.Fatalf("%+v", list)
	}
	e.do(b, "GET", "/api/v1/engagements?attention=ending_soon", nil, 200, &list)
	if len(list.Data) != 1 || list.Data[0].ID != a.ID {
		t.Fatalf("%+v", list)
	}
	e.do(b, "GET", "/api/v1/engagements?status=ended", nil, 200, &list)
	if len(list.Data) != 1 || list.Data[0].Status != "ended" {
		t.Fatalf("%+v", list)
	}
	e.do(b, "GET", "/api/v1/engagements?status=scheduled,active,ended&page=2&page_size=2&sort=title", nil, 200, &list)
	if len(list.Data) != 2 || list.Data[0].Title != "C later" || list.Meta["total"] != 4 || list.Meta["total_pages"] != 2 {
		t.Fatalf("%+v", list)
	}
	e.do(b, "GET", "/api/v1/engagements?q=nothing", nil, 200, &list)
	if len(list.Data) != 0 {
		t.Fatalf("%+v", list)
	}
	e.fails(b, "GET", "/api/v1/engagements?status=bogus", nil, 400, "invalid_request")
	e.fails(b, "GET", "/api/v1/engagements?attention=bogus", nil, 400, "invalid_request")
	e.fails(b, "GET", "/api/v1/engagements?sort=bogus", nil, 400, "invalid_request")
	e.fails(b, "GET", "/api/v1/engagements?page_size=999", nil, 400, "invalid_request")

	var sum struct {
		Data map[string]int `json:"data"`
	}
	e.do(b, "GET", "/api/v1/engagements/summary", nil, 200, &sum)
	if sum.Data["active"] != 2 || sum.Data["ending_soon"] != 1 || sum.Data["to_invoice"] < 2 {
		t.Fatalf("%+v", sum)
	}
}

func TestDeleteWithInvoice409(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	v := e.create(b, input(c, nil))
	var ps struct {
		Data []struct{ ID string } `json:"data"`
	}
	e.do(b, "GET", "/api/v1/engagements/"+v.ID+"/periods", nil, 200, &ps)
	e.invoice(b, v.ID, ps.Data[0].ID, "open")
	e.fails(b, "DELETE", "/api/v1/engagements/"+v.ID, nil, 409, "engagement_invoiced")
	free := e.create(b, input(c, nil))
	e.do(b, "DELETE", "/api/v1/engagements/"+free.ID, nil, 204, nil)
	e.fails(b, "GET", "/api/v1/engagements/"+free.ID, nil, 404, "not_found")
	if w := e.create(b, input(c, nil)); w.Number != 3 { // numbers are never reused
		t.Fatalf("%d", w.Number)
	}
}

func TestRenewNoneOnly(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	rec := e.create(b, input(c, nil))
	e.fails(b, "POST", "/api/v1/engagements/"+rec.ID+"/renew", nil, 409, "not_renewable")
	one1 := e.create(b, input(c, map[string]any{"recurrence": "none", "start_date": "2026-09-01", "end_date": "2026-11-30"}))
	var out one
	e.do(b, "POST", "/api/v1/engagements/"+one1.ID+"/renew", nil, 201, &out) // the day after, same length
	if out.Data.ID == one1.ID || out.Data.Number != one1.Number+1 || out.Data.Status != "scheduled" {
		t.Fatalf("%+v", out.Data)
	}
	var full struct {
		Data struct {
			StartDate string `json:"start_date"`
			EndDate   string `json:"end_date"`
		} `json:"data"`
	}
	e.do(b, "GET", "/api/v1/engagements/"+out.Data.ID, nil, 200, &full)
	if full.Data.StartDate != "2026-12-01" || full.Data.EndDate != "2027-03-01" {
		t.Fatalf("%+v", full)
	}
	e.do(b, "POST", "/api/v1/engagements/"+one1.ID+"/renew", map[string]any{"start_date": "2027-03-01"}, 201, &out)
	e.fails(b, "POST", "/api/v1/engagements/"+one1.ID+"/renew", map[string]any{"start_date": "soon"}, 422, "validation_failed", "start_date")
}

// rowsOf lists one string per period, built from a SQL expression over engagement_periods.
func (e *env) rowsOf(id, expr string) string {
	e.t.Helper()
	rows, err := e.pool.Query(context.Background(), `SELECT `+expr+` FROM engagement_periods WHERE engagement_id = $1 ORDER BY idx`, id)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			e.t.Fatal(err)
		}
		out = append(out, s)
	}
	return strings.Join(out, ",")
}

func TestPatchPricesUpdateOpenPeriodOnly(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"start_date": "2026-09-01"}))
	const cols = `idx || ':' || unit_price || '/' || overage_unit_price`
	e.do(b, "PATCH", "/api/v1/engagements/"+v.ID, map[string]any{"unit_price": "120"}, 200, nil)
	if got := e.rowsOf(v.ID, cols); got != "1:10000/10000,2:10000/10000,3:12000/12000" {
		t.Fatal(got)
	}
	e.do(b, "PATCH", "/api/v1/engagements/"+v.ID, map[string]any{"overage_unit_price": "150"}, 200, nil)
	if got := e.rowsOf(v.ID, cols); got != "1:10000/10000,2:10000/10000,3:12000/15000" {
		t.Fatal(got)
	}
}

func TestPatchScheduleRebuildsPeriods(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"start_date": "2026-08-31"}))
	if got := e.rowsOf(v.ID, `idx::text`); got != "1,2,3" {
		t.Fatal(got)
	}
	e.do(b, "PATCH", "/api/v1/engagements/"+v.ID, map[string]any{"start_date": "2026-11-01"}, 200, nil)
	if got := e.rowsOf(v.ID, `idx || ':' || starts_on || '..' || ends_on`); got != "1:2026-11-01..2026-11-30" {
		t.Fatal(got)
	}
}

func TestCutAndRestorePeriods(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"start_date": "2026-09-01"}))
	path := "/api/v1/engagements/" + v.ID
	lastEnd := func() string { return e.rowsOf(v.ID, `ends_on::text`)[len("2026-09-30,2026-10-31,"):] }

	// cancelling mid-period cuts the open one; resuming brings its natural end back
	e.do(b, "POST", path+"/cancel", map[string]any{"cancelled_on": "2026-11-20"}, 200, nil)
	if got := lastEnd(); got != "2026-11-20" {
		t.Fatal(got)
	}
	e.do(b, "POST", path+"/resume", nil, 200, nil)
	if got := lastEnd(); got != "2026-11-30" {
		t.Fatal(got)
	}

	// an earlier end drops the later period; a later end opens it again
	e.do(b, "PATCH", path, map[string]any{"end_date": "2026-10-15"}, 200, nil)
	if got := e.rowsOf(v.ID, `idx || ':' || ends_on`); got != "1:2026-09-30,2:2026-10-15" {
		t.Fatal(got)
	}
	e.do(b, "PATCH", path, map[string]any{"end_date": "2026-12-31"}, 200, nil)
	if got := e.rowsOf(v.ID, `idx || ':' || ends_on`); got != "1:2026-09-30,2:2026-10-31,3:2026-11-30" {
		t.Fatal(got)
	}
	e.do(b, "PATCH", path, map[string]any{"end_date": "2026-11-25"}, 200, nil)
	if got := lastEnd(); got != "2026-11-25" {
		t.Fatal(got)
	}
}

func TestPatchQuantitySkipsManualPeriods(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"start_date": "2026-10-01"}))
	path := "/api/v1/engagements/" + v.ID
	e.do(b, "PATCH", path+"/periods/"+e.periodList(b, v.ID)[0].ID, map[string]any{"quantity": "12"}, 200, nil) // the open period
	e.do(b, "PATCH", path, map[string]any{"quantity": "40"}, 200, nil)
	if rows := e.periodRows(v.ID); strings.Join(rows, ",") != "1:30000,2:12000" {
		t.Fatal(rows)
	}
	// still hand-set afterwards: a cut does not prorate it either
	e.do(b, "POST", path+"/cancel", map[string]any{"cancelled_on": "2026-11-20"}, 200, nil)
	if rows := e.periodRows(v.ID); strings.Join(rows, ",") != "1:30000,2:12000" {
		t.Fatal(rows)
	}
}

func TestEnsurePeriodsOpensMissedPeriodsAndStopsAtEnd(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"start_date": "2026-08-01"}))
	open := func(today string) int {
		var n int
		err := e.st.Tx(context.Background(), func(q store.Q) error {
			eng, err := q.Engagement(context.Background(), b.workspace, v.ID, false)
			if err != nil {
				return err
			}
			ps, err := ensurePeriods(context.Background(), q, eng, today)
			n = len(ps)
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := open("2027-03-31"); n != 8 { // Aug .. Mar after five idle months, all at once
		t.Fatalf("%d periods", n)
	}
	if n := open("2027-03-31"); n != 8 {
		t.Fatalf("repeat: %d periods", n)
	}
	e.do(b, "PATCH", "/api/v1/engagements/"+v.ID, map[string]any{"end_date": "2026-12-15"}, 200, nil)
	if n := open("2027-03-31"); n != 5 || len(e.periodRows(v.ID)) != 5 { // nothing opens after end_date
		t.Fatalf("%d periods %v", n, e.periodRows(v.ID))
	}
}

// With both end_date and cancelled_on past, the list filter and the status agree: whichever came first.
func TestStatusBothDatesPast(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b)
	ended := e.create(b, input(c, map[string]any{"title": "ended first", "recurrence": "none", "start_date": "2026-01-01", "end_date": "2026-02-01"}))
	cancelled := e.create(b, input(c, map[string]any{"title": "cancelled first", "recurrence": "none", "start_date": "2026-01-01", "end_date": "2026-02-01"}))
	for id, on := range map[string]string{ended.ID: "2026-03-01", cancelled.ID: "2026-01-15"} {
		if _, err := e.pool.Exec(context.Background(), `UPDATE engagements SET cancelled_on = $2 WHERE id = $1`, id, on); err != nil {
			t.Fatal(err)
		}
	}
	for status, want := range map[string]string{"ended": ended.ID, "cancelled": cancelled.ID} {
		var list struct {
			Data []view `json:"data"`
		}
		e.do(b, "GET", "/api/v1/engagements?status="+status, nil, 200, &list)
		if len(list.Data) != 1 || list.Data[0].ID != want || list.Data[0].Status != status {
			t.Fatalf("%s: %+v", status, list.Data)
		}
	}
}
