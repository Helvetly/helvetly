package invoices

import (
	"context"
	"errors"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// confirmationAttempts: a confirmation the mail server keeps refusing (a used-up email allowance, a bad address) is
// given up after this many tries.
const confirmationAttempts = 5

// queueConfirmation queues the client's payment confirmation in the payment's transaction: asked (nil: the workspace's
// setting) and the invoice one Helvetly issued (an invoice issued elsewhere is never emailed). Credit notes and
// proformas take no payments at all.
func (s *Service) queueConfirmation(ctx context.Context, q store.Q, sess store.Session, inv store.Invoice, p store.Payment, asked *bool) error {
	if s.mail == nil || inv.IssuedElsewhere() || asked != nil && !*asked {
		return nil
	}
	if asked == nil {
		set, err := loadSettings(ctx, q, sess.Workspace.ID)
		if err != nil || !set.PaymentConfirmation {
			return err
		}
	}
	today := s.today(sess.Workspace)
	after, err := q.Invoice(ctx, sess.Workspace.ID, inv.ID, today, false)
	if err != nil {
		return err
	}
	allocate(&after, today)
	c := store.PaymentConfirmation{PaymentID: p.ID, WorkspaceID: sess.Workspace.ID, InvoiceID: inv.ID, RecordedBy: &sess.User.ID, Open: after.AmountDue}
	if after.Instalments != nil && after.AmountDue > 0 {
		if k := slices.IndexFunc(after.Instalments.Items, func(it store.InstalmentItem) bool { return it.Open > 0 }); k >= 0 {
			next := after.Instalments.Items[k]
			c.NextAmount, c.NextDue = &next.Open, &next.DueDate
		}
	}
	return q.QueuePaymentConfirmation(ctx, c, s.now())
}

// RunPaymentConfirmations sends the queued payment confirmations every few seconds.
func (s *Service) RunPaymentConfirmations(ctx context.Context) {
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	for {
		if err := s.SendPaymentConfirmations(ctx); err != nil {
			s.log.ErrorContext(ctx, "payment confirmations", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// SendPaymentConfirmations sends what is queued, batch by batch. A send failing never touches the payment: it is
// tried again later (a refusal) or left unconfirmed (an unknown outcome), never sent twice.
func (s *Service) SendPaymentConfirmations(ctx context.Context) error {
	if s.mail == nil {
		return nil
	}
	for {
		now := s.now()
		batch, err := s.db.ClaimPaymentConfirmations(ctx, 20, now)
		if err != nil || len(batch) == 0 {
			return err
		}
		for _, c := range batch {
			state, err := s.sendConfirmation(ctx, c)
			done := context.WithoutCancel(ctx)
			var retry *time.Time
			switch {
			case errors.Is(err, mail.ErrUncertain):
				s.log.WarnContext(ctx, "payment confirmation may have been sent", "payment", c.PaymentID, "error", err)
				continue // stays uncertain
			case err != nil:
				s.log.WarnContext(ctx, "payment confirmation not sent", "payment", c.PaymentID, "attempt", c.Attempts, "error", err)
				state, retry = "pending", new(now.Add(time.Duration(c.Attempts*c.Attempts)*time.Minute)) // 1, 4, 9, 16 min
				if c.Attempts >= confirmationAttempts {
					state, retry = "failed", nil
				}
			}
			if err := s.db.FinishPaymentConfirmation(done, c.PaymentID, state, retry); err != nil {
				return err
			}
		}
	}
}

// sendConfirmation emails one confirmation to the invoice's recipients (as sending the invoice finds them) and records
// it as the invoice's delivery; "skipped" when there is nobody to send it to.
func (s *Service) sendConfirmation(ctx context.Context, c store.PaymentConfirmation) (string, error) {
	inv, err := s.db.Invoice(ctx, c.WorkspaceID, c.InvoiceID, s.now().Format(time.DateOnly), false)
	if err != nil {
		return "", err
	}
	_, _, to := s.recipients(ctx, c.WorkspaceID, inv, nil)
	if len(to) == 0 {
		return "skipped", nil
	}
	lang := emailLanguage(inv)
	t, err := template(ctx, s.db.Q, c.WorkspaceID, "payment_confirmation", lang)
	if err != nil {
		return "", err
	}
	var company, client string
	if inv.Seller != nil {
		company = inv.Seller.Name
	}
	if inv.Buyer != nil {
		client = inv.Buyer.Name
	}
	money := func(m store.Money) string { return inv.Currency + " " + m.Swiss("'") }
	r := emailtemplate.Render(t, map[string]string{"document": Title(inv), "number": deref(inv.Number), "client": client,
		"amount": money(c.Amount), "paid_on": swissDate(c.PaidOn), "balance": money(c.Open), "company": company})
	m := confirmationLetter(mail.Message{Workspace: c.WorkspaceID, Language: inv.Language, To: to, Subject: r.Subject, Text: r.Body}, inv, c)
	if inv.Seller != nil && inv.Seller.Email != nil {
		m.ReplyTo = *inv.Seller.Email
	}
	if err := s.mail.Send(ctx, m); err != nil {
		return "", err
	}
	d := store.Delivery{ID: auth.NewID("dlv"), To: to, Cc: []string{}, Bcc: []string{}, SentAt: s.now(), Kind: "payment_confirmation"}
	if err := s.db.CreateDelivery(context.WithoutCancel(ctx), inv.ID, c.RecordedBy, d); err != nil {
		return "", errors.Join(mail.ErrUncertain, err) // it went: never again
	}
	return "sent", nil
}

// confirmationWords: the summary's labels and the pill, per language.
type confirmationWords struct{ eyebrow, received, paidOn, status, paid, open, next string }

var confirmationLabels = map[string]confirmationWords{
	"de": {"Zahlung erhalten", "Erhaltener Betrag", "Zahlungsdatum", "Status", "Vollständig bezahlt", "Offener Betrag", "Nächste Rate"},
	"fr": {"Paiement reçu", "Montant reçu", "Date du paiement", "Statut", "Entièrement payée", "Solde restant", "Prochain versement"},
	"it": {"Pagamento ricevuto", "Importo ricevuto", "Data del pagamento", "Stato", "Interamente pagata", "Saldo residuo", "Prossima rata"},
	"en": {"Payment received", "Amount received", "Payment date", "Status", "Paid in full", "Remaining balance", "Next instalment"},
}

// confirmationLetter makes m (its Text the message) the confirmation: the message, then the invoice, the payment, and
// either "paid in full" or what is still open with the next instalment.
func confirmationLetter(m mail.Message, inv store.Invoice, c store.PaymentConfirmation) mail.Message {
	lang := emailLanguage(inv)
	w, due := confirmationLabels[lang], invoicepdf.EmailWordsFor(lang).DueDate
	money := func(v store.Money) string { return inv.Currency + " " + v.Swiss("'") }
	number, amount := deref(inv.Number), money(c.Amount)
	rows := []mail.Row{{Label: Title(inv), Value: number}, {Label: w.received, Value: amount}, {Label: w.paidOn, Value: swissDate(c.PaidOn)}}
	if c.Open <= 0 {
		rows = append(rows, mail.Row{Label: w.status, Value: w.paid})
	} else {
		rows = append(rows, mail.Row{Label: w.open, Value: money(c.Open)})
		if c.NextAmount != nil && c.NextDue != nil {
			rows = append(rows, mail.Row{Label: w.next, Value: money(*c.NextAmount)}, mail.Row{Label: due, Value: swissDate(*c.NextDue)})
		}
	}
	l := mail.NewLetter(lang).DocumentMessage(m.Text, number, amount).Summary(rows...)
	m.Text, m.HTML, m.Eyebrow, m.Tone = l.Text(), l.HTML(), w.eyebrow, mail.Positive
	return m
}
