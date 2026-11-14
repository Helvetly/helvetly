package invoices

import (
	"context"
	"encoding/binary"
	"encoding/csv"
	"net/http"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"helvetly.com/api/internal/store"
)

func TestSummaryDoesNotCountReplacedInvoiceTwice(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	original := e.issued(b, client, nil) // 200.00 net + 16.20 VAT = 216.20
	e.invoice(b, "POST", path(original.ID, "mark-paid"), map[string]any{}, http.StatusOK)
	draft := e.invoice(b, "POST", path(original.ID, "correct"), nil, http.StatusCreated)
	e.invoice(b, "POST", path(draft.ID, "issue"), nil, http.StatusOK)
	var result struct{ Data store.InvoiceSummary }
	e.do(b, "GET", "/api/v1/invoices/summary", nil, http.StatusOK, &result)
	s := result.Data
	if s.CollectionRate == nil || *s.CollectionRate != 1 {
		t.Errorf("collection rate %v, want 100%% for the one paid obligation", s.CollectionRate)
	}
	if len(s.Monthly) != 12 || s.Monthly[11].Invoiced != 21620 || s.Monthly[11].Paid != 21620 {
		t.Fatalf("month includes superseded invoice: %+v", s.Monthly)
	}
}

func TestSelfBilledCreditDoesNotReduceSalesSummary(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	e.issued(b, client, nil) // the only sale: 216.20
	supplier := e.client(b, map[string]any{"vat_number": "CHE-109.322.551 MWST"})
	e.agreement(b, supplier)
	purchase := e.issued(b, supplier, map[string]any{"kind": "self_billed"})
	e.invoice(b, "POST", path(purchase.ID, "void"), map[string]any{}, http.StatusOK)
	var result struct{ Data store.InvoiceSummary }
	e.do(b, "GET", "/api/v1/invoices/summary", nil, http.StatusOK, &result)
	if len(result.Data.Monthly) != 12 || result.Data.Monthly[11].Invoiced != 21620 {
		t.Fatalf("supplier credit reduced sales: %+v", result.Data.Monthly)
	}
}

func TestPrepaymentsCannotMakeFinalTotalNegative(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	pre := e.paidPrepayment(b, client, nil) // 1,081.00 paid
	e.fails(b, "POST", "/api/v1/invoices", map[string]any{"client_id": client,
		"lines": []any{line("1", "500.00")}, "prepayment_ids": []string{pre.ID}},
		http.StatusUnprocessableEntity, "validation_failed", "prepayment_ids")
	final := e.draft(b, client, map[string]any{"lines": []any{line("1", "1500.00")}, "prepayment_ids": []string{pre.ID}})
	e.fails(b, "PATCH", path(final.ID), map[string]any{"lines": []any{line("1", "500.00")}},
		http.StatusUnprocessableEntity, "validation_failed", "prepayment_ids")
}

func TestIssuedInvoiceClientNameStaysHistoricalInAPIAndExport(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	issued := e.issued(b, client, nil)
	draft := e.draft(b, client, nil)
	if _, err := e.st.UpdateClient(context.Background(), b.workspace, client, map[string]any{"name": "Renamed AG"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	var got struct {
		Data struct {
			Client store.InvoiceClient
			Buyer  *store.Party
		}
	}
	e.do(b, "GET", path(issued.ID), nil, http.StatusOK, &got)
	if got.Data.Client.Name != "Kunde AG" || got.Data.Buyer == nil || got.Data.Buyer.Name != "Kunde AG" {
		t.Errorf("issued API changed client identity: %+v", got.Data.Client)
	}
	e.do(b, "GET", path(draft.ID), nil, http.StatusOK, &got)
	if got.Data.Client.Name != "Renamed AG" {
		t.Errorf("draft name %q, want live name", got.Data.Client.Name)
	}
	resp, raw := e.send(b, "GET", "/api/v1/invoices/export?ids="+issued.ID, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("export status %d", resp.StatusCode)
	}
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(raw), "\uFEFF"))).ReadAll()
	if err != nil || len(rows) != 2 || rows[1][5] != "Kunde AG" {
		t.Fatalf("export changed historical client: %v, %v", rows, err)
	}
}

func TestDeductedPrepaymentKeepsItsPaidBasis(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	pre := e.paidPrepayment(b, client, nil)
	credit := e.invoice(b, "POST", path(pre.ID, "credit-note"), map[string]any{}, http.StatusCreated)
	correction := e.invoice(b, "POST", path(pre.ID, "correct"), nil, http.StatusCreated)
	final := e.invoice(b, "POST", path(e.draft(b, client, map[string]any{"lines": []any{line("1", "5000.00")},
		"prepayment_ids": []string{pre.ID}}).ID, "issue"), nil, http.StatusOK)
	e.fails(b, "POST", path(pre.ID, "credit-note"), map[string]any{}, http.StatusConflict, "invalid_state")
	e.fails(b, "POST", path(pre.ID, "correct"), nil, http.StatusConflict, "invalid_state")
	e.fails(b, "DELETE", path(pre.ID, "payments", pre.Payments[0].ID), nil, http.StatusConflict, "invalid_state")
	for _, id := range []string{credit.ID, correction.ID} {
		out := e.fails(b, "POST", path(id, "issue"), nil, http.StatusUnprocessableEntity, "cannot_issue")
		if codes := reasonCodes(out); len(codes) != 1 || codes[0] != "prepayment_already_deducted" {
			t.Fatalf("issue of consumed prepayment adjustment: %+v", out.Error.Details.Reasons)
		}
	}
	// Voiding the final releases the prepayment, then payment corrections can be made normally.
	e.invoice(b, "POST", path(final.ID, "void"), map[string]any{}, http.StatusOK)
	e.do(b, "DELETE", path(pre.ID, "payments", pre.Payments[0].ID), nil, http.StatusNoContent, nil)
	if got := e.invoice(b, "GET", path(pre.ID), nil, http.StatusOK); got.Status != "open" || got.DeductedOn != nil {
		t.Fatalf("released prepayment: %+v", got)
	}
}

func TestFullCreditOfFinalUsesItsNetPrepaymentBasis(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	pre := e.paidPrepayment(b, client, nil) // 1,000.00 net + 81.00 VAT
	final := e.invoice(b, "POST", path(e.draft(b, client, map[string]any{"lines": []any{line("1", "5000.00")},
		"prepayment_ids": []string{pre.ID}}).ID, "issue"), nil, http.StatusOK) // final 4,000.00 + 324.00 VAT
	e.invoice(b, "POST", path(final.ID, "payments"), map[string]any{"amount": "1000.00", "method": "bank_transfer"}, http.StatusCreated)
	credit := e.invoice(b, "POST", path(final.ID, "credit-note"), map[string]any{}, http.StatusCreated)
	if credit.PayableTotal != "4324.00" || credit.PrepaidTotal != "1081.00" {
		t.Fatalf("full credit overstates final: payable %s prepaid %s", credit.PayableTotal, credit.PrepaidTotal)
	}
	credit = e.invoice(b, "PATCH", path(credit.ID), map[string]any{"note": "Full cancellation"}, http.StatusOK)
	if credit.PayableTotal != "4324.00" {
		t.Fatalf("editing the draft lost the prepaid basis: %s", credit.PayableTotal)
	}
	e.invoice(b, "POST", path(credit.ID, "issue"), nil, http.StatusOK)
	var state refundState
	e.do(b, "GET", path(final.ID), nil, http.StatusOK, &state)
	if state.Data.Status != "void" || state.Data.RefundDue != "1000.00" {
		t.Fatalf("credited final balance: %+v", state.Data)
	}
	if got := e.invoice(b, "GET", path(pre.ID), nil, http.StatusOK); got.DeductedOn != nil || got.Status != "paid" {
		t.Fatalf("credited final did not release paid prepayment: %+v", got)
	}
}

func TestIssueUsesLockedPrepaymentAmounts(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	pre := e.draft(b, client, map[string]any{"kind": "prepayment", "lines": []any{line("1", "1000.00")}})
	final := e.draft(b, client, map[string]any{"lines": []any{line("1", "5000.00")}, "prepayment_ids": []string{pre.ID}})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	loaded, resume := make(chan struct{}), make(chan struct{})
	finished := make(chan error, 1)
	sess := store.Session{Workspace: store.Workspace{ID: b.workspace, Timezone: "Europe/Zurich"}}
	go func() {
		finished <- e.st.Tx(ctx, func(q store.Q) error {
			inv, err := q.Invoice(ctx, b.workspace, final.ID, sess.Workspace.Today(e.svc.now()), true)
			if err != nil {
				return err
			}
			close(loaded)
			select {
			case <-resume:
			case <-ctx.Done():
				return ctx.Err()
			}
			return e.svc.issueDraft(ctx, q, sess, inv, new(string))
		})
	}()
	select {
	case <-loaded:
	case err := <-finished:
		t.Fatalf("load final: %v", err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	e.invoice(b, "PATCH", path(pre.ID), map[string]any{"lines": []any{line("1", "500.00")}}, http.StatusOK)
	e.invoice(b, "POST", path(pre.ID, "issue"), nil, http.StatusOK)
	e.invoice(b, "POST", path(pre.ID, "mark-paid"), map[string]any{}, http.StatusOK)
	close(resume)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	got := e.invoice(b, "GET", path(final.ID), nil, http.StatusOK)
	// 5,000.00 - 500.00 = 4,500.00 net; 8.1% VAT = 364.50.
	if got.PrepaidTotal != "540.50" || got.PayableTotal != "4864.50" {
		t.Fatalf("issued using stale prepayment: prepaid %s payable %s", got.PrepaidTotal, got.PayableTotal)
	}
}

func TestSelfBilledVATRequiresActualSupplierVATNumber(t *testing.T) {
	e := newEnv(t)
	b, supplier := e.ready() // workspace has a VAT ID, the supplier does not
	e.agreement(b, supplier)
	taxable := e.draft(b, supplier, map[string]any{"kind": "self_billed"})
	out := e.fails(b, "POST", path(taxable.ID, "issue"), nil, http.StatusUnprocessableEntity, "cannot_issue")
	if codes := reasonCodes(out); len(codes) != 1 || codes[0] != "supplier_vat_missing" {
		t.Fatalf("taxable self-billing without supplier VAT ID: %+v", out.Error.Details.Reasons)
	}
	nonVAT := e.issued(b, supplier, map[string]any{"kind": "self_billed", "vat_mode": "none"})
	if nonVAT.PayableTotal != "200.00" {
		t.Fatalf("non-VAT self-billing: %+v", nonVAT)
	}
	supplier = e.client(b, map[string]any{"vat_number": "CHE-109.322.551 MWST"})
	e.agreement(b, supplier)
	issued := e.issued(b, supplier, map[string]any{"kind": "self_billed"})
	if _, err := e.st.UpdateClient(context.Background(), b.workspace, supplier, map[string]any{"vat_number": nil}, time.Now()); err != nil {
		t.Fatal(err)
	}
	out = e.fails(b, "POST", path(issued.ID, "void"), map[string]any{}, http.StatusUnprocessableEntity, "cannot_issue")
	if codes := reasonCodes(out); len(codes) != 1 || codes[0] != "supplier_vat_missing" {
		t.Fatalf("self-billing credit without actual supplier VAT ID: %+v", out.Error.Details.Reasons)
	}
}

func pdfUnicode(s string) string {
	var text []byte
	for _, code := range utf16.Encode([]rune(s)) {
		text = binary.BigEndian.AppendUint16(text, code)
	}
	return string(text)
}

func TestSelfBilledFactoryUsesActualFiscalParties(t *testing.T) {
	e := newEnv(t)
	b, _ := e.ready()
	supplier := e.client(b, map[string]any{"name": "Supplier GmbH", "country": "DE", "vat_number": "DE123456789"})
	e.agreement(b, supplier)
	draft := e.draft(b, supplier, map[string]any{"kind": "self_billed", "language": "en", "lines": []any{
		map[string]any{"description": "Exempt service", "quantity": "1", "unit_price": "100.00", "vat_category": "E", "vat_rate": "0",
			"vat_exemption_code": "VATEX-EU-132"},
	}})
	check := func(text string) {
		t.Helper()
		if !strings.Contains(text, pdfUnicode("Muster GmbH, Bahnhofstrasse 1, 8001 Zürich")) {
			t.Error("workspace buyer is not the issuer above the supplier's address window")
		}
		if strings.Contains(text, pdfUnicode("Supplier GmbH, Rue du Lac 12, 1003 Lausanne")) {
			t.Error("supplier incorrectly heads the self-billed document")
		}
		if !strings.Contains(text, pdfUnicode("Exempt from VAT.")) || strings.Contains(text, pdfUnicode("Swiss VAT Act")) {
			t.Error("German supplier uses the workspace's Swiss tax-note jurisdiction")
		}
	}
	response, raw := e.send(b, "GET", path(draft.ID, "pdf"), nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("draft preview status %d", response.StatusCode)
	}
	check(pdfContentText(raw))
	issued := e.invoice(b, "POST", path(draft.ID, "issue"), nil, http.StatusOK)
	if issued.Seller.Name != "Muster GmbH" || issued.Buyer.Name != "Supplier GmbH" {
		t.Fatal("storage snapshot roles changed instead of adapting only rendering")
	}
	check(e.storedPDFText(issued.ID))
	creditDraft := e.derived(b, issued.ID, "credit_note", nil)
	response, raw = e.send(b, "GET", path(creditDraft, "pdf"), nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("self-billed credit preview status %d", response.StatusCode)
	}
	check(pdfContentText(raw))
	e.do(b, "DELETE", path(creditDraft), nil, http.StatusNoContent, nil)
	e.invoice(b, "POST", path(issued.ID, "void"), map[string]any{}, http.StatusOK)
	notes := e.creditNotes(b)
	if len(notes) != 1 {
		t.Fatalf("self-billed credit notes %d", len(notes))
	}
	check(e.storedPDFText(notes[0].ID))
}
