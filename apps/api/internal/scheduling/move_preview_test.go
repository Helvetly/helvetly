package scheduling

import (
	"context"
	"testing"
	"time"
)

// A series move's preview (dry_run) names every session that does not simply go along, and changes nothing.
func TestSeriesMovePreview(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	path := "/api/v1/scheduling/occurrences/"
	ctx := context.Background()
	// Tuesdays from 2026-12-01 at 09:00 Zurich (08:00Z), six sessions; the third is dragged to Thursday 17 December
	// at 11:00, so each session goes two days later.
	series := func(extra map[string]any) (string, []Occurrence) {
		e.at(fixedNow)
		c := e.client(b, "")
		body := map[string]any{"client_id": c, "title": "Lesson", "host_id": b.user, "starts_local": "2026-12-01T09:00",
			"duration_minutes": 60, "recurrence": map[string]any{"freq": "weekly", "count": 6}}
		for k, v := range extra {
			body[k] = v
		}
		return c, e.create(b, body).Data.Occurrences
	}
	drag := map[string]any{"scope": "all", "starts_local": "2026-12-17T11:00", "duration_minutes": 60, "dry_run": true}
	preview := func(t *testing.T, id string, body map[string]any) MovePreview {
		t.Helper()
		var out struct{ Data MovePreview }
		e.do(b, "PATCH", path+id, body, 200, &out)
		return out.Data
	}
	holiday := func(day string) {
		e.do(b, "PUT", "/api/v1/scheduling/holidays", map[string]any{"days": []map[string]any{{"date": day, "name": "Closed"}}}, 200, nil)
	}

	cases := []struct {
		name   string
		extra  map[string]any
		setup  func(t *testing.T, client string, occs []Occurrence)
		body   map[string]any
		target int // the session moved
		item   int // the session the reason is about
		reason string
		moves  bool
		moving int
	}{
		{name: "started", setup: func(t *testing.T, _ string, _ []Occurrence) { e.at(mustTime("2026-12-08T08:30:00Z")) },
			target: 2, item: 1, reason: reasonStarted, moving: 4},
		{name: "closed", setup: func(t *testing.T, _ string, occs []Occurrence) {
			e.at(mustTime("2026-12-08T08:30:00Z"))
			e.do(b, "POST", path+occs[1].ID+"/attendance", map[string]any{"status": "attended"}, 200, nil)
		}, target: 2, item: 1, reason: reasonClosed, moving: 4},
		{name: "changed on its own", setup: func(t *testing.T, _ string, occs []Occurrence) {
			e.do(b, "PATCH", path+occs[4].ID, map[string]any{"scope": "this", "starts_local": "2026-12-29T13:00"}, 200, nil)
		}, target: 2, item: 4, reason: reasonException, moving: 5},
		{name: "lands on a day off", setup: func(t *testing.T, _ string, _ []Occurrence) { holiday("2026-12-24") },
			target: 2, item: 3, reason: reasonDayOff, moves: true, moving: 6},
		{name: "a series skipping days off cancels it", extra: map[string]any{"skip_holidays": true},
			setup: func(t *testing.T, _ string, _ []Occurrence) { holiday("2026-12-24") }, target: 2, item: 3, reason: reasonDayOff, moving: 5},
		{name: "outside the series' end", body: map[string]any{"recurrence": map[string]any{"freq": "weekly", "by_day": []string{"TH"}, "until": "2026-12-31"}},
			target: 2, item: 5, reason: reasonOutsideSeries, moving: 5},
		{name: "client request pending", setup: func(t *testing.T, client string, occs []Occurrence) {
			if _, err := e.svc.RequestReschedule(ctx, e.ws(b), client, occs[4].ID, "", []time.Time{mustTime("2026-12-30T08:00:00Z")}, nil); err != nil {
				t.Fatal(err)
			}
		}, target: 2, item: 4, reason: reasonRequestPending, moves: true, moving: 6},
		{name: "host busy", setup: func(t *testing.T, _ string, _ []Occurrence) {
			e.create(b, map[string]any{"client_id": e.client(b, ""), "title": "Other", "host_id": b.user, "starts_local": "2026-12-24T11:00", "duration_minutes": 60})
		}, target: 2, item: 3, reason: reasonConflict, moves: true, moving: 6},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e.do(b, "PUT", "/api/v1/scheduling/holidays", map[string]any{"days": []map[string]any{}}, 200, nil)
			client, occs := series(tc.extra)
			if tc.setup != nil {
				tc.setup(t, client, occs)
			}
			body := map[string]any{}
			for k, v := range drag {
				body[k] = v
			}
			for k, v := range tc.body {
				body[k] = v
			}
			before := e.occurrence(b, occs[tc.item].ID)
			got := preview(t, occs[tc.target].ID, body)
			if got.Moving != tc.moving || len(got.Sample) == 0 {
				t.Fatalf("moving %d (sample %d), want %d", got.Moving, len(got.Sample), tc.moving)
			}
			var item *MoveItem
			for i := range got.Items {
				if got.Items[i].OccurrenceID == occs[tc.item].ID {
					item = &got.Items[i]
				}
			}
			if item == nil || item.Reason != tc.reason || item.Moves != tc.moves ||
				(item.MovesTo == nil) != (tc.reason == reasonStarted || tc.reason == reasonClosed) {
				t.Fatalf("session %d: %+v, want %s (moves %v); items %+v", tc.item, item, tc.reason, tc.moves, got.Items)
			}
			if after := e.occurrence(b, occs[tc.item].ID); !after.StartsAt.Equal(before.StartsAt) || after.Status != before.Status ||
				after.EventID != before.EventID {
				t.Fatalf("a preview changed the session: %+v", after)
			}
		})
	}

	t.Run("monthly rule", func(t *testing.T) {
		occs := e.create(b, map[string]any{"client_id": e.client(b, ""), "title": "Lesson", "starts_local": "2026-12-30T09:00",
			"duration_minutes": 60, "recurrence": map[string]any{"freq": "monthly", "by_month_day": 30, "count": 3}}).Data.Occurrences
		got := preview(t, occs[1].ID, map[string]any{"scope": "following", "starts_local": "2027-02-01T09:00", "dry_run": true})
		if got.Moving != 0 || len(got.Items) != 1 || got.Items[0].Reason != reasonMonthlyRule || got.Items[0].OccurrenceID != occs[1].ID {
			t.Fatalf("%+v", got)
		}
	})

	t.Run("one session has no preview", func(t *testing.T) {
		_, occs := series(nil)
		e.fails(b, "PATCH", path+occs[0].ID, map[string]any{"scope": "this", "starts_local": "2026-12-02T09:00", "dry_run": true}, 400, "invalid_request")
	})
}

// "Move the others": the sessions kept stay, those cancelled are cancelled, one changed on its own moves too, the rest
// move, in one write.
func TestSeriesMoveWithChoices(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	path := "/api/v1/scheduling/occurrences/"
	e.do(b, "PUT", "/api/v1/scheduling/holidays", map[string]any{"days": []map[string]any{{"date": "2026-12-24", "name": "Closed"}}}, 200, nil)
	for _, scope := range []string{"all", "following"} {
		t.Run(scope, func(t *testing.T) {
			occs := e.create(b, map[string]any{"client_id": e.client(b, ""), "title": "Lesson", "starts_local": "2026-12-01T09:00",
				"duration_minutes": 60, "recurrence": map[string]any{"freq": "weekly", "count": 6}}).Data.Occurrences
			e.do(b, "PATCH", path+occs[4].ID, map[string]any{"scope": "this", "starts_local": "2026-12-29T13:00"}, 200, nil)
			e.do(b, "PATCH", path+occs[2].ID, map[string]any{"scope": scope, "starts_local": "2026-12-17T11:00", "duration_minutes": 60,
				"decisions": map[string]string{occs[3].ID: "keep", occs[5].ID: "skip", occs[4].ID: "with_series"}}, 200, nil)
			for i, o := range occs {
				after := e.occurrence(b, o.ID)
				switch {
				case i < 2 && scope == "following", i == 3:
					if !after.StartsAt.Equal(o.StartsAt) || !isOpen(after.Status) {
						t.Fatalf("session %d should stay: %+v", i, after)
					}
				case i == 5:
					if after.Status != "cancelled_on_time" {
						t.Fatalf("session 5 should be cancelled: %+v", after)
					}
				default:
					if want := o.StartsAt.AddDate(0, 0, 2).Add(2 * time.Hour); !after.StartsAt.Equal(want) || !isOpen(after.Status) {
						t.Fatalf("session %d not moved to %s: %+v", i, want, after)
					}
				}
			}
		})
	}
	e.fails(b, "PATCH", path+"soc_x", map[string]any{"scope": "all", "decisions": []string{"soc_y"}}, 422, "validation_failed")
}
