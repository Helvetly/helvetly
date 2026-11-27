package dunning

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"helvetly.com/api/internal/dunningcalc"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

// Run ticks hourly until ctx ends (like instalments.Service.Run).
func (s *Service) Run(ctx context.Context) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		if err := s.Tick(ctx); err != nil {
			s.log.ErrorContext(ctx, "dunning job", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// Tick sends each step that is due, once: a failure on one invoice is logged and retried on the next run; only a
// failed lookup is returned.
func (s *Service) Tick(ctx context.Context) error {
	now := s.now()
	if err := s.notifyOverdue(ctx, now); err != nil {
		return err
	}
	candidates, err := s.db.DunningCandidates(ctx, now, dunningcalc.MaxDaysBefore)
	if err != nil {
		return fmt.Errorf("list dunning candidates: %w", err)
	}
	settings := map[string]invoices.DunningSettings{}
	due := 0
	for _, c := range candidates {
		set, ok := settings[c.Workspace.ID]
		if !ok {
			if set, err = s.inv.DunningSettingsOf(ctx, s.db.Q, c.Workspace.ID); err != nil {
				return fmt.Errorf("dunning settings: %w", err)
			}
			settings[c.Workspace.ID] = set
		}
		step, on := dunningDue(c, set, c.Workspace.Today(now))
		if on == "" || c.Workspace.Today(now) < on {
			continue
		}
		due++
		if c.ClientEmail == "" {
			s.log.WarnContext(ctx, "dunning notice skipped: the client has no email address", "invoice", c.InvoiceID, "step", step)
			continue
		}
		if s.mailer == nil {
			continue
		}
		if _, err := guard(func() (bool, error) { return s.send(ctx, c.Workspace, c.InvoiceID, nil) }); err != nil {
			s.log.ErrorContext(ctx, "dunning notice", "invoice", c.InvoiceID, "step", step, "error", err)
		}
	}
	if due > 0 && s.mailer == nil {
		s.log.WarnContext(ctx, "dunning notices not sent: no mail server", "count", due)
	}
	return nil
}

// overdueWindow: an invoice is reported overdue up to this many days after its due date, so turning the job on (or
// a long outage) never floods the bell with old invoices.
const overdueWindow = 7

// notifyOverdue tells the managers once about each invoice that recently fell due, dunning on or off.
func (s *Service) notifyOverdue(ctx context.Context, now time.Time) error {
	due, err := s.db.RecentlyOverdue(ctx, now, overdueWindow)
	if err != nil {
		return fmt.Errorf("list overdue invoices: %w", err)
	}
	for _, o := range due {
		err := s.db.Tx(ctx, func(q store.Q) error {
			return notifications.Notify(ctx, q, o.WorkspaceID, "invoice.overdue", map[string]any{"invoice_id": o.InvoiceID,
				"number": o.Number, "client": o.Client, "amount": o.Open.String(), "currency": o.Currency, "due_date": o.DueDate},
				store.NotifyTo{Roles: notifications.Managers, Once: "invoice.overdue:" + o.InvoiceID}, now)
		})
		if err != nil {
			s.log.ErrorContext(ctx, "overdue notification", "invoice", o.InvoiceID, "error", err)
		}
	}
	return nil
}

// dunningDue: the candidate's next step on today and the day it is due, "" when no step is left.
func dunningDue(c store.DunningCandidate, set invoices.DunningSettings, today string) (int, string) {
	steps := set.CalcSteps()
	step := dunningcalc.Next(c.IssueDate, c.DueDate, today, c.LastLevel, steps)
	return step, dunningcalc.DueOn(c.DueDate, c.LastSentOn, steps, step)
}

// guard turns a panic in one invoice's notice into an error, so one bad invoice cannot stop the job.
func guard(f func() (bool, error)) (sent bool, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
		}
	}()
	return f()
}

// message is notice n of the invoice as an email to n.Email, in the invoice's language, with the letter (and its QR
// bill) and the invoice attached; replies go to the seller.
func (st state) message(n store.DunningNotice, letter, invoicePDF []byte) mail.Message {
	inv := st.inv
	w, title := st.words(n)
	number := ""
	if inv.Number != nil {
		number = *inv.Number
	}
	sentence := fmt.Sprintf(w.Sentence, number, invoicepdf.SwissDate(inv.IssueDate), invoicepdf.SwissDate(inv.DueDate))
	amount := func(label string, m store.Money) mail.Row {
		return mail.Row{Label: label, Value: inv.Currency + " " + m.Swiss("'")}
	}
	rows := []mail.Row{amount(fmt.Sprintf(w.Open, number), n.Open)}
	if n.Fee != 0 {
		rows = append(rows, amount(w.Fee, n.Fee))
	}
	if n.Interest != 0 && n.InterestFrom != nil {
		rows = append(rows, amount(fmt.Sprintf(w.Interest, n.InterestRate, invoicepdf.SwissDate(*n.InterestFrom),
			invoicepdf.SwissDate(n.SentOn), dunningcalc.Days(*n.InterestFrom, n.SentOn)), n.Interest))
	}
	signOff := w.SignOff
	if inv.Seller != nil {
		signOff += "\n" + inv.Seller.Name
	}
	m := mail.Message{Language: inv.Language, To: []string{n.Email}, Subject: title + ": " + strings.TrimSpace(invoices.Title(inv)+" "+number), Eyebrow: title, Tone: mail.Attention,
		Attachments: []mail.Attachment{{Name: st.letterName(n), ContentType: "application/pdf", Data: letter}}}
	if invoicePDF != nil {
		m.Attachments = append(m.Attachments, mail.Attachment{Name: invoiceName(inv), ContentType: "application/pdf", Data: invoicePDF})
	}
	if inv.Seller != nil && inv.Seller.Email != nil {
		m.ReplyTo = *inv.Seller.Email
	}
	names := []string{}
	for _, a := range m.Attachments {
		names = append(names, a.Name)
	}
	l := mail.NewLetter(inv.Language).Lead(w.Greeting).Message(sentence, number, invoicepdf.SwissDate(inv.IssueDate), invoicepdf.SwissDate(inv.DueDate)).Summary(append(rows, amount(w.Total, n.Total))...).
		Lead(w.PayWithin + " " + w.Settled).Attached(names...).SignOff(signOff)
	m.Text, m.HTML = l.Text(), l.HTML()
	return m
}

func (st state) letterName(n store.DunningNotice) string {
	_, title := st.words(n)
	return fileSafe(title + "-" + deref(st.inv.Number) + ".pdf")
}

// invoiceName matches the attachment name of POST /invoices/{id}/send.
func invoiceName(inv store.Invoice) string {
	return fileSafe(invoices.Title(inv) + "-" + deref(inv.Number) + ".pdf")
}

func fileSafe(s string) string { return strings.NewReplacer("/", "-", " ", "-").Replace(s) }

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// DigestWorkspaces: the workspaces with a notice sent in the last 24 hours.
func (s *Service) DigestWorkspaces(ctx context.Context, now time.Time) ([]store.Workspace, error) {
	return s.db.DunningDigestWorkspaces(ctx, now)
}

// DigestSection is the "Dunning" section of the engagements digest: the notices sent in the last 24 hours.
func (s *Service) DigestSection(ctx context.Context, ws store.Workspace, now time.Time) (string, []engagements.DigestLine, error) {
	rows, err := s.db.DunningDigestRows(ctx, ws.ID, now)
	if err != nil {
		return "", nil, fmt.Errorf("dunning digest rows: %w", err)
	}
	lines := make([]engagements.DigestLine, len(rows))
	for i, r := range rows {
		title := invoicepdf.LegacyReminderWords("en", r.Level, r.Levels).Title
		if r.Title != nil { // as sent: the step's name or the standard title in the invoice's language
			title = *r.Title
		}
		outcome := "sent"
		if !r.Confirmed {
			outcome = "delivery unconfirmed"
		}
		lines[i] = engagements.DigestLine{Text: fmt.Sprintf("%s %s for %s, %s: %s %s",
			title, outcome, r.Number, r.ClientName, r.Currency, r.Total.Swiss("'")),
			Path: "/invoices?id=" + url.QueryEscape(r.InvoiceID)}
	}
	return "Dunning", lines, nil
}
