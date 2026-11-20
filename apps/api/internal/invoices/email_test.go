package invoices

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/store"
)

type emailDraftOut struct {
	Data struct {
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		Message string   `json:"message"`
	}
}

func (e *env) setTemplate(b *browser, kind, lang, subject, body string) {
	e.t.Helper()
	ws := e.wsID(b)
	err := e.st.Q.SetEmailTemplate(context.Background(), ws, store.EmailTemplate{Kind: kind, Language: lang, Subject: subject, Body: body}, "", time.Now())
	if err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) wsID(b *browser) string { return b.workspace }

func (e *env) draftOf(b *browser, id string, want int) emailDraftOut {
	var out emailDraftOut
	e.do(b, "GET", "/api/v1/invoices/"+id+"/email", nil, want, &out)
	return out
}

func TestDraftDefaultsMatchTheBuiltInTexts(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	en := e.issued(b, client, map[string]any{"language": "en"})
	got := e.draftOf(b, en.ID, http.StatusOK).Data
	seller := en.Seller.Name
	number := *en.Number
	if !slices.Equal(got.To, []string{"ap@kunde.ch"}) || got.Subject != "Invoice "+number+" from "+seller ||
		got.Message != "Hello\n\nPlease find attached our invoice "+number+" for CHF 216.20, payable by "+swissDate(en.DueDate)+
			".\n\nKind regards\n"+seller {
		t.Fatalf("draft %+v", got)
	}
	de := e.issued(b, client, map[string]any{"language": "de"})
	cn := e.invoice(b, "POST", "/api/v1/invoices/"+de.ID+"/credit-note", map[string]any{"lines": []any{line("1", "50.00")}}, http.StatusCreated)
	cn = e.invoice(b, "POST", "/api/v1/invoices/"+cn.ID+"/issue", nil, http.StatusOK)
	got = e.draftOf(b, cn.ID, http.StatusOK).Data
	if want := "Guten Tag\n\nIm Anhang finden Sie unsere Gutschrift " + *cn.Number + " über CHF 54.05.\n\nFreundliche Grüsse\n" + seller; got.Message != want {
		t.Fatalf("credit note message %q, want %q", got.Message, want)
	}
}

func TestDraftUsesInvoiceLanguageTemplate(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	e.setTemplate(b, "invoice", "en", "EN {number}", "english")
	e.setTemplate(b, "invoice", "de", "Rechnung {number} – {client}", "Hi {client}")
	de := e.issued(b, client, map[string]any{"language": "de"})
	got := e.draftOf(b, de.ID, http.StatusOK).Data
	if got.Subject != "Rechnung "+*de.Number+" – "+de.Buyer.Name || got.Message != "Hi "+de.Buyer.Name {
		t.Fatalf("draft %+v", got)
	}
}

func TestDraftCreditNoteUsesCreditNoteTemplate(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	e.setTemplate(b, "invoice", "de", "wrong", "wrong")
	e.setTemplate(b, "credit_note", "de", "Gutschrift {number}", "credit")
	de := e.issued(b, client, map[string]any{"language": "de"})
	cn := e.invoice(b, "POST", "/api/v1/invoices/"+de.ID+"/credit-note", map[string]any{"lines": []any{line("1", "50.00")}}, http.StatusCreated)
	cn = e.invoice(b, "POST", "/api/v1/invoices/"+cn.ID+"/issue", nil, http.StatusOK)
	got := e.draftOf(b, cn.ID, http.StatusOK).Data
	if got.Subject != "Gutschrift "+*cn.Number || got.Message != "credit" {
		t.Fatalf("draft %+v", got)
	}
}

func TestDraftAppendsRevolutOnce(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"revolut_enabled": true, "revolut_username": "muster"}, http.StatusOK, nil)
	inv := e.issued(b, client, map[string]any{"language": "en"})
	url := "https://revolut.me/muster"
	got := e.draftOf(b, inv.ID, http.StatusOK).Data
	if !strings.HasSuffix(got.Message, "\n\nPay with Revolut: "+url) || strings.Count(got.Message, url) != 1 {
		t.Fatalf("message %q", got.Message)
	}
	e.setTemplate(b, "invoice", "en", "S", "Pay here: "+url)
	if got := e.draftOf(b, inv.ID, http.StatusOK).Data; got.Message != "Pay here: "+url {
		t.Fatalf("message %q, want the link once", got.Message)
	}
}

func TestDraftOfDraftInvoice(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	d := e.draft(b, client, nil)
	e.fails(b, "POST", "/api/v1/invoices/"+d.ID+"/send", map[string]any{}, http.StatusConflict, "invalid_state")
	e.fails(b, "GET", "/api/v1/invoices/"+d.ID+"/email", nil, http.StatusConflict, "invalid_state")
}

func TestDraftOfAnotherWorkspace(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	inv := e.issued(b, client, nil)
	other, _ := e.ready()
	e.fails(other, "GET", "/api/v1/invoices/"+inv.ID+"/email", nil, http.StatusNotFound, "not_found")
}

func TestSendWithoutSubjectUsesTemplate(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	e.setTemplate(b, "invoice", "en", "Bill {number}", "Dear {client}")
	inv := e.issued(b, client, map[string]any{"language": "en"})
	e.do(b, "POST", "/api/v1/invoices/"+inv.ID+"/send", map[string]any{}, http.StatusOK, nil)
	m := e.mail.sent[0]
	if m.Subject != "Bill "+*inv.Number || m.Text != "Dear "+inv.Buyer.Name {
		t.Fatalf("mail %q / %q", m.Subject, m.Text)
	}
}

func TestInstalmentMailUsesTemplate(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	e.setTemplate(b, "invoice", "en", "Bill {number}", "Dear {client}")
	issued := e.issued(b, client, map[string]any{"language": "en"})
	inv, err := e.st.Invoice(context.Background(), b.workspace, issued.ID, e.today(), false)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SendIssued(context.Background(), store.Workspace{ID: b.workspace, Timezone: zone.String()}, inv); err != nil {
		t.Fatal(err)
	}
	if m := e.mail.sent[0]; m.Subject != "Bill "+*inv.Number || m.Text != "Dear "+inv.Buyer.Name {
		t.Fatalf("mail %q / %q", m.Subject, m.Text)
	}
}

func TestSendAcceptsTheRenderedDraftOverTheLimit(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	// the template is within the limits, the rendered draft (company name filled in) is not
	e.setTemplate(b, "invoice", "en", "{company}"+strings.Repeat("s", 191), strings.Repeat("{company}", 100)+strings.Repeat("b", emailtemplate.MaxMessage-900))
	inv := e.issued(b, client, map[string]any{"language": "en"})
	d := e.draftOf(b, inv.ID, http.StatusOK).Data
	if utf8.RuneCountInString(d.Subject) <= 200 || utf8.RuneCountInString(d.Message) <= emailtemplate.MaxMessage {
		t.Fatalf("draft is %d / %d runes, want over the limits", utf8.RuneCountInString(d.Subject), utf8.RuneCountInString(d.Message))
	}
	e.do(b, "POST", "/api/v1/invoices/"+inv.ID+"/send", map[string]any{"subject": d.Subject, "message": d.Message}, http.StatusOK, nil)
	if m := e.mail.sent[0]; m.Subject != d.Subject || m.Text != d.Message {
		t.Fatalf("mail %q / %q, want the draft", m.Subject, m.Text)
	}
	e.fails(b, "POST", "/api/v1/invoices/"+inv.ID+"/send", map[string]any{"subject": strings.Repeat("s", 201)}, http.StatusUnprocessableEntity, "validation_failed", "subject")
	e.fails(b, "POST", "/api/v1/invoices/"+inv.ID+"/send", map[string]any{"message": d.Message + "!"}, http.StatusUnprocessableEntity, "validation_failed", "message")
}

func TestSendMessageLimit(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	inv := e.issued(b, client, map[string]any{"language": "en"})
	for _, tc := range []struct {
		name  string
		runes int
		ok    bool
	}{
		{"at the limit, counted in characters not bytes", emailtemplate.MaxMessage, true},
		{"one over the limit", emailtemplate.MaxMessage + 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := map[string]any{"message": strings.Repeat("é", tc.runes)}
			if tc.ok {
				e.do(b, "POST", "/api/v1/invoices/"+inv.ID+"/send", body, http.StatusOK, nil)
			} else {
				e.fails(b, "POST", "/api/v1/invoices/"+inv.ID+"/send", body, http.StatusUnprocessableEntity, "validation_failed", "message")
			}
		})
	}
}
