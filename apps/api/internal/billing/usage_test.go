package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/imports"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/store"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// usageEnv is a billing env whose canonical writes are admitted by the offer, as in production.
func usageEnv(t *testing.T) *env {
	t.Helper()
	e := newEnv(t, true)
	e.st.SetAdmission(e.svc.AllowResource)
	return e
}

func (e *env) userOf(b *browser) string {
	e.t.Helper()
	var id string
	if err := e.raw.QueryRow(context.Background(), `SELECT user_id FROM workspace_members WHERE workspace_id = $1 LIMIT 1`, b.workspace).Scan(&id); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *env) usedIn(ws string, l Limit, now time.Time) int64 {
	e.t.Helper()
	u, err := e.st.UsageInPeriods(context.Background(), ws, string(l), store.UsagePeriod(now), store.UsagePeriod(now))
	if err != nil {
		e.t.Fatal(err)
	}
	return u.Total()
}

func (e *env) buyer(ws string) string {
	e.t.Helper()
	id := auth.NewID("cli")
	e.exec(`INSERT INTO clients (id, workspace_id, number, name, street, street_number, zip, city, country, email, created_at, updated_at)
		VALUES ($1, $2, (SELECT coalesce(max(number), 0) + 1 FROM clients WHERE workspace_id = $2), 'Kunde AG', 'Rue du Lac', '12', '1003',
			'Lausanne', 'CH', 'ap@kunde.ch', now(), now())`, id, ws)
	return id
}

func draftOf(id, client string) store.Invoice {
	return store.Invoice{ID: id, Kind: "invoice", ClientID: client, IssueDate: time.Now().UTC().Format(time.DateOnly),
		DueDate: time.Now().UTC().Format(time.DateOnly), Currency: "CHF", Language: "en", VATMode: "none"}
}

func denied(err error) bool { return errors.Is(err, store.ErrAdmissionDenied) }

// TestStateLimitsAdmitUpToTheBasicCap: what exists counts, at cap-1, cap and cap+1 of Basic's own values.
func TestStateLimitsAdmitUpToTheBasicCap(t *testing.T) {
	ctx := context.Background()
	today := time.Now().UTC().Format(time.DateOnly)
	for _, tc := range []struct {
		limit  Limit
		want   int64
		seed   func(e *env, ws string, n int64)
		create func(e *env, ws string, i int64) error
	}{
		{Clients, 30, func(e *env, ws string, n int64) {
			e.exec(`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at)
				SELECT 'seed' || i, $1, 1000 + i, 'Seed', now(), now() FROM generate_series(1, $2::int) AS i`, ws, n)
		}, func(e *env, ws string, i int64) error {
			return e.st.CreateClient(ctx, ws, fmt.Sprint("new", i), map[string]any{"name": "New"}, time.Now())
		}},
		{Products, 25, func(e *env, ws string, n int64) {
			e.exec(`INSERT INTO products (id, workspace_id, type, name, price_basis, unit_price, currency, vat_category, vat_rate, created_at, updated_at)
				SELECT 'seed' || i, $1, 'service', 'S', 'net', 100, 'CHF', 'S', 810, now(), now() FROM generate_series(1, $2::int) AS i`, ws, n)
		}, func(e *env, ws string, i int64) error {
			return e.st.CreateProduct(ctx, ws, store.Product{ID: fmt.Sprint("new", i), Type: "service", Name: "New", PriceBasis: "net",
				UnitPrice: 100, Currency: "CHF", VATCategory: "S", VATRate: 810, CreatedAt: time.Now()})
		}},
		{Engagements, 3, func(e *env, ws string, n int64) {
			client := e.buyer(ws)
			e.exec(`INSERT INTO engagements (id, workspace_id, number, client_id, title, unit, quantity, billing, price_basis, unit_price,
					currency, vat_category, vat_rate, start_date, recurrence, interval, created_at, updated_at)
				SELECT 'seed' || i, $1, 1000 + i, $3, 'Retainer', 'hour', 10000, 'arrears', 'net', 15000, 'CHF', 'S', 810, current_date, 'monthly', 1, now(), now()
				FROM generate_series(1, $2::int) AS i`, ws, n, client)
		}, func(e *env, ws string, i int64) error {
			var client string
			if err := e.raw.QueryRow(ctx, `SELECT id FROM clients WHERE workspace_id = $1 LIMIT 1`, ws).Scan(&client); err != nil {
				return err
			}
			unit := "hour"
			return e.st.CreateEngagement(ctx, ws, &store.Engagement{ID: fmt.Sprint("new", i), ClientID: client, Title: "New", Unit: &unit,
				Quantity: 10000, Billing: "arrears", PriceBasis: "net", UnitPrice: 15000, Currency: "CHF", VATCategory: "S", VATRate: 810,
				StartDate: today, Recurrence: "monthly", Interval: 1}, time.Now())
		}},
		{InvoiceDrafts, 100, func(e *env, ws string, n int64) {
			client := e.buyer(ws)
			e.exec(`INSERT INTO invoices (id, workspace_id, kind, status, client_id, issue_date, due_date, currency, language, vat_mode,
					discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount, vat_breakdown, created_at, updated_at)
				SELECT 'seed' || i, $1, 'invoice', 'draft', $3, current_date, current_date, 'CHF', 'de', 'exclusive', 0, 0, 0, 0, 0, 0, 0, '[]', now(), now()
				FROM generate_series(1, $2::int) AS i`, ws, n, client)
		}, func(e *env, ws string, i int64) error {
			var client string
			if err := e.raw.QueryRow(ctx, `SELECT id FROM clients WHERE workspace_id = $1 LIMIT 1`, ws).Scan(&client); err != nil {
				return err
			}
			return e.st.SaveDraft(ctx, ws, draftOf(fmt.Sprint("new", i), client), time.Now())
		}},
		{QuotesRetained, 500, func(e *env, ws string, n int64) {
			client := e.buyer(ws)
			e.exec(`INSERT INTO quotes (id, workspace_id, client_id, status, issue_date, valid_until, currency, language, vat_mode,
					discount_percent, lines, subtotal, discount_amount, net_total, vat_total, total, rounding_amount, vat_breakdown, created_at, updated_at)
				SELECT 'seed' || i, $1, $3, 'draft', current_date, current_date, 'CHF', 'de', 'exclusive', 0, '[]', 0, 0, 0, 0, 0, 0, '[]', now(), now()
				FROM generate_series(1, $2::int) AS i`, ws, n, client)
		}, func(e *env, ws string, i int64) error {
			var client string
			if err := e.raw.QueryRow(ctx, `SELECT id FROM clients WHERE workspace_id = $1 LIMIT 1`, ws).Scan(&client); err != nil {
				return err
			}
			return e.st.SaveQuote(ctx, ws, store.Quote{ID: fmt.Sprint("new", i), Revision: 1, Status: "draft", ClientID: client,
				IssueDate: today, ValidUntil: today, Currency: "CHF", Language: "de", VATMode: "exclusive", Lines: []store.InvoiceLine{},
				VATBreakdown: []invoicecalc.Group{}}, time.Now())
		}},
	} {
		t.Run(string(tc.limit), func(t *testing.T) {
			e := usageEnv(t)
			ws := e.workspace().workspace
			e.subscribe(ws, "price_bm")
			if got := e.cap(ws, tc.limit); got != tc.want {
				t.Fatalf("Basic's %s is %d, the offer sells %d", tc.limit, got, tc.want)
			}
			tc.seed(e, ws, tc.want-1)
			if err := tc.create(e, ws, 1); err != nil {
				t.Fatalf("at cap-1 (%d) the next one is refused: %v", tc.want-1, err)
			}
			if err := tc.create(e, ws, 2); !denied(err) {
				t.Fatalf("at the cap (%d) another was admitted: %v", tc.want, err)
			}
		})
	}
}

// TestQuoteRevisionsAndIssuedDraftsFreeStateRoom: a revision is the same quote; issuing a draft frees its draft slot.
func TestQuoteRevisionsAndIssuedDraftsFreeStateRoom(t *testing.T) {
	e := usageEnv(t)
	ctx := context.Background()
	ws := e.workspace().workspace
	e.subscribe(ws, "price_bm")
	e.setPlanValue(Basic, QuotesRetained, StateLimited, n64(1))
	e.setPlanValue(Basic, InvoiceDrafts, StateLimited, n64(1))
	client := e.buyer(ws)
	today := time.Now().UTC().Format(time.DateOnly)
	q := store.Quote{ID: "quo_1", Revision: 1, Status: "draft", ClientID: client, IssueDate: today, ValidUntil: today, Currency: "CHF",
		Language: "de", VATMode: "exclusive", Lines: []store.InvoiceLine{}, VATBreakdown: []invoicecalc.Group{}}
	if err := e.st.SaveQuote(ctx, ws, q, time.Now()); err != nil {
		t.Fatal(err)
	}
	q.Revision = 2
	if err := e.st.SaveQuote(ctx, ws, q, time.Now()); err != nil {
		t.Fatalf("a revision took another quote: %v", err)
	}
	q.ID = "quo_2"
	if err := e.st.SaveQuote(ctx, ws, q, time.Now()); !denied(err) {
		t.Fatalf("a second quote: %v", err)
	}
	if err := e.st.SaveDraft(ctx, ws, draftOf("inv_1", client), time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := e.st.SaveDraft(ctx, ws, draftOf("inv_2", client), time.Now()); !denied(err) {
		t.Fatalf("a second draft: %v", err)
	}
	issue(t, e.st, ws, "inv_1", time.Now())
	if err := e.st.SaveDraft(ctx, ws, draftOf("inv_2", client), time.Now()); err != nil {
		t.Fatalf("issuing the draft did not free its slot: %v", err)
	}
}

// issue issues a saved draft as the canonical write does, numbered by its id.
func issue(t *testing.T, st *store.Store, ws, id string, now time.Time) {
	t.Helper()
	if err := issueErr(st, ws, id, now); err != nil {
		t.Fatalf("issue %s: %v", id, err)
	}
}

func issueErr(st *store.Store, ws, id string, now time.Time) error {
	ctx := context.Background()
	return st.Tx(ctx, func(q store.Q) error {
		inv, err := q.Invoice(ctx, ws, id, now.UTC().Format(time.DateOnly), true)
		if err != nil {
			return err
		}
		number := "N-" + id
		inv.Number = &number
		return q.Issue(ctx, ws, inv, 1, now)
	})
}

// TestIssueCountsEveryKindButLinkedCorrections: invoices, partial, prepayment, proforma and self-billed documents each
// count when issued; a credit note, correction or debit note of an issued document counts nothing, also at the cap.
func TestIssueCountsEveryKindButLinkedCorrections(t *testing.T) {
	ctx := context.Background()
	for _, kind := range []string{"invoice", "partial", "prepayment", "proforma", "self_billed"} {
		t.Run(kind, func(t *testing.T) {
			e := usageEnv(t)
			ws := e.workspace().workspace
			e.subscribe(ws, "price_bm")
			e.setPlanValue(Basic, Invoices, StateLimited, n64(1))
			client := e.buyer(ws)
			for _, id := range []string{"first", "second"} {
				d := draftOf(id, client)
				d.Kind = kind
				if err := e.st.SaveDraft(ctx, ws, d, time.Now()); err != nil {
					t.Fatalf("drafts are not issues: %v", err)
				}
			}
			issue(t, e.st, ws, "first", time.Now())
			if err := issueErr(e.st, ws, "second", time.Now()); !denied(err) {
				t.Fatalf("second %s issued past the cap: %v", kind, err)
			}
			for _, linked := range []string{"credit_note", "corrected", "debit_note"} {
				d := draftOf("linked-"+linked, client)
				d.Kind, d.CreditedInvoice = linked, &store.InvoiceRef{ID: "first"}
				if err := e.st.SaveDraft(ctx, ws, d, time.Now()); err != nil {
					t.Fatal(err)
				}
				if err := issueErr(e.st, ws, d.ID, time.Now()); err != nil {
					t.Fatalf("a linked %s is refused at the cap: %v", linked, err)
				}
			}
			if n := e.usedIn(ws, Invoices, time.Now()); n != 1 {
				t.Fatalf("issues counted: %d", n)
			}
		})
	}
}

var issueSettings = map[string]any{
	"seller": map[string]any{"name": "Muster GmbH", "street": "Bahnhofstrasse", "street_number": "1", "zip": "8001",
		"city": "Zürich", "country": "CH", "vat_number": "CHE-109.322.551 MWST", "email": "billing@muster.ch"},
	"iban": "CH44 3199 9123 0008 8901 2", "bank_name": "ZKB",
}

// invoicingServer serves the invoices API behind the billing guard on st.
func invoicingServer(t *testing.T, e *env, st *store.Store) (*httptest.Server, *admissionFiles) {
	t.Helper()
	files := &admissionFiles{objects: map[string][]byte{}}
	mux := http.NewServeMux()
	invoices.New(st, e.svc.auth, invoiceFiles{files}, nil, quiet).Register(mux)
	srv := httptest.NewServer(e.svc.Guard(mux))
	t.Cleanup(srv.Close)
	return srv, files
}

type invoiceFiles struct{ *admissionFiles }

func (f invoiceFiles) Get(ctx context.Context, key string) ([]byte, error) {
	r, err := f.Open(ctx, key)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

func dataOf(body map[string]any) map[string]any {
	d, _ := body["data"].(map[string]any)
	return d
}

func errorCode(body map[string]any) string {
	e, _ := body["error"].(map[string]any)
	code, _ := e["code"].(string)
	return code
}

// TestBasicIssuesFifteenAMonthAndKeepsTheRefusedDraft: 14, 15 and 16 issues through the API; the 16th answers 402 and
// leaves its draft as it was, without a number or a stored PDF; a retry counts nothing; voiding gives nothing back.
func TestBasicIssuesFifteenAMonthAndKeepsTheRefusedDraft(t *testing.T) {
	e := usageEnv(t)
	b := e.workspace()
	e.subscribe(b.workspace, "price_bm")
	srv, files := invoicingServer(t, e, e.st)
	e.srv = srv
	if code, body := e.do(b, http.MethodPut, "/api/v1/invoice-settings", issueSettings); code != http.StatusOK {
		t.Fatalf("settings: %d %v", code, body)
	}
	client := e.buyer(b.workspace)
	ids := make([]string, 16)
	for i := range ids {
		code, body := e.do(b, http.MethodPost, "/api/v1/invoices", map[string]any{"client_id": client,
			"lines": []any{map[string]any{"description": "Beratung", "quantity": "1", "unit": "hour", "unit_price": "100.00"}}})
		if code != http.StatusCreated {
			t.Fatalf("draft %d: %d %v", i, code, body)
		}
		ids[i] = dataOf(body)["id"].(string)
	}
	issueHTTP := func(id string) (int, map[string]any) {
		return e.do(b, http.MethodPost, "/api/v1/invoices/"+id+"/issue", nil)
	}
	for i := range 14 {
		if code, body := issueHTTP(ids[i]); code != http.StatusOK {
			t.Fatalf("issue %d: %d %v", i+1, code, body)
		}
	}
	if n := e.usedIn(b.workspace, Invoices, time.Now()); n != 14 {
		t.Fatalf("after 14 issues the month counts %d", n)
	}
	if code, body := issueHTTP(ids[14]); code != http.StatusOK {
		t.Fatalf("the 15th issue: %d %v", code, body)
	}
	code, body := issueHTTP(ids[15])
	if code != http.StatusPaymentRequired || errorCode(body) != "limit_reached" {
		t.Fatalf("the 16th issue: %d %v", code, body)
	}
	if code, body := e.do(b, http.MethodGet, "/api/v1/invoices/"+ids[15], nil); code != http.StatusOK || dataOf(body)["status"] != "draft" || dataOf(body)["number"] != nil {
		t.Fatalf("the refused draft changed: %d %v", code, body)
	}
	for key := range files.objects {
		if strings.Contains(key, ids[15]) {
			t.Fatalf("the refused issue left a PDF: %s", key)
		}
	}
	// Retrying an issued document, or voiding one where corrections are granted (its credit note is a linked
	// correction), counts nothing.
	if code, _ := issueHTTP(ids[0]); code == http.StatusOK {
		t.Fatal("an issued invoice issued again")
	}
	e.override(b.workspace, Limit(store.FeatureInvoiceCorrections), StateEnabled, nil, nil) // voiding is Pro's; an operator grants it here
	if code, body := e.do(b, http.MethodPost, "/api/v1/invoices/"+ids[0]+"/void", map[string]any{}); code != http.StatusOK {
		t.Fatalf("void: %d %v", code, body)
	}
	if n := e.usedIn(b.workspace, Invoices, time.Now()); n != 15 {
		t.Fatalf("after retry and void the month counts %d", n)
	}
	if code, _ := issueHTTP(ids[15]); code != http.StatusPaymentRequired {
		t.Fatalf("voiding gave the month's allowance back: %d", code)
	}
}

// TestNothingRestartsTheMonth: a time zone, plan or seat change keeps what the month has used.
func TestNothingRestartsTheMonth(t *testing.T) {
	e := usageEnv(t)
	ws := e.workspace().workspace
	e.subscribe(ws, "price_bm")
	client := e.buyer(ws)
	now := time.Now()
	for i := range 16 {
		if err := e.st.SaveDraft(context.Background(), ws, draftOf(fmt.Sprint("inv", i), client), now); err != nil {
			t.Fatal(err)
		}
	}
	for i := range 15 {
		issue(t, e.st, ws, fmt.Sprint("inv", i), now)
	}
	refused := func(why string) {
		t.Helper()
		if err := issueErr(e.st, ws, "inv15", now); !denied(err) {
			t.Fatalf("%s: the 16th issue: %v", why, err)
		}
	}
	refused("at Basic's cap")
	// Kiritimati is UTC+14: its calendar is in the next month for most of the month's last day.
	e.exec(`UPDATE workspaces SET timezone = 'Pacific/Kiritimati' WHERE id = $1`, ws)
	refused("after a time zone change")
	e.subscribe(ws, "price_pm")
	if room := e.cap(ws, Invoices) - e.usedIn(ws, Invoices, now); room != 135 {
		t.Fatalf("Pro's room after 15 issues on Basic: %d", room)
	}
	e.subscribe(ws, "price_bm")
	refused("back on Basic")
	e.exec(`UPDATE workspace_billing SET per_seat = true, seats = 2 WHERE workspace_id = $1`, ws)
	if err := issueErr(e.st, ws, "inv15", now); err != nil {
		t.Fatalf("a second paid seat adds its 15: %v", err)
	}
	e.exec(`UPDATE workspace_billing SET seats = 1 WHERE workspace_id = $1`, ws)
	if n := e.usedIn(ws, Invoices, now); n != 16 {
		t.Fatalf("a seat change reset the month: %d", n)
	}
}

// TestExpensesAndSignaturesCountForGood: Basic has none; on Pro the 300th expense and 50th package are admitted and the
// next refused; deleting an expense gives nothing back.
func TestExpensesAndSignaturesCountForGood(t *testing.T) {
	ctx := context.Background()
	e := usageEnv(t)
	b := e.workspace()
	ws := b.workspace
	e.subscribe(ws, "price_bm")
	user := e.userOf(b)
	expense := func(id string) error {
		return e.st.CreateExpense(ctx, ws, &store.Expense{ID: id, Source: "manual", Currency: "CHF", AmountMode: "gross", InputTax: "none",
			ExchangeRate: 1000000, PaymentStatus: "unpaid", Base: store.ExpenseBase{Currency: "CHF"}, CreatedBy: &store.Uploader{ID: user}}, time.Now())
	}
	e.exec(`INSERT INTO documents (id, workspace_id, name, size, content_type, object_key, created_at, updated_at)
		VALUES ('doc_1', $1, 'Contract.pdf', 10, 'application/pdf', 'k', now(), now())`, ws)
	signature := func(id string) error {
		return e.st.CreateSignatureRequest(ctx, store.SignatureRequest{ID: id, WorkspaceID: ws, Document: &store.FolderRef{ID: "doc_1"},
			Title: "Contract", SigningOrder: "parallel", OriginalKey: "k", OriginalSHA256: "x", PageCount: 1,
			ExpiresAt: time.Now().Add(time.Hour), CreatedAt: time.Now()}, user)
	}
	if err := expense("exp_basic"); !denied(err) {
		t.Fatalf("Basic's first expense: %v", err)
	}
	if err := signature("sig_basic"); !denied(err) {
		t.Fatalf("Basic's first signature package: %v", err)
	}
	e.subscribe(ws, "price_pm")
	for _, tc := range []struct {
		limit  Limit
		want   int64
		create func(string) error
	}{{Expenses, 300, expense}, {Signatures, 50, signature}} {
		if got := e.cap(ws, tc.limit); got != tc.want {
			t.Fatalf("Pro's %s is %d, the offer sells %d", tc.limit, got, tc.want)
		}
		e.exec(`INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period, reserved, consumed, created_at, settled_at)
			SELECT $1, $2, 'seed' || i, '', $3, 0, 1, now(), now() FROM generate_series(1, $4::int) AS i`,
			ws, string(tc.limit), store.UsagePeriod(time.Now()), tc.want-1)
		if err := tc.create(string(tc.limit) + "_last"); err != nil {
			t.Fatalf("%s at cap-1: %v", tc.limit, err)
		}
		if err := tc.create(string(tc.limit) + "_over"); !denied(err) {
			t.Fatalf("%s at the cap: %v", tc.limit, err)
		}
	}
	if ok, err := e.st.DeleteDraftExpense(ctx, ws, string(Expenses)+"_last", time.Now()); err != nil || !ok {
		t.Fatalf("delete: %v %v", ok, err)
	}
	if err := expense("exp_after_delete"); !denied(err) {
		t.Fatalf("deleting an expense gave the month's allowance back: %v", err)
	}
}

// TestTenRequestsForTheLastClientAcrossHTTPImportAndJobsAdmitOne: one free client slot, ten writers on separate
// connections (the API, import commits and direct canonical writes as jobs and Heidi make them): exactly one wins.
func TestTenRequestsForTheLastClientAcrossHTTPImportAndJobsAdmitOne(t *testing.T) {
	e := usageEnv(t)
	b := e.workspace()
	ws := b.workspace
	e.subscribe(ws, "price_bm")
	ctx := context.Background()
	wide := wideStore(t, e)
	e.exec(`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at)
		SELECT 'seed' || i, $1, 1000 + i, 'Seed ' || i, now(), now() FROM generate_series(1, $2::int) AS i`, ws, e.cap(ws, Clients)-1)

	mux := http.NewServeMux()
	clients.New(wide, e.svc.auth, nil, quiet).Register(mux)
	imports.New(wide, e.svc.auth, &admissionFiles{objects: map[string][]byte{}}, quiet, imports.Options{}).Register(mux)
	srv := httptest.NewServer(e.svc.Guard(mux))
	t.Cleanup(srv.Close)
	e.srv = srv
	user := e.userOf(b)
	batches := make([]string, 3)
	for i := range batches {
		batch, file := auth.NewID("imb"), store.ImportFile{ID: auth.NewID("imf"), Name: "clients.csv", Size: 1, ContentType: "text/csv", Status: "done"}
		if err := e.st.CreateImportBatch(ctx, store.ImportBatch{ID: batch, WorkspaceID: ws, UserID: user, Kind: "clients"}, []store.ImportFile{file}, time.Now()); err != nil {
			t.Fatal(err)
		}
		file.BatchID, file.WorkspaceID = batch, ws
		rec := store.ImportRecord{ID: auth.NewID("imr"), Kind: "clients", Data: map[string]json.RawMessage{"name": json.RawMessage(fmt.Sprintf(`"Imported %d"`, i))}, Issues: map[string]string{}}
		if err := e.st.InsertImportRecords(ctx, file, []store.ImportRecord{rec}, time.Now()); err != nil {
			t.Fatal(err)
		}
		batches[i] = batch + "/" + rec.ID
	}

	start := make(chan struct{})
	won := make(chan string, 10)
	for i := range 4 {
		go func() {
			<-start
			if code, _ := e.do(b, http.MethodPost, "/api/v1/clients", map[string]any{"name": fmt.Sprint("HTTP ", i)}); code == http.StatusCreated {
				won <- "http"
			} else {
				won <- ""
			}
		}()
	}
	for _, br := range batches {
		batch, rec, _ := strings.Cut(br, "/")
		go func() {
			<-start
			_, body := e.do(b, http.MethodPost, "/api/v1/imports/"+batch+"/commit", map[string]any{"record_ids": []string{rec}})
			data, _ := body["data"].(map[string]any)
			results, _ := data["results"].([]any)
			if len(results) == 1 && results[0].(map[string]any)["status"] == "created" {
				won <- "import"
			} else {
				won <- ""
			}
		}()
	}
	for i := range 3 {
		go func() {
			<-start
			err := wide.Tx(ctx, func(q store.Q) error {
				return q.CreateClient(ctx, ws, fmt.Sprint("job", i), map[string]any{"name": fmt.Sprint("Job ", i)}, time.Now())
			})
			switch {
			case err == nil:
				won <- "job"
			case denied(err):
				won <- ""
			default:
				t.Errorf("job write: %v", err)
				won <- ""
			}
		}()
	}
	close(start)
	var winners []string
	for range 10 {
		if w := <-won; w != "" {
			winners = append(winners, w)
		}
	}
	var n int64
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM clients WHERE workspace_id = $1 AND deleted_at IS NULL`, ws).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if len(winners) != 1 || n != e.cap(ws, Clients) {
		t.Fatalf("winners=%v clients=%d, want one winner and %d clients", winners, n, e.cap(ws, Clients))
	}
}

// TestTenIssuesOfTheLastSlotIssueOne: one issue left this month, ten drafts issued at once through the API and jobs on
// separate connections: one is issued, nine stay drafts.
func TestTenIssuesOfTheLastSlotIssueOne(t *testing.T) {
	e := usageEnv(t)
	b := e.workspace()
	ws := b.workspace
	e.subscribe(ws, "price_bm")
	ctx := context.Background()
	wide := wideStore(t, e)
	srv, _ := invoicingServer(t, e, wide)
	e.srv = srv
	if code, body := e.do(b, http.MethodPut, "/api/v1/invoice-settings", issueSettings); code != http.StatusOK {
		t.Fatalf("settings: %d %v", code, body)
	}
	client := e.buyer(ws)
	e.exec(`INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period, reserved, consumed, created_at, settled_at)
		SELECT $1, 'invoices_per_month', 'invoice.issue:seed' || i, '', $2, 0, 1, now(), now() FROM generate_series(1, $3::int) AS i`,
		ws, store.UsagePeriod(time.Now()), e.cap(ws, Invoices)-1)
	ids := make([]string, 10)
	for i := range ids {
		code, body := e.do(b, http.MethodPost, "/api/v1/invoices", map[string]any{"client_id": client,
			"lines": []any{map[string]any{"description": "Beratung", "quantity": "1", "unit": "hour", "unit_price": "100.00"}}})
		if code != http.StatusCreated {
			t.Fatalf("draft: %d %v", code, body)
		}
		ids[i] = dataOf(body)["id"].(string)
	}
	start := make(chan struct{})
	issued := make(chan bool, 10)
	for i, id := range ids {
		go func() {
			<-start
			if i%2 == 0 {
				code, _ := e.do(b, http.MethodPost, "/api/v1/invoices/"+id+"/issue", nil)
				issued <- code == http.StatusOK
				return
			}
			err := issueErr(wide, ws, id, time.Now())
			if err != nil && !denied(err) {
				t.Errorf("job issue: %v", err)
			}
			issued <- err == nil
		}()
	}
	close(start)
	n := 0
	for range ids {
		if <-issued {
			n++
		}
	}
	var drafts int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM invoices WHERE workspace_id = $1 AND status = 'draft'`, ws).Scan(&drafts); err != nil {
		t.Fatal(err)
	}
	if n != 1 || drafts != 9 || e.usedIn(ws, Invoices, time.Now()) != e.cap(ws, Invoices) {
		t.Fatalf("issued=%d drafts=%d used=%d", n, drafts, e.usedIn(ws, Invoices, time.Now()))
	}
}
