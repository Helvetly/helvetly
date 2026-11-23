package scheduling

import (
	"context"
	"testing"
	"time"
)

func TestStartedSessionsKeepTheirTime(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b, "")
	path := "/api/v1/scheduling/occurrences/"
	// 2026-12-01 09:00 Zurich = 08:00 UTC, one hour long
	oneOff := func() Occurrence {
		e.at(fixedNow)
		return e.create(b, map[string]any{"client_id": c, "title": "Intro", "starts_local": "2026-12-01T09:00", "duration_minutes": 60}).Data.Occurrences[0]
	}

	tests := []struct {
		name   string
		now    time.Time
		body   map[string]any
		status int
	}{
		{"past: moved", mustTime("2026-12-02T08:00:00Z"), map[string]any{"starts_local": "2026-12-03T09:00"}, 409},
		{"in progress: longer", mustTime("2026-12-01T08:30:00Z"), map[string]any{"duration_minutes": 90}, 409},
		{"starts now: moved", mustTime("2026-12-01T08:00:00Z"), map[string]any{"starts_local": "2026-12-01T10:00"}, 409},
		{"one second before: moved", mustTime("2026-12-01T07:59:59Z"), map[string]any{"starts_local": "2026-12-01T10:00"}, 200},
		{"past: notes and same time", mustTime("2026-12-02T08:00:00Z"), map[string]any{"title": "Renamed", "starts_local": "2026-12-01T09:00", "duration_minutes": 60}, 200},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			o := oneOff()
			e.at(tc.now)
			if tc.status == 409 {
				e.fails(b, "PATCH", path+o.ID, tc.body, 409, "occurrence_started")
				if got := e.occurrence(b, o.ID); !got.StartsAt.Equal(o.StartsAt) || !got.EndsAt.Equal(o.EndsAt) {
					t.Fatalf("moved anyway: %+v", got)
				}
				return
			}
			e.do(b, "PATCH", path+o.ID, tc.body, 200, nil)
		})
	}

	t.Run("this of a series", func(t *testing.T) {
		e.at(fixedNow)
		occs := e.create(b, map[string]any{"client_id": c, "title": "Lesson", "starts_local": "2026-12-01T09:00", "duration_minutes": 60,
			"recurrence": map[string]any{"freq": "weekly", "count": 4}}).Data.Occurrences
		e.at(mustTime("2026-12-02T08:00:00Z"))
		e.fails(b, "PATCH", path+occs[0].ID, map[string]any{"scope": "this", "starts_local": "2026-12-01T11:00"}, 409, "occurrence_started")
	})

	for _, scope := range []string{"all", "following"} {
		t.Run(scope+" skips started sessions", func(t *testing.T) {
			e.at(fixedNow)
			occs := e.create(b, map[string]any{"client_id": c, "title": "Lesson", "starts_local": "2026-12-01T09:00", "duration_minutes": 60,
				"recurrence": map[string]any{"freq": "weekly", "count": 4}}).Data.Occurrences
			e.at(mustTime("2026-12-08T08:30:00Z")) // the first is past, the second in progress
			e.do(b, "PATCH", path+occs[0].ID, map[string]any{"scope": scope, "starts_local": "2026-12-01T11:00"}, 200, nil)
			for i, o := range occs {
				got := e.occurrence(b, o.ID)
				if i < 2 && (!got.StartsAt.Equal(o.StartsAt) || got.Status != "scheduled") {
					t.Fatalf("started session %d changed: %+v", i, got)
				}
				if i >= 2 && got.StartsAt.Sub(o.StartsAt) != 2*time.Hour {
					t.Fatalf("future session %d not moved: %s", i, got.StartsAt)
				}
			}
		})
	}

	t.Run("calendar move ignored", func(t *testing.T) {
		o := oneOff()
		e.at(mustTime("2026-12-01T08:30:00Z"))
		err := e.svc.MoveFromCalendar(context.Background(), b.workspace, o.ID, mustTime("2026-12-01T10:00:00Z"), mustTime("2026-12-01T11:00:00Z"), "google")
		if err != errTimeLocked {
			t.Fatalf("calendar move: %v", err)
		}
		if got := e.occurrence(b, o.ID); !got.StartsAt.Equal(o.StartsAt) {
			t.Fatalf("moved anyway: %+v", got)
		}
	})
}
