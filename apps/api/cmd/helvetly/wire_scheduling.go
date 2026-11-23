package main

import (
	"log/slog"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/scheduling"
	"helvetly.com/api/internal/store"
)

// wireScheduling makes the Scheduling service. Emails, jobs (PR 4) and calendar sync (PR 5) attach here through
// SetNotifier and SetCalendar; until then nothing is pushed or emailed.
func wireScheduling(db *store.Store, a *auth.Service, inv scheduling.Invoices, cfg config.Config) *scheduling.Service {
	return scheduling.New(db, a, inv, cfg.SecretKey, cfg.PublicURL, cfg.PortalURL, slog.Default())
}
