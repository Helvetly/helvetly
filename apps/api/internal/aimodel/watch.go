package aimodel

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

// blockedAlert: a pool that has refused every call this long for a reason other than its allowance (another call in
// flight, an unfunded budget, the provider's configuration) is logged as an error for the operator, once per period.
const blockedAlert = 15 * time.Minute

// shortcut: kept in this process's memory, so each instance alerts on the refusals it sees; a shared record is due if
// alerts must survive restarts.
var (
	blockedMu sync.Mutex
	blocked   = map[string]*refusals{} // workspace + " " + pool
)

type refusals struct{ since, logged time.Time }

// blocking says err refuses the pool for a cause that is neither its allowance nor this call alone: one an operator
// may have to look at when it lasts.
func blocking(err error) string {
	switch {
	case errors.Is(err, ErrUncertain):
		return "in_flight"
	case errors.Is(err, ErrUnfunded):
		return "unfunded"
	case FailureKind(err) == FailConfig:
		return FailConfig
	}
	return ""
}

// watchRefusal notes a call's outcome for its workspace's pool: any other outcome clears it, and a blocking refusal
// that has lasted blockedAlert is logged as an error.
func watchRefusal(ctx context.Context, workspaceID, pool string, err error, now time.Time) {
	key := workspaceID + " " + pool
	reason := blocking(err)
	blockedMu.Lock()
	defer blockedMu.Unlock()
	if reason == "" {
		delete(blocked, key)
		return
	}
	r := blocked[key]
	if r == nil {
		r = &refusals{since: now}
		blocked[key] = r
	}
	if now.Sub(r.since) < blockedAlert || now.Sub(r.logged) < blockedAlert {
		return
	}
	r.logged = now
	slog.ErrorContext(ctx, "AI pool refusing calls", "workspace", workspaceID, "pool", pool, "reason", reason,
		"since", r.since, "minutes", int(now.Sub(r.since).Minutes()), "error", err.Error())
}
