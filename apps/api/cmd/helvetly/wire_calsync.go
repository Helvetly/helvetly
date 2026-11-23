package main

import (
	"context"

	"helvetly.com/api/internal/calsync"
)

// runCalendars connects calendar sync (members' Google and Microsoft calendars, the private iCal feeds) to the
// scheduling service, then runs the sync jobs when a provider is configured.
func runCalendars(ctx context.Context, bg *jobs, svc *calsync.Service, mover calsync.Mover) {
	svc.SetMover(mover) // a pushed session moved in the host's calendar is the host's reschedule
	if svc.Enabled() {
		bg.Go(ctx, "calendar push", svc.RunPush)       // every 5 s: queued pushes of sessions to members' calendars
		bg.Go(ctx, "calendar import", svc.RunImport)   // every 30 s: due calendars' busy times and outside moves
		bg.Go(ctx, "calendar watches", svc.RunWatches) // every 10 min: change notification channels made and renewed
		bg.Go(ctx, "calendar purge", svc.RunPurge)     // daily: past busy times; Microsoft delta windows weekly
	}
}
