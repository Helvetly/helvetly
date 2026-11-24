package scheduling

import (
	"context"
	"maps"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// The owner's case: a weekly series on Wednesdays 20:30 skipping days off, its first session changed on its own
// earlier, dragged from Wednesday 25 Nov to Thursday 26 Nov 20:15 for all sessions. Thursday 6 May (Ascension) and
// 27 May (Corpus Christi) 2027 are days off: those two are listed as days off (not "past the end of the series")
// with their new times, and the dragged session itself moves.
func TestSeriesMoveOwnersCase(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	path := "/api/v1/scheduling/occurrences/"
	e.do(b, "PUT", "/api/v1/scheduling/holidays", map[string]any{"days": []map[string]any{
		{"date": "2027-05-06", "name": "Ascension Day"}, {"date": "2027-05-27", "name": "Corpus Christi"}}}, 200, nil)
	series := func() []Occurrence {
		occs := e.create(b, map[string]any{"client_id": e.client(b, ""), "title": "Lesson", "host_id": b.user,
			"starts_local": "2026-11-25T20:30", "duration_minutes": 60, "skip_holidays": true,
			"recurrence": map[string]any{"freq": "weekly", "until": "2027-12-15"}}).Data.Occurrences
		occs = e.series(b, occs[0].EventID)
		// Changed on its own before: same day, then back to its time (an exception, status rescheduled).
		e.do(b, "PATCH", path+occs[0].ID, map[string]any{"scope": "this", "starts_local": "2026-11-25T20:00"}, 200, nil)
		e.do(b, "PATCH", path+occs[0].ID, map[string]any{"scope": "this", "starts_local": "2026-11-25T20:30"}, 200, nil)
		return occs
	}
	byDay := func(occs []Occurrence, day string) Occurrence {
		for _, o := range occs {
			if o.StartsAt.In(zurich).Format("2006-01-02") == day {
				return o
			}
		}
		t.Fatalf("no session on %s", day)
		return Occurrence{}
	}
	drag := map[string]any{"scope": "all", "starts_local": "2026-11-26T20:15", "duration_minutes": 60}

	occs := series()
	may5, may26 := byDay(occs, "2027-05-05"), byDay(occs, "2027-05-26")
	var preview struct{ Data MovePreview }
	e.do(b, "PATCH", path+occs[0].ID, with(maps.Clone(drag), "dry_run", true), 200, &preview)
	if len(preview.Data.Items) != 2 || preview.Data.Moving != len(occs)-2 {
		t.Fatalf("moving %d of %d, items %+v", preview.Data.Moving, len(occs), preview.Data.Items)
	}
	for i, want := range []struct{ id, to, name string }{{may5.ID, "2027-05-06T20:15", "Ascension Day"}, {may26.ID, "2027-05-27T20:15", "Corpus Christi"}} {
		it := preview.Data.Items[i]
		if it.OccurrenceID != want.id || it.Reason != reasonDayOff || it.DayOff != want.name || it.Moves || it.MovesTo == nil ||
			it.MovesTo.In(zurich).Format("2006-01-02T15:04") != want.to {
			t.Fatalf("item %d: %+v, want %+v", i, it, want)
		}
	}

	// Applied without decisions: the dragged session lands where it was dropped, the days off are skipped.
	e.do(b, "PATCH", path+occs[0].ID, drag, 200, nil)
	if got := e.occurrence(b, occs[0].ID); got.StartsAt.In(zurich).Format("2006-01-02T15:04") != "2026-11-26T20:15" || !isOpen(got.Status) {
		t.Fatalf("the dragged session did not move: %+v", got)
	}
	if got := e.occurrence(b, may5.ID); got.Status != "cancelled_on_time" {
		t.Fatalf("5 May: %+v", got)
	}
	if got := e.occurrence(b, occs[len(occs)-1].ID); got.StartsAt.In(zurich).Format("2006-01-02T15:04") != "2027-12-16T20:15" || !isOpen(got.Status) {
		t.Fatalf("the last session (the series' end moves with it): %+v", got)
	}

	// With decisions: 5 May moves onto the day off anyway, 26 May stays on Wednesday.
	occs = series()
	may5, may26 = byDay(occs, "2027-05-05"), byDay(occs, "2027-05-26")
	e.do(b, "PATCH", path+occs[0].ID, with(maps.Clone(drag), "decisions", map[string]string{may5.ID: "move_anyway", may26.ID: "keep"}), 200, nil)
	if got := e.occurrence(b, may5.ID); got.StartsAt.In(zurich).Format("2006-01-02T15:04") != "2027-05-06T20:15" || !isOpen(got.Status) || !got.IsException {
		t.Fatalf("5 May moved anyway: %+v", got)
	}
	if got := e.occurrence(b, may26.ID); !got.StartsAt.Equal(may26.StartsAt) || !isOpen(got.Status) {
		t.Fatalf("26 May kept: %+v", got)
	}
}

var zurich, _ = time.LoadLocation("Europe/Zurich")

// series are every session of the event, by start.
func (e *env) series(b *browser, eventID string) []Occurrence {
	e.t.Helper()
	rows, err := e.st.SchedOccurrences(context.Background(), b.workspace, store.SchedOccurrenceFilter{EventID: eventID})
	if err != nil {
		e.t.Fatal(err)
	}
	out := make([]Occurrence, len(rows))
	for i, o := range rows {
		out[i] = Occurrence{ID: o.ID, EventID: o.EventID, StartsAt: o.StartsAt, Status: o.Status}
	}
	return out
}

// Every decision a person can make for a listed session, applied in the same write, and the ones refused.
func TestSeriesMoveDecisions(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	path := "/api/v1/scheduling/occurrences/"
	// Tuesdays 09:00 from 1 Dec, six sessions; the third is dragged to Thursday 17 Dec 11:00 (two days later).
	occs := e.create(b, map[string]any{"client_id": e.client(b, ""), "title": "Lesson", "starts_local": "2026-12-01T09:00",
		"duration_minutes": 60, "recurrence": map[string]any{"freq": "weekly", "count": 6}}).Data.Occurrences
	e.do(b, "PATCH", path+occs[4].ID, map[string]any{"scope": "this", "starts_local": "2026-12-29T13:00"}, 200, nil)
	e.do(b, "PATCH", path+occs[1].ID, map[string]any{"scope": "this", "starts_local": "2026-12-08T15:00"}, 200, nil)
	e.do(b, "PATCH", path+occs[2].ID, map[string]any{"scope": "all", "starts_local": "2026-12-17T11:00", "duration_minutes": 60,
		"decisions": map[string]string{
			occs[0].ID: "keep", occs[1].ID: "move_to:2026-12-11T14:00:00Z", occs[3].ID: "skip", occs[4].ID: "with_series",
		}}, 200, nil)
	local := func(i int) string { return e.occurrence(b, occs[i].ID).StartsAt.In(zurich).Format("2006-01-02T15:04") }
	for i, want := range []string{"2026-12-01T09:00", "2026-12-11T15:00", "2026-12-17T11:00", "", "2026-12-31T11:00", "2027-01-07T11:00"} {
		if i == 3 {
			if got := e.occurrence(b, occs[3].ID); got.Status != "cancelled_on_time" {
				t.Fatalf("skip: %+v", got)
			}
			continue
		}
		if got := local(i); got != want {
			t.Fatalf("session %d at %s, want %s", i, got, want)
		}
	}
	if !e.occurrence(b, occs[1].ID).IsException || e.occurrence(b, occs[4].ID).IsException {
		t.Fatal("a session moved to its own time is changed on its own; one moved with the series is not")
	}

	for name, v := range map[string]string{"unknown": "later", "bad time": "move_to:tomorrow", "past": "move_to:2026-01-01T09:00:00Z",
		"extra": "keep:now"} {
		t.Run(name, func(t *testing.T) {
			e.fails(b, "PATCH", path+occs[5].ID, map[string]any{"scope": "all", "starts_local": "2027-01-08T11:00",
				"decisions": map[string]string{occs[5].ID: v}}, 422, "validation_failed")
		})
	}
}

// The last sessions made, near the 400-day horizon, still move when the series moves later: they are not cancelled
// as if past its end.
func TestSeriesMovePastTheHorizon(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	occs := e.create(b, map[string]any{"client_id": e.client(b, ""), "title": "Lesson", "starts_local": "2026-11-23T20:30",
		"duration_minutes": 60, "recurrence": map[string]any{"freq": "weekly"}}).Data.Occurrences
	occs = e.series(b, occs[0].EventID)
	last := occs[len(occs)-1]
	var preview struct{ Data MovePreview }
	e.do(b, "PATCH", "/api/v1/scheduling/occurrences/"+occs[0].ID, map[string]any{"scope": "all", "starts_local": "2026-11-24T20:30",
		"dry_run": true}, 200, &preview)
	if len(preview.Data.Items) != 0 || preview.Data.Moving != len(occs) {
		t.Fatalf("%+v", preview.Data)
	}
	e.do(b, "PATCH", "/api/v1/scheduling/occurrences/"+occs[0].ID, map[string]any{"scope": "all", "starts_local": "2026-11-24T20:30"}, 200, nil)
	if got := e.occurrence(b, last.ID); !isOpen(got.Status) || !got.StartsAt.Equal(last.StartsAt.AddDate(0, 0, 1)) {
		t.Fatalf("the last session: %+v", got)
	}
}

// The preview names what a new time overlaps: the host's own session, and the client's session with another member.
func TestSeriesMovePreviewConflicts(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	anna := e.join(b.workspace, "member", []string{"read:scheduling", "write:scheduling"})
	client := e.client(b, "")
	occs := e.create(b, map[string]any{"client_id": client, "title": "Lesson", "host_id": b.user, "starts_local": "2026-12-01T09:00",
		"duration_minutes": 60, "recurrence": map[string]any{"freq": "weekly", "count": 4}}).Data.Occurrences
	e.create(b, map[string]any{"client_id": e.client(b, ""), "title": "Strategy call", "host_id": b.user, "starts_local": "2026-12-10T11:30",
		"duration_minutes": 60})
	e.create(b, map[string]any{"client_id": client, "title": "Tax review", "host_id": anna.user, "starts_local": "2026-12-17T10:30",
		"duration_minutes": 60})
	var preview struct{ Data MovePreview }
	e.do(b, "PATCH", "/api/v1/scheduling/occurrences/"+occs[0].ID, map[string]any{"scope": "all", "starts_local": "2026-12-03T11:00",
		"dry_run": true}, 200, &preview)
	want := map[string]Conflict{occs[1].ID: {Kind: "event", Title: "Strategy call"}, occs[2].ID: {Kind: conflictClient, Title: "Tax review"}}
	if len(preview.Data.Items) != 2 {
		t.Fatalf("%+v", preview.Data.Items)
	}
	for _, it := range preview.Data.Items {
		w, ok := want[it.OccurrenceID]
		if !ok || it.Reason != reasonConflict || !it.Moves || len(it.Conflicts) != 1 || it.Conflicts[0].Kind != w.Kind || it.Conflicts[0].Title != w.Title {
			t.Fatalf("%+v", it)
		}
	}
}
