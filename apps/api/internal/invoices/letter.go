package invoices

import (
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
	l := mail.NewLetter(inv.Language).Message(m.Text).Summary(
		mail.Row{Label: Title(inv), Value: deref(inv.Number)},
		mail.Row{Label: amount, Value: inv.Currency + " " + abs(inv.Payable()).Swiss("'")},
		mail.Row{Label: w.DueDate, Value: due},
	).Attached(names...)
	m.Text, m.HTML = l.Text(), l.HTML()
	return m
}

func abs(m store.Money) store.Money {
	if m < 0 {
		return -m
	}
	return m
}
