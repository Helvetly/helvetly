package main

import (
	"context"
	"log/slog"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/calsync"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
)

// wireCalendars makes calendar sync (members' Google and Microsoft calendars) and the private iCal feeds, and runs
// the sync jobs when a provider is configured. Its service is internal/scheduling's Calendar.
func wireCalendars(ctx context.Context, bg *jobs, cfg config.Config, db *store.Store, a *auth.Service) *calsync.Service {
	svc := calsync.New(db, a, cfg, slog.Default())
	if svc.Enabled() {
		bg.Go(ctx, "calendar push", svc.RunPush)       // every 5 s: queued pushes of sessions to members' calendars
		bg.Go(ctx, "calendar import", svc.RunImport)   // every 30 s: due calendars' busy times and outside moves
		bg.Go(ctx, "calendar watches", svc.RunWatches) // every 10 min: change notification channels made and renewed
		bg.Go(ctx, "calendar purge", svc.RunPurge)     // daily: past busy times; Microsoft delta windows weekly
	}
	return svc
}
