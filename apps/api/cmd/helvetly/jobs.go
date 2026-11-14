package main

import (
	"context"
	"log/slog"
	"runtime/debug"
	"sync"
	"time"
)

// jobs runs the background loops. A panic is logged and the loop restarted after restartDelay instead of taking the
// API down with it, and Wait lets ticks in flight finish before the pool closes and the process exits.
type jobs struct {
	wg           sync.WaitGroup
	restartDelay time.Duration
}

func (j *jobs) Go(ctx context.Context, name string, run func(context.Context)) {
	j.wg.Go(func() {
		for runRecovered(ctx, name, run) {
			select {
			case <-ctx.Done():
				return
			case <-time.After(j.restartDelay):
			}
		}
	})
}

// runRecovered reports whether run panicked; a loop that returns did so because ctx ended.
func runRecovered(ctx context.Context, name string, run func(context.Context)) (panicked bool) {
	defer func() {
		if v := recover(); v != nil {
			slog.Error("background job panicked; restarting", "job", name, "panic", v, "stack", string(debug.Stack()))
			panicked = true
		}
	}()
	run(ctx)
	return false
}

// Wait reports whether every loop stopped within timeout.
func (j *jobs) Wait(timeout time.Duration) bool {
	done := make(chan struct{})
	go func() { j.wg.Wait(); close(done) }()
	select {
	case <-done:
		return true
	case <-time.After(timeout):
		return false
	}
}
