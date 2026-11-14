package ledger

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
	"helvetly.com/api/internal/ledgercalc"
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

type browser struct{ token, csrf, workspace string }

func (e *env) workspace() *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Muster GmbH"}, "Europe/Zurich", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	e.exec(`INSERT INTO clients (id,workspace_id,number,name,is_company,country,created_at,updated_at)
		VALUES ($1||'-client',$1,1,'Buyer',true,'CH',now(),now())`, ws)
	return e.join(ws, "owner")
}

func (e *env) join(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: role}
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

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		e.t.Fatal(err)
	}
}

// sale issues invoice 1081.00 (1000.00 + 81.00 VAT) on 2026-03-02 and a cash payment of all of it on 2026-03-20.
func (e *env) sale(ws string) {
	e.t.Helper()
	e.exec(`INSERT INTO invoices (id,workspace_id,kind,status,number,client_id,issue_date,due_date,currency,
		language,vat_mode,discount_percent,subtotal,discount_amount,net_total,vat_total,total,rounding_amount,vat_breakdown,
		amount_paid,amount_credited,created_at,updated_at)
		VALUES ($1||'-inv',$1,'invoice','paid','2026-001',$1||'-client','2026-03-02','2026-04-02','CHF','de','none',0,
		100000,0,100000,8100,108100,0,'[{"category":"S","rate":"8.1","taxable_amount":"1000.00","vat_amount":"81.00"}]',108100,0,now(),now())`, ws)
	e.exec(`INSERT INTO invoice_payments (id,invoice_id,amount,paid_on,method,created_at)
		VALUES ($1||'-pay',$1||'-inv',108100,'2026-03-20','cash',now())`, ws)
}

func (e *env) send(b *browser, method, path string, body any) (*http.Response, []byte) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp, raw
}

func TestLedgerBalancesEndToEnd(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.sale(b.workspace)
	resp, raw := e.send(b, "GET", "/api/v1/ledger?from=2026-01-01&to=2026-12-31", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("%d %s", resp.StatusCode, raw)
	}
	var out struct {
		Data struct {
			Currency string
			Balances []ledgercalc.Balance
		}
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, bal := range out.Data.Balances {
		got[bal.Account] = bal.Closing.String()
	}
	want := map[string]string{"1000": "1081.00", "1100": "0.00", "3200": "-1000.00", "2200": "-81.00"}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s closing = %q, want %q (all: %v)", k, got[k], v, got)
		}
	}
	if out.Data.Currency != "CHF" {
		t.Errorf("currency %q", out.Data.Currency)
	}
	if resp, raw = e.send(b, "GET", "/api/v1/ledger/accounts/1100?from=2026-01-01&to=2026-12-31", nil); resp.StatusCode != 200 || !strings.Contains(string(raw), `"lines"`) {
		t.Errorf("statement %d %s", resp.StatusCode, raw)
	}
	if resp, raw = e.send(b, "GET", "/api/v1/ledger/journal?from=2026-01-01&to=2026-12-31", nil); resp.StatusCode != 200 || strings.Count(string(raw), `"source_type"`) < 3 {
		t.Errorf("journal %d %s", resp.StatusCode, raw)
	}
}

func TestLedgerBadDate(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	for _, p := range []string{"/api/v1/ledger?from=2026-13-01", "/api/v1/ledger/journal?to=yesterday", "/api/v1/ledger/accounts/12?from=2026-01-01"} {
		if resp, raw := e.send(b, "GET", p, nil); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: %d %s", p, resp.StatusCode, raw)
		}
	}
}

func TestLedgerFromAfterTo(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	if resp, raw := e.send(b, "GET", "/api/v1/ledger?from=2026-05-01&to=2026-04-01", nil); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("%d %s", resp.StatusCode, raw)
	}
}

func TestLedgerSettingsMemberForbidden(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	m := e.join(b.workspace, "member")
	if resp, raw := e.send(m, "PUT", "/api/v1/ledger/settings", ledgercalc.DefaultAccounts()); resp.StatusCode != http.StatusForbidden {
		t.Errorf("%d %s", resp.StatusCode, raw)
	}
	if resp, raw := e.send(b, "PUT", "/api/v1/ledger/settings", ledgercalc.DefaultAccounts()); resp.StatusCode != http.StatusOK {
		t.Errorf("owner: %d %s", resp.StatusCode, raw)
	}
}

func TestLedgerSettingsInvalidCode(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	a := ledgercalc.DefaultAccounts()
	a.Receivables = "11"
	a.Bank["cash"] = "abc"
	resp, raw := e.send(b, "PUT", "/api/v1/ledger/settings", a)
	var out struct {
		Error struct {
			Details struct{ Fields map[string]string }
		}
	}
	_ = json.Unmarshal(raw, &out)
	f := out.Error.Details.Fields
	if resp.StatusCode != http.StatusUnprocessableEntity || f["receivables"] == "" || f["bank.cash"] == "" || len(f) != 2 {
		t.Errorf("%d %s", resp.StatusCode, raw)
	}
}

func TestLedgerExportHeaders(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.sale(b.workspace)
	resp, raw := e.send(b, "GET", "/api/v1/ledger/export?from=2026-01-01&to=2026-12-31&format=bexio", nil)
	if resp.StatusCode != http.StatusOK ||
		resp.Header.Get("Content-Disposition") != `attachment; filename="journal-2026-01-01-2026-12-31-bexio.csv"` ||
		!strings.HasPrefix(resp.Header.Get("Content-Type"), "text/csv") || resp.Header.Get("X-Skipped-Rows") != "0" {
		t.Errorf("%d %v %s", resp.StatusCode, resp.Header, raw)
	}
	if resp, _ = e.send(b, "GET", "/api/v1/ledger/export?format=pdf", nil); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("unknown format: %d", resp.StatusCode)
	}
}

func TestLedgerOtherWorkspace404(t *testing.T) {
	e := newEnv(t)
	a, b := e.workspace(), e.workspace()
	e.sale(a.workspace)
	_, raw := e.send(b, "GET", "/api/v1/ledger/journal?from=2026-01-01&to=2026-12-31", nil)
	if !strings.Contains(string(raw), `"data":[]`) {
		t.Errorf("workspace b sees %s", raw)
	}
}

func TestLedgerSettingsPartialKeepsDefaults(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	resp, raw := e.send(b, "PUT", "/api/v1/ledger/settings", map[string]any{"revenue": "3400", "bank": map[string]string{"cash": "1001"}})
	var out struct{ Data ledgercalc.Accounts }
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode != http.StatusOK || out.Data.Revenue != "3400" || out.Data.Receivables != "1100" ||
		out.Data.Bank["cash"] != "1001" || out.Data.Bank["other"] != "1020" {
		t.Errorf("%d %s", resp.StatusCode, raw)
	}
}

func TestLedgerSettingsNullBankRejected(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	resp, raw := e.send(b, "PUT", "/api/v1/ledger/settings", map[string]any{"bank": nil})
	var out struct {
		Error struct {
			Details struct{ Fields map[string]string }
		}
	}
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode != http.StatusUnprocessableEntity || out.Error.Details.Fields["bank.other"] == "" {
		t.Errorf("%d %s", resp.StatusCode, raw)
	}
}
