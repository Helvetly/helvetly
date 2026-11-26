package invoices

import (
	"strings"

	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// withLetter makes m (its Text the message: the template, or what the sender wrote) an invoice's email: the message,
// then the invoice's summary as on its PDF and the attached files.
func withLetter(m mail.Message, inv store.Invoice) mail.Message {
	w := invoicepdf.EmailWordsFor(inv.Language)
	amount, due := w.Payable, invoicepdf.SwissDate(inv.DueDate)
	if inv.Kind == "credit_note" || inv.Payable() <= 0 {
		amount, due = w.Credited, ""
	}
	names := make([]string, len(m.Attachments))
	for i, a := range m.Attachments {
		names[i] = a.Name
	}
	number, total := deref(inv.Number), inv.Currency+" "+abs(inv.Payable()).Swiss("'")
	message, payment := m.Text, ""
	if inv.Payment.RevolutURL != nil {
		if body, ok := strings.CutSuffix(message, "\n\n"+revolutPaymentLine(inv)); ok {
			message, payment = body, *inv.Payment.RevolutURL
		}
	}
	l := mail.NewLetter(inv.Language).DocumentMessage(message, number, total, due).Summary(
		mail.Row{Label: Title(inv), Value: number},
		mail.Row{Label: amount, Value: total},
		mail.Row{Label: w.DueDate, Value: due},
	).Link(revolutPaymentLabel(inv.Language), payment).Attached(names...)
	m.Text, m.HTML, m.Eyebrow = l.Text(), l.HTML(), Title(inv)
	if inv.Kind == "corrected" || inv.Kind == "credit_note" || inv.Kind == "debit_note" {
		m.Tone = mail.Amended
	}
	return m
}

func abs(m store.Money) store.Money {
	if m < 0 {
		return -m
	}
	return m
}
