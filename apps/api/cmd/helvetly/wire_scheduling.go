package main

import (
	"context"
	"log/slog"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/scheduling"
	"helvetly.com/api/internal/store"
)

// wireScheduling makes the Scheduling service with its emails (m nil: no mail server, only the bell) and runs its
// jobs. Calendar sync attaches through SetCalendar.
func wireScheduling(ctx context.Context, bg *jobs, db *store.Store, a *auth.Service, inv scheduling.Invoices, m scheduling.Mailer,
	portal scheduling.PortalURLs, brands func(context.Context, string) (mail.Brand, error), cfg config.Config) *scheduling.Service {
	svc := scheduling.New(db, a, inv, cfg.SecretKey, cfg.PublicURL, cfg.PortalURL, slog.Default())
	emails := scheduling.NewEmails(svc, m, portal, brands)
	svc.SetNotifier(emails)
	bg.Go(ctx, "scheduling reminders", emails.RunReminders)  // every minute: due reminders to clients and hosts
	bg.Go(ctx, "scheduling series", svc.RunMaterialise)      // hourly: series extended to 400 days ahead; old history purged
	bg.Go(ctx, "scheduling attendance", svc.RunAutoAttend)   // every 15 min: ended sessions marked attended where asked
	bg.Go(ctx, "scheduling requests", svc.RunExpireRequests) // every 5 min: open requests of started sessions expire
	return svc
}
