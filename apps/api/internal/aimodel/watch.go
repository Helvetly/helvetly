package aimodel

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

const (
	// blockedAlert: a pool that has refused every call this long for a reason other than its allowance (another call
	// in flight, an unfunded budget, the provider's configuration), while no instance got a call of it admitted, is
	// logged as an error for the operator, once per period.
	blockedAlert = 15 * time.Minute
	// watchIdle: a pool not refused for this long is forgotten, so workspaces that stop asking leave nothing behind.
	watchIdle = time.Hour
)

// The refusals this instance saw; whether the pool admitted calls meanwhile is read from ai_calls, so a pool busy
// with another instance's calls is never reported.
var (
	blockedMu sync.Mutex
	blocked   = map[string]*refusals{} // workspace + " " + pool
)

type refusals struct{ since, last, logged time.Time }

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

// watch notes a call's outcome for its workspace's pool: any other outcome clears it, and a blocking refusal that has
// lasted blockedAlert with no call of the pool admitted since (by any instance) is logged as an error.
func (b Budget) watch(ctx context.Context, workspaceID string, err error) {
	now, key, reason := b.Now(), workspaceID+" "+b.Pool, blocking(err)
	since, due := noteRefusal(key, reason, now)
	if !due {
		return
	}
	admitted, qerr := b.DB.AICallAdmittedSince(ctx, workspaceID, b.Pool, since)
	switch {
	case qerr != nil:
		slog.WarnContext(ctx, "check a refusing AI pool", "workspace", workspaceID, "pool", b.Pool, "error", qerr)
	case admitted: // another instance's calls hold it: the pool works, the wait starts again
		noteRefusal(key, "", now)
	default:
		slog.ErrorContext(ctx, "AI pool refusing calls", "workspace", workspaceID, "pool", b.Pool, "reason", reason,
			"since", since, "minutes", int(now.Sub(since).Minutes()), "error", err.Error())
	}
}

// noteRefusal records reason ("" clears) for key and forgets idle pools; due says the refusal has lasted blockedAlert
// and was not reported within it, and marks it reported.
func noteRefusal(key, reason string, now time.Time) (since time.Time, due bool) {
	blockedMu.Lock()
	defer blockedMu.Unlock()
	for k, r := range blocked {
		if now.Sub(r.last) >= watchIdle {
			delete(blocked, k)
		}
	}
	if reason == "" {
		delete(blocked, key)
		return time.Time{}, false
	}
	r := blocked[key]
	if r == nil {
		r = &refusals{since: now}
		blocked[key] = r
	}
	r.last = now
	if now.Sub(r.since) < blockedAlert || now.Sub(r.logged) < blockedAlert {
		return r.since, false
	}
	r.logged = now
	return r.since, true
}
