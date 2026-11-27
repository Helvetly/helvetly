package workspaceaudit

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

func amt(n int64) *int64 { return &n }
func source(id string, f facts) store.AuditDocument {
	b, err := json.Marshal(f)
	if err != nil {
		panic(err)
	}
	return store.AuditDocument{ID: id, Name: id, ObjectKey: "key/" + id, Kind: "other", Client: "c", Owners: []string{"c"}, Status: "read", Facts: b}
}
func TestAuditCrossChecksEvidenceAndMoney(t *testing.T) {
	invoice := store.AuditInvoice{ID: "i", Number: "2026/IN/01", Currency: "CHF", Client: "c", Reference: "C-11", Source: "inv", Total: 10000, Paid: 7000, PaidRows: 6000, Status: "open"}
	second := store.AuditInvoice{ID: "other", Number: "2026/IN/02", Currency: "EUR", Client: "other", Total: 500}
	bank := source("2026-IN-02-paid.pdf", facts{Kind: "payment-confirmation", Complete: true, Credits: []entry{{Reference: invoice.Number, Amount: amt(6000), Date: "2026-01-01", Currency: "CHF"}}})
	contract := source("contract", facts{Kind: "contract", Contract: "C11", Total: amt(15000), Currency: "CHF", Complete: true})
	tax := source("tax", facts{Kind: "tax-document", TaxYear: "2024", Complete: true})
	tax.FolderYear = "2025"
	s := snapshot{clients: []store.AuditClient{{ID: "c", Name: "Alice", Number: 15}, {ID: "other", Name: "Bob", Number: 16}}, invoices: []store.AuditInvoice{invoice, second}, payments: []store.AuditPayment{{ID: "p", Invoice: "i", Amount: 6000, Date: "2026-01-01"}}, docs: []store.AuditDocument{source("inv", facts{Kind: "invoice", Currency: "CHF", Total: amt(12000), Complete: true}), contract, bank, tax}}
	out, err := evaluate(s, access{clients: true, invoices: true, documents: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	codes := map[string]finding{}
	for _, f := range out.Findings {
		codes[f.Code] = f
	}
	for _, c := range []string{"original_total", "ledger_total", "contract_amount", "contract_link", "filename_reference", "payment_link", "tax_year", "missing_original"} {
		if _, ok := codes[c]; !ok {
			t.Errorf("missing %s: %+v", c, out.Findings)
		}
	}
	if codes["ledger_total"].Severity != "critical" || codes["ledger_total"].Class != "error" || codes["contract_link"].Evidence[1].ID != contract.ID || out.Read != 4 {
		t.Fatal(out)
	}
	s.docs[2].Payments = []string{"p"}
	s.docs[2].Name = "2026-IN-01.pdf"
	s.docs[1].Owners = []string{"other", "c"}
	s.invoices[0].Contract = contract.ID
	out, _ = evaluate(s, access{clients: true, invoices: true, documents: true}, nil)
	for _, f := range out.Findings {
		if slices.Contains([]string{"payment_link", "contract_link", "contract_owner", "filename_reference"}, f.Code) {
			t.Error("false positive", f)
		}
	}
}
func TestInvoiceCopiesAndIncorrectOriginals(t *testing.T) {
	invoice := store.AuditInvoice{ID: "i", Number: "INV-12", Source: "attached"}
	draft := store.AuditInvoice{ID: "draft", Number: "INV-13", Status: "draft"}
	other := source("attached", facts{Kind: "contract", Complete: true})
	copy := source("copy", facts{Kind: "invoice", Reference: "INV12", Complete: true})
	receipt := source("receipt", facts{Kind: "invoice", Reference: "INV12", Complete: true})
	receipt.Expenses = []string{"expense"}
	linked := source("linked", facts{Kind: "invoice", Reference: "INV12", Complete: true})
	linked.Invoices = []string{"i"}
	s := snapshot{invoices: []store.AuditInvoice{invoice, draft}, docs: []store.AuditDocument{other, copy, receipt, linked}}
	r, err := evaluate(s, access{documents: true, invoices: true}, nil)
	if err != nil || len(r.Findings) != 2 {
		t.Fatalf("%+v %v", r.Findings, err)
	}
	for _, expected := range []struct{ code, file string }{{"invoice_copy", "copy"}, {"original_kind", "attached"}} {
		if !slices.ContainsFunc(r.Findings, func(f finding) bool {
			return f.Code == expected.code && len(f.Evidence) == 2 && f.Evidence[0].ID == expected.file && f.Evidence[1].ID == "i"
		}) {
			t.Fatalf("missing %+v in %+v", expected, r.Findings)
		}
	}
}

func TestPartialReadAndLimitedScope(t *testing.T) {
	d := source("statement", facts{Kind: "bank-statement", Complete: false, Credits: []entry{{Reference: "private"}}})
	out, err := evaluate(snapshot{docs: []store.AuditDocument{d, {ID: "pending"}, {ID: "unavailable", Status: "unsupported"}, {ID: "broken", Status: "integrity"}}}, access{documents: true}, nil)
	if err != nil || out.Partial != 3 || len(out.Pending) != 1 || len(out.Findings) != 3 {
		t.Fatal(out, err)
	}
	if _, ok := out.Counts["invoices"]; ok {
		t.Fatal("leaked hidden scope")
	}
}

func TestAuditSelectedAreas(t *testing.T) {
	s := snapshot{docs: []store.AuditDocument{
		{ID: "statement", Kind: "bank_statements"},
		{ID: "invoice-original", Kind: "credit_notes", ContractEvidence: true},
		{ID: "unclassified", Kind: "other"},
		{ID: "possible-proof", Kind: "other", Client: "client"},
		{ID: "tax-original", Kind: "tax_documents"},
		{ID: "broken", Status: "integrity"},
		source("read-tax", facts{Kind: "tax-document", Complete: true, Issues: []observation{{Evidence: "Tax issue"}}}),
	}}
	a := access{clients: true, documents: true, invoices: true}
	for _, tt := range []struct {
		query      string
		pending    []string
		counts     map[string]int
		categories []string
	}{
		{"", []string{"statement", "invoice-original", "unclassified", "possible-proof", "tax-original"}, map[string]int{"clients": 0, "documents": 7, "invoices": 0, "payments": 0}, []string{"documents", "tax"}},
		{"payments, tax", []string{"statement", "tax-original"}, map[string]int{"payments": 0}, []string{"tax"}},
		{"contracts", []string{"invoice-original"}, nil, nil},
		{"clients", []string{"possible-proof"}, map[string]int{"clients": 0}, nil},
		{"documents", []string{"statement", "invoice-original", "unclassified", "possible-proof", "tax-original"}, map[string]int{"documents": 7}, []string{"documents"}},
	} {
		t.Run(tt.query, func(t *testing.T) {
			selected, err := parseAreas(tt.query)
			if err != nil {
				t.Fatal(err)
			}
			out, err := evaluate(s, a, selected)
			if err != nil {
				t.Fatal(err)
			}
			var categories []string
			for _, f := range out.Findings {
				categories = append(categories, f.Category)
			}
			if !slices.Equal(out.Pending, tt.pending) || !maps.Equal(out.Counts, tt.counts) || !slices.Equal(categories, tt.categories) {
				t.Fatal(out)
			}
		})
	}
}

func TestAuditRoutesRejectUnknownArea(t *testing.T) {
	a := &sessionAuth{Service: &auth.Service{}}
	mux := http.NewServeMux()
	New(nil, a, nil, nil, aimodel.Budget{}).Register(mux)
	for _, path := range []string{"", "/documents/own"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/reports/workspace-audit"+path+"?areas=quotes,unknown", nil))
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"invalid_areas"`) {
			t.Fatalf("%s got %d: %s", path, w.Code, w.Body.String())
		}
	}
}

type sessionAuth struct {
	*auth.Service
	current store.Session
}

func (a *sessionAuth) SignedIn(next func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { next(w, r, a.current) }
}

type sourceFiles struct {
	content string
	opened  int
}

func (s *sourceFiles) Open(_ context.Context, _ string) (io.ReadSeekCloser, error) {
	s.opened++
	return seekCloser{strings.NewReader(s.content)}, nil
}

type seekCloser struct{ *strings.Reader }

func (seekCloser) Close() error { return nil }

func TestAuditPlanAndRunAllowance(t *testing.T) {
	db, _ := storetest.New(t)
	billingtest.Wire(t, db)
	ctx := context.Background()
	now := time.Now().UTC()
	ws := store.Workspace{ID: "ws", Name: "Example", Timezone: "Europe/Zurich"}
	user := store.User{ID: "user", Email: "owner@example.test", Name: "Owner"}
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(db.CreateWorkspace(ctx, ws, ws.Timezone, now))
	check(db.CreateUser(ctx, user, now))
	check(db.AddMember(ctx, ws.ID, user.ID, "owner", now))
	check(db.SetAIConsent(ctx, ws.ID, user.ID, true, now))
	a := &sessionAuth{current: store.Session{User: user, Workspace: ws, Role: "owner"}}
	svc := New(db, a, nil, &aimodel.Fake{}, aimodel.Budget{})
	svc.now = func() time.Time { return now }
	mux := http.NewServeMux()
	svc.Register(mux)
	call := func(suffix, key string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/v1/reports/workspace-audit"+suffix, nil)
		r.Header.Set("Idempotency-Key", key)
		mux.ServeHTTP(w, r)
		return w
	}
	assert := func(w *httptest.ResponseRecorder, status int, body string) {
		t.Helper()
		if w.Code != status || !strings.Contains(w.Body.String(), body) {
			t.Fatalf("got %d %s, want %d with %q", w.Code, w.Body, status, body)
		}
	}
	for _, plan := range []string{billing.Free, billing.Basic, billing.Pro} {
		if plan != billing.Free {
			billingtest.On(t, db, ws.ID, plan)
		}
		for _, suffix := range []string{"", "/documents/removed"} {
			assert(call(suffix, ""), http.StatusForbidden, `"code":"feature_not_in_plan"`)
			assert(call(suffix, ""), http.StatusForbidden, `"required_plan":"business"`)
		}
	}
	billingtest.On(t, db, ws.ID, billing.Business)
	assert(call("?areas=invoices,clients", "first"), http.StatusOK, `"findings"`)
	assert(call("?areas=clients,invoices", "first"), http.StatusOK, `"findings"`)
	assert(call("?areas=quotes", "first"), http.StatusConflict, `"code":"idempotency_conflict"`)
	assert(call("/documents/removed", ""), http.StatusOK, `"status":"removed"`)

	var starts sync.WaitGroup
	results := make(chan *httptest.ResponseRecorder, 12)
	for range cap(results) {
		starts.Go(func() { results <- call("", "") })
	}
	starts.Wait()
	close(results)
	accepted := 0
	for result := range results {
		if result.Code == http.StatusOK {
			accepted++
		} else {
			assert(result, http.StatusPaymentRequired, `"code":"limit_reached"`)
		}
	}
	if accepted != 9 {
		t.Fatalf("accepted %d concurrent starts after the first, want 9", accepted)
	}
	assert(call("?areas=clients,invoices", "first"), http.StatusOK, `"findings"`)
	assert(call("/documents/removed", ""), http.StatusOK, `"status":"removed"`)
	month := store.UsagePeriod(now)
	used, err := db.UsageInPeriods(ctx, ws.ID, string(billing.WorkspaceAudits), month, month)
	check(err)
	if used.Total() != 10 {
		t.Fatalf("recorded %d audit starts, want 10", used.Total())
	}
	now = store.UsagePeriodStart(now).AddDate(0, 1, 0)
	assert(call("", ""), http.StatusOK, `"findings"`)
	month = store.UsagePeriod(now)
	used, err = db.UsageInPeriods(ctx, ws.ID, string(billing.WorkspaceAudits), month, month)
	check(err)
	if used.Total() != 1 {
		t.Fatalf("recorded %d audit starts in new month, want 1", used.Total())
	}
}
func TestAuditRoutesScopeConsentCacheAndOriginals(t *testing.T) {
	db, raw := storetest.New(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ws := store.Workspace{ID: "ws", Name: "Example", Timezone: "Europe/Zurich"}
	user := store.User{ID: "user", Email: "owner@example.test", Name: "Owner"}
	check := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(db.CreateWorkspace(ctx, ws, "Europe/Zurich", now))
	check(db.CreateWorkspace(ctx, store.Workspace{ID: "outside", Name: "Foreign"}, "UTC", now))
	check(db.CreateUser(ctx, user, now))
	check(db.AddMember(ctx, ws.ID, user.ID, "owner", now))
	file := &sourceFiles{content: "A source document for the audit."}
	_, err := raw.Exec(ctx, `INSERT INTO documents(id,workspace_id,name,size,content_type,object_key,hr_private,created_at,updated_at)
		SELECT id,ws,id||'.txt',$1,'text/plain',id,hr,now(),now() FROM (VALUES ('own','ws',false),('quote','ws',false),('hr','ws',true),('foreign','outside',false)) s(id,ws,hr)`, len(file.content))
	check(err)
	a := &sessionAuth{current: store.Session{User: user, Workspace: ws, Role: "owner"}}
	budget := aimodel.Budget{DB: db, Pool: aimodel.PoolAutomation, Allowance: func(context.Context, store.Q, string) (int64, error) { return 500000, nil }, Now: time.Now}
	svc := New(db, a, file, aimodel.Fake{}, budget)
	mux := http.NewServeMux()
	svc.Register(mux)
	call := func(suffix string, status int) []byte {
		t.Helper()
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/reports/workspace-audit"+suffix, nil))
		if w.Code != status {
			t.Fatalf("%s got %d: %s", suffix, w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}
	call("", 403)
	if file.opened != 0 {
		t.Fatal("read before consent")
	}
	check(db.SetAIConsent(ctx, ws.ID, user.ID, true, now))
	var r report
	full := call("", 200)
	if string(call("?areas=", 200)) != string(full) {
		t.Fatal("empty areas changed the full audit")
	}
	check(json.Unmarshal(full, &r))
	if !slices.Equal(r.Pending, []string{"own", "quote"}) || r.Counts["documents"] != 2 {
		t.Fatal(r)
	}
	var scoped report
	check(json.Unmarshal(call("?areas=quotes", 200), &scoped))
	if !slices.Equal(scoped.Pending, []string{"quote"}) || !maps.Equal(scoped.Counts, map[string]int{"quotes": 0}) {
		t.Fatal(scoped)
	}
	if !strings.Contains(string(call("/documents/own?areas=quotes", 200)), `"skipped"`) {
		t.Fatal("an out-of-scope original must be skipped")
	}
	readings, err := json.Marshal(facts{Kind: "tax-document", Complete: true, Issues: []observation{{Evidence: "Tax issue"}}})
	check(err)
	quote, err := db.AuditSource(ctx, ws.ID, "en", "quote")
	check(err)
	check(db.SaveAuditEvidence(ctx, ws.ID, "en", "quote", quote.Fingerprint, "read", readings))
	check(json.Unmarshal(call("?areas=quotes,tax", 200), &scoped))
	if len(scoped.Pending) != 0 || len(scoped.Findings) != 1 || scoped.Findings[0].Category != "tax" {
		t.Fatal(scoped)
	}
	check(json.Unmarshal(call("?areas=quotes", 200), &scoped))
	if len(scoped.Findings) != 0 {
		t.Fatal(scoped)
	}
	for _, id := range []string{"hr", "foreign"} {
		call("/documents/"+id, 200)
	}
	if file.opened != 0 {
		t.Fatal("excluded file opened")
	}
	claimed, err := db.ClaimAuditDocument(ctx, ws.ID, "en", "own", "first")
	check(err)
	if !claimed || !strings.Contains(string(call("/documents/own", 200)), "busy") || file.opened != 0 {
		t.Fatal("an in-flight original must not be read twice")
	}
	check(db.ReleaseAuditDocument(ctx, ws.ID, "en", "own", "some-other-token"))
	if !strings.Contains(string(call("/documents/own", 200)), "busy") {
		t.Fatal("released a different reader's lease")
	}
	check(db.ReleaseAuditDocument(ctx, ws.ID, "en", "own", "first"))
	call("/documents/own?areas=documents", 200)
	call("/documents/own", 200)
	if file.opened != 1 {
		t.Fatal("cache miss", file.opened)
	}
	check(json.Unmarshal(call("", 200), &r))
	if r.Read != 2 || len(r.Pending) != 0 {
		t.Fatal(r)
	}
	a.current.Role = "member"
	a.current.Scopes = []string{"read:clients"}
	call("/documents/own", 403)
	call("/documents/own?areas=documents", 403)
	payload := call("", 200)
	if strings.Contains(string(payload), "documents") {
		t.Fatal(string(payload))
	}
	a.current.Role = "owner"
	check(db.SetAIConsent(ctx, ws.ID, user.ID, false, now))
	call("", 403)
	call("/documents/own", 403)
	_, err = db.AuditSource(ctx, "outside", "en", "own")
	if !errors.Is(err, store.ErrNotFound) {
		t.Fatal(err)
	}
}
