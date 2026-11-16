package billing

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// ReserveDownload holds n bytes of the workspace's monthly download allowance before a file is sent
// (storage.Meter); settle records the bytes actually sent and releases the rest, in the month it was reserved in.
// Without billing, or without a plan (a locked workspace still reads its own files), nothing is counted.
func (s *Service) ReserveDownload(ctx context.Context, workspaceID string, n int64) (func(sent int64), error) {
	noop := func(int64) {}
	if !s.enabled {
		return noop, nil
	}
	r, err := s.Entitlements(ctx, s.db.Q, workspaceID)
	if err != nil {
		return nil, err
	}
	if r.SelfHosted || r.Plan == "" {
		return noop, nil
	}
	id := "download:" + auth.NewID("dl")
	if _, err := s.db.ReserveUsage(ctx, workspaceID, store.UsageOp{Resource: string(Downloads), ID: id, Amount: n}, s.now()); err != nil {
		return nil, err
	}
	return func(sent int64) { s.settle(ctx, workspaceID, Downloads, id, sent) }, nil
}

// ReserveEmail holds a business email's recipients (To and Cc alike) in emails_per_month and its attachment bytes
// times the recipients in email_attachment_bytes_per_month, both or neither, before the SMTP send (mail.Meter). A
// message whose attachments exceed max_email_attachment_bytes is refused as too large. settle(true) records the
// whole reservation used (the server accepted the message), settle(false) releases it (it was not sent); an outcome
// that stays unknown is not settled, so it keeps counting. Emails are often sent from inside a transaction that holds
// the workspace's billing lock, so the reservation takes only the limits' own locks (store.ReserveCapped).
func (s *Service) ReserveEmail(ctx context.Context, workspaceID string, recipients, attachmentBytes int64) (func(sent bool), error) {
	noop := func(bool) {}
	if !s.enabled {
		return noop, nil
	}
	b, err := s.db.WorkspaceBilling(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	r, err := s.entitlementsOf(ctx, s.db.Q, workspaceID, b)
	if err != nil {
		return nil, err
	}
	if r.SelfHosted {
		return noop, nil
	}
	if r.Plan == "" {
		return nil, fmt.Errorf("%w: %w", store.ErrAdmissionDenied, errPlanRequired)
	}
	if max, err := r.Cap(MaxEmailAttach); err == nil && max != Unlimited && attachmentBytes > max {
		return nil, auth.Error(http.StatusUnprocessableEntity, "attachments_too_large",
			fmt.Sprintf("The attachments add up to %.1f MiB; one email can carry at most %.0f MiB. Send fewer files, or download them to send yourself.",
				float64(attachmentBytes)/(1<<20), float64(max)/(1<<20)), map[string]any{"limit": MaxEmailAttach, "max": max})
	}
	id := "email:" + auth.NewID("eml")
	attached := attachmentBytes * recipients
	var ops []store.UsageOp
	var caps []int64
	for _, l := range []Limit{EmailAttachments, Emails} { // the lock order of their keys
		amount := map[Limit]int64{EmailAttachments: attached, Emails: recipients}[l]
		if amount == 0 {
			continue
		}
		max, err := r.Cap(l)
		if err != nil {
			return nil, err
		}
		ops, caps = append(ops, store.UsageOp{Resource: string(l), ID: id, Amount: amount}), append(caps, max)
	}
	now := s.now()
	err = s.db.ReserveCapped(ctx, workspaceID, ops, caps, store.UsagePeriod(quotaStart(b, now)), now)
	var over *store.CapExceeded
	if errors.As(err, &over) {
		l := Limit(over.Resource)
		return nil, fmt.Errorf("%w: %w", store.ErrAdmissionDenied, auth.Error(http.StatusPaymentRequired, "limit_reached",
			limitMessage(r.Plan, l, over.Max), map[string]any{"limit": l, "used": over.Used, "max": over.Max, "plan": r.Plan}))
	}
	if err != nil {
		return nil, err
	}
	return func(sent bool) {
		for _, op := range ops {
			used := int64(0)
			if sent {
				used = op.Amount
			}
			s.settle(ctx, workspaceID, Limit(op.Resource), id, used)
		}
	}, nil
}

func (s *Service) settle(ctx context.Context, workspaceID string, limit Limit, id string, used int64) {
	if err := s.db.SettleUsage(context.WithoutCancel(ctx), workspaceID, string(limit), id, used, s.now()); err != nil {
		s.log.ErrorContext(ctx, "settle usage", "workspace", workspaceID, "limit", limit, "operation", id, "error", err)
	}
}

// The owner's whole-workspace export has its own small allowance (offer v2 own_data_export), apart from downloads, so
// a workspace that used its downloads can still take its data: one export at a time, one a week, four a month, of
// at most four times the larger of what it keeps and what its plan lets it keep.
const (
	snapshotResource   = "own_data_export"
	snapshotsPerMonth  = 4
	snapshotEvery      = 7 * 24 * time.Hour
	snapshotMultiplier = 4
)

// ReserveSnapshot admits one whole-workspace export (the route already requires data_export and the owner);
// settle records the bytes it sent. An export that fails before sending anything does not count. Without billing
// nothing is counted.
func (s *Service) ReserveSnapshot(ctx context.Context, workspaceID string) (func(sent int64), error) {
	noop := func(int64) {}
	if !s.enabled {
		return noop, nil
	}
	r, err := s.Entitlements(ctx, s.db.Q, workspaceID)
	if err != nil {
		return nil, err
	}
	if r.SelfHosted {
		return noop, nil
	}
	kept, err := s.db.StoredBytes(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	entitled, err := r.Cap(Storage)
	if err != nil {
		return nil, err
	}
	base := max(kept, entitled)
	id := "export:" + auth.NewID("exp")
	now := s.now()
	err = s.db.ReserveSnapshot(ctx, workspaceID, snapshotResource, id, base, now, func(h store.Snapshots) error {
		switch {
		case h.Running:
			return auth.Error(http.StatusTooManyRequests, "export_running", "An export of this workspace is already running. Wait until it finishes.", nil)
		case h.LastAt != nil:
			next := h.LastAt.Add(snapshotEvery)
			return auth.Error(http.StatusTooManyRequests, "export_weekly",
				"The whole workspace can be exported once a week. The next export is possible from "+next.Format("2 January 2006, 15:04")+" UTC.",
				map[string]any{"retry_at": next})
		case h.ThisMonth >= snapshotsPerMonth || h.Bytes+base > snapshotMultiplier*base:
			return auth.Error(http.StatusTooManyRequests, "export_monthly",
				fmt.Sprintf("The whole workspace can be exported %d times a month. The next export is possible on the 1st (UTC).", snapshotsPerMonth), nil)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return func(sent int64) { s.settle(ctx, workspaceID, snapshotResource, id, sent) }, nil
}
