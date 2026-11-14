package vatreturn

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

// remindFor: a period whose last day is this many days ago or less is still news; older ones the person has seen.
const remindFor = 7

var periodMonths = map[string]bool{"monthly": true, "quarterly": true, "half_yearly": true, "yearly": true}

// Run reminds hourly until ctx ends (like the other jobs).
func (s *Service) Run(ctx context.Context) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		if err := s.Tick(ctx, s.now()); err != nil {
			slog.Default().ErrorContext(ctx, "vat return reminders", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// Tick tells the owners and admins of each workspace with VAT return settings, once per period, that the period
// that just ended can be filed.
func (s *Service) Tick(ctx context.Context, now time.Time) error {
	list, err := s.db.VATPeriodicities(ctx)
	if err != nil {
		return fmt.Errorf("list vat settings: %w", err)
	}
	var errs []error
	for _, v := range list {
		p, ok := justEnded(v.Workspace.Today(now), v.Period)
		if !ok {
			continue
		}
		errs = append(errs, s.db.Tx(ctx, func(q store.Q) error {
			return notifications.Notify(ctx, q, v.Workspace.ID, "vat.return_due", map[string]any{"period": p.Name, "last": p.Last},
				store.NotifyTo{Roles: notifications.Managers, Once: "vat.return_due:" + p.Name}, now)
		}))
	}
	return errors.Join(errs...)
}

// justEnded: the period of this periodicity that ended last before today (a civil date), when it ended less than
// remindFor days ago.
func justEnded(today, periodicity string) (span, bool) {
	d, err := time.Parse(time.DateOnly, today)
	if _, ok := periodMonths[periodicity]; !ok || err != nil {
		return span{}, false
	}
	p, ok := parsePeriod(lastEnded(periodicity, today))
	last, _ := time.Parse(time.DateOnly, p.Last)
	return p, ok && d.Sub(last) <= remindFor*24*time.Hour
}
