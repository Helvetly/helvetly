package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func schedEvent(id, typeID string) store.SchedEvent {
	e := store.SchedEvent{ID: id, WorkspaceID: "wsp_a", ClientID: "cli_a", HostUserID: ptr("usr_h"), Title: "Lesson", Mode: "live",
		TimeZone: "Europe/Zurich", StartsLocal: time.Date(2026, 12, 1, 9, 0, 0, 0, time.UTC), DurationMinutes: 60,
		Attendees: []string{"a@x.ch"}, CreatedAt: t0, UpdatedAt: t0}
	if typeID != "" {
		e.EventTypeID = &typeID
	}
	return e
}

func slot(id string, start time.Time) store.SchedSlot {
	return store.SchedSlot{ID: id, OriginalStart: start, StartsAt: start, EndsAt: start.Add(time.Hour)}
}

func TestCreateSchedEventCountsOnceInTheMonth(t *testing.T) {
	s := seedScheduling(t)
	s.SetAdmission(capOf(1, func() time.Time { return t0 }))
	ctx := context.Background()
	series := schedEvent("sev_1", "")
	series.RRule, series.Count = ptr("FREQ=WEEKLY;COUNT=10"), ptr(10)
	if err := s.CreateSchedEvent(ctx, series); err != nil {
		t.Fatal(err)
	}
	got, err := s.SchedEvent(ctx, "wsp_a", "sev_1", false)
	if err != nil || *got.RRule != "FREQ=WEEKLY;COUNT=10" || got.StartsLocal.Hour() != 9 || got.UntilDate != nil || got.Attendees[0] != "a@x.ch" {
		t.Fatalf("%+v %v", got, err)
	}
	if err := s.CreateSchedEvent(ctx, schedEvent("sev_2", "")); !errors.Is(err, store.ErrAdmissionDenied) {
		t.Fatalf("over the cap: %v", err)
	}
	if _, err := s.SchedEvent(ctx, "wsp_a", "sev_2", false); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("a refused event was stored: %v", err)
	}
	// a split's new half counts nothing
	if err := s.InsertSchedEvent(ctx, schedEvent("sev_3", "")); err != nil {
		t.Fatal(err)
	}
	if u, err := s.UsageInPeriods(ctx, "wsp_a", store.ScheduledEvents, store.UsagePeriod(t0), store.UsagePeriod(t0)); err != nil || u.Total() != 1 {
		t.Fatalf("usage %+v %v", u, err)
	}
	got.Title, got.Sequence, got.UntilDate, got.Count = "Renamed", 1, ptr("2027-06-30"), nil
	if err := s.SaveSchedEvent(ctx, got); err != nil {
		t.Fatal(err)
	}
	if saved, _ := s.SchedEvent(ctx, "wsp_a", "sev_1", false); saved.Title != "Renamed" || *saved.UntilDate != "2027-06-30" || saved.Sequence != 1 {
		t.Fatalf("saved %+v", saved)
	}
	got.WorkspaceID = "wsp_b"
	if err := s.SaveSchedEvent(ctx, got); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("saved through another workspace: %v", err)
	}
	if _, err := s.SchedEvent(ctx, "wsp_b", "sev_1", false); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("read through another workspace: %v", err)
	}
	bad := schedEvent("sev_4", "")
	bad.UntilDate, bad.Count, bad.RRule = ptr("2027-01-01"), ptr(3), ptr("FREQ=WEEKLY")
	if err := s.InsertSchedEvent(ctx, bad); err == nil {
		t.Fatal("an event with both until and count was stored")
	}
}

func TestMaterialiseOccurrencesIsIdempotent(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	if err := s.CreateSchedEvent(ctx, schedEvent("sev_1", "")); err != nil {
		t.Fatal(err)
	}
	d0 := time.Date(2026, 12, 1, 8, 0, 0, 0, time.UTC)
	week := 7 * 24 * time.Hour
	until := d0.Add(2 * week)
	n, err := s.MaterialiseOccurrences(ctx, "wsp_a", "sev_1", []store.SchedSlot{slot("soc_1", d0), slot("soc_2", d0.Add(week))},
		store.SchedScheduled, &until, t0)
	if err != nil || n != 2 {
		t.Fatalf("added %d: %v", n, err)
	}
	// the same slots again under new ids add only the new one
	until = d0.Add(3 * week)
	n, err = s.MaterialiseOccurrences(ctx, "wsp_a", "sev_1", []store.SchedSlot{slot("soc_x", d0), slot("soc_y", d0.Add(week)),
		slot("soc_3", d0.Add(2*week))}, store.SchedScheduled, &until, t0)
	if err != nil || n != 1 {
		t.Fatalf("again: added %d: %v", n, err)
	}
	if e, _ := s.SchedEvent(ctx, "wsp_a", "sev_1", false); e.MaterialisedUntil == nil || !e.MaterialisedUntil.Equal(until) {
		t.Fatalf("materialised until %v", e.MaterialisedUntil)
	}
	list, err := s.SchedOccurrences(ctx, "wsp_a", store.SchedOccurrenceFilter{EventID: "sev_1"})
	if err != nil || len(list) != 3 || list[0].ID != "soc_1" || list[2].ID != "soc_3" || *list[0].HostUserID != "usr_h" ||
		list[0].ClientID != "cli_a" || list[0].Status != store.SchedScheduled || !list[0].TimedAt.Equal(t0) {
		t.Fatalf("%+v %v", list, err)
	}
	if _, err := s.MaterialiseOccurrences(ctx, "wsp_b", "sev_1", []store.SchedSlot{slot("soc_9", d0.Add(9*week))}, store.SchedScheduled,
		&until, t0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("materialised through another workspace: %v", err)
	}
	long := store.SchedSlot{ID: "soc_long", OriginalStart: d0.Add(5 * week), StartsAt: d0.Add(5 * week), EndsAt: d0.Add(5*week + 25*time.Hour)}
	if _, err := s.MaterialiseOccurrences(ctx, "wsp_a", "sev_1", []store.SchedSlot{long}, store.SchedScheduled, nil, t0); err == nil {
		t.Fatal("an occurrence over 24 hours was stored")
	}
}

func TestOccurrenceFiltersAndHostSessions(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	for _, id := range []string{"sev_1", "sev_2"} {
		if err := s.CreateSchedEvent(ctx, schedEvent(id, "")); err != nil {
			t.Fatal(err)
		}
	}
	other := schedEvent("sev_o", "")
	other.HostUserID = ptr("usr_o")
	if err := s.CreateSchedEvent(ctx, other); err != nil {
		t.Fatal(err)
	}
	day := time.Date(2026, 12, 2, 0, 0, 0, 0, time.UTC)
	long := store.SchedSlot{ID: "soc_night", OriginalStart: day.Add(-23 * time.Hour), StartsAt: day.Add(-23 * time.Hour), EndsAt: day.Add(30 * time.Minute)}
	for _, m := range []struct {
		event string
		slots []store.SchedSlot
	}{
		{"sev_1", []store.SchedSlot{long, slot("soc_morning", day.Add(9*time.Hour)), slot("soc_before", day.Add(-2*time.Hour))}},
		{"sev_2", []store.SchedSlot{slot("soc_cancelled", day.Add(10*time.Hour))}},
		{"sev_o", []store.SchedSlot{slot("soc_other", day.Add(9*time.Hour))}},
	} {
		if _, err := s.MaterialiseOccurrences(ctx, "wsp_a", m.event, m.slots, store.SchedScheduled, nil, t0); err != nil {
			t.Fatal(err)
		}
	}
	cancelled, _ := s.SchedOccurrence(ctx, "wsp_a", "soc_cancelled", false)
	cancelled.Status = store.SchedCancelledOnTime
	if err := s.SaveSchedOccurrence(ctx, cancelled); err != nil {
		t.Fatal(err)
	}
	ids := func(list []store.SchedOccurrence) []string {
		out := []string{}
		for _, o := range list {
			out = append(out, o.ID)
		}
		return out
	}
	sessions, err := s.HostSessions(ctx, "wsp_a", []string{"usr_h"}, day, day.Add(24*time.Hour))
	if got := ids(sessions); err != nil || len(got) != 2 || got[0] != "soc_night" || got[1] != "soc_morning" {
		t.Fatalf("host sessions %v %v", got, err)
	}
	if got, _ := s.HostSessions(ctx, "wsp_b", []string{"usr_h"}, day, day.Add(24*time.Hour)); len(got) != 0 {
		t.Fatalf("another workspace's sessions: %v", ids(got))
	}
	from, to := day, day.Add(24*time.Hour)
	list, _ := s.SchedOccurrences(ctx, "wsp_a", store.SchedOccurrenceFilter{From: &from, To: &to, HostIDs: []string{"usr_h", "usr_o"}})
	if got := ids(list); len(got) != 3 || got[2] != "soc_cancelled" {
		t.Fatalf("by range and hosts %v", got)
	}
	list, _ = s.SchedOccurrences(ctx, "wsp_a", store.SchedOccurrenceFilter{Statuses: []string{store.SchedCancelledOnTime}, ClientID: "cli_a"})
	if got := ids(list); len(got) != 1 || got[0] != "soc_cancelled" {
		t.Fatalf("by status %v", got)
	}
	if list, _ := s.SchedOccurrences(ctx, "wsp_b", store.SchedOccurrenceFilter{}); len(list) != 0 {
		t.Fatalf("another workspace lists %v", ids(list))
	}
}

// TestSplitKeepsOccurrenceIDs: "following" moves future rows to the new event with their ids, so their requests and
// entries stay attached.
func TestSplitKeepsOccurrenceIDs(t *testing.T) {
	s := seedScheduling(t)
	seedPeriod(t, s)
	ctx := context.Background()
	if err := s.CreateSchedEvent(ctx, schedEvent("sev_1", "")); err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 12, 8, 8, 0, 0, 0, time.UTC)
	if _, err := s.MaterialiseOccurrences(ctx, "wsp_a", "sev_1", []store.SchedSlot{slot("soc_1", start)}, store.SchedScheduled, nil, t0); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSchedRequest(ctx, store.SchedRequest{ID: "srq_1", WorkspaceID: "wsp_a", OccurrenceID: "soc_1", ClientID: "cli_a",
		Kind: "cancel", Status: "pending", CreatedAt: t0}); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertSchedEvent(ctx, schedEvent("sev_2", "")); err != nil {
		t.Fatal(err)
	}
	o, _ := s.SchedOccurrence(ctx, "wsp_a", "soc_1", true)
	o.EventID, o.OriginalStart, o.StartsAt, o.EndsAt, o.Sequence = "sev_2", start.Add(time.Hour), start.Add(time.Hour), start.Add(2*time.Hour), 1
	if err := s.SaveSchedOccurrence(ctx, o); err != nil {
		t.Fatal(err)
	}
	moved, err := s.SchedOccurrence(ctx, "wsp_a", "soc_1", false)
	if err != nil || moved.EventID != "sev_2" || !moved.StartsAt.Equal(start.Add(time.Hour)) || moved.Sequence != 1 {
		t.Fatalf("%+v %v", moved, err)
	}
	if r, err := s.OpenSchedRequest(ctx, "wsp_a", "soc_1"); err != nil || r.ID != "srq_1" {
		t.Fatalf("request after the split: %+v %v", r, err)
	}
	o.WorkspaceID = "wsp_b"
	if err := s.SaveSchedOccurrence(ctx, o); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("saved through another workspace: %v", err)
	}
	// engagement entries: linked once per reason, unlinked by reason, gone with the entry
	if err := s.CreateEntry(ctx, "eng_1", entry("ent_1", "2026-02-01", 1000), t0); err != nil {
		t.Fatal(err)
	}
	if err := s.LinkSchedEntry(ctx, "soc_1", "ent_1", "attended"); err != nil {
		t.Fatal(err)
	}
	if links, err := s.SchedEntryLinks(ctx, "soc_1"); err != nil || len(links) != 1 || links[0] != (store.SchedEntryLink{EntryID: "ent_1", Reason: "attended"}) {
		t.Fatalf("%+v %v", links, err)
	}
	if id, err := s.UnlinkSchedEntry(ctx, "soc_1", "attended"); err != nil || id != "ent_1" {
		t.Fatalf("unlink %q %v", id, err)
	}
	if _, err := s.UnlinkSchedEntry(ctx, "soc_1", "attended"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("second unlink: %v", err)
	}
	if err := s.LinkSchedEntry(ctx, "soc_1", "ent_1", "no_show"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteEntry(ctx, "ent_1"); err != nil {
		t.Fatal(err)
	}
	if links, _ := s.SchedEntryLinks(ctx, "soc_1"); len(links) != 0 {
		t.Fatalf("deleting the entry kept its link: %+v", links)
	}
}

func TestSchedRequests(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	if err := s.CreateSchedEvent(ctx, schedEvent("sev_1", "")); err != nil {
		t.Fatal(err)
	}
	start := t0.Add(48 * time.Hour)
	if _, err := s.MaterialiseOccurrences(ctx, "wsp_a", "sev_1", []store.SchedSlot{slot("soc_1", start), slot("soc_2", t0.Add(time.Hour))},
		store.SchedScheduled, nil, t0); err != nil {
		t.Fatal(err)
	}
	req := store.SchedRequest{ID: "srq_1", WorkspaceID: "wsp_a", OccurrenceID: "soc_1", ClientID: "cli_a", Kind: "reschedule",
		Status: "pending", Late: true, ProposedTimes: []time.Time{start.Add(time.Hour)}, Note: ptr("ill"), CreatedAt: t0}
	if err := s.CreateSchedRequest(ctx, req); err != nil {
		t.Fatal(err)
	}
	req.ID = "srq_2"
	if err := s.CreateSchedRequest(ctx, req); !errors.Is(err, store.ErrSchedRequestOpen) {
		t.Fatalf("a second open request: %v", err)
	}
	got, err := s.SchedRequest(ctx, "wsp_a", "srq_1", true)
	if err != nil || !got.Late || len(got.ProposedTimes) != 1 || !got.ProposedTimes[0].Equal(start.Add(time.Hour)) || *got.Note != "ill" {
		t.Fatalf("%+v %v", got, err)
	}
	if _, err := s.SchedRequest(ctx, "wsp_b", "srq_1", false); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("another workspace's request: %v", err)
	}
	got.Status, got.Reason, got.DecidedAt, got.DecidedBy = "declined", ptr("full"), ptr(t0), ptr("usr_o")
	if err := s.SaveSchedRequest(ctx, got); err != nil {
		t.Fatal(err)
	}
	if _, err := s.OpenSchedRequest(ctx, "wsp_a", "soc_1"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("a declined request is open: %v", err)
	}
	if err := s.CreateSchedRequest(ctx, req); err != nil {
		t.Fatalf("a new request after the decision: %v", err)
	}
	if err := s.CreateSchedRequest(ctx, store.SchedRequest{ID: "srq_3", WorkspaceID: "wsp_a", OccurrenceID: "soc_2", ClientID: "cli_a",
		Kind: "cancel", Status: "pending", CreatedAt: t0}); err != nil {
		t.Fatal(err)
	}
	if list, err := s.SchedRequests(ctx, "wsp_a", []string{"pending", "proposed"}, []string{"usr_h"}); err != nil || len(list) != 2 {
		t.Fatalf("open requests %+v %v", list, err)
	}
	if list, _ := s.SchedRequests(ctx, "wsp_a", nil, []string{"usr_o"}); len(list) != 0 {
		t.Fatalf("another host's requests %+v", list)
	}
	expired, err := s.ExpireSchedRequests(ctx, t0.Add(2*time.Hour))
	if err != nil || len(expired) != 1 || expired[0].ID != "srq_3" || expired[0].Status != "expired" {
		t.Fatalf("expired %+v %v", expired, err)
	}
	if err := s.PurgeSchedHistory(ctx, t0.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.SchedRequests(ctx, "wsp_a", nil, nil); len(list) != 1 || list[0].ID != "srq_2" {
		t.Fatalf("after the purge only the open request stays: %+v", list)
	}
}

func TestClaimDueReminders(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	if err := s.CreateSchedEvent(ctx, schedEvent("sev_1", "")); err != nil {
		t.Fatal(err)
	}
	made := t0.Add(-72 * time.Hour)
	start := t0.Add(30 * time.Hour)
	if _, err := s.MaterialiseOccurrences(ctx, "wsp_a", "sev_1", []store.SchedSlot{slot("soc_1", start)}, store.SchedScheduled, nil, made); err != nil {
		t.Fatal(err)
	}
	// booked an hour before its 1 h reminder: only that one
	if _, err := s.MaterialiseOccurrences(ctx, "wsp_a", "sev_1", []store.SchedSlot{slot("soc_late", start.Add(-23*time.Hour+30*time.Minute))}, store.SchedScheduled, nil,
		start.Add(-25*time.Hour)); err != nil {
		t.Fatal(err)
	}
	// waiting for confirmation: none
	if _, err := s.MaterialiseOccurrences(ctx, "wsp_a", "sev_1", []store.SchedSlot{slot("soc_req", start.Add(time.Hour))}, store.SchedRequested, nil,
		made); err != nil {
		t.Fatal(err)
	}
	claim := func(now time.Time) []store.DueReminder {
		t.Helper()
		got, err := s.ClaimDueReminders(ctx, now, 100)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	if got := claim(t0); len(got) != 0 {
		t.Fatalf("nothing is due yet: %+v", got)
	}
	got := claim(start.Add(-23 * time.Hour))
	if len(got) != 2 || got[0].OccurrenceID != "soc_late" || got[0].OffsetMinutes != 60 || got[1].OccurrenceID != "soc_1" ||
		got[1].OffsetMinutes != 1440 || got[1].Audience != "client" || got[1].WorkspaceID != "wsp_a" {
		t.Fatalf("due %+v", got)
	}
	if again := claim(start.Add(-23 * time.Hour)); len(again) != 0 {
		t.Fatalf("claimed twice: %+v", again)
	}
	// hosts get theirs once set (each audience by its own offsets)
	settings := store.DefaultSchedSettings()
	settings.HostReminders = []int{120}
	if err := s.SaveSchedulingSettings(ctx, "wsp_a", settings, "usr_o", t0); err != nil {
		t.Fatal(err)
	}
	got = claim(start.Add(-30 * time.Minute))
	if len(got) != 2 || got[0].OffsetMinutes != 60 || got[0].Audience != "client" || got[1].OffsetMinutes != 120 || got[1].Audience != "host" {
		t.Fatalf("1 h before: %+v", got)
	}
	// moved after its reminder time: not sent for that time
	o, _ := s.SchedOccurrence(ctx, "wsp_a", "soc_req", true)
	o.Status, o.TimedAt = store.SchedScheduled, start.Add(-10*time.Minute)
	if err := s.SaveSchedOccurrence(ctx, o); err != nil {
		t.Fatal(err)
	}
	if got := claim(start.Add(-5 * time.Minute)); len(got) != 0 {
		t.Fatalf("reminders before the occurrence was confirmed: %+v", got)
	}
}

// TestClaimSeriesSkipsLocked: a series one transaction is extending is skipped by another, not waited for.
func TestClaimSeriesSkipsLocked(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	for _, id := range []string{"sev_1", "sev_2", "sev_one_off"} {
		e := schedEvent(id, "")
		if id != "sev_one_off" {
			e.RRule, e.MaterialisedUntil = ptr("FREQ=WEEKLY"), ptr(t0.Add(time.Duration(len(id))*time.Hour))
		}
		if err := s.CreateSchedEvent(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	horizon := t0.Add(400 * 24 * time.Hour)
	err := s.Tx(ctx, func(q store.Q) error {
		first, err := q.ClaimSeriesToMaterialise(ctx, horizon, 1)
		if err != nil || len(first) != 1 {
			t.Fatalf("first claim %+v %v", first, err)
		}
		rest, err := s.ClaimSeriesToMaterialise(ctx, horizon, 10)
		if err != nil || len(rest) != 1 || rest[0].ID == first[0].ID {
			t.Fatalf("second claim %+v %v", rest, err)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if none, _ := s.ClaimSeriesToMaterialise(ctx, t0, 10); len(none) != 0 {
		t.Fatalf("series materialised past the horizon: %+v", none)
	}
}
