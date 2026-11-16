package vatreturn

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
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
	"helvetly.com/api/internal/vatcalc"
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

// invoice inserts an issued document; breakdown is its VAT groups as stored, total its gross amount.
func (e *env) invoice(ws, id, kind, status, currency, issued, breakdown string, total int64, credited *string) {
	e.t.Helper()
	e.exec(`INSERT INTO invoices (id,workspace_id,kind,status,number,client_id,credited_invoice_id,issue_date,due_date,currency,
		language,vat_mode,discount_percent,subtotal,discount_amount,net_total,vat_total,total,rounding_amount,vat_breakdown,
		amount_paid,amount_credited,created_at,updated_at)
		VALUES ($1,$2,$3,$4,CASE WHEN $4='draft' THEN NULL ELSE $1 END,$2||'-client',$5,$6,$6,$7,'de','none',0,$8,0,$8,0,$8,0,$9,0,0,now(),now())`,
		id, ws, kind, status, credited, issued, currency, total, breakdown)
}

func (e *env) expense(ws string, number int, docDate, paidOn string, net, deductible int64, percent int, reverse bool, category *string) {
	e.t.Helper()
	e.exec(`INSERT INTO expenses (id,workspace_id,number,status,currency,amount_mode,input_tax,deductible_percent,net_total,
		vat_total,total,deductible_vat,vat_breakdown,exchange_rate,base_currency,base_net_total,base_vat_total,base_total,
		base_deductible_vat,payment_status,document_date,paid_on,booked_at,created_at,updated_at,reverse_charge,category_id,
		supplier_country)
		VALUES ($1||'-exp-'||$10,$1,$2,'booked','CHF','net','full',$7,$5,$6,$5::bigint+$6::bigint,$6,'[]',1000000,'CHF',$5,$6,$5::bigint+$6::bigint,$6,
		CASE WHEN $4::date IS NULL THEN 'unpaid' ELSE 'paid' END,$3,$4,now(),now(),now(),$8,$9,CASE WHEN $8::boolean THEN 'DE' ELSE 'CH' END)`,
		ws, number, docDate, nilIfEmpty(paidOn), net, deductible, percent, reverse, category, strconv.Itoa(number))
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
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

func (e *env) report(b *browser, period string) Report {
	e.t.Helper()
	resp, raw := e.send(b, "GET", "/api/v1/vat-return?period="+period, nil)
	if resp.StatusCode != http.StatusOK {
		e.t.Fatalf("report %s: %d %s", period, resp.StatusCode, raw)
	}
	var out struct{ Data Report }
	if err := json.Unmarshal(raw, &out); err != nil {
		e.t.Fatal(err)
	}
	return out.Data
}

func line(r Report, ziffer string) vatcalc.Line {
	return vatcalc.Return{Lines: r.Lines}.Line(ziffer)
}

func warned(r Report, code string) []string {
	for _, w := range r.Warnings {
		if w.Code == code {
			return w.Refs
		}
	}
	return nil
}

const (
	sale1    = `[{"category":"S","rate":"8.1","taxable_amount":"1000.00","vat_amount":"81.00"},{"category":"G","rate":"0","taxable_amount":"500.00","vat_amount":"0.00"}]`
	credit1  = `[{"category":"S","rate":"8.1","taxable_amount":"100.00","vat_amount":"8.10"}]`
	original = `[{"category":"S","rate":"8.1","taxable_amount":"200.00","vat_amount":"16.20"}]`
	correct  = `[{"category":"S","rate":"8.1","taxable_amount":"300.00","vat_amount":"24.30"}]`
)

func fixture(e *env) *browser {
	b := e.workspace()
	ws := b.workspace
	e.invoice(ws, ws+"-2026-001", "invoice", "open", "CHF", "2026-08-10", sale1, 158100, nil)
	inv := ws + "-2026-001"
	e.invoice(ws, ws+"-CN-001", "credit_note", "paid", "CHF", "2026-09-01", credit1, 10810, &inv)
	orig := ws + "-2026-000"
	e.invoice(ws, orig, "invoice", "replaced", "CHF", "2026-05-10", original, 21620, nil)
	e.invoice(ws, ws+"-2026-002", "corrected", "open", "CHF", "2026-08-20", correct, 32430, &orig)
	e.invoice(ws, ws+"-draft", "invoice", "draft", "CHF", "2026-08-11", sale1, 158100, nil)
	e.invoice(ws, ws+"-EUR-1", "invoice", "open", "EUR", "2026-08-12", sale1, 158100, nil)
	e.invoice(ws, ws+"-SB-1", "self_billed", "open", "CHF", "2026-08-13", credit1, 10810, nil)
	e.exec(`INSERT INTO expense_categories (id,workspace_id,name,account_code,created_at,updated_at) VALUES ($1||'-cat',$1,'Material','4000',now(),now())`, ws)
	cat := ws + "-cat"
	e.expense(ws, 1, "2026-08-05", "2026-10-02", 50000, 4050, 10000, false, &cat)
	e.expense(ws, 2, "2026-08-06", "2026-08-06", 100000, 0, 10000, true, nil)
	e.expense(ws, 3, "2026-06-30", "", 10000, 810, 10000, false, nil) // Q2
	return b
}

func TestEffectiveAgreed(t *testing.T) {
	e := newEnv(t)
	b := fixture(e)
	fixture(e) // another workspace's documents never count

	r := e.report(b, "2026-Q3")
	if r.Method != "effective" || r.Basis != "agreed" || r.From != "2026-07-01" || r.To != "2026-09-30" || r.Months != 3 {
		t.Fatalf("report header: %+v", r)
	}
	for _, c := range []struct {
		ziffer       string
		amount, base vatcalc.Money
	}{
		{"200", 150000, 0}, // 1000 + 500 − 100 + 300 − 200 (the correction takes its original back out)
		{"220", 50000, 0},
		{"299", 100000, 0},
		{"303", 0, 100000},
		{"383", 0, 100000}, // the service from Germany
		{"400", 4050, 0},   // account 4000
		{"405", 8100, 0},   // no category: 405; the acquisition tax is deductible in full
	} {
		l := line(r, c.ziffer)
		if l.Amount != c.amount || l.Base != c.base {
			t.Errorf("Ziffer %s = amount %s base %s, want %s %s", c.ziffer, l.Amount, l.Base, c.amount, c.base)
		}
	}
	if l := line(r, "500"); l.Amount != 4050 { // tax 81.00 (303) + 81.00 (383) − input 121.50
		t.Errorf("500 = %s, want 40.50", l.Amount)
	}
	if refs := warned(r, "foreign_currency"); len(refs) != 1 || !strings.HasSuffix(refs[0], "-EUR-1") {
		t.Errorf("foreign_currency = %v", refs)
	}
	if refs := warned(r, "self_billed"); len(refs) != 1 {
		t.Errorf("self_billed = %v", refs)
	}
	if warned(r, "open_period") == nil {
		t.Error("an open period warns")
	}

	q2 := e.report(b, "2026-Q2")
	if l := line(q2, "303"); l.Base != 20000 {
		t.Errorf("Q2 keeps the replaced original as filed: 303 base %s", l.Base)
	}
	if l := line(q2, "405"); l.Amount != 810 {
		t.Errorf("Q2 input tax 405 = %s", l.Amount)
	}

	e.exec(`INSERT INTO closed_periods (workspace_id,month,closed_at) VALUES ($1,'2026-07',now()),($1,'2026-08',now()),($1,'2026-09',now())`, b.workspace)
	if r := e.report(b, "2026-Q3"); r.ClosedMonths != 3 || warned(r, "open_period") != nil {
		t.Errorf("closed period: %d closed, warnings %v", r.ClosedMonths, r.Warnings)
	}
}

func TestReceivedBasisAndNetTaxRate(t *testing.T) {
	e := newEnv(t)
	b := fixture(e)
	ws := b.workspace
	e.exec(`INSERT INTO invoice_payments (id,invoice_id,amount,paid_on,method,created_at) VALUES ($1||'-p1',$1||'-2026-001',79050,'2026-09-15','cash',now())`, ws)
	if resp, raw := e.send(b, "PUT", "/api/v1/vat-return/settings", map[string]any{"method": "effective", "period": "quarterly", "basis": "received", "net_rates": []any{}}); resp.StatusCode != 200 {
		t.Fatalf("settings: %d %s", resp.StatusCode, raw)
	}
	r := e.report(b, "2026-Q3")
	// 790.50 paid after the credit note (S 100.00 + 8.10) of 2026-09-01: priced against what is left, 1472.90 of S 900.00
	// and G 500.00, so 900.00 × 790.50 / 1472.90 = 483.03 and 500.00 × 790.50 / 1472.90 = 268.35
	if l := line(r, "303"); l.Base != 48303 {
		t.Errorf("received 303 base = %s", l.Base)
	}
	if l := line(r, "220"); l.Amount != 26835 {
		t.Errorf("received 220 = %s", l.Amount)
	}
	if l := line(r, "400"); l.Amount != 0 { // expense 1 was paid in Q4
		t.Errorf("received 400 = %s", l.Amount)
	}
	if l := line(r, "383"); l.Base != 100000 {
		t.Errorf("received 383 base = %s", l.Base)
	}

	resp, raw := e.send(b, "PUT", "/api/v1/vat-return/settings", map[string]any{"method": "net_tax_rate", "period": "half_yearly",
		"basis": "agreed", "net_rates": []map[string]string{{"label": "Beratung", "rate": "6.2"}}})
	if resp.StatusCode != 200 {
		t.Fatalf("net tax rate settings: %d %s", resp.StatusCode, raw)
	}
	r = e.report(b, "2026-H2")
	if l := line(r, "323"); l.Base != 108100 || l.Tax != 6702 { // 1081 − 108.10 + 324.30 − 216.20 gross, at 6.2%
		t.Errorf("323 = base %s tax %s", l.Base, l.Tax)
	}
	if line(r, "400").Ziffer != "" {
		t.Error("no input tax under the net tax rate method")
	}
	if l := line(r, "383"); l.Tax != 8100 {
		t.Errorf("acquisition tax under the net tax rate method = %s", l.Tax)
	}
}

func TestSettingsAndFormats(t *testing.T) {
	e := newEnv(t)
	b := fixture(e)
	member := e.join(b.workspace, "member")

	resp, raw := e.send(b, "GET", "/api/v1/vat-return/settings", nil)
	if resp.StatusCode != 200 || !strings.Contains(string(raw), `"method":"effective"`) || !strings.Contains(string(raw), `"basis":"agreed"`) {
		t.Fatalf("default settings: %d %s", resp.StatusCode, raw)
	}
	valid := map[string]any{"method": "effective", "period": "quarterly", "basis": "agreed", "net_rates": []any{}}
	// full access covers write:vat-return; the guard (permissions) refuses a member without it
	if resp, _ := e.send(member, "PUT", "/api/v1/vat-return/settings", valid); resp.StatusCode != http.StatusOK {
		t.Errorf("member PUT: %d", resp.StatusCode)
	}
	for name, body := range map[string]map[string]any{
		"no rate":     {"method": "net_tax_rate", "period": "half_yearly", "basis": "agreed", "net_rates": []any{}},
		"bad method":  {"method": "flat", "period": "quarterly", "basis": "agreed", "net_rates": []any{}},
		"bad rate":    {"method": "net_tax_rate", "period": "quarterly", "basis": "agreed", "net_rates": []map[string]string{{"label": "A", "rate": "12"}}},
		"blank label": {"method": "net_tax_rate", "period": "quarterly", "basis": "agreed", "net_rates": []map[string]string{{"label": " ", "rate": "6.2"}}},
	} {
		if resp, raw := e.send(b, "PUT", "/api/v1/vat-return/settings", body); resp.StatusCode != http.StatusUnprocessableEntity {
			t.Errorf("%s: %d %s", name, resp.StatusCode, raw)
		}
	}
	if resp, _ := e.send(b, "GET", "/api/v1/vat-return?period=2026-Q5", nil); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("bad period: %d", resp.StatusCode)
	}
	if resp, _ := e.send(b, "GET", "/api/v1/vat-return?period=2026-Q3&format=docx", nil); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("bad format: %d", resp.StatusCode)
	}
	if resp, raw := e.send(member, "GET", "/api/v1/vat-return?period=2026-Q3", nil); resp.StatusCode != 200 {
		t.Errorf("a member reads the return: %d %s", resp.StatusCode, raw)
	}

	resp, raw = e.send(b, "GET", "/api/v1/vat-return?period=2026-Q3&format=csv", nil)
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/csv") ||
		!strings.Contains(string(raw), "303,Normalsatz 8,1 %") && !strings.Contains(string(raw), `303,"Normalsatz 8,1 %`) ||
		!strings.Contains(string(raw), ",1000.00,8.1,81.00,") {
		t.Errorf("csv: %d %s", resp.StatusCode, raw)
	}
	resp, raw = e.send(b, "GET", "/api/v1/vat-return?period=2026-Q3&format=pdf", nil)
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(raw, []byte("%PDF")) ||
		!bytes.Contains(raw, utf16be("MWST-Abrechnung 2026-Q3")) {
		t.Errorf("pdf: %d %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	if resp, _ := e.send(b, "GET", "/api/v1/vat-return", nil); resp.StatusCode != 200 {
		t.Errorf("default period: %d", resp.StatusCode)
	}
}
