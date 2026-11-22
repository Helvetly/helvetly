package expenses

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/approvals"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// ---- computation (no database) ----

func money(s string) invoicecalc.Money {
	m, ok := invoicecalc.ParseMoney(s)
	if !ok {
		panic(s)
	}
	return m
}

func pct(s string) invoicecalc.Percent {
	p, ok := invoicecalc.ParsePercent(s)
	if !ok {
		panic(s)
	}
	return p
}

func TestCompute(t *testing.T) {
	type vat struct{ rate, taxable, vat, deductible string }
	tests := []struct {
		name, mode, percent, rate      string
		lines                          [][2]string // amount, rate
		net, vatTotal, total, deduct   string
		breakdown                      []vat
		baseTotal, baseVAT, baseDeduct string
	}{
		{name: "gross receipt, one rate", mode: "gross", percent: "100", rate: "1", lines: [][2]string{{"108.10", "8.1"}},
			net: "100.00", vatTotal: "8.10", total: "108.10", deduct: "8.10", breakdown: []vat{{"8.1", "100.00", "8.10", "8.10"}},
			baseTotal: "108.10", baseVAT: "8.10", baseDeduct: "8.10"},
		{name: "hotel bill: lodging and breakfast at two rates, one rounding each", mode: "gross", percent: "100", rate: "1",
			lines: [][2]string{{"180.00", "3.8"}, {"25.00", "8.1"}},
			net:   "196.54", vatTotal: "8.46", total: "205.00", deduct: "8.46",
			breakdown: []vat{{"8.1", "23.13", "1.87", "1.87"}, {"3.8", "173.41", "6.59", "6.59"}},
			baseTotal: "205.00", baseVAT: "8.46", baseDeduct: "8.46"},
		{name: "net supplier invoice, half private use", mode: "net", percent: "50", rate: "1", lines: [][2]string{{"1000.00", "8.1"}},
			net: "1000.00", vatTotal: "81.00", total: "1081.00", deduct: "40.50", breakdown: []vat{{"8.1", "1000.00", "81.00", "40.50"}},
			baseTotal: "1081.00", baseVAT: "81.00", baseDeduct: "40.50"},
		{name: "EUR receipt converted, base net is what is left", mode: "gross", percent: "100", rate: "0.9412",
			lines: [][2]string{{"119.00", "19"}}, net: "100.00", vatTotal: "19.00", total: "119.00", deduct: "19.00",
			breakdown: []vat{{"19", "100.00", "19.00", "19.00"}}, baseTotal: "112.00", baseVAT: "17.88", baseDeduct: "17.88"},
		{name: "no VAT and no lines", mode: "gross", percent: "0", rate: "1", lines: nil,
			net: "0.00", vatTotal: "0.00", total: "0.00", deduct: "0.00", breakdown: []vat{}, baseTotal: "0.00", baseVAT: "0.00", baseDeduct: "0.00"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, _ := invoicecalc.ParseRate(tt.rate)
			e := store.Expense{AmountMode: tt.mode, DeductiblePercent: pct(tt.percent), ExchangeRate: r}
			for _, l := range tt.lines {
				e.Lines = append(e.Lines, store.ExpenseLine{Amount: money(l[0]), VATRate: pct(l[1])})
			}
			compute(&e, "CHF")
			got := []string{e.NetTotal.String(), e.VATTotal.String(), e.Total.String(), e.DeductibleVAT.String(),
				e.Base.Total.String(), e.Base.VATTotal.String(), e.Base.DeductibleVAT.String()}
			want := []string{tt.net, tt.vatTotal, tt.total, tt.deduct, tt.baseTotal, tt.baseVAT, tt.baseDeduct}
			if !slices.Equal(got, want) {
				t.Fatalf("totals %v, want %v", got, want)
			}
			if e.Base.NetTotal+e.Base.VATTotal != e.Base.Total || e.NetTotal+e.VATTotal != e.Total {
				t.Fatalf("does not add up: %+v", e.Base)
			}
			var bd []vat
			for _, g := range e.VATBreakdown {
				bd = append(bd, vat{g.Rate.String(), g.TaxableAmount.String(), g.VATAmount.String(), g.DeductibleAmount.String()})
			}
			if len(bd) != len(tt.breakdown) || (len(bd) > 0 && !slices.Equal(bd, tt.breakdown)) {
				t.Fatalf("breakdown %v, want %v", bd, tt.breakdown)
			}
		})
	}
}

func TestReceiptType(t *testing.T) {
	heic := append([]byte{0, 0, 0, 24}, []byte("ftypheic\x00\x00\x00\x00")...)
	tests := []struct {
		name string
		head []byte
		want string
	}{
		{"scan.pdf", []byte("%PDF-1.7\n"), "application/pdf"},
		{"photo.JPG", []byte("\xFF\xD8\xFF\xE0\x00\x10JFIF"), "image/jpeg"},
		{"IMG_1.heic", heic, "image/heic"},
		{"fake.pdf", []byte("<html><script>"), ""},
		{"page.html", []byte("<html>"), ""},
		{"photo.png", []byte("\xFF\xD8\xFF\xE0"), ""}, // a JPEG named .png
	}
	for _, tt := range tests {
		if got := receiptType(tt.name, tt.head); got != tt.want {
			t.Errorf("receiptType(%s) = %q, want %q", tt.name, got, tt.want)
		}
	}
}

// ---- the API ----

type fakeStorage struct {
	mu       sync.Mutex
	objects  map[string][]byte
	retained map[string]bool // locked like S3 Object Lock: deleting fails
	proxy    bool            // S3_PROXY_DOWNLOADS
}

func (f *fakeStorage) RetentionMode() string { return "COMPLIANCE" }

func (f *fakeStorage) RetainUntil(requested time.Time, deadline *time.Time) time.Time {
	if deadline != nil {
		return *deadline
	}
	return requested.AddDate(0, 0, 1)
}

func (f *fakeStorage) Retain(_ context.Context, key string, until time.Time) (storage.Lock, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.objects[key]; !ok {
		return storage.Lock{}, fmt.Errorf("retain %s: missing", key)
	}
	f.retained[key] = true
	return storage.Lock{VersionID: "v1", Mode: "COMPLIANCE", Until: until}, nil
}

func (f *fakeStorage) isRetained(key string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.retained[key]
}

func (f *fakeStorage) Put(_ context.Context, key string, body io.Reader, size int64, _, _ string) error {
	b, err := io.ReadAll(body)
	if err != nil || int64(len(b)) != size {
		return fmt.Errorf("put %s: read %d of %d bytes: %v", key, len(b), size, err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[key] = b
	return nil
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

func (f *fakeStorage) PresignDownload(_ context.Context, key string, ttl time.Duration, _ string) (string, error) {
	return "https://s3.test/" + key + "?ttl=" + ttl.String(), nil
}

func (f *fakeStorage) ProxyDownloads() bool { return f.proxy }

func (f *fakeStorage) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.retained[key] {
		return fmt.Errorf("delete %s: object is locked", key)
	}
	delete(f.objects, key)
	return nil
}

func (f *fakeStorage) keys() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	keys := []string{}
	for k := range f.objects {
		keys = append(keys, k)
	}
	return keys
}

func (f *fakeStorage) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.objects)
}

type env struct {
	t     *testing.T
	st    *store.Store
	srv   *httptest.Server
	files *fakeStorage
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
	files := &fakeStorage{objects: map[string][]byte{}, retained: map[string]bool{}}
	svc := New(st, a, files, discard)
	svc.now = func() time.Time { return time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC) }
	ap := approvals.New(st, a)
	svc.SetApprovals(ap)
	mux := http.NewServeMux()
	a.Register(mux)
	ap.Register(mux)
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, srv: srv, files: files, svc: svc, raw: raw}
}

type browser struct{ token, csrf, workspace, user string }

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
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws, user: u.ID}
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

func (e *env) send(b *browser, method, path string, body any, contentType string) (*http.Response, []byte) {
	e.t.Helper()
	var rd io.Reader
	switch v := body.(type) {
	case nil:
	case *bytes.Buffer:
		rd = v
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			e.t.Fatal(err)
		}
		rd, contentType = bytes.NewReader(raw), "application/json"
	}
	req, err := http.NewRequest(method, e.srv.URL+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
	resp, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp, raw
}

func (e *env) do(b *browser, method, path string, body any, want int, out any) {
	e.t.Helper()
	resp, raw := e.send(b, method, path, body, "")
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
			Reasons []string          `json:"reasons"`
		} `json:"details"`
	} `json:"error"`
}

func (e *env) fails(b *browser, method, path string, body any, status int, code string, fields ...string) apiErr {
	e.t.Helper()
	var out apiErr
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
	if len(fields) > 0 && !slices.Equal(got, fields) {
		e.t.Fatalf("%s %s: invalid fields %v, want %v", method, path, out.Error.Details.Fields, fields)
	}
	return out
}

// expense is the JSON the API answers, read back with the decimals as strings.
type expense struct {
	ID            string   `json:"id"`
	Number        int64    `json:"number"`
	Status        string   `json:"status"`
	Total         string   `json:"total"`
	VATTotal      string   `json:"vat_total"`
	DeductibleVAT string   `json:"deductible_vat"`
	InputTax      string   `json:"input_tax"`
	Country       string   `json:"supplier_country"`
	Percent       string   `json:"deductible_percent"`
	ExchangeRate  string   `json:"exchange_rate"`
	PaymentStatus string   `json:"payment_status"`
	PaidOn        *string  `json:"paid_on"`
	IsComplete    bool     `json:"is_complete"`
	IsOverdue     bool     `json:"is_overdue"`
	MissingFields []string `json:"missing_fields"`
	Category      *struct {
		ID          string `json:"id"`
		AccountCode string `json:"account_code"`
	} `json:"category"`
	Base struct {
		Currency string `json:"currency"`
		Total    string `json:"total"`
	} `json:"base"`
	PaidByMember *struct{ ID string }   `json:"paid_by_member"`
	CreatedBy    *struct{ Name string } `json:"created_by"`
	BookedBy     *struct{ Name string } `json:"booked_by"`
	VoidReason   *string                `json:"void_reason"`
	Lines        []struct {
		Amount  string `json:"amount"`
		VATRate string `json:"vat_rate"`
	} `json:"lines"`
	ReceiptsCount int     `json:"receipts_count"`
	ReverseCharge bool    `json:"reverse_charge"`
	InputTaxBox   *string `json:"input_tax_box"`
}

func (e *env) create(b *browser, body map[string]any) expense {
	e.t.Helper()
	var out struct{ Data expense }
	e.do(b, "POST", "/api/v1/expenses", body, 201, &out)
	return out.Data
}

type category struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AccountCode string `json:"account_code"`
	IsArchived  bool   `json:"is_archived"`
}

func (e *env) categories(b *browser) map[string]category {
	e.t.Helper()
	var out struct{ Data []category }
	e.do(b, "GET", "/api/v1/expense-categories", nil, 200, &out)
	byCode := map[string]category{}
	for _, c := range out.Data {
		byCode[c.AccountCode] = c
	}
	return byCode
}

// categoryList: the categories as the API names them for a ?lang and an Accept-Language (either may be empty).
func (e *env) categoryList(b *browser, lang, acceptLanguage string) []presetCategory {
	e.t.Helper()
	req, err := http.NewRequest("GET", e.srv.URL+"/api/v1/expense-categories?include_archived=1&lang="+lang, nil)
	if err != nil {
		e.t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	if acceptLanguage != "" {
		req.Header.Set("Accept-Language", acceptLanguage)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct{ Data []presetCategory }
	if resp.StatusCode != 200 {
		e.t.Fatalf("categories: status %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		e.t.Fatal(err)
	}
	return out.Data
}

func (e *env) upload(b *browser, id, name string, content []byte) *http.Response {
	e.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, _ := w.CreateFormFile("files[]", name)
	_, _ = part.Write(content)
	_ = w.Close()
	resp, _ := e.send(b, "POST", "/api/v1/expenses/"+id+"/receipts", &buf, w.FormDataContentType())
	return resp
}

var pdf = []byte("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n")

func complete(categoryID string) map[string]any {
	return map[string]any{"supplier_name": "SBB CFF FFS", "document_date": "2026-11-03", "category_id": categoryID,
		"lines": []map[string]any{{"amount": "108.10", "vat_rate": "8.1"}}}
}

func TestLifecycle(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	member := e.join(owner.workspace, "member")
	travel := e.categories(owner)["6640"]
	if travel.Name != "Travel" || len(e.categoryList(owner, "", "")) != len(store.CategoryPresets) {
		t.Fatalf("seeded categories: %+v", e.categories(owner))
	}

	draft := e.create(member, map[string]any{})
	if draft.Number != 1 || draft.Status != "draft" || draft.InputTax != "full" || draft.Total != "0.00" || draft.Base.Currency != "CHF" ||
		!slices.Equal(draft.MissingFields, []string{"supplier_name", "document_date", "category", "total", "receipt"}) ||
		draft.CreatedBy == nil || draft.CreatedBy.Name != "Anna member" {
		t.Fatalf("draft: %+v", draft)
	}
	out := e.fails(member, "POST", "/api/v1/expenses/"+draft.ID+"/book", nil, 422, "cannot_book")
	if len(out.Error.Details.Reasons) != 5 {
		t.Fatalf("reasons: %v", out.Error.Details.Reasons)
	}

	var got struct{ Data expense }
	e.do(member, "PATCH", "/api/v1/expenses/"+draft.ID, complete(travel.ID), 200, &got)
	if got.Data.Total != "108.10" || got.Data.VATTotal != "8.10" || got.Data.DeductibleVAT != "8.10" ||
		!slices.Equal(got.Data.MissingFields, []string{"receipt"}) || got.Data.Category.AccountCode != "6640" {
		t.Fatalf("filled: %+v", got.Data)
	}
	if resp := e.upload(member, draft.ID, "ticket.pdf", pdf); resp.StatusCode != 201 {
		t.Fatalf("upload: %d", resp.StatusCode)
	}
	e.do(member, "POST", "/api/v1/expenses/"+draft.ID+"/book", nil, 200, &got)
	if got.Data.Status != "booked" || !got.Data.IsComplete || got.Data.BookedBy == nil || got.Data.ReceiptsCount != 1 {
		t.Fatalf("booked: %+v", got.Data)
	}
	for _, key := range e.files.receiptKeys() {
		if !e.files.isRetained(key) {
			t.Fatalf("booked receipt %s not retained", key)
		}
	}
	if resp := e.upload(member, draft.ID, "second.pdf", append(append([]byte{}, pdf...), []byte("second receipt")...)); resp.StatusCode != 201 || len(e.files.receiptKeys()) != 2 {
		t.Fatalf("upload to booked: %d", resp.StatusCode)
	}
	for _, key := range e.files.receiptKeys() {
		if !e.files.isRetained(key) {
			t.Fatalf("receipt added after booking %s not retained", key)
		}
	}

	// Booked: amounts, receipts and the record itself are kept; the payment can still be recorded.
	e.fails(member, "PATCH", "/api/v1/expenses/"+draft.ID, map[string]any{"lines": []map[string]any{{"amount": "1"}}}, 409, "expense_locked")
	e.fails(member, "DELETE", "/api/v1/expenses/"+draft.ID, nil, 409, "invalid_state")
	var files struct{ Data []struct{ ID string } }
	e.do(member, "GET", "/api/v1/expenses/"+draft.ID+"/receipts", nil, 200, &files)
	e.fails(member, "DELETE", "/api/v1/expenses/"+draft.ID+"/receipts/"+files.Data[0].ID, nil, 409, "invalid_state")
	e.do(member, "PATCH", "/api/v1/expenses/"+draft.ID, map[string]any{"payment_status": "paid", "payment_method": "twint"}, 200, &got)
	if got.Data.PaymentStatus != "paid" || got.Data.PaidOn == nil || *got.Data.PaidOn != "2026-11-03" {
		t.Fatalf("paid: %+v", got.Data)
	}

	// Voiding is for owners and admins, with a reason; the copy is a fresh draft.
	e.fails(member, "POST", "/api/v1/expenses/"+draft.ID+"/void", map[string]any{"reason": "Wrong amount"}, 403, "forbidden")
	e.fails(owner, "POST", "/api/v1/expenses/"+draft.ID+"/void", map[string]any{"reason": " "}, 422, "validation_failed", "reason")
	e.do(owner, "POST", "/api/v1/expenses/"+draft.ID+"/void", map[string]any{"reason": "Wrong amount"}, 200, &got)
	if got.Data.Status != "void" || *got.Data.VoidReason != "Wrong amount" {
		t.Fatalf("void: %+v", got.Data)
	}
	e.fails(owner, "PATCH", "/api/v1/expenses/"+draft.ID, map[string]any{"payment_status": "unpaid"}, 409, "expense_locked")
	e.do(owner, "PATCH", "/api/v1/expenses/"+draft.ID, map[string]any{"note": "Booked again as #2"}, 200, nil)
	if resp := e.upload(owner, draft.ID, "more.pdf", pdf); resp.StatusCode != 409 {
		t.Fatalf("upload to void: %d", resp.StatusCode)
	}
	var dup struct{ Data expense }
	e.do(member, "POST", "/api/v1/expenses/"+draft.ID+"/duplicate", nil, 201, &dup)
	if dup.Data.Number != 2 || dup.Data.Status != "draft" || dup.Data.Total != "108.10" || dup.Data.PaymentStatus != "unpaid" ||
		!slices.Equal(dup.Data.MissingFields, []string{"document_date", "receipt"}) {
		t.Fatalf("duplicate: %+v", dup.Data)
	}
	e.do(member, "DELETE", "/api/v1/expenses/"+dup.Data.ID, nil, 204, nil)
	e.do(member, "GET", "/api/v1/expenses/"+dup.Data.ID, nil, 404, nil)

	// Another workspace sees none of it.
	other := e.workspace()
	e.do(other, "GET", "/api/v1/expenses/"+draft.ID, nil, 404, nil)
	e.fails(other, "PATCH", "/api/v1/expenses/"+draft.ID, map[string]any{"note": "x"}, 404, "not_found")
	e.fails(other, "PATCH", "/api/v1/expenses/"+e.create(other, map[string]any{}).ID, map[string]any{"category_id": travel.ID},
		422, "validation_failed", "category_id")
}

func TestInput(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	stranger := e.workspace()
	tests := []struct {
		name   string
		body   map[string]any
		status int
		fields []string
		check  func(expense) bool
	}{
		{"unknown field", map[string]any{"price": 10}, 400, nil, nil},
		{"bad currency and mode", map[string]any{"currency": "CHFX", "amount_mode": "both"}, 422, []string{"amount_mode", "currency"}, nil},
		{"floats are never read as floats", map[string]any{"lines": []map[string]any{{"amount": 0.1, "vat_rate": 8.1}}}, 201, nil,
			func(x expense) bool { return x.Total == "0.10" && x.VATTotal == "0.01" }},
		{"three decimals", map[string]any{"lines": []map[string]any{{"amount": "1.005"}}}, 422, []string{"lines.0.amount"}, nil},
		{"line default rate is the workspace's", map[string]any{"lines": []map[string]any{{"amount": "54.05"}}}, 201, nil,
			func(x expense) bool { return x.Lines[0].VATRate == "8.1" && x.VATTotal == "4.05" }},
		{"partial from a percentage", map[string]any{"deductible_percent": "40", "lines": []map[string]any{{"amount": "108.10"}}}, 201, nil,
			func(x expense) bool { return x.InputTax == "partial" && x.DeductibleVAT == "3.24" }},
		{"partial needs a share", map[string]any{"input_tax": "partial", "deductible_percent": "100"}, 422, []string{"deductible_percent"}, nil},
		{"share above 100", map[string]any{"deductible_percent": "150"}, 422, []string{"deductible_percent"}, nil},
		{"share not a number", map[string]any{"deductible_percent": "kkk2.6"}, 422, []string{"deductible_percent"}, nil},
		{"negative line rate", map[string]any{"lines": []map[string]any{{"amount": "10", "vat_rate": "-8.1"}}}, 422, []string{"lines.0.vat_rate"}, nil},
		{"line rate above 100", map[string]any{"lines": []map[string]any{{"amount": "10", "vat_rate": "101"}}}, 422, []string{"lines.0.vat_rate"}, nil},
		{"none clears the share", map[string]any{"input_tax": "none", "lines": []map[string]any{{"amount": "108.10"}}}, 201, nil,
			func(x expense) bool { return x.Percent == "0" && x.DeductibleVAT == "0.00" }},
		{"dates in order and not in the future", map[string]any{"document_date": "2026-11-04", "due_date": "2026-11-01",
			"paid_on": "2026-12-01"}, 422, []string{"due_date", "paid_on"}, nil},
		{"acquisition tax only from abroad", map[string]any{"reverse_charge": true}, 422, []string{"reverse_charge"}, nil},
		{"acquisition tax on a service from abroad", map[string]any{"supplier_country": "DE", "reverse_charge": true,
			"input_tax_box": "405"}, 201, nil, func(x expense) bool { return x.ReverseCharge && *x.InputTaxBox == "405" }},
		{"input tax box 400 or 405", map[string]any{"input_tax_box": "401", "reverse_charge": "yes"}, 422,
			[]string{"input_tax_box", "reverse_charge"}, nil},
		{"input tax box from the category by default", map[string]any{}, 201, nil,
			func(x expense) bool { return !x.ReverseCharge && x.InputTaxBox == nil }},
		{"reimbursed needs a member", map[string]any{"reimbursed_on": "2026-11-01"}, 422, []string{"reimbursed_on"}, nil},
		{"a member who paid makes it paid", map[string]any{"paid_by_member_id": b.user, "document_date": "2026-11-02"}, 201, nil,
			func(x expense) bool {
				return x.PaymentStatus == "paid" && *x.PaidOn == "2026-11-02" && x.PaidByMember.ID == b.user
			}},
		{"someone else's member", map[string]any{"paid_by_member_id": stranger.user}, 422, []string{"paid_by_member_id"}, nil},
		{"foreign currency needs its rate's date and source", map[string]any{"currency": "eur", "exchange_rate": "0.9412",
			"lines": []map[string]any{{"amount": "119.00", "vat_rate": "19"}}}, 201, nil,
			func(x expense) bool {
				return x.ExchangeRate == "0.9412" && x.Base.Total == "112.00" && slices.Contains(x.MissingFields, "exchange_rate")
			}},
		{"the home currency has rate 1", map[string]any{"currency": "CHF", "exchange_rate": "2"}, 201, nil,
			func(x expense) bool { return x.ExchangeRate == "1" }},
		{"Swiss supplier: full input tax", map[string]any{"supplier_country": "li"}, 201, nil,
			func(x expense) bool { return x.Country == "LI" && x.InputTax == "full" && x.Percent == "100" }},
		{"foreign VAT is not Swiss input tax", map[string]any{"supplier_country": "de", "currency": "EUR",
			"lines": []map[string]any{{"amount": "119.00", "vat_rate": "19"}}}, 201, nil,
			func(x expense) bool { return x.Country == "DE" && x.InputTax == "none" && x.DeductibleVAT == "0.00" }},
		{"an explicit choice overrides the foreign default", map[string]any{"supplier_country": "DE", "input_tax": "full"}, 201, nil,
			func(x expense) bool { return x.InputTax == "full" && x.Percent == "100" }},
		{"bad country", map[string]any{"supplier_country": "XX"}, 422, []string{"supplier_country"}, nil},
		{"overdue", map[string]any{"document_date": "2026-10-01", "due_date": "2026-10-31"}, 201, nil,
			func(x expense) bool { return x.IsOverdue }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, raw := e.send(b, "POST", "/api/v1/expenses", tt.body, "")
			if resp.StatusCode != tt.status {
				t.Fatalf("status %d, want %d: %s", resp.StatusCode, tt.status, raw)
			}
			if tt.fields != nil {
				var out apiErr
				_ = json.Unmarshal(raw, &out)
				got := []string{}
				for f := range out.Error.Details.Fields {
					got = append(got, f)
				}
				slices.Sort(got)
				if !slices.Equal(got, tt.fields) {
					t.Fatalf("fields %v, want %v", out.Error.Details.Fields, tt.fields)
				}
			}
			if tt.check != nil {
				var out struct{ Data expense }
				_ = json.Unmarshal(raw, &out)
				if !tt.check(out.Data) {
					t.Fatalf("unexpected: %s", raw)
				}
			}
		})
	}
}

func TestListBulkExportSummary(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cats := e.categories(b)
	travel, it := cats["6640"].ID, cats["6570"].ID

	mk := func(supplier, date, amount, categoryID string, extra map[string]any) expense {
		body := map[string]any{"supplier_name": supplier, "document_date": date, "category_id": categoryID,
			"lines": []map[string]any{{"amount": amount, "vat_rate": "8.1"}}, "receipt_missing_reason": "Lost on the train"}
		for k, v := range extra {
			body[k] = v
		}
		return e.create(b, body)
	}
	sbb := mk("SBB", "2026-11-03", "108.10", travel, nil)
	swisscom := mk("=Swisscom", "2026-11-01", "54.05", it, map[string]any{"payment_status": "paid"})
	october := mk("Hotel Bern", "2026-10-15", "216.20", travel, map[string]any{"paid_by_member_id": b.user})
	draft := e.create(b, map[string]any{"supplier_name": "Unknown"})

	var bulk struct {
		Data struct {
			Updated int `json:"updated"`
			Skipped []struct{ ID, Reason string }
		}
	}
	if resp := e.upload(b, draft.ID, "ticket.pdf", pdf); resp.StatusCode != 201 {
		t.Fatalf("upload: %d", resp.StatusCode)
	}
	e.do(b, "POST", "/api/v1/expenses/bulk", map[string]any{"ids": []string{sbb.ID, swisscom.ID, october.ID, draft.ID}, "action": "book"}, 200, &bulk)
	if bulk.Data.Updated != 3 || len(bulk.Data.Skipped) != 1 || bulk.Data.Skipped[0].ID != draft.ID {
		t.Fatalf("bulk book: %+v", bulk.Data)
	}
	e.do(b, "POST", "/api/v1/expenses/bulk", map[string]any{"ids": []string{sbb.ID, swisscom.ID}, "action": "mark_paid", "payment_method": "card"}, 200, &bulk)
	if bulk.Data.Updated != 1 || bulk.Data.Skipped[0].Reason != "Already paid." {
		t.Fatalf("bulk paid: %+v", bulk.Data)
	}
	e.fails(b, "POST", "/api/v1/expenses/bulk", map[string]any{"ids": []string{sbb.ID}, "action": "approve"}, 422, "validation_failed", "action")

	list := func(query string) []int64 {
		var out struct{ Data []expense }
		e.do(b, "GET", "/api/v1/expenses?"+query, nil, 200, &out)
		n := []int64{}
		for _, x := range out.Data {
			n = append(n, x.Number)
		}
		return n
	}
	for _, tt := range []struct {
		query string
		want  []int64
	}{
		{"search=swiss", []int64{2}},
		{"search=%233", []int64{3}},
		{"status=draft", []int64{4}},
		{"payment=to_reimburse", []int64{3}},
		{"category_id=" + it, []int64{2}},
		{"from=2026-11-01&to=2026-11-30&sort=document_date", []int64{2, 1}},
		{"sort=-total&status=booked", []int64{3, 1, 2}},
		{"total_min=100&total_max=200&sort=number", []int64{1}},
		{"total_min=108.10&sort=number", []int64{1, 3}},
		{"total_max=54.05", []int64{2, 4}},
		{"receipt=attached", []int64{4}},
		{"receipt=missing&sort=number", []int64{1, 2, 3}},
	} {
		if got := list(tt.query); !slices.Equal(got, tt.want) {
			t.Errorf("%s: %v, want %v", tt.query, got, tt.want)
		}
	}
	if got := list(""); !slices.Equal(got, []int64{1, 2, 3, 4}) {
		t.Errorf("default sort (newest document first, undated last): %v", got)
	}
	for _, bad := range []string{"sort=price", "total_min=abc", "total_max=1.234", "receipt=yes"} {
		e.fails(b, "GET", "/api/v1/expenses?"+bad, nil, 400, "invalid_request")
	}

	var sum struct {
		Data struct {
			Currency  string `json:"currency"`
			ThisMonth struct {
				Amount string
				Count  int
			} `json:"this_month"`
			LastMonth struct{ Amount string } `json:"last_month"`
			Unpaid    struct {
				Amount string
				Count  int
			} `json:"unpaid"`
			ToReimburse struct{ Amount string }         `json:"to_reimburse"`
			InputVAT    struct{ Period, Amount string } `json:"input_vat"`
			Incomplete  struct{ Count int }             `json:"incomplete"`
			ByCategory  []struct {
				Category *struct {
					AccountCode string `json:"account_code"`
				}
				Amount string
			} `json:"by_category"`
			Monthly []struct{ Month, Amount string }
			Views   map[string]int
		}
	}
	e.do(b, "GET", "/api/v1/expenses/summary", nil, 200, &sum)
	// Each tab's count is what that tab lists.
	for view, query := range map[string]string{"review": "status=draft", "unpaid": "payment=unpaid", "reimburse": "payment=to_reimburse"} {
		var page struct{ Meta struct{ Total int } }
		e.do(b, "GET", "/api/v1/expenses?"+query, nil, 200, &page)
		if sum.Data.Views[view] != page.Meta.Total || page.Meta.Total == 0 {
			t.Fatalf("views[%s] = %d, list total %d", view, sum.Data.Views[view], page.Meta.Total)
		}
	}
	s := sum.Data
	if s.Currency != "CHF" || s.ThisMonth.Amount != "162.15" || s.ThisMonth.Count != 2 || s.LastMonth.Amount != "216.20" ||
		s.Unpaid.Count != 1 || s.ToReimburse.Amount != "216.20" || s.InputVAT.Period != "2026-Q4" || s.InputVAT.Amount != "28.35" ||
		s.Incomplete.Count != 1 || len(s.ByCategory) != 2 || s.ByCategory[0].Category.AccountCode != "6640" ||
		len(s.Monthly) != 12 || s.Monthly[11].Month != "2026-11" || s.Monthly[10].Amount != "216.20" {
		t.Fatalf("summary: %+v", s)
	}

	resp, raw := e.send(b, "GET", "/api/v1/expenses/export?status=booked&sort=number", nil, "")
	if resp.StatusCode != 200 || !bytes.HasPrefix(raw, []byte("\xEF\xBB\xBF")) ||
		!strings.Contains(resp.Header.Get("Content-Disposition"), "expenses-2026-11-05.csv") {
		t.Fatalf("export: %d %q", resp.StatusCode, resp.Header)
	}
	rows := strings.Split(strings.TrimSpace(string(raw[3:])), "\n")
	if len(rows) != 4 || !strings.HasPrefix(rows[2], "2,booked,2026-11-01,'=Swisscom,") || !strings.Contains(rows[1], ",6640,Travel,CHF,100.00,8.10,108.10,1,") {
		t.Fatalf("csv: %q", rows)
	}
}

func TestReceiptsAndCategories(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	member := e.join(owner.workspace, "member")
	x := e.create(member, map[string]any{})

	if resp := e.upload(member, x.ID, "receipt.pdf", []byte("<html>not a pdf")); resp.StatusCode != 422 {
		t.Fatalf("fake pdf: %d", resp.StatusCode)
	}
	if resp := e.upload(member, x.ID, "receipt.pdf", pdf); resp.StatusCode != 201 || len(e.files.receiptKeys()) != 1 {
		t.Fatalf("upload: %d", resp.StatusCode)
	}
	var files struct{ Data []struct{ ID, Name string } }
	e.do(member, "GET", "/api/v1/expenses/"+x.ID+"/receipts", nil, 200, &files)
	path := "/api/v1/expenses/" + x.ID + "/receipts/" + files.Data[0].ID
	resp, _ := e.send(member, "GET", path, nil, "")
	if resp.StatusCode != 302 || !strings.HasPrefix(resp.Header.Get("Location"), "https://s3.test/workspaces/"+owner.workspace+"/expenses/") {
		t.Fatalf("download: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	e.files.mu.Lock()
	e.files.proxy = true // S3_PROXY_DOWNLOADS: the API streams the bytes itself
	e.files.mu.Unlock()
	resp, body := e.send(member, "GET", path, nil, "")
	if resp.StatusCode != 200 || string(body) != string(pdf) || resp.Header.Get("Content-Type") != "application/pdf" ||
		resp.Header.Get("Content-Disposition") != `attachment; filename=receipt.pdf` {
		t.Fatalf("proxied download: %d %v", resp.StatusCode, resp.Header)
	}
	e.files.mu.Lock()
	e.files.proxy = false
	e.files.mu.Unlock()
	resp, body = e.send(member, "GET", path+"?inline=1", nil, "")
	if resp.StatusCode != 200 || !bytes.Equal(body, pdf) || resp.Header.Get("Content-Type") != "application/pdf" ||
		!strings.HasPrefix(resp.Header.Get("Content-Disposition"), "inline") || resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("inline: %d %v", resp.StatusCode, resp.Header)
	}
	other := e.workspace()
	if resp, _ := e.send(other, "GET", path, nil, ""); resp.StatusCode != 404 {
		t.Fatalf("other workspace: %d", resp.StatusCode)
	}
	e.do(member, "DELETE", path, nil, 204, nil)
	if len(e.files.receiptKeys()) != 0 {
		t.Fatal("object kept")
	}

	// Categories: owners and admins manage them; names are unique; archived ones leave the pickers.
	e.fails(member, "POST", "/api/v1/expense-categories", map[string]any{"name": "Coworking", "account_code": "6000"}, 403, "forbidden")
	e.fails(owner, "POST", "/api/v1/expense-categories", map[string]any{"name": "travel", "account_code": "66x"}, 422, "validation_failed", "account_code")
	e.categories(owner) // seeds
	e.fails(owner, "POST", "/api/v1/expense-categories", map[string]any{"name": "travel", "account_code": "6640"}, 422, "validation_failed", "name")
	var made struct{ Data category }
	e.do(owner, "POST", "/api/v1/expense-categories", map[string]any{"name": "Coworking", "account_code": "6010"}, 201, &made)
	e.do(member, "PATCH", "/api/v1/expenses/"+x.ID, map[string]any{"category_id": made.Data.ID}, 200, nil)
	e.do(owner, "PATCH", "/api/v1/expense-categories/"+made.Data.ID, map[string]any{"is_archived": true}, 200, &made)
	if !made.Data.IsArchived || e.categories(owner)["6010"].ID != "" {
		t.Fatalf("archived: %+v", made.Data)
	}
	e.do(member, "PATCH", "/api/v1/expenses/"+x.ID, map[string]any{"note": "keeps its archived category"}, 200, nil)
	e.fails(member, "POST", "/api/v1/expenses", map[string]any{"category_id": made.Data.ID}, 422, "validation_failed", "category_id")
}

func TestBookedCategoryKeepsHistoricalClassification(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.categories(b)["6640"]
	input := complete(c.ID)
	input["receipt_missing_reason"] = "Lost on the train"
	x := e.create(b, input)
	e.do(b, "POST", "/api/v1/expenses/"+x.ID+"/book", nil, 200, nil)
	path := "/api/v1/expense-categories/" + c.ID
	for _, change := range []map[string]any{{"name": "Renamed"}, {"account_code": "6570"}} {
		e.fails(b, "PATCH", path, change, 409, "category_locked")
	}
	e.do(b, "PATCH", path, map[string]any{"is_archived": true}, 200, nil)
	_, raw := e.send(b, "GET", "/api/v1/expenses/export?status=booked", nil, "")
	if !strings.Contains(string(raw), ",6640,Travel,CHF,") {
		t.Fatalf("booked export classification changed: %s", raw)
	}
	e.do(b, "POST", "/api/v1/expenses/"+x.ID+"/void", map[string]any{"reason": "Corrected receipt"}, 200, nil)
	e.fails(b, "PATCH", path, map[string]any{"account_code": "6570"}, 409, "category_locked")
	e.do(b, "PATCH", path, map[string]any{"is_archived": false}, 200, nil)
}

func TestReimbursedNotifiesWhoPaid(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	paid, muted, other := e.join(b.workspace, "member"), e.join(b.workspace, "member"), e.join(b.workspace, "admin")
	if err := e.st.SetUserNotificationPrefs(context.Background(), muted.user, store.NotificationPrefs{"expense.reimbursed": {}}, time.Now()); err != nil {
		t.Fatal(err)
	}
	reimburse := func(by, payer *browser) {
		x := e.create(b, map[string]any{"paid_by_member_id": payer.user, "document_date": "2026-11-02", "description": "Train"})
		for range 2 { // again: no second notification
			e.do(by, "PATCH", "/api/v1/expenses/"+x.ID, map[string]any{"reimbursed_on": "2026-11-03"}, 200, nil)
		}
	}
	reimburse(b, paid)
	reimburse(b, muted)
	reimburse(b, b) // the owner's own: they recorded it
	count := func(who *browser) int {
		got, err := e.st.Notifications(context.Background(), b.workspace, who.user, store.NotificationFilter{Limit: 50, Events: []string{"expense.reimbursed"}})
		if err != nil {
			t.Fatal(err)
		}
		return len(got)
	}
	for _, c := range []struct {
		name string
		who  *browser
		want int
	}{{"who paid", paid, 1}, {"muted", muted, 0}, {"actor", b, 0}, {"admin", other, 0}} {
		if n := count(c.who); n != c.want {
			t.Errorf("%s: %d, want %d", c.name, n, c.want)
		}
	}
}

// TestReceiptCompleteness: the receipt rule follows the stored receipts on every read, so the expense, the list's
// incomplete filter and booking agree after each upload and delete.
func TestReceiptCompleteness(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	x := e.create(owner, complete(e.categories(owner)["6640"].ID))
	second := append(append([]byte{}, pdf...), []byte("% second\n")...)

	check := func(step string, wantCount int) {
		t.Helper()
		var got struct{ Data expense }
		e.do(owner, "GET", "/api/v1/expenses/"+x.ID, nil, 200, &got)
		missing := wantCount == 0
		if got.Data.ReceiptsCount != wantCount || got.Data.IsComplete == missing || slices.Contains(got.Data.MissingFields, "receipt") != missing {
			t.Fatalf("%s: %+v", step, got.Data)
		}
		var list struct{ Data []expense }
		e.do(owner, "GET", "/api/v1/expenses?incomplete=true", nil, 200, &list)
		if (len(list.Data) == 1) != missing {
			t.Fatalf("%s: incomplete list %d", step, len(list.Data))
		}
	}
	receipts := func() []struct{ ID string } {
		var files struct{ Data []struct{ ID string } }
		e.do(owner, "GET", "/api/v1/expenses/"+x.ID+"/receipts", nil, 200, &files)
		return files.Data
	}

	for _, step := range []struct {
		name  string
		run   func()
		count int
	}{
		{"none", func() {}, 0},
		{"first upload", func() { e.upload(owner, x.ID, "a.pdf", pdf) }, 1},
		{"another receipt", func() { e.upload(owner, x.ID, "b.pdf", second) }, 2},
		{"one deleted", func() { e.do(owner, "DELETE", "/api/v1/expenses/"+x.ID+"/receipts/"+receipts()[0].ID, nil, 204, nil) }, 1},
		{"last deleted", func() { e.do(owner, "DELETE", "/api/v1/expenses/"+x.ID+"/receipts/"+receipts()[0].ID, nil, 204, nil) }, 0},
	} {
		step.run()
		check(step.name, step.count)
	}
	e.fails(owner, "POST", "/api/v1/expenses/"+x.ID+"/book", nil, 422, "cannot_book")
	e.upload(owner, x.ID, "a.pdf", pdf)
	e.do(owner, "POST", "/api/v1/expenses/"+x.ID+"/book", nil, 200, nil)
}
