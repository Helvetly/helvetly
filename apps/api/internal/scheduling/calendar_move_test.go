package scheduling

import (
	"context"
	"sync"
	"testing"
	"time"
)

type heard struct {
	mu sync.Mutex
	cs []Change
}

func (h *heard) Changed(_ context.Context, c Change) {
	h.mu.Lock()
	h.cs = append(h.cs, c)
	h.mu.Unlock()
}

func TestMoveFromCalendar(t *testing.T) {
	e := newEnv(t)
	h := &heard{}
	e.svc.SetNotifier(h)
	b := e.workspace()
	c := e.client(b, "anna@mueller.example")
	ctx := context.Background()
	one := e.create(b, map[string]any{"client_id": c, "title": "Intro", "starts_local": "2026-12-01T09:00", "duration_minutes": 60})
	series := e.create(b, map[string]any{"client_id": c, "title": "Weekly", "starts_local": "2026-12-02T09:00", "duration_minutes": 60,
		"recurrence": map[string]any{"freq": "weekly", "interval": 1, "count": 4}})

	tests := []struct {
		name       string
		id         string
		start, end time.Time
		exception  bool
	}{
		{"one-off", one.Data.Occurrences[0].ID, mustTime("2026-12-01T13:00:00Z"), mustTime("2026-12-01T14:30:00Z"), false},
		{"one of a series", series.Data.Occurrences[1].ID, mustTime("2026-12-10T15:00:00Z"), mustTime("2026-12-10T16:00:00Z"), true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			before := e.occurrence(b, tc.id)
			if err := e.svc.MoveFromCalendar(ctx, b.workspace, tc.id, tc.start, tc.end, "google"); err != nil {
				t.Fatal(err)
			}
			got := e.occurrence(b, tc.id)
			if !got.StartsAt.Equal(tc.start) || !got.EndsAt.Equal(tc.end) || got.Status != "rescheduled" || got.IsException != tc.exception ||
				got.Sequence != before.Sequence+1 || !got.OriginalStart.Equal(before.OriginalStart) {
				t.Fatalf("moved %+v", got)
			}
			h.mu.Lock()
			last := h.cs[len(h.cs)-1]
			h.mu.Unlock()
			if last.Kind != ChangeUpdated || last.OccurrenceIDs[0] != tc.id || !last.Notify || last.ActorID != b.user {
				t.Fatalf("told %+v", last)
			}
		})
	}
	// a one-off keeps its new time through a later edit of another field
	e.do(b, "PATCH", "/api/v1/scheduling/occurrences/"+one.Data.Occurrences[0].ID, map[string]any{"title": "Renamed"}, 200, nil)
	if got := e.occurrence(b, one.Data.Occurrences[0].ID); !got.StartsAt.Equal(tests[0].start) || !got.EndsAt.Equal(tests[0].end) {
		t.Fatalf("an edit moved it back: %+v", got)
	}
	var audited int
	if err := e.db.QueryRow(ctx, `SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'scheduling.moved_from_calendar'
		AND payload->>'source' = 'google'`, b.workspace).Scan(&audited); err != nil || audited != 2 {
		t.Fatalf("audited %d: %v", audited, err)
	}

	refused := []struct {
		name       string
		ws, id     string
		start, end time.Time
	}{
		{"too short", b.workspace, series.Data.Occurrences[2].ID, mustTime("2026-12-16T08:00:00Z"), mustTime("2026-12-16T08:02:00Z")},
		{"over 12 hours", b.workspace, series.Data.Occurrences[2].ID, mustTime("2026-12-16T08:00:00Z"), mustTime("2026-12-16T21:00:00Z")},
		{"another workspace", e.workspace().workspace, series.Data.Occurrences[2].ID, mustTime("2026-12-16T10:00:00Z"), mustTime("2026-12-16T11:00:00Z")},
	}
	for _, tc := range refused {
		if err := e.svc.MoveFromCalendar(ctx, tc.ws, tc.id, tc.start, tc.end, "microsoft"); err == nil {
			t.Errorf("%s: moved", tc.name)
		}
	}
	e.do(b, "POST", "/api/v1/scheduling/occurrences/"+series.Data.Occurrences[3].ID+"/cancel", map[string]any{"scope": "this", "notify": false}, 200, nil)
	if err := e.svc.MoveFromCalendar(ctx, b.workspace, series.Data.Occurrences[3].ID, mustTime("2026-12-23T10:00:00Z"),
		mustTime("2026-12-23T11:00:00Z"), "google"); err == nil {
		t.Fatal("a cancelled session was moved")
	}
}
