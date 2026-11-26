package invoices

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"testing"

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

// oldOverride stores a row of the email texts workspaces could once write; the app no longer reads them.
func (e *env) oldOverride(b *browser, kind, lang, subject, body string) {
	e.t.Helper()
	if _, err := e.raw.Exec(context.Background(), `INSERT INTO email_templates (workspace_id, kind, language, subject, body, updated_at)
		VALUES ($1, $2, $3, $4, $5, now())`, b.workspace, kind, lang, subject, body); err != nil {
		e.t.Fatal(err)
	}
}

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
			".\n\nThe PDF includes the payment details. If you have a question about the invoice, reply to this email.\n\nKind regards\n"+seller {
		t.Fatalf("draft %+v", got)
	}
	de := e.issued(b, client, map[string]any{"language": "de"})
	cn := e.invoice(b, "POST", "/api/v1/invoices/"+de.ID+"/credit-note", map[string]any{"lines": []any{line("1", "50.00")}}, http.StatusCreated)
	cn = e.invoice(b, "POST", "/api/v1/invoices/"+cn.ID+"/issue", nil, http.StatusOK)
	got = e.draftOf(b, cn.ID, http.StatusOK).Data
	if want := "Guten Tag\n\nIm Anhang finden Sie unsere Gutschrift " + *cn.Number + " über CHF 54.05.\n\nIm PDF sehen Sie, was gutgeschrieben wurde. Bei Fragen zur Verrechnung antworten Sie auf diese E-Mail.\n\nFreundliche Grüsse\n" + seller; got.Message != want {
		t.Fatalf("credit note message %q, want %q", got.Message, want)
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
	e.do(b, "POST", "/api/v1/invoices/"+inv.ID+"/send", map[string]any{}, http.StatusOK, nil)
	msg := e.mail.sent[len(e.mail.sent)-1]
	if !strings.Contains(msg.HTML, `href="`+url+`">Pay with Revolut</a>`) ||
		!strings.Contains(msg.Text, "\nPay with Revolut: "+url+"\n") || strings.Count(msg.Text, url) != 1 {
		t.Fatalf("Revolut payment link missing: %s\n%s", msg.HTML, msg.Text)
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

// A send uses Helvetly's wording even when the workspace still has a text it wrote when that was possible.
func TestSendIgnoresOldOverrides(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	for _, kind := range []string{"invoice", "credit_note"} {
		e.oldOverride(b, kind, "en", "Bill {number}", "Dear {client}")
	}
	issued := e.issued(b, client, map[string]any{"language": "en"})
	want := emailtemplate.Default("invoice", "en")
	if d := e.draftOf(b, issued.ID, http.StatusOK).Data; !strings.HasPrefix(d.Subject, "Invoice ") || !strings.HasPrefix(d.Message, "Hello\n\n") {
		t.Fatalf("draft %+v, want the built-in %+v", d, want)
	}
	e.do(b, "POST", "/api/v1/invoices/"+issued.ID+"/send", map[string]any{}, http.StatusOK, nil)
	// the email of an instalment that issues itself
	second := e.issued(b, client, map[string]any{"language": "en"})
	inv, err := e.st.Invoice(context.Background(), b.workspace, second.ID, e.today(), false)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SendIssued(context.Background(), store.Workspace{ID: b.workspace, Timezone: zone.String()}, inv); err != nil {
		t.Fatal(err)
	}
	if len(e.mail.sent) != 2 {
		t.Fatalf("sent %d emails, want 2", len(e.mail.sent))
	}
	for _, m := range e.mail.sent {
		if !strings.HasPrefix(m.Subject, "Invoice ") || !strings.HasSuffix(m.Subject, " from "+inv.Seller.Name) || strings.Contains(m.Text, "Dear ") {
			t.Fatalf("mail %q / %q, want the built-in text", m.Subject, m.Text)
		}
	}
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
