package invoices

import (
	"context"
	"net/http"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestKindRules(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		kind, code, series, prefix string
		receivable, payments       bool
	}{
		{"invoice", "380", "invoice", "", true, true},
		{"partial", "326", "invoice", "", true, true},
		{"prepayment", "386", "invoice", "", true, true},
		{"debit_note", "383", "invoice", "", true, true},
		{"corrected", "384", "invoice", "", true, true},
		{"credit_note", "381", "credit_note", "CN-", false, false},
		{"proforma", "325", "proforma", "PF-", false, false},
		{"self_billed", "389", "self_billed", "SB-", false, true},
	} {
		series, prefix := Series(c.kind)
		if TypeCode(c.kind) != c.code || series != c.series || prefix != c.prefix || Receivable(c.kind) != c.receivable ||
			takesPayments(c.kind) != c.payments {
			t.Errorf("%s: code %s series %s/%s receivable %v payments %v", c.kind, TypeCode(c.kind), series, prefix,
				Receivable(c.kind), takesPayments(c.kind))
		}
	}
	if TypeCode("final") != "" || validKind("final") {
		t.Error("unknown kinds have no code")
	}
}

func path(id string, more ...string) string {
	p := "/api/v1/invoices/" + id
	for _, m := range more {
		p += "/" + m
	}
	return p
}

// derived saves a draft of the kind made from an issued document, as the derive endpoints do.
func (e *env) derived(b *browser, srcID, kind string, edit func(*store.Invoice)) string {
	e.t.Helper()
	ctx := context.Background()
	src, err := e.st.Invoice(ctx, b.workspace, srcID, time.Now().In(zone).Format(time.DateOnly), false)
	if err != nil {
		e.t.Fatal(err)
	}
	inv := e.svc.draftFrom(src, kind)
	if edit != nil {
		edit(&inv)
	}
	if err := e.st.Tx(ctx, func(q store.Q) error { return q.SaveDraft(ctx, b.workspace, inv, time.Now()) }); err != nil {
		e.t.Fatal(err)
	}
	return inv.ID
}

func reasonCodes(out apiErr) []string {
	var codes []string
	for _, r := range out.Error.Details.Reasons {
		codes = append(codes, r.Code)
	}
	return codes
}

func TestCreateEachKind(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	for _, kind := range creatable {
		if inv := e.draft(b, clientID, map[string]any{"kind": kind}); inv.Kind != kind || inv.TypeCode != TypeCode(kind) {
			t.Errorf("create %s: %+v", kind, inv)
		}
	}
	for _, kind := range []string{"credit_note", "debit_note", "corrected", "final"} {
		e.fails(b, "POST", "/api/v1/invoices", map[string]any{"client_id": clientID, "kind": kind}, http.StatusUnprocessableEntity,
			"validation_failed", "kind")
	}
	inv := e.draft(b, clientID, map[string]any{"kind": "partial"})
	e.fails(b, "PATCH", path(inv.ID), map[string]any{"kind": "invoice"}, http.StatusUnprocessableEntity, "validation_failed", "kind")
	dup := e.invoice(b, "POST", path(e.issued(b, clientID, map[string]any{"kind": "partial"}).ID, "duplicate"), nil, http.StatusCreated)
	if dup.Kind != "partial" || dup.Status != "draft" {
		t.Fatalf("duplicate keeps the kind: %+v", dup)
	}
}

func TestTypeCodeInJSON(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	inv := e.draft(b, clientID, map[string]any{"kind": "proforma"})
	if got := e.invoice(b, "GET", path(inv.ID), nil, http.StatusOK); got.TypeCode != "325" {
		t.Fatalf("get type_code %q", got.TypeCode)
	}
	if got := e.invoice(b, "POST", "/api/v1/invoices/preview", map[string]any{"kind": "prepayment"}, http.StatusOK); got.TypeCode != "386" {
		t.Fatalf("preview type_code %q", got.TypeCode)
	}
	var list struct{ Data []map[string]any }
	e.do(b, "GET", "/api/v1/invoices?kind=proforma", nil, http.StatusOK, &list)
	if len(list.Data) != 1 || list.Data[0]["type_code"] != "325" || list.Data[0]["prepaid_total"] != "0.00" {
		t.Fatalf("list: %+v", list.Data)
	}
}

func TestIssueSeriesPerKind(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	clientID = e.client(b, map[string]any{"vat_number": "CHE-109.322.551 MWST"})
	e.agreement(b, clientID)
	year := time.Now().In(zone).Format("2006")
	for _, c := range []struct{ kind, number string }{
		{"invoice", year + "-001"}, {"partial", year + "-002"}, {"prepayment", year + "-003"},
		{"proforma", "PF-" + year + "-001"}, {"self_billed", "SB-" + year + "-001"}, {"proforma", "PF-" + year + "-002"},
	} {
		if inv := e.issued(b, clientID, map[string]any{"kind": c.kind}); inv.Number == nil || *inv.Number != c.number {
			t.Errorf("%s numbered %v, want %s", c.kind, inv.Number, c.number)
		}
	}
	src := e.issued(b, clientID, nil)
	cn := e.invoice(b, "POST", path(src.ID, "credit-note"), map[string]any{}, http.StatusCreated)
	if cn = e.invoice(b, "POST", path(cn.ID, "issue"), nil, http.StatusOK); *cn.Number != "CN-"+year+"-001" {
		t.Errorf("credit note numbered %s", *cn.Number)
	}
}

func TestProformaNoPayments409(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	inv := e.issued(b, clientID, map[string]any{"kind": "proforma"})
	e.fails(b, "POST", path(inv.ID, "payments"), map[string]any{"amount": "1", "method": "cash"}, http.StatusConflict, "invalid_state")
	e.fails(b, "POST", path(inv.ID, "mark-paid"), map[string]any{}, http.StatusConflict, "invalid_state")
	e.fails(b, "POST", path(inv.ID, "credit-note"), map[string]any{}, http.StatusConflict, "invalid_state")
}

func TestProformaNoQR(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	draft := e.draft(b, clientID, map[string]any{"kind": "proforma", "payment_methods": map[string]any{"qr_bill": true}})
	if draft.Payment.QRBill || draft.Payment.ReferenceType != "NON" {
		t.Fatalf("draft payment: %+v", draft.Payment)
	}
	inv := e.invoice(b, "POST", path(draft.ID, "issue"), nil, http.StatusOK)
	if inv.Payment.QRBill || inv.Payment.Reference != nil || inv.IsOverdue {
		t.Fatalf("issued payment: %+v", inv.Payment)
	}
	if invoice := e.issued(b, clientID, nil); !invoice.Payment.QRBill {
		t.Fatal("an invoice keeps its QR bill")
	}
}

func TestSelfBilledNoQRPaymentsAllowed(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	clientID = e.client(b, map[string]any{"vat_number": "CHE-109.322.551 MWST"})
	e.agreement(b, clientID)
	inv := e.issued(b, clientID, map[string]any{"kind": "self_billed"})
	if inv.Payment.QRBill || inv.Payment.Reference != nil {
		t.Fatalf("payment: %+v", inv.Payment)
	}
	paid := e.invoice(b, "POST", path(inv.ID, "mark-paid"), map[string]any{}, http.StatusOK)
	if paid.Status != "paid" || paid.AmountPaid != "216.20" {
		t.Fatalf("paid: %+v", paid)
	}
}

// paidPrepayment issues a prepayment of 1'000.00 net at 8.1% (1'081.00) and records it as paid.
func (e *env) paidPrepayment(b *browser, clientID string, extra map[string]any) Invoice {
	e.t.Helper()
	body := map[string]any{"kind": "prepayment", "lines": []any{line("1", "1000.00")}}
	for k, v := range extra {
		body[k] = v
	}
	p := e.issued(b, clientID, body)
	return e.invoice(b, "POST", path(p.ID, "mark-paid"), map[string]any{}, http.StatusOK)
}

func TestFinalDeductsPrepayment(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	pre := e.paidPrepayment(b, clientID, nil)
	final := e.draft(b, clientID, map[string]any{"lines": []any{line("1", "5000.00")}, "prepayment_ids": []string{pre.ID}})
	if final.PrepaidTotal != "1081.00" || final.Total != "4324.00" || final.AmountDue != "4324.00" {
		t.Fatalf("draft: prepaid %s total %s due %s", final.PrepaidTotal, final.Total, final.AmountDue)
	}
	final = e.invoice(b, "POST", path(final.ID, "issue"), nil, http.StatusOK)
	if final.Status != "open" || final.PrepaidTotal != "1081.00" || final.AmountDue != "4324.00" || final.PayableTotal != "4324.00" {
		t.Fatalf("issued: %+v", final)
	}
	if got := e.invoice(b, "GET", path(pre.ID), nil, http.StatusOK); got.DeductedOn == nil || got.DeductedOn.ID != final.ID {
		t.Fatalf("prepayment deducted_on %+v", got.DeductedOn)
	}
	paid := e.invoice(b, "POST", path(final.ID, "mark-paid"), map[string]any{}, http.StatusOK)
	if paid.Status != "paid" || paid.AmountPaid != "4324.00" {
		t.Fatalf("final paid: %+v", paid)
	}
}

func TestPrepaymentDeductedOnce(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	pre := e.paidPrepayment(b, clientID, nil)
	first := e.draft(b, clientID, map[string]any{"lines": []any{line("1", "5000.00")}, "prepayment_ids": []string{pre.ID}})
	second := e.draft(b, clientID, map[string]any{"lines": []any{line("1", "5000.00")}, "prepayment_ids": []string{pre.ID}})
	e.invoice(b, "POST", path(first.ID, "issue"), nil, http.StatusOK)
	out := e.fails(b, "POST", path(second.ID, "issue"), nil, http.StatusUnprocessableEntity, "cannot_issue")
	if codes := reasonCodes(out); len(codes) != 1 || codes[0] != "prepayment_unavailable" || out.Error.Details.Reasons[0].Field != "prepayment_ids" {
		t.Fatalf("reasons %+v", out.Error.Details.Reasons)
	}
}

func TestPrepaymentMustBePaidSameClientCurrency(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	// a EUR prepayment needs a normal IBAN: a QR-IBAN takes CHF only (SIX IG 2.4)
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"iban": "CH93 0076 2011 6238 5295 7"}, http.StatusOK, nil)
	other := e.client(b, map[string]any{"name": "Andere AG"})
	open := e.issued(b, clientID, map[string]any{"kind": "prepayment", "lines": []any{line("1", "1000.00")}})
	foreign := e.paidPrepayment(b, other, nil)
	euro := e.paidPrepayment(b, clientID, map[string]any{"currency": "EUR"})
	for name, id := range map[string]string{"unpaid": open.ID, "other client": foreign.ID, "other currency": euro.ID} {
		final := e.draft(b, clientID, map[string]any{"lines": []any{line("1", "5000.00")}, "prepayment_ids": []string{id}})
		if codes := reasonCodes(e.fails(b, "POST", path(final.ID, "issue"), nil, http.StatusUnprocessableEntity, "cannot_issue")); len(codes) != 1 ||
			codes[0] != "prepayment_unavailable" {
			t.Errorf("%s: reasons %v", name, codes)
		}
	}

	plain := e.issued(b, clientID, nil)
	partial := e.draft(b, clientID, map[string]any{"kind": "partial"})
	draft := e.draft(b, clientID, nil)
	for _, c := range []struct {
		id  string
		ids any
	}{
		{partial.ID, []string{open.ID}},              // only an invoice deducts
		{draft.ID, []string{plain.ID}},               // not a prepayment
		{draft.ID, []string{"inv_missing"}},          // not in the workspace
		{draft.ID, []string{open.ID, open.ID}},       // twice
		{draft.ID, "inv_1"},                          // not a list
		{draft.ID, make([]string, maxPrepayments+1)}, // too many
	} {
		e.fails(b, "PATCH", path(c.id), map[string]any{"prepayment_ids": c.ids}, http.StatusUnprocessableEntity, "validation_failed",
			"prepayment_ids")
	}
	cleared := e.invoice(b, "PATCH", path(draft.ID), map[string]any{"prepayment_ids": []string{}}, http.StatusOK)
	if cleared.PrepaidTotal != "0.00" || cleared.AmountDue != "216.20" {
		t.Fatalf("cleared: %+v", cleared)
	}
}

func TestCorrectedMovesPaymentsOnce(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	orig := e.issued(b, clientID, nil) // 216.20
	e.invoice(b, "POST", path(orig.ID, "payments"), map[string]any{"amount": "200.00", "method": "cash"}, http.StatusCreated)
	first := e.derived(b, orig.ID, "corrected", nil)
	second := e.derived(b, orig.ID, "corrected", nil)

	fixed := e.invoice(b, "POST", path(first, "issue"), nil, http.StatusOK)
	if fixed.AmountPaid != "200.00" || fixed.AmountDue != "16.20" || fixed.Status != "open" || fixed.TypeCode != "384" ||
		fixed.CreditedInvoice == nil || fixed.CreditedInvoice.ID != orig.ID || len(fixed.Payments) != 1 {
		t.Fatalf("correction: %+v", fixed)
	}
	replaced := e.invoice(b, "GET", path(orig.ID), nil, http.StatusOK)
	if replaced.Status != "replaced" || replaced.AmountPaid != "0.00" || replaced.AmountDue != "0.00" || len(replaced.Payments) != 0 {
		t.Fatalf("original: %+v", replaced)
	}
	if codes := reasonCodes(e.fails(b, "POST", path(second, "issue"), nil, http.StatusUnprocessableEntity, "cannot_issue")); len(codes) != 1 ||
		codes[0] != "credited_invoice_state" {
		t.Fatalf("second correction: %v", codes)
	}
	if again := e.invoice(b, "GET", path(first), nil, http.StatusOK); again.AmountPaid != "200.00" {
		t.Fatalf("payments moved twice: %+v", again)
	}
	var list struct{ Meta struct{ Total int } }
	e.do(b, "GET", "/api/v1/invoices?status=replaced", nil, http.StatusOK, &list)
	if list.Meta.Total != 1 {
		t.Fatalf("replaced filter: %d", list.Meta.Total)
	}
}

func TestDebitNoteNeedsIssuedPreceding(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	year := time.Now().In(zone).Format("2006")
	orig := e.issued(b, clientID, nil)
	orphan := e.derived(b, orig.ID, "debit_note", func(inv *store.Invoice) { inv.CreditedInvoice = nil })
	if codes := reasonCodes(e.fails(b, "POST", path(orphan, "issue"), nil, http.StatusUnprocessableEntity, "cannot_issue")); len(codes) != 1 ||
		codes[0] != "preceding_required" {
		t.Fatalf("no preceding: %v", codes)
	}
	unissued := e.draft(b, clientID, nil)
	onDraft := e.derived(b, orig.ID, "debit_note", func(inv *store.Invoice) {
		inv.CreditedInvoice = &store.InvoiceRef{ID: unissued.ID}
	})
	if codes := reasonCodes(e.fails(b, "POST", path(onDraft, "issue"), nil, http.StatusUnprocessableEntity, "cannot_issue")); len(codes) != 1 ||
		codes[0] != "credited_invoice_state" {
		t.Fatalf("draft preceding: %v", codes)
	}
	e.fails(b, "PATCH", path(onDraft), map[string]any{"currency": "EUR"}, http.StatusUnprocessableEntity, "validation_failed", "currency")
	debit := e.invoice(b, "POST", path(e.derived(b, orig.ID, "debit_note", nil), "issue"), nil, http.StatusOK)
	if *debit.Number != year+"-002" || debit.TypeCode != "383" || !debit.Payment.QRBill || debit.Status != "open" {
		t.Fatalf("debit note: %+v", debit)
	}
	if after := e.invoice(b, "GET", path(orig.ID), nil, http.StatusOK); after.Status != "open" || after.AmountCredited != "0.00" {
		t.Fatalf("a debit note does not credit: %+v", after)
	}
}

func TestListKindFilter(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	e.draft(b, clientID, nil)
	e.draft(b, clientID, map[string]any{"kind": "self_billed"})
	e.fails(b, "GET", "/api/v1/invoices?kind=final", nil, http.StatusBadRequest, "invalid_request")
	e.fails(b, "GET", "/api/v1/invoices/export?kind=bogus", nil, http.StatusBadRequest, "invalid_request")
	for kind, want := range map[string]int{"": 2, "invoice": 1, "self_billed": 1, "partial": 0} {
		var list struct{ Meta struct{ Total int } }
		e.do(b, "GET", "/api/v1/invoices?kind="+kind, nil, http.StatusOK, &list)
		if list.Meta.Total != want {
			t.Errorf("kind %q: %d, want %d", kind, list.Meta.Total, want)
		}
	}
}
