package invoices

import (
	"context"
	"net/http"
	"testing"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

func TestEmailAttachesTheClientsEInvoice(t *testing.T) {
	e := newEnv(t)
	b, _ := e.ready()
	var asked []string
	var refuse error
	e.svc.SetEInvoice(func(_ context.Context, _ store.Session, inv store.Invoice, format string) (string, []byte, error) {
		asked = append(asked, format)
		if refuse != nil {
			return "", nil, refuse
		}
		return *inv.Number + ".xml", []byte("<Invoice/>"), nil
	})
	plain := e.client(b, nil)
	public := e.client(b, map[string]any{"name": "Stadt Bonn", "country": "DE", "einvoice_format": "xrechnung_ubl",
		"leitweg_id": "04011000-1234512345-06"})

	// a German public body's Leitweg-ID becomes the new invoice's buyer reference (BT-10)
	d := e.draft(b, public, nil)
	var got struct{ Data struct{ Reference *string } }
	e.do(b, "GET", "/api/v1/invoices/"+d.ID, nil, http.StatusOK, &got)
	if got.Data.Reference == nil || *got.Data.Reference != "04011000-1234512345-06" {
		t.Fatalf("draft reference %v", got.Data.Reference)
	}
	inv := e.invoice(b, "POST", "/api/v1/invoices/"+d.ID+"/issue", nil, http.StatusOK)
	e.do(b, "POST", "/api/v1/invoices/"+inv.ID+"/send", map[string]any{}, http.StatusOK, nil)
	m := e.mail.sent[len(e.mail.sent)-1]
	if len(m.Attachments) != 2 || m.Attachments[1].Name != *inv.Number+".xml" || m.Attachments[1].ContentType != "application/xml" ||
		len(asked) != 1 || asked[0] != "xrechnung-ubl" {
		t.Fatalf("attachments %+v, formats asked %v", m.Attachments, asked)
	}

	// no XML for a client that did not ask for it
	other := e.issued(b, plain, nil)
	e.do(b, "POST", "/api/v1/invoices/"+other.ID+"/send", map[string]any{}, http.StatusOK, nil)
	if m := e.mail.sent[len(e.mail.sent)-1]; len(m.Attachments) != 1 || len(asked) != 1 {
		t.Fatalf("plain client got %d attachments", len(m.Attachments))
	}

	// the XML cannot be made: nothing is sent rather than the PDF alone
	refuse = auth.Error(http.StatusConflict, "einvoice_seller_contact_missing", "XRechnung needs the seller's phone.", nil)
	sent := len(e.mail.sent)
	e.fails(b, "POST", "/api/v1/invoices/"+inv.ID+"/send", map[string]any{}, http.StatusConflict, "einvoice_seller_contact_missing")
	if len(e.mail.sent) != sent {
		t.Fatal("sent without the XML the client asked for")
	}
}
