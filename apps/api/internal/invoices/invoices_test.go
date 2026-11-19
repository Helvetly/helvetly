package invoices

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
	"helvetly.com/api/internal/swissqr"
)

type fakeStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
	proxy   bool // S3_PROXY_DOWNLOADS
	failPut bool // every Put fails, as an unreachable bucket would
}

func (f *fakeStorage) Put(_ context.Context, key string, body io.Reader, size int64, _, _ string) error {
	b, err := io.ReadAll(body)
	if err != nil || int64(len(b)) != size {
		return fmt.Errorf("put %s: read %d of %d bytes: %v", key, len(b), size, err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failPut {
		return fmt.Errorf("put %s: bucket unreachable", key)
	}
	f.objects[key] = b
	return nil
}

func (f *fakeStorage) Get(_ context.Context, key string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("no object %s", key)
	}
	return b, nil
}

func (f *fakeStorage) PresignDownload(_ context.Context, key string, ttl time.Duration, _ string) (string, error) {
	return "https://s3.test/" + key + "?ttl=" + ttl.String(), nil
}

func (f *fakeStorage) ProxyDownloads() bool { return f.proxy }

func (f *fakeStorage) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.objects, key)
	return nil
}

func (f *fakeStorage) has(prefix string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var keys []string
	for k := range f.objects {
		if strings.Contains(k, prefix) {
			keys = append(keys, k)
		}
	}
	return keys
}

type fakeMailer struct {
	mu     sync.Mutex
	sent   []mail.Message
	onSend func(context.Context) // runs after a successful send
}

func (m *fakeMailer) Send(ctx context.Context, msg mail.Message) error {
	m.mu.Lock()
	m.sent = append(m.sent, msg)
	m.mu.Unlock()
	if m.onSend != nil {
		m.onSend(ctx)
	}
	return nil
}

type env struct {
	t     *testing.T
	st    *store.Store
	srv   *httptest.Server
	files *fakeStorage
	mail  *fakeMailer
	svc   *Service
	raw   *pgxpool.Pool
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
	e := &env{t: t, st: st, raw: raw, files: &fakeStorage{objects: map[string][]byte{}}, mail: &fakeMailer{}}
	e.svc = New(st, a, e.files, e.mail, discard)
	mux := http.NewServeMux()
	a.Register(mux)
	e.svc.Register(mux)
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

type browser struct{ token, csrf, workspace string }

// zone is the test workspaces' time zone.
var zone = store.Workspace{Timezone: "Europe/Zurich"}.Location()

func (e *env) workspace() *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, zone.String(), time.Now()); err != nil {
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

type apiErr struct {
	Error struct {
		Code    string `json:"code"`
		Details struct {
			Fields  map[string]string `json:"fields"`
			Reasons []reason          `json:"reasons"`
		} `json:"details"`
	} `json:"error"`
}

// fails checks the error code and, for validation, that each named field is among the invalid ones.
func (e *env) fails(b *browser, method, path string, body any, status int, code string, fields ...string) apiErr {
	e.t.Helper()
	var out apiErr
	e.do(b, method, path, body, status, &out)
	if out.Error.Code != code {
		e.t.Fatalf("%s %s: code %q, want %q", method, path, out.Error.Code, code)
	}
	for _, f := range fields {
		if out.Error.Details.Fields[f] == "" {
			e.t.Fatalf("%s %s: no message for %s in %v", method, path, f, out.Error.Details.Fields)
		}
	}
	return out
}

// Invoice is the part of the response the tests read.
type Invoice struct {
	ID, Kind, Status, IssueDate, DueDate, Currency, Language, VATMode string
	Number                                                            *string
	IsOverdue                                                         bool
	Total, RoundingAmount, PayableTotal, AmountPaid, AmountCredited   string
	AmountDue, TypeCode, PrepaidTotal                                 string
	CreditedInvoice, DeductedOn                                       *store.InvoiceRef
	Lines                                                             []struct{ Amount, VATCategory, VATRate string }
	Payment                                                           struct {
		IBAN          *string `json:"iban"`
		ReferenceType string  `json:"reference_type"`
		Reference     *string `json:"reference"`
		QRBill        bool    `json:"qr_bill"`
		RevolutURL    *string `json:"revolut_url"`
	}
	PaymentMethods struct {
		QRBill  bool `json:"qr_bill"`
		Revolut bool `json:"revolut"`
	}
	Payments []struct{ ID, Amount string }
	Seller   *store.Party
	Buyer    *store.Party
}

// UnmarshalJSON maps snake_case without tagging every field above.
func (i *Invoice) UnmarshalJSON(b []byte) error {
	type plain Invoice
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	fixed := map[string]json.RawMessage{}
	for k, v := range raw {
		fixed[strings.ReplaceAll(k, "_", "")] = v
	}
	if lines, ok := raw["lines"]; ok {
		var ls []map[string]json.RawMessage
		_ = json.Unmarshal(lines, &ls)
		for _, l := range ls {
			for k, v := range l {
				l[strings.ReplaceAll(k, "_", "")] = v
			}
		}
		fixed["lines"], _ = json.Marshal(ls)
	}
	out, _ := json.Marshal(fixed)
	return json.Unmarshal(out, (*plain)(i))
}

func (e *env) invoice(b *browser, method, path string, body any, want int) Invoice {
	e.t.Helper()
	var out struct{ Data Invoice }
	e.do(b, method, path, body, want, &out)
	return out.Data
}

var completeSettings = map[string]any{
	"seller": map[string]any{"name": "Muster GmbH", "street": "Bahnhofstrasse", "street_number": "1", "zip": "8001",
		"city": "Zürich", "country": "CH", "vat_number": "CHE-109.322.551 MWST", "email": "billing@muster.ch"},
	"iban": "CH44 3199 9123 0008 8901 2", "bank_name": "ZKB",
}

func (e *env) client(b *browser, fields map[string]any) string {
	e.t.Helper()
	body := map[string]any{"name": "Kunde AG", "street": "Rue du Lac", "street_number": "12", "zip": "1003", "city": "Lausanne",
		"country": "CH", "email": "ap@kunde.ch", "payment_terms_days": 10}
	for k, v := range fields {
		if v == nil {
			delete(body, k)
		} else {
			body[k] = v
		}
	}
	id := auth.NewID("cli")
	if err := e.st.CreateClient(context.Background(), b.workspace, id, body, time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return id
}

// ready: a workspace with complete settings and a billable client.
func (e *env) ready() (*browser, string) {
	b := e.workspace()
	e.do(b, "PUT", "/api/v1/invoice-settings", completeSettings, http.StatusOK, nil)
	return b, e.client(b, nil)
}

func line(qty, price string) map[string]any {
	return map[string]any{"description": "Beratung", "quantity": qty, "unit": "hour", "unit_price": price}
}

func (e *env) draft(b *browser, clientID string, extra map[string]any) Invoice {
	body := map[string]any{"client_id": clientID, "lines": []any{line("2", "100.00")}}
	for k, v := range extra {
		body[k] = v
	}
	return e.invoice(b, "POST", "/api/v1/invoices", body, http.StatusCreated)
}

func (e *env) issued(b *browser, clientID string, extra map[string]any) Invoice {
	inv := e.draft(b, clientID, extra)
	return e.invoice(b, "POST", "/api/v1/invoices/"+inv.ID+"/issue", nil, http.StatusOK)
}

func TestSettings(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	var got struct{ Data Settings }
	e.do(b, "GET", "/api/v1/invoice-settings", nil, http.StatusOK, &got)
	if got.Data.IsComplete || got.Data.Currency != "CHF" || got.Data.DefaultVATRate != 810 || !slices.Contains(got.Data.MissingFields, "iban") {
		t.Fatalf("defaults: %+v", got.Data)
	}
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"iban": "CH44 3199 9123 0008 8901 3", "seller": map[string]any{"country": "XX"}},
		http.StatusUnprocessableEntity, "validation_failed", "iban", "seller.country")
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"colour": "red"}, http.StatusBadRequest, "invalid_request")
	e.do(b, "PUT", "/api/v1/invoice-settings", completeSettings, http.StatusOK, &got)
	if !got.Data.IsComplete || *got.Data.IBAN != "CH4431999123000889012" || *got.Data.Seller.VATNumber != "CHE-109.322.551 MWST" {
		t.Fatalf("saved: %+v", got.Data)
	}
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"bic": "ZKB"}, http.StatusUnprocessableEntity, "validation_failed", "bic")
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"bic": "zkbk chzz 80a"}, http.StatusOK, &got)
	if got.Data.BIC == nil || *got.Data.BIC != "ZKBKCHZZ80A" {
		t.Fatalf("bic: %+v", got.Data.BIC)
	}
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"vat_registered": false}, http.StatusOK, &got)
	if got.Data.DefaultVATMode != "none" || !got.Data.IsComplete || got.Data.Seller.Name != "Muster GmbH" {
		t.Fatalf("unregistered: %+v", got.Data)
	}
}

func TestDrafts(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	inv := e.draft(b, clientID, map[string]any{"discount_percent": "10", "lines": []any{line("2", "100.00"),
		map[string]any{"description": "Buch", "quantity": "1", "unit_price": 50, "vat_category": "S", "vat_rate": "2.6"}}})
	today := time.Now().In(zone).Format(time.DateOnly)
	if inv.Status != "draft" || inv.Number != nil || inv.IssueDate != today || inv.DueDate != addDays(today, 10) ||
		inv.Total != "240.75" || inv.RoundingAmount != "0.00" || inv.AmountDue != "240.75" || inv.Payment.ReferenceType != "QRR" ||
		!inv.Payment.QRBill || inv.Lines[0].VATRate != "8.1" {
		t.Fatalf("draft: %+v", inv)
	}

	for _, tt := range []struct {
		name   string
		body   map[string]any
		status int
		fields []string
	}{
		{"unknown field", map[string]any{"client_id": clientID, "number": "1"}, http.StatusBadRequest, nil},
		{"unknown line field", map[string]any{"client_id": clientID, "lines": []any{map[string]any{"description": "x", "unit_price": "1", "id": "x"}}},
			http.StatusBadRequest, nil},
		{"no client", map[string]any{}, http.StatusUnprocessableEntity, []string{"client_id"}},
		{"other workspace's client", map[string]any{"client_id": "cli_nope"}, http.StatusUnprocessableEntity, []string{"client_id"}},
		{"bad numbers", map[string]any{"client_id": clientID, "discount_percent": "101", "lines": []any{
			map[string]any{"description": "", "quantity": "0", "unit_price": "1.001", "vat_category": "S", "vat_rate": "0"},
			map[string]any{"description": "x", "quantity": "-1", "unit_price": "1", "vat_category": "E", "vat_rate": "8.1"}}},
			http.StatusUnprocessableEntity, []string{"discount_percent", "lines.0.quantity", "lines.0.unit_price",
				"lines.0.vat_rate", "lines.1.quantity", "lines.1.vat_rate"}},
		{"credit note kind", map[string]any{"client_id": clientID, "kind": "credit_note"}, http.StatusUnprocessableEntity, []string{"kind"}},
		{"service period backwards", map[string]any{"client_id": clientID, "service_date": "2026-02-01", "service_date_end": "2026-01-01"},
			http.StatusUnprocessableEntity, []string{"service_date_end"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			code := "validation_failed"
			if tt.status == http.StatusBadRequest {
				code = "invalid_request"
			}
			e.fails(b, "POST", "/api/v1/invoices", tt.body, tt.status, code, tt.fields...)
		})
	}

	// preview: no write, no client needed, inclusive mode
	var pv struct{ Data Invoice }
	e.do(b, "POST", "/api/v1/invoices/preview", map[string]any{"vat_mode": "inclusive", "currency": "EUR",
		"lines": []any{line("1", "108.10")}}, http.StatusOK, &pv)
	if pv.Data.Total != "108.10" || pv.Data.RoundingAmount != "0.00" || pv.Data.PayableTotal != "108.10" || pv.Data.ID != "" {
		t.Fatalf("preview: %+v", pv.Data)
	}

	// an empty description computes while drafting
	e.do(b, "POST", "/api/v1/invoices/preview", map[string]any{"lines": []any{map[string]any{"description": "", "quantity": "2", "unit_price": "5"}}},
		http.StatusOK, &pv)
	if pv.Data.PayableTotal != "10.80" || pv.Data.RoundingAmount != "-0.01" {
		t.Fatalf("preview without description: %+v", pv.Data)
	}
	upd := e.invoice(b, "PATCH", "/api/v1/invoices/"+inv.ID, map[string]any{"vat_mode": "none", "reference": "PO-1"}, http.StatusOK)
	if upd.VATMode != "none" || upd.Lines[1].VATCategory != "O" || upd.Total != "225.00" {
		t.Fatalf("patched: %+v", upd)
	}
	other := e.workspace()
	e.fails(other, "GET", "/api/v1/invoices/"+inv.ID, nil, http.StatusNotFound, "not_found")
	e.fails(other, "PATCH", "/api/v1/invoices/"+inv.ID, map[string]any{"note": "x"}, http.StatusNotFound, "not_found")
	e.do(b, "DELETE", "/api/v1/invoices/"+inv.ID, nil, http.StatusNoContent, nil)
	e.fails(b, "GET", "/api/v1/invoices/"+inv.ID, nil, http.StatusNotFound, "not_found")
}

func TestIssue(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	draftClient := e.client(b, map[string]any{"street": nil})
	inv := e.draft(b, draftClient, map[string]any{"issue_date": "2999-01-01", "due_date": "2998-01-01", "lines": []any{
		map[string]any{"description": "EU", "unit_price": "10", "vat_category": "K"}, map[string]any{"description": " ", "unit_price": "1"}}})
	out := e.fails(b, "POST", "/api/v1/invoices/"+inv.ID+"/issue", nil, http.StatusUnprocessableEntity, "cannot_issue")
	got := map[string]string{}
	for _, r := range out.Error.Details.Reasons {
		if r.Message == "" {
			t.Fatalf("reason without a message: %+v", r)
		}
		got[r.Field] = r.Code
	}
	want := map[string]string{"settings.seller.name": "settings_incomplete", "settings.seller.zip": "settings_incomplete",
		"settings.seller.vat_number": "seller_vat_missing", "settings.iban": "no_iban", "client.address": "client_draft",
		"client.vat_number": "buyer_vat_missing", "lines.1.description": "line_description_missing", "issue_date": "issue_date_future",
		"due_date": "due_before_issue"}
	for field, code := range want {
		if got[field] != code {
			t.Errorf("reason for %s = %q, want %q (all: %v)", field, got[field], code, got)
		}
	}

	e.do(b, "PUT", "/api/v1/invoice-settings", completeSettings, http.StatusOK, nil)
	clientID := e.client(b, nil)
	first := e.issued(b, clientID, nil)
	second := e.issued(b, clientID, nil)
	old := e.issued(b, clientID, map[string]any{"issue_date": "2025-12-31"})
	year := time.Now().In(zone).Format("2006")
	if *first.Number != year+"-001" || *second.Number != year+"-002" || *old.Number != "2025-001" {
		t.Fatalf("numbers %s %s %s", *first.Number, *second.Number, *old.Number)
	}
	if first.Status != "open" || first.Payment.ReferenceType != "QRR" || !swissqr.ValidQRR(*first.Payment.Reference) ||
		*first.Payment.Reference == *second.Payment.Reference || first.Seller.Name != "Muster GmbH" || first.Buyer.City != "Lausanne" {
		t.Fatalf("issued: %+v", first)
	}
	if !old.IsOverdue {
		t.Fatal("a 2025 invoice due in 2026-01 is overdue")
	}
	if len(e.files.objects) != 3 {
		t.Fatalf("stored PDFs: %d", len(e.files.objects))
	}
	e.fails(b, "PATCH", "/api/v1/invoices/"+first.ID, map[string]any{"note": "x"}, http.StatusConflict, "invoice_locked")
	e.fails(b, "DELETE", "/api/v1/invoices/"+first.ID, nil, http.StatusConflict, "invoice_locked")
	e.fails(b, "POST", "/api/v1/invoices/"+first.ID+"/issue", nil, http.StatusConflict, "invalid_state")

	// a normal IBAN gets an ISO 11649 reference; USD gets no QR bill
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"iban": "CH93 0076 2011 6238 5295 7", "number_format": "RE-{YYYY}-{NNN}"}, http.StatusOK, nil)
	usd := e.issued(b, clientID, map[string]any{"currency": "USD"})
	if *usd.Number != "RE-"+year+"-003" || usd.Payment.ReferenceType != "SCOR" || !swissqr.ValidSCOR(*usd.Payment.Reference) ||
		usd.Payment.QRBill || usd.RoundingAmount != "0.00" {
		t.Fatalf("usd: %+v", usd)
	}

	// without a year the running number never restarts: one series across years, references kept apart
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"number_format": "INV-{NNNN}"}, http.StatusOK, nil)
	now := e.issued(b, clientID, nil)
	past := e.issued(b, clientID, map[string]any{"issue_date": "2025-06-30"})
	if *now.Number != "INV-0001" || *past.Number != "INV-0002" || *now.Payment.Reference == *usd.Payment.Reference {
		t.Fatalf("yearless: %s %s %s", *now.Number, *past.Number, *now.Payment.Reference)
	}

	// the PDF: drafts render live, issued ones come from storage
	d := e.draft(b, clientID, nil)
	for _, id := range []string{d.ID, first.ID} {
		resp, body := e.send(b, "GET", "/api/v1/invoices/"+id+"/pdf?download=1", nil)
		if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(body, []byte("%PDF")) ||
			!strings.HasPrefix(resp.Header.Get("Content-Disposition"), "attachment") {
			t.Fatalf("pdf %s: %d %v", id, resp.StatusCode, resp.Header)
		}
	}
}

func TestConcurrentIssueIsGapless(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	ids := make([]string, 6)
	for i := range ids {
		ids[i] = e.draft(b, clientID, nil).ID
	}
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Go(func() {
			resp, body := e.send(b, "POST", "/api/v1/invoices/"+id+"/issue", nil)
			if resp.StatusCode != 200 {
				t.Errorf("issue: %d %s", resp.StatusCode, body)
			}
		})
	}
	wg.Wait()
	var list struct{ Data []struct{ Number string } }
	e.do(b, "GET", "/api/v1/invoices?sort=number", nil, http.StatusOK, &list)
	year := time.Now().In(zone).Format("2006")
	for i, inv := range list.Data {
		if want := fmt.Sprintf("%s-%03d", year, i+1); inv.Number != want {
			t.Fatalf("number %d = %s, want %s", i, inv.Number, want)
		}
	}
}

func TestPaymentsAndCredits(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	member := e.join(b.workspace, "member")
	inv := e.issued(b, clientID, nil) // 216.20
	path := "/api/v1/invoices/" + inv.ID

	e.fails(member, "POST", path+"/payments", map[string]any{"amount": "216.25", "paid_on": "2026-01-01", "method": "cash"},
		http.StatusUnprocessableEntity, "validation_failed", "amount")
	e.fails(member, "POST", path+"/payments", map[string]any{"amount": "0", "paid_on": "2999-01-01", "method": "gold"},
		http.StatusUnprocessableEntity, "validation_failed", "amount", "paid_on", "method")
	part := e.invoice(member, "POST", path+"/payments", map[string]any{"amount": "100", "method": "twint", "note": "erste Rate"}, http.StatusCreated)
	if part.Status != "open" || part.AmountPaid != "100.00" || part.AmountDue != "116.20" || len(part.Payments) != 1 {
		t.Fatalf("partial: %+v", part)
	}
	paid := e.invoice(member, "POST", path+"/mark-paid", map[string]any{}, http.StatusOK)
	if paid.Status != "paid" || paid.AmountDue != "0.00" || len(paid.Payments) != 2 || paid.Payments[1].Amount != "116.20" {
		t.Fatalf("paid: %+v", paid)
	}
	e.fails(member, "POST", path+"/mark-paid", map[string]any{}, http.StatusConflict, "invalid_state")
	e.fails(member, "DELETE", path+"/payments/"+paid.Payments[1].ID, nil, http.StatusForbidden, "forbidden")
	e.do(b, "DELETE", path+"/payments/"+paid.Payments[1].ID, nil, http.StatusNoContent, nil)
	if again := e.invoice(b, "GET", path, nil, http.StatusOK); again.Status != "open" || again.AmountDue != "116.20" {
		t.Fatalf("after delete: %+v", again)
	}

	// a partial credit note, then one too large, then the rest
	cn := e.invoice(member, "POST", path+"/credit-note", map[string]any{"lines": []any{line("1", "50")}, "reason": "Rabatt"}, http.StatusCreated)
	if cn.Kind != "credit_note" || cn.Status != "draft" || cn.Total != "54.05" {
		t.Fatalf("credit draft: %+v", cn)
	}
	e.fails(member, "PATCH", "/api/v1/invoices/"+cn.ID, map[string]any{"currency": "EUR"}, http.StatusUnprocessableEntity, "validation_failed", "currency")
	cn = e.invoice(member, "POST", "/api/v1/invoices/"+cn.ID+"/issue", nil, http.StatusOK)
	year := time.Now().In(zone).Format("2006")
	if *cn.Number != "CN-"+year+"-001" || cn.Status != "paid" || cn.AmountDue != "0.00" || cn.Payment.QRBill {
		t.Fatalf("credit issued: %+v", cn)
	}
	after := e.invoice(b, "GET", path, nil, http.StatusOK)
	if after.AmountCredited != "54.05" || after.AmountDue != "62.15" || after.Status != "open" {
		t.Fatalf("after credit: %+v", after)
	}
	e.fails(member, "POST", path+"/credit-note", map[string]any{}, http.StatusUnprocessableEntity, "validation_failed", "lines")
	rest := e.invoice(member, "POST", path+"/credit-note", map[string]any{"lines": []any{line("1", "57.50")}}, http.StatusCreated) // 62.16 → 62.15
	e.invoice(member, "POST", "/api/v1/invoices/"+rest.ID+"/issue", nil, http.StatusOK)
	if done := e.invoice(b, "GET", path, nil, http.StatusOK); done.Status != "paid" || done.AmountDue != "0.00" {
		t.Fatalf("settled: %+v", done)
	}
	var credits struct{ Meta struct{ Total int } }
	e.do(b, "GET", "/api/v1/invoices?credited_invoice_id="+inv.ID, nil, http.StatusOK, &credits)
	if credits.Meta.Total != 2 {
		t.Fatalf("credit notes of the invoice: %d", credits.Meta.Total)
	}

	// void: owners only, open invoices without payments
	other := e.issued(b, clientID, nil)
	e.fails(member, "POST", "/api/v1/invoices/"+other.ID+"/void", map[string]any{}, http.StatusForbidden, "forbidden")
	e.fails(b, "POST", path+"/void", map[string]any{}, http.StatusConflict, "invalid_state")
	voided := e.invoice(b, "POST", "/api/v1/invoices/"+other.ID+"/void", map[string]any{"reason": "Falscher Kunde"}, http.StatusOK)
	if voided.Status != "void" || voided.AmountCredited != "216.20" || voided.AmountDue != "0.00" {
		t.Fatalf("voided: %+v", voided)
	}
	e.fails(member, "POST", "/api/v1/invoices/"+other.ID+"/payments", map[string]any{"amount": "1", "method": "cash"}, http.StatusConflict, "invalid_state")

	dup := e.invoice(member, "POST", "/api/v1/invoices/"+other.ID+"/duplicate", nil, http.StatusCreated)
	if dup.Status != "draft" || dup.Total != "216.20" || dup.Number != nil {
		t.Fatalf("duplicate: %+v", dup)
	}
}

func TestSendListExportSummary(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	d := e.draft(b, clientID, nil)
	e.fails(b, "POST", "/api/v1/invoices/"+d.ID+"/send", map[string]any{}, http.StatusConflict, "invalid_state")
	inv := e.issued(b, clientID, map[string]any{"reference": "PO-77", "language": "fr"})
	e.fails(b, "POST", "/api/v1/invoices/"+inv.ID+"/send", map[string]any{"to": []string{"nope"}}, http.StatusUnprocessableEntity, "validation_failed", "to")
	e.do(b, "POST", "/api/v1/invoices/"+inv.ID+"/send", map[string]any{"cc": []string{"Boss@Kunde.ch"}}, http.StatusOK, nil)
	m := e.mail.sent[0]
	if !slices.Equal(m.To, []string{"ap@kunde.ch"}) || !slices.Equal(m.Cc, []string{"boss@kunde.ch"}) || m.ReplyTo != "billing@muster.ch" ||
		!strings.HasPrefix(m.Subject, "Facture ") || len(m.Attachments) != 1 || !bytes.HasPrefix(m.Attachments[0].Data, []byte("%PDF")) {
		t.Fatalf("mail: %+v", m)
	}
	var dl struct{ Data []store.Delivery }
	e.do(b, "GET", "/api/v1/invoices/"+inv.ID+"/deliveries", nil, http.StatusOK, &dl)
	if len(dl.Data) != 1 || dl.Data[0].To[0] != "ap@kunde.ch" || dl.Data[0].SentBy == nil {
		t.Fatalf("deliveries: %+v", dl.Data)
	}

	var list struct {
		Data []struct{ ID, Status string }
		Meta struct{ Total int }
	}
	for _, tt := range []struct {
		query string
		want  int
	}{
		{"", 2}, {"?status=draft", 1}, {"?status=open,paid", 1}, {"?search=po-77", 1}, {"?client_id=" + clientID + "&kind=invoice", 2},
		{"?kind=credit_note", 0}, {"?issued_from=2999-01-01", 0}, {"?status=overdue", 0},
	} {
		e.do(b, "GET", "/api/v1/invoices"+tt.query, nil, http.StatusOK, &list)
		if list.Meta.Total != tt.want {
			t.Errorf("list%s: %d, want %d", tt.query, list.Meta.Total, tt.want)
		}
	}
	e.fails(b, "GET", "/api/v1/invoices?status=late", nil, http.StatusBadRequest, "invalid_request")
	e.fails(b, "GET", "/api/v1/invoices?sort=amount", nil, http.StatusBadRequest, "invalid_request")

	resp, body := e.send(b, "GET", "/api/v1/invoices/export?status=open", nil)
	if resp.StatusCode != 200 || !bytes.HasPrefix(body, []byte("\xEF\xBB\xBF")) {
		t.Fatalf("export: %d %q", resp.StatusCode, body[:min(10, len(body))])
	}
	rows, err := csv.NewReader(bytes.NewReader(body[3:])).ReadAll()
	if err != nil || len(rows) != 2 || rows[0][0] != "number" || rows[1][2] != "380" || rows[1][17] != "PO-77" || rows[1][11] != "216.20" || rows[1][13] != "216.20" {
		t.Fatalf("csv: %v %v", rows, err)
	}

	e.invoice(b, "POST", "/api/v1/invoices/"+inv.ID+"/payments", map[string]any{"amount": "16.20", "method": "card"}, http.StatusCreated)
	var raw struct{ Data []map[string]any }
	e.do(b, "GET", "/api/v1/invoices?status=draft", nil, http.StatusOK, &raw)
	if it := raw.Data[0]; it["total"] != "216.20" || it["rounding_amount"] != "0.00" || it["payable_total"] != "216.20" {
		t.Fatalf("list item: %v", it)
	}

	// another client's invoice stays out of a client-scoped summary
	other := e.client(b, map[string]any{"name": "Andere AG"})
	e.issued(b, other, nil)
	var sum struct{ Data store.InvoiceSummary }
	e.do(b, "GET", "/api/v1/invoices/summary?client_id="+clientID, nil, http.StatusOK, &sum)
	s := sum.Data
	if s.Currency != "CHF" || s.Outstanding.Amount != 20000 || s.Outstanding.Count != 1 || s.Drafts.Count != 1 ||
		s.PaidThisMonth.Amount != 1620 || len(s.Monthly) != 12 || s.Monthly[11].Invoiced != 21620 || s.CollectionRate == nil {
		t.Fatalf("summary: %+v", s)
	}
}

// A client that disconnects once the mail is out must not lose the delivery record.
func TestSendRecordedAfterClientDisconnects(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	inv := e.issued(b, clientID, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	e.mail.onSend = func(server context.Context) {
		cancel()
		<-server.Done() // the server has seen the disconnect
	}
	req, err := http.NewRequestWithContext(ctx, "POST", e.srv.URL+"/api/v1/invoices/"+inv.ID+"/send", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", b.csrf)
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	if resp, err := http.DefaultClient.Do(req); err == nil {
		resp.Body.Close()
		t.Fatal("the request was not cancelled")
	}
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(20 * time.Millisecond) {
		d, err := e.st.Deliveries(context.Background(), inv.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(d) == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("mail sent, %d deliveries recorded", len(d))
		}
	}
}
