package invoices

import (
	"bytes"
	"compress/zlib"
	"io"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"
)

var pdfStream = regexp.MustCompile(`(?s)stream\n(.*?)\nendstream`)

// storedPDFText: the decompressed content streams of the PDF stored for the invoice.
func (e *env) storedPDFText(id string) string {
	e.t.Helper()
	var text []byte
	for key, pdf := range e.files.objects {
		if !strings.Contains(key, "/invoices/"+id+"/") {
			continue
		}
		text = append(text, pdfContentText(pdf)...)
	}
	return string(text)
}

func pdfContentText(pdf []byte) string {
	var text []byte
	for _, m := range pdfStream.FindAllSubmatch(pdf, -1) {
		if zr, err := zlib.NewReader(bytes.NewReader(m[1])); err == nil {
			b, _ := io.ReadAll(zr)
			text = append(text, b...)
		}
	}
	return string(text)
}

// creditNotes: the issued credit notes in the workspace (numbers and ids).
func (e *env) creditNotes(b *browser) []Invoice {
	e.t.Helper()
	var list struct{ Data []Invoice }
	e.do(b, "GET", "/api/v1/invoices?kind=credit_note", nil, http.StatusOK, &list)
	return list.Data
}

func TestVoidProformaAndSelfBilled(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	clientID = e.client(b, map[string]any{"vat_number": "CHE-109.322.551 MWST"})
	e.agreement(b, clientID)
	for _, kind := range []string{"proforma", "self_billed"} {
		doc := e.issued(b, clientID, map[string]any{"kind": kind})
		got := e.invoice(b, "POST", path(doc.ID, "void"), map[string]any{}, http.StatusOK)
		if got.Status != "void" || got.AmountDue != "0.00" {
			t.Fatalf("%s voided: %+v", kind, got)
		}
		e.fails(b, "POST", path(doc.ID, "void"), map[string]any{}, http.StatusConflict, "invalid_state")
	}
}

func TestVoidCreditNoteStays409(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	orig := e.issued(b, clientID, nil)
	cn := e.invoice(b, "POST", path(e.derived(b, orig.ID, "credit_note", nil), "issue"), nil, http.StatusOK)
	e.fails(b, "POST", path(cn.ID, "void"), map[string]any{}, http.StatusConflict, "invalid_state")
}

func TestVoidFinalReleasesPrepayment(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	pre := e.paidPrepayment(b, clientID, nil)
	body := map[string]any{"lines": []any{line("1", "5000.00")}, "prepayment_ids": []string{pre.ID}}
	final := e.invoice(b, "POST", path(e.draft(b, clientID, body).ID, "issue"), nil, http.StatusOK)
	var list struct {
		Data []struct {
			ID         string
			DeductedOn *struct{ ID string } `json:"deducted_on"`
		}
	}
	e.do(b, "GET", "/api/v1/invoices?kind=prepayment", nil, http.StatusOK, &list)
	if len(list.Data) != 1 || list.Data[0].DeductedOn == nil || list.Data[0].DeductedOn.ID != final.ID {
		t.Fatalf("list deducted_on: %+v", list.Data)
	}
	if got := e.invoice(b, "POST", path(final.ID, "void"), map[string]any{}, http.StatusOK); got.Status != "void" || got.AmountCredited != final.PayableTotal || got.AmountCredited == "0.00" {
		t.Fatalf("voided without a credit note for the post-deduction total: %+v (final %s)", got, final.PayableTotal)
	}
	if got := e.invoice(b, "GET", path(pre.ID), nil, http.StatusOK); got.DeductedOn != nil {
		t.Fatalf("prepayment still deducted: %+v", got.DeductedOn)
	}
	again := e.draft(b, clientID, body)
	if got := e.invoice(b, "POST", path(again.ID, "issue"), nil, http.StatusOK); got.Status != "open" {
		t.Fatalf("rededuct: %+v", got)
	}
}

func TestVoidSelfBilledIssuesSBCreditNote(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	clientID = e.client(b, map[string]any{"vat_number": "CHE-109.322.551 MWST"})
	year := time.Now().In(zone).Format("2006")
	e.agreement(b, clientID)
	doc := e.issued(b, clientID, map[string]any{"kind": "self_billed", "language": "en"})
	if got := e.invoice(b, "POST", path(doc.ID, "void"), map[string]any{}, http.StatusOK); got.Status != "void" {
		t.Fatalf("voided: %+v", got)
	}
	notes := e.creditNotes(b)
	if len(notes) != 1 || notes[0].Number == nil || *notes[0].Number != "SB-"+year+"-002" {
		t.Fatalf("credit notes: %+v", notes)
	}
	text := e.storedPDFText(notes[0].ID)
	var selfBilling strings.Builder
	for _, r := range "Self-billing" { // the embedded Unicode font encodes this ASCII text as UTF-16BE
		selfBilling.WriteByte(0)
		selfBilling.WriteRune(r)
	}
	if !strings.Contains(text, "("+selfBilling.String()+")") {
		t.Fatalf("the credit note PDF lacks the self-billing mention")
	}
}

func TestVoidFullyPrepaidFinal(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	pre := e.paidPrepayment(b, clientID, nil)
	final := e.invoice(b, "POST", path(e.draft(b, clientID, map[string]any{"lines": []any{line("1", "1000.00")},
		"prepayment_ids": []string{pre.ID}}).ID, "issue"), nil, http.StatusOK)
	if final.Status != "paid" || final.PayableTotal != "0.00" || final.AmountPaid != "0.00" {
		t.Fatalf("fully prepaid final: %+v", final)
	}
	if got := e.invoice(b, "POST", path(final.ID, "void"), map[string]any{}, http.StatusOK); got.Status != "void" {
		t.Fatalf("voided: %+v", got)
	}
	if got := e.invoice(b, "GET", path(pre.ID), nil, http.StatusOK); got.DeductedOn != nil {
		t.Fatalf("prepayment still deducted: %+v", got.DeductedOn)
	}
}
