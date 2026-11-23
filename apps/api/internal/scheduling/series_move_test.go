package scheduling

import (
	"slices"
	"testing"
	"time"
)

// The week view's drag sends the new wall-clock start and the length, nothing else (useSessionChange.move).
func TestSeriesMoveToAnotherDay(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	var c string
	path := "/api/v1/scheduling/occurrences/"
	// Tuesdays from 2026-12-01 at 09:00 Zurich (08:00Z), six sessions.
	series := func() []Occurrence { // each on its own client, so the counts below are its own
		e.at(fixedNow)
		c = e.client(b, "")
		return e.create(b, map[string]any{"client_id": c, "title": "Lesson", "starts_local": "2026-12-01T09:00", "duration_minutes": 60,
			"recurrence": map[string]any{"freq": "weekly", "count": 6}}).Data.Occurrences
	}
	// The third session, Tuesday 15 December, dragged to Thursday 17 December at 11:00.
	drag := func(scope string) map[string]any {
		return map[string]any{"scope": scope, "starts_local": "2026-12-17T11:00", "duration_minutes": 60}
	}
	event := func(id string) Event {
		var out struct{ Data Event }
		e.do(b, "GET", "/api/v1/scheduling/events/"+id, nil, 200, &out)
		return out.Data
	}
	movedTwoDays := func(t *testing.T, before, after Occurrence) {
		t.Helper()
		want := before.StartsAt.AddDate(0, 0, 2).Add(2 * time.Hour)
		if !after.StartsAt.Equal(want) || !isOpen(after.Status) || after.EndsAt.Sub(after.StartsAt) != time.Hour {
			t.Fatalf("%s not moved to %s: %+v", before.ID, want, after)
		}
	}

	t.Run("following", func(t *testing.T) {
		occs := series()
		var out struct{ Data Occurrence }
		e.do(b, "PATCH", path+occs[2].ID, drag("following"), 200, &out)
		got := out.Data
		if got.ID != occs[2].ID || !got.StartsAt.Equal(mustTime("2026-12-17T10:00:00Z")) {
			t.Fatalf("dragged session: %+v", got)
		}
		fresh := event(got.EventID)
		if r := fresh.Recurrence; r == nil || !slices.Equal(r.ByDay, []string{"TH"}) || r.Count != 4 || fresh.StartsLocal != "2026-12-17T11:00" {
			t.Fatalf("new series: %+v %+v", fresh, fresh.Recurrence)
		}
		for i, o := range occs {
			after := e.occurrence(b, o.ID)
			if i < 2 {
				if after.EventID != o.EventID || !after.StartsAt.Equal(o.StartsAt) {
					t.Fatalf("earlier session %d changed: %+v", i, after)
				}
				continue
			}
			if after.EventID != got.EventID {
				t.Fatalf("session %d stayed in the old series", i)
			}
			movedTwoDays(t, o, after)
		}
		if n := len(e.list(b, "from=2026-11-30T00:00:00Z&to=2027-02-28T00:00:00Z&client_id="+c+"&status=scheduled,rescheduled")); n != 6 {
			t.Fatalf("open sessions: %d, want 6", n)
		}
	})

	t.Run("all", func(t *testing.T) {
		occs := series()
		var out struct {
			Data    Occurrence
			Details map[string]int
		}
		e.do(b, "PATCH", path+occs[2].ID, drag("all"), 200, &out)
		ev := event(occs[0].EventID)
		if r := ev.Recurrence; r == nil || !slices.Equal(r.ByDay, []string{"TH"}) || r.Count != 6 || ev.StartsLocal != "2026-12-03T11:00" {
			t.Fatalf("series: %+v %+v", ev, ev.Recurrence)
		}
		for _, o := range occs {
			movedTwoDays(t, o, e.occurrence(b, o.ID))
		}
		if n := len(e.list(b, "from=2026-11-30T00:00:00Z&to=2027-02-28T00:00:00Z&client_id="+c+"&status=scheduled,rescheduled")); n != 6 {
			t.Fatalf("open sessions: %d, want 6", n)
		}
	})

	t.Run("all skips started sessions", func(t *testing.T) {
		occs := series()
		e.at(mustTime("2026-12-08T08:30:00Z")) // the first is past, the second in progress
		e.do(b, "PATCH", path+occs[2].ID, drag("all"), 200, nil)
		for i, o := range occs {
			after := e.occurrence(b, o.ID)
			if i < 2 {
				if !after.StartsAt.Equal(o.StartsAt) || after.Status != "scheduled" {
					t.Fatalf("started session %d changed: %+v", i, after)
				}
				continue
			}
			movedTwoDays(t, o, after)
		}
		// No second session in the started sessions' weeks.
		if l := e.list(b, "from=2026-11-30T00:00:00Z&to=2027-02-28T00:00:00Z&client_id="+c+"&status=scheduled,rescheduled"); len(l) != 6 {
			for _, o := range l {
				t.Log(o.ID, o.StartsAt)
			}
			t.Fatalf("open sessions: %d, want 6", len(l))
		}
	})

	t.Run("earlier day, following", func(t *testing.T) {
		occs := series()
		e.do(b, "PATCH", path+occs[2].ID, map[string]any{"scope": "following", "starts_local": "2026-12-14T09:00", "duration_minutes": 60}, 200, nil)
		for i := 2; i < 6; i++ {
			if after := e.occurrence(b, occs[i].ID); !after.StartsAt.Equal(occs[i].StartsAt.AddDate(0, 0, -1)) || !isOpen(after.Status) {
				t.Fatalf("session %d: %+v", i, after)
			}
		}
	})
}
