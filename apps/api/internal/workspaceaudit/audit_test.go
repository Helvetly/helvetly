package workspaceaudit

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
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
	out, err := evaluate(s, access{clients: true, invoices: true, documents: true})
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
	out, _ = evaluate(s, access{clients: true, invoices: true, documents: true})
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
	r, err := evaluate(s, access{documents: true, invoices: true})
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
	out, err := evaluate(snapshot{docs: []store.AuditDocument{d, {ID: "pending"}, {ID: "unavailable", Status: "unsupported"}, {ID: "broken", Status: "integrity"}}}, access{documents: true})
	if err != nil || out.Partial != 3 || len(out.Pending) != 1 || len(out.Findings) != 3 {
		t.Fatal(out, err)
	}
	if _, ok := out.Counts["invoices"]; ok {
		t.Fatal("leaked hidden scope")
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
 SELECT id,ws,id||'.txt',$1,'text/plain',id,hr,now(),now() FROM (VALUES ('own','ws',false),('hr','ws',true),('foreign','outside',false)) s(id,ws,hr)`, len(file.content))
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
	check(json.Unmarshal(call("", 200), &r))
	if !slices.Equal(r.Pending, []string{"own"}) || r.Counts["documents"] != 1 {
		t.Fatal(r)
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
	call("/documents/own", 200)
	call("/documents/own", 200)
	if file.opened != 1 {
		t.Fatal("cache miss", file.opened)
	}
	check(json.Unmarshal(call("", 200), &r))
	if r.Read != 1 || len(r.Pending) != 0 {
		t.Fatal(r)
	}
	a.current.Role = "member"
	a.current.Scopes = []string{"read:clients"}
	call("/documents/own", 403)
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
