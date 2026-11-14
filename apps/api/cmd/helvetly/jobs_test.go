package main

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

// TestJobPanicRestarts: a panicking loop is restarted instead of crashing the process, and Wait returns once the
// loops have seen the cancellation.
func TestJobPanicRestarts(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	j := jobs{restartDelay: time.Millisecond}
	var runs atomic.Int32
	restarted := make(chan struct{})
	j.Go(ctx, "flaky", func(ctx context.Context) {
		if runs.Add(1) == 1 {
			panic("boom")
		}
		close(restarted)
		<-ctx.Done()
	})
	<-restarted
	cancel()
	if !j.Wait(time.Second) {
		t.Fatal("Wait timed out after cancel")
	}
}

// TestJobWaitTimesOut: a tick that ignores the cancellation does not hold the shutdown past its deadline.
func TestJobWaitTimesOut(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	j := jobs{}
	stuck := make(chan struct{})
	defer close(stuck)
	j.Go(ctx, "stuck", func(context.Context) { <-stuck })
	cancel()
	if j.Wait(10 * time.Millisecond) {
		t.Fatal("Wait returned true while a job was still running")
	}
}
