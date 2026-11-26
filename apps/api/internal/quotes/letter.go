package quotes

import (
	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// withLetter makes m (its Text the message: the template, or what the sender wrote) a quote's email: the message,
// then the quote's summary as on its PDF (a revision's number with it) and the attached files.
func withLetter(m mail.Message, t store.Quote) mail.Message {
	w, number := invoicepdf.EmailWordsFor(t.Language), ""
	if n := asInvoice(t).Number; n != nil {
		number = *n
	}
	names := make([]string, len(m.Attachments))
	for i, a := range m.Attachments {
		names[i] = a.Name
	}
	total, validUntil := t.Currency+" "+t.PayableTotal.Swiss("'"), swissDate(t.ValidUntil)
	l := mail.NewLetter(t.Language).DocumentMessage(m.Text, number, total, validUntil).Summary(
		mail.Row{Label: invoicepdf.Title(t.Language, "quote"), Value: number},
		mail.Row{Label: w.Total, Value: total},
		mail.Row{Label: w.ValidUntil, Value: validUntil},
	).Attached(names...)
	m.Text, m.HTML, m.Eyebrow = l.Text(), l.HTML(), invoicepdf.Title(t.Language, "quote")
	return m
}
