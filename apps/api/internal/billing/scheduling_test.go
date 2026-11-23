package billing

import (
	"context"
	"fmt"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// TestScheduledEventsAdmission: creating an event counts in scheduled_events_per_month through ConsumeUsage. Basic
// has no scheduling, Pro schedules 100 events a month, Business has no cap.
func TestScheduledEventsAdmission(t *testing.T) {
	ctx := context.Background()
	e := usageEnv(t)
	b := e.workspace()
	ws := b.workspace
	e.exec(`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at) VALUES ('cli_1', $1, 1, 'Client', now(), now())`, ws)
	n := 0
	create := func() error {
		n++
		now := time.Now()
		return e.st.CreateSchedEvent(ctx, store.SchedEvent{ID: fmt.Sprintf("sev_%d", n), WorkspaceID: ws,
			ClientID: "cli_1", Title: "Lesson", Mode: "live", TimeZone: "UTC", StartsLocal: now, DurationMinutes: 60, CreatedAt: now, UpdatedAt: now})
	}
	e.subscribe(ws, "price_bm")
	if err := create(); !denied(err) {
		t.Fatalf("Basic scheduled an event: %v", err)
	}
	e.subscribe(ws, "price_pm")
	if got := e.cap(ws, ScheduledEvents); got != 100 {
		t.Fatalf("Pro's %s is %d, the offer sells 100", ScheduledEvents, got)
	}
	e.exec(`INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period, reserved, consumed, created_at, settled_at)
		SELECT $1, $2, 'seed' || i, '', $3, 0, 1, now(), now() FROM generate_series(1, 99) AS i`,
		ws, string(ScheduledEvents), store.UsagePeriod(time.Now()))
	if err := create(); err != nil {
		t.Fatalf("the 100th event: %v", err)
	}
	if err := create(); !denied(err) {
		t.Fatalf("the 101st event: %v", err)
	}
	e.subscribe(ws, "price_xm")
	for range 3 {
		if err := create(); err != nil {
			t.Fatalf("Business over 100: %v", err)
		}
	}
	if got := e.usedIn(ws, ScheduledEvents, time.Now()); got != 103 {
		t.Fatalf("used %d", got)
	}
}
