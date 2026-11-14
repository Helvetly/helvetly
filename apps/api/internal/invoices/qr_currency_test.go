package invoices

import (
	"net/http"
	"slices"
	"testing"
)

// SIX IG 2.4 (§2.8, §4.3.2): a QR-IBAN with its QR reference is for CHF only; a normal Swiss IBAN takes CHF and EUR.
func TestQRBillCurrencyByAccount(t *testing.T) {
	cases := []struct {
		name, iban, currency string
		qrBill               bool
		reference            string
	}{
		{"QR-IBAN in CHF: QR reference", "CH44 3199 9123 0008 8901 2", "CHF", true, "QRR"},
		{"IBAN in CHF: creditor reference", "CH93 0076 2011 6238 5295 7", "CHF", true, "SCOR"},
		{"IBAN in EUR: creditor reference", "CH93 0076 2011 6238 5295 7", "EUR", true, "SCOR"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := newEnv(t)
			b, clientID := e.ready()
			e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"iban": c.iban}, http.StatusOK, nil)
			draft := e.draft(b, clientID, map[string]any{"currency": c.currency})
			if draft.PaymentMethods.QRBill != c.qrBill {
				t.Fatalf("draft QR bill %v, want %v", draft.PaymentMethods.QRBill, c.qrBill)
			}
			issued := e.invoice(b, "POST", "/api/v1/invoices/"+draft.ID+"/issue", nil, http.StatusOK)
			if issued.Payment.ReferenceType != c.reference || issued.Payment.QRBill != c.qrBill {
				t.Fatalf("issued payment %+v, want %s with QR bill %v", issued.Payment, c.reference, c.qrBill)
			}
		})
	}

	t.Run("QR-IBAN in EUR: no QR bill and refused on issue", func(t *testing.T) {
		e := newEnv(t)
		b, clientID := e.ready() // a QR-IBAN
		draft := e.draft(b, clientID, map[string]any{"currency": "EUR", "payment_methods": map[string]any{"qr_bill": true}})
		if draft.PaymentMethods.QRBill || draft.Payment.QRBill {
			t.Fatalf("EUR draft to a QR-IBAN offers a QR bill: %+v %+v", draft.PaymentMethods, draft.Payment)
		}
		out := e.fails(b, "POST", "/api/v1/invoices/"+draft.ID+"/issue", nil, http.StatusUnprocessableEntity, "cannot_issue")
		if !slices.ContainsFunc(out.Error.Details.Reasons, func(r reason) bool { return r.Code == "qr_iban_currency" && r.Field == "currency" }) {
			t.Fatalf("reasons %+v, want qr_iban_currency on currency", out.Error.Details.Reasons)
		}
	})
}
