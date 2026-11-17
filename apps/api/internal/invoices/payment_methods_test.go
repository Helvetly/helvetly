package invoices

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"helvetly.com/api/internal/swissqr"
)

func TestNormaliseRevolut(t *testing.T) {
	for _, tt := range []struct{ in, want string }{
		{"jan.muster", "jan.muster"},
		{"@jan_m", "jan_m"},
		{"https://revolut.me/jan-muster/", "jan-muster"},
		{"HTTPS://WWW.Revolut.me/JanM?utm=x", "JanM"},
		{"revolut.me/jan", "jan"},
		{"ja", ""},                      // too short
		{"jan muster", ""},              // space
		{"revolut.me/jan/10chf", ""},    // a path is not a username
		{"https://example.com/jan", ""}, // another site
		{strings.Repeat("a", 33), ""},   // too long
	} {
		got, msg := normaliseRevolut(tt.in)
		if got != tt.want || (tt.want == "") != (msg != "") {
			t.Errorf("normaliseRevolut(%q) = %q, %q; want %q", tt.in, got, msg, tt.want)
		}
	}
}

func TestPaymentMethods(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	var set struct{ Data Settings }
	e.do(b, "GET", "/api/v1/invoice-settings", nil, http.StatusOK, &set)
	if !set.Data.QRBillEnabled || set.Data.RevolutEnabled || set.Data.RevolutUsername != nil {
		t.Fatalf("defaults: %+v", set.Data)
	}

	// settings: Revolut needs a username; a pasted link is stored as the bare username
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"revolut_enabled": true}, http.StatusUnprocessableEntity,
		"validation_failed", "revolut_username")
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"revolut_username": "no spaces"}, http.StatusUnprocessableEntity,
		"validation_failed", "revolut_username")
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"qr_bill_enabled": nil}, http.StatusUnprocessableEntity,
		"validation_failed", "qr_bill_enabled")
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"revolut_enabled": true, "revolut_username": "https://revolut.me/muster/"},
		http.StatusOK, &set)
	if !set.Data.RevolutEnabled || *set.Data.RevolutUsername != "muster" {
		t.Fatalf("revolut saved: %+v", set.Data)
	}

	// new drafts offer what can apply: the QR bill only in CHF and EUR
	chf := e.draft(b, clientID, nil)
	if !chf.PaymentMethods.QRBill || !chf.PaymentMethods.Revolut || !chf.Payment.QRBill || chf.Payment.RevolutURL == nil ||
		*chf.Payment.RevolutURL != "https://revolut.me/muster" {
		t.Fatalf("chf draft: %+v", chf)
	}
	usd := e.draft(b, clientID, map[string]any{"currency": "USD", "payment_methods": map[string]any{"qr_bill": true, "revolut": true}})
	if usd.PaymentMethods.QRBill || !usd.PaymentMethods.Revolut {
		t.Fatalf("usd draft keeps a QR bill it cannot have: %+v", usd)
	}
	plain := e.invoice(b, "PATCH", "/api/v1/invoices/"+chf.ID, map[string]any{"payment_methods": map[string]any{"qr_bill": false}},
		http.StatusOK)
	if plain.PaymentMethods.QRBill || !plain.PaymentMethods.Revolut || plain.Payment.QRBill {
		t.Fatalf("patched: %+v", plain)
	}
	e.fails(b, "PATCH", "/api/v1/invoices/"+chf.ID, map[string]any{"payment_methods": map[string]any{"twint": true}},
		http.StatusBadRequest, "invalid_request")

	// a choice that stops applying is dropped on the next save and on issue, never refused
	both := e.draft(b, clientID, nil)
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"iban": "DE89 3704 0044 0532 0130 00"}, http.StatusOK, nil)
	if saved := e.invoice(b, "PATCH", "/api/v1/invoices/"+both.ID, map[string]any{"note": "x"}, http.StatusOK); saved.PaymentMethods.QRBill {
		t.Fatalf("foreign IBAN keeps the QR bill: %+v", saved.PaymentMethods)
	}
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"iban": "CH93 0076 2011 6238 5295 7", "revolut_enabled": false}, http.StatusOK, nil)
	issuedBoth := e.invoice(b, "POST", "/api/v1/invoices/"+both.ID+"/issue", nil, http.StatusOK)
	if issuedBoth.PaymentMethods.Revolut || issuedBoth.Payment.RevolutURL != nil || issuedBoth.PaymentMethods.QRBill {
		t.Fatalf("issued with methods that no longer apply: %+v %+v", issuedBoth.PaymentMethods, issuedBoth.Payment)
	}
	var list struct{ Data []Invoice }
	e.do(b, "GET", "/api/v1/invoices?status=draft", nil, http.StatusOK, &list)
	for _, i := range list.Data {
		if i.ID == chf.ID && (i.PaymentMethods.QRBill || !i.PaymentMethods.Revolut) {
			t.Fatalf("list methods: %+v", i.PaymentMethods)
		}
	}

	// issued: the link is frozen; changing the username later leaves it, and the email carries it
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"revolut_enabled": true}, http.StatusOK, nil)
	issued := e.invoice(b, "POST", "/api/v1/invoices/"+chf.ID+"/issue", nil, http.StatusOK)
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"revolut_username": "someone.else"}, http.StatusOK, nil)
	issued = e.invoice(b, "GET", "/api/v1/invoices/"+issued.ID, nil, http.StatusOK)
	if issued.Payment.QRBill || issued.Payment.RevolutURL == nil || *issued.Payment.RevolutURL != "https://revolut.me/muster" {
		t.Fatalf("issued: %+v", issued.Payment)
	}
	e.do(b, "POST", "/api/v1/invoices/"+issued.ID+"/send", map[string]any{}, http.StatusOK, nil)
	e.do(b, "POST", "/api/v1/invoices/"+issued.ID+"/send", map[string]any{"message": "Hallo"}, http.StatusOK, nil)
	for _, m := range e.mail.sent {
		if !strings.Contains(m.Text, "Mit Revolut bezahlen: https://revolut.me/muster") {
			t.Errorf("email without the Revolut link: %q", m.Text)
		}
	}

	// credit notes have nothing to pay
	cn := e.invoice(b, "POST", "/api/v1/invoices/"+issued.ID+"/credit-note", map[string]any{}, http.StatusCreated)
	if cn.PaymentMethods.QRBill || cn.PaymentMethods.Revolut || cn.Payment.RevolutURL != nil {
		t.Fatalf("credit note: %+v", cn)
	}
	e.fails(b, "PATCH", "/api/v1/invoices/"+cn.ID, map[string]any{"payment_methods": map[string]any{"revolut": true}},
		http.StatusUnprocessableEntity, "validation_failed", "payment_methods")
}

func TestDraftReference(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready() // a QR-IBAN
	e.issued(b, clientID, nil)
	d := e.draft(b, clientID, nil)
	ctx := context.Background()
	inv, err := e.st.Invoice(ctx, b.workspace, d.ID, d.IssueDate, false)
	if err != nil {
		t.Fatal(err)
	}
	year, _ := strconv.Atoi(d.IssueDate[:4])
	for _, tt := range []struct {
		name, iban, refType string
		want                *string
	}{
		{"QR-IBAN: provisional QRR of the next number", "CH4431999123000889012", "QRR", ptr(swissqr.QRR(fmt.Sprintf("%d%06d", year, 2)))},
		{"IBAN: no reference (NON)", "CH9300762011623852957", "SCOR", nil},
	} {
		inv.Payment.IBAN, inv.Payment.ReferenceType = &tt.iban, tt.refType
		got, err := draftReference(ctx, e.st.Q, b.workspace, "{YYYY}-{NNN}", inv)
		if err != nil {
			t.Fatal(err)
		}
		if (got == nil) != (tt.want == nil) || got != nil && (*got != *tt.want || !swissqr.ValidQRR(*got)) {
			t.Errorf("%s: %v, want %v", tt.name, deref(got), deref(tt.want))
		}
	}
}

func ptr[T any](v T) *T { return &v }
