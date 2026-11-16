package instalments

import (
	"context"
	"errors"
	"fmt"
	"time"

	"helvetly.com/api/internal/instalcalc"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/store"
)

// Run ticks hourly until ctx ends (like engagements.Service.Run).
func (s *Service) Run(ctx context.Context) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		if err := s.Tick(ctx, time.Now()); err != nil {
			s.log.ErrorContext(ctx, "instalments job", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// Tick is one idempotent run at now: retry the failed automatic sends, issue the due plan items, then send the due
// reminders. A failure on one item or reminder is logged and retried next run; only a failed lookup is returned.
func (s *Service) Tick(ctx context.Context, now time.Time) error {
	if err := s.retrySends(ctx, now); err != nil {
		return err
	}
	due, err := s.db.DuePlanItems(ctx, now)
	if err != nil {
		return fmt.Errorf("list due plan items: %w", err)
	}
	for _, d := range due {
		if err := guard(func() error { return s.issue(ctx, d, now) }); err != nil {
			s.log.ErrorContext(ctx, "plan item not issued", "plan", d.Plan.ID, "seq", d.Item.Seq, "error", err)
		}
	}
	targets, err := s.db.DueReminders(ctx, now)
	if err != nil {
		return fmt.Errorf("list due reminders: %w", err)
	}
	if len(targets) > 0 && s.mailer == nil {
		s.log.WarnContext(ctx, "instalment reminders not sent: no mail server", "count", len(targets))
		return nil
	}
	for _, t := range targets {
		if err := guard(func() error { return s.remind(ctx, t, now) }); err != nil {
			s.log.ErrorContext(ctx, "instalment reminder", "invoice", t.InvoiceID, "seq", t.Seq, "error", err)
		}
	}
	return nil
}

// issue issues one plan item and, with auto_send, emails it; a failed send leaves it issued and unsent (logged). Over
// the plan's invoice limit the item waits (the digest says why) until the limit allows it.
func (s *Service) issue(ctx context.Context, d store.DuePlanItem, now time.Time) error {
	// A plan waits while the workspace's plan lacks instalment plans; nothing is issued or sent.
	if on, err := s.db.FeatureAllowed(ctx, d.Workspace.ID, store.FeatureInvoiceInstalments); err != nil || !on {
		return err
	}
	if over, err := s.overLimit(ctx, d.Workspace); err != nil || over {
		if over {
			s.log.WarnContext(ctx, "plan item not issued: plan limit reached", "plan", d.Plan.ID, "seq", d.Item.Seq)
		}
		return err
	}
	inv, err := s.inv.IssuePlanItem(ctx, d.Workspace, d.Plan, d.Item)
	if errors.Is(err, invoices.ErrAlreadyIssued) {
		return nil // a concurrent run got there first
	}
	if errors.Is(err, store.ErrAdmissionDenied) {
		s.log.WarnContext(ctx, "plan item not issued: automatic actions used up", "plan", d.Plan.ID, "seq", d.Item.Seq)
		return nil // the item waits for room: a new month, more seats or a bigger plan
	}
	if err != nil || !d.Plan.AutoSend {
		return err
	}
	if err := s.sendOnce(ctx, d.Workspace, inv.ID, now); err != nil {
		s.log.WarnContext(ctx, "plan partial issued, not sent", "plan", d.Plan.ID, "invoice", inv.ID, "error", err)
	}
	return nil
}

// retrySends sends again the plan partials whose automatic send failed (store.UnsentPlanPartials). It runs before
// issuing, so a send that just failed waits for the next run.
func (s *Service) retrySends(ctx context.Context, now time.Time) error {
	if s.mailer == nil {
		return nil
	}
	unsent, err := s.db.UnsentPlanPartials(ctx, now)
	if err != nil {
		return fmt.Errorf("list unsent plan partials: %w", err)
	}
	for _, u := range unsent {
		err := guard(func() error { return s.sendOnce(ctx, u.Workspace, u.InvoiceID, now) })
		if err != nil {
			s.log.WarnContext(ctx, "plan partial still not sent", "invoice", u.InvoiceID, "error", err)
		}
	}
	return nil
}

// sendOnce sends an issued plan partial unless it was sent, under a claim, so two instances never both send it.
func (s *Service) sendOnce(ctx context.Context, ws store.Workspace, invoiceID string, now time.Time) error {
	if on, err := s.db.FeatureAllowed(ctx, ws.ID, store.FeatureInvoiceInstalments); err != nil || !on {
		return err
	}
	won, err := s.db.ClaimPlanSend(ctx, invoiceID, now)
	if err != nil || !won {
		return err
	}
	// The send is an automatic action of its own: an issued item whose send waits for room is sent, not issued again.
	action := "instalments.send:" + invoiceID
	err = s.db.ReserveAutomation(ctx, ws.ID, action, now)
	if errors.Is(err, store.ErrAdmissionDenied) {
		return s.db.ReleasePlanSend(context.WithoutCancel(ctx), invoiceID) // it waits among the unsent partials
	}
	if err == nil {
		var inv store.Invoice
		if inv, err = s.db.Invoice(ctx, ws.ID, invoiceID, ws.Today(now), false); err != nil {
			err = fmt.Errorf("load invoice: %w", err)
		} else if err = s.inv.SendIssued(ctx, ws, inv); err == nil {
			// a failed send keeps its reservation for the retry: whether the mail server took it is not known
			return s.db.SettleAutomation(context.WithoutCancel(ctx), ws.ID, action, now)
		}
	}
	if err != nil {
		if rerr := s.db.ReleasePlanSend(context.WithoutCancel(ctx), invoiceID); rerr != nil {
			return errors.Join(err, fmt.Errorf("release send claim: %w", rerr))
		}
	}
	return err
}

func (s *Service) remind(ctx context.Context, t store.ReminderTarget, now time.Time) error {
	if t.ClientEmail == "" {
		s.log.WarnContext(ctx, "instalment reminder skipped: the client has no email address", "invoice", t.InvoiceID, "seq", t.Seq)
		return nil
	}
	if on, err := s.db.FeatureAllowed(ctx, t.WorkspaceID, store.FeatureInvoiceInstalments); err != nil || !on {
		return err
	}
	inv, err := s.db.Invoice(ctx, t.WorkspaceID, t.InvoiceID, t.Today, false)
	if err != nil {
		return fmt.Errorf("load invoice: %w", err)
	}
	key := ""
	if inv.PDFKey != nil {
		key = *inv.PDFKey
	}
	pdf, err := s.files.Get(ctx, key)
	if err != nil {
		return fmt.Errorf("load invoice pdf: %w", err)
	}
	action := fmt.Sprintf("instalments.remind:%s:%d:%s:%d", t.InvoiceID, t.Seq, t.Kind, t.OffsetDays)
	if err := s.db.ReserveAutomation(ctx, t.WorkspaceID, action, now); err != nil {
		if errors.Is(err, store.ErrAdmissionDenied) {
			return nil // paused: the reminder waits for room, and is checked against the payments again then
		}
		return err
	}
	// The log row goes in first, in a transaction that rolls back when the send fails: a failed send leaves no row
	// (the next run retries), and a concurrent run waits on the row's key, then sees the conflict and sends nothing.
	sent := false
	err = s.db.Tx(ctx, func(q store.Q) error {
		// The target was listed earlier: under the invoice's lock (payments, credits and voids take it too) remind only
		// of what is open now.
		cur, err := q.Invoice(ctx, t.WorkspaceID, t.InvoiceID, t.Today, true)
		if err != nil {
			return fmt.Errorf("lock invoice: %w", err)
		}
		if t.Open = openOf(cur, t.Seq); t.Open <= 0 {
			return nil
		}
		won, err := q.LogReminder(ctx, t, now)
		if err != nil || !won {
			return err
		}
		if err := q.SettleAutomation(ctx, t.WorkspaceID, action, now); err != nil {
			return err
		}
		if err := s.mailer.Send(ctx, reminderMessage(cur, t, pdf)); err != nil {
			return fmt.Errorf("send: %w", err)
		}
		sent = true
		return nil
	})
	if err == nil && !sent { // paid since it was listed, or sent by a concurrent run
		return s.db.ReleaseAutomation(context.WithoutCancel(ctx), t.WorkspaceID, action)
	}
	return err
}

// guard turns a panic in one unit of work into an error, so one bad plan or reminder cannot stop the job.
func guard(f func() error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
		}
	}()
	return f()
}

// openOf: what is open of instalment seq of a scheduled invoice, or of a plan partial (no schedule), as DueReminders
// derives it; 0 unless the invoice is open.
func openOf(inv store.Invoice, seq int) store.Money {
	if inv.Status != "open" {
		return 0
	}
	if inv.Instalments == nil {
		return max(0, inv.Payable()-inv.AmountPaid-inv.AmountCredited)
	}
	amounts := make([]store.Money, len(inv.Instalments.Items))
	for i, it := range inv.Instalments.Items {
		amounts[i] = it.Amount
	}
	effective, paid := instalcalc.Allocate(amounts, inv.AmountCredited, inv.AmountPaid)
	for i, it := range inv.Instalments.Items {
		if it.Seq == seq {
			return effective[i] - paid[i]
		}
	}
	return 0
}
