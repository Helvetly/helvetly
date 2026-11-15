package delivery

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

const (
	lease       = 10 * time.Minute // a claimed transmission is left to its job this long
	margin      = time.Minute      // sends end this long before the lease, so a reclaim never overlaps one
	batch       = 50
	maxAttempts = 8 // 1+2+…+64 ≈ 2 hours of backoff before a transmission is marked failed
)

// Run ticks every minute until ctx ends.
func (s *Service) Run(ctx context.Context) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		if err := s.Tick(ctx, s.now()); err != nil {
			s.log.ErrorContext(ctx, "transmission job", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// Tick sends every due queued transmission once, batch by batch; claims make concurrent instances skip each other's.
// Every claim of this tick leases until now+lease, so sends stop (and a running one is cancelled) before then:
// what is left stays queued and is reclaimed once the lease ends, never sent by two instances at once.
func (s *Service) Tick(ctx context.Context, now time.Time) error {
	sends, cancel := context.WithDeadline(ctx, now.Add(lease-margin))
	defer cancel()
	for sends.Err() == nil {
		due, err := s.db.ClaimTransmissions(ctx, now, lease, batch)
		if err != nil {
			return err
		}
		for _, t := range due {
			if sends.Err() != nil {
				return nil
			}
			s.send(ctx, sends, t, now)
		}
		if len(due) < batch {
			return nil
		}
	}
	return nil
}

// backoff: a minute after the first failure, doubling.
func backoff(attempts int) time.Duration { return time.Minute << min(attempts-1, 12) }

// send attempts t within the lease (sends) and records the outcome with ctx, which the lease does not cancel.
func (s *Service) send(ctx, sends context.Context, t store.Transmission, now time.Time) {
	res, err := s.attempt(sends, t)
	if err == nil {
		var ext *string
		if res.ExternalID != "" {
			ext = &res.ExternalID
		}
		event, data := "einvoice.delivered", map[string]any(nil)
		var reason *string
		if res.Status == "rejected" {
			event = "einvoice.delivery_failed"
			if res.Reason != "" {
				reason, data = &res.Reason, map[string]any{"reason": res.Reason}
			}
		}
		err = s.db.Tx(ctx, func(q store.Q) error {
			if err := q.TransmissionDone(ctx, t, res.Status, ext, reason, now); err != nil {
				return err
			}
			return s.notify(ctx, q, t, event, data, now)
		})
		if errors.Is(err, store.ErrStaleClaim) {
			s.log.WarnContext(ctx, "transmission outcome after its claim ended", "transmission", t.ID, "status", res.Status)
		} else if err != nil {
			s.log.ErrorContext(ctx, "record transmission", "transmission", t.ID, "error", err)
		}
		return
	}
	var retry *time.Time
	if next := now.Add(backoff(t.Attempts)); !errors.As(err, &Permanent{}) && t.Attempts < maxAttempts {
		retry = &next
	}
	// only the channel's message is logged and stored, never the credentials it was given
	s.log.WarnContext(ctx, "transmission failed", "transmission", t.ID, "channel", t.Channel, "attempts", t.Attempts,
		"retry", retry != nil, "error", err)
	reason := err.Error()
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.TransmissionFailed(ctx, t, reason, retry, now); err != nil || retry != nil {
			return err
		}
		return s.notify(ctx, q, t, "einvoice.delivery_failed", map[string]any{"reason": reason}, now)
	})
	if errors.Is(err, store.ErrStaleClaim) {
		s.log.WarnContext(ctx, "transmission failure after its claim ended", "transmission", t.ID)
	} else if err != nil {
		s.log.ErrorContext(ctx, "record transmission failure", "transmission", t.ID, "error", err)
	}
}

// notify tells the workspace's managers how a transmission ended.
func (s *Service) notify(ctx context.Context, q store.Q, t store.Transmission, event string, data map[string]any, now time.Time) error {
	number, err := q.TransmissionInvoiceNumber(ctx, t.WorkspaceID, t.InvoiceID)
	if err != nil {
		return err
	}
	if data == nil {
		data = map[string]any{}
	}
	data["invoice_id"], data["number"], data["channel"] = t.InvoiceID, number, t.Channel
	return notifications.Notify(ctx, q, t.WorkspaceID, event, data, store.NotifyTo{Roles: notifications.Managers}, now)
}

func (s *Service) attempt(ctx context.Context, t store.Transmission) (Result, error) {
	c := s.channel(t.Channel)
	if c == nil {
		return Result{}, Permanent{fmt.Errorf("channel %q is not offered by this server", t.Channel)}
	}
	// queued on a plan with XML; after a downgrade it ends with the reason, and Retry on a plan with XML sends it
	if err := s.db.RequireFeature(ctx, t.WorkspaceID, store.FeatureEInvoiceXML); err != nil {
		if errors.Is(err, store.ErrFeatureDenied) {
			err = Permanent{err}
		}
		return Result{}, err
	}
	ws, err := s.db.AdmissionWorkspace(ctx, t.WorkspaceID)
	if err != nil {
		return Result{}, fmt.Errorf("load workspace: %w", err)
	}
	inv, err := s.db.Invoice(ctx, ws.ID, t.InvoiceID, ws.Today(s.now()), false)
	if err != nil {
		return Result{}, fmt.Errorf("load invoice: %w", err)
	}
	// the job acts for the workspace, not a person: the archive records no actor
	name, xml, err := s.export(ctx, store.Session{Workspace: ws}, inv, t.Format)
	if err != nil {
		err = fmt.Errorf("e-invoice XML: %w", err)
		// the XML's own refusals (4xx) stay until the invoice changes; an outage producing it is retried
		if status, _, _, ok := auth.Describe(err); ok && status < http.StatusInternalServerError {
			err = Permanent{err}
		}
		return Result{}, err
	}
	var credentials []byte
	if c.NeedsCredentials() {
		sealed, err := s.db.TransmissionCredentials(ctx, ws.ID, c.Name())
		if err != nil {
			return Result{}, Permanent{fmt.Errorf("channel credentials: %w", err)}
		}
		if credentials, err = s.sealer.open(ws.ID, c.Name(), sealed); err != nil {
			return Result{}, Permanent{errors.New("channel credentials cannot be opened: set them again")}
		}
	}
	res, err := c.Send(ctx, Document{TransmissionID: t.ID, WorkspaceID: ws.ID, InvoiceID: inv.ID, Format: t.Format, Filename: name, XML: xml}, credentials)
	if err == nil && res.Status != "sent" && res.Status != "accepted" && res.Status != "rejected" {
		err = Permanent{fmt.Errorf("channel answered status %q", res.Status)}
	}
	return res, err
}
