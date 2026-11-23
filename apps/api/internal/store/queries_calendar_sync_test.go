package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestCalendarSyncQueries(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	if err := s.CreateCalendarConnection(ctx, connection("cal_1", "usr_h", "microsoft", "m1")); err != nil {
		t.Fatal(err)
	}
	if c, err := s.CalendarConnectionByID(ctx, "cal_1"); err != nil || c.WorkspaceID != "wsp_a" {
		t.Fatalf("%+v %v", c, err)
	}
	if _, err := s.CalendarConnectionByID(ctx, "cal_x"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown: %v", err)
	}
	if err := s.SaveCalendarSources(ctx, "cal_1", []store.CalendarSource{{CalendarID: "a", Name: "A", Primary: true, Busy: true},
		{CalendarID: "b", Name: "B"}}, t0); err != nil {
		t.Fatal(err)
	}
	// watches: the busy calendar needs one; a second one on it and one on a calendar not imported are orphans
	if list, err := s.UnwatchedCalendarSources(ctx, 10); err != nil || len(list) != 1 || list[0].CalendarID != "a" {
		t.Fatalf("unwatched %+v %v", list, err)
	}
	for _, w := range []store.CalendarWatch{
		{ID: "cwt_1", ConnectionID: "cal_1", CalendarID: "a", ProviderID: "p1", SecretHash: []byte{1}, ExpiresAt: t0.Add(time.Hour)},
		{ID: "cwt_2", ConnectionID: "cal_1", CalendarID: "a", ProviderID: "p2", SecretHash: []byte{1}, ExpiresAt: t0.Add(2 * time.Hour)},
		{ID: "cwt_3", ConnectionID: "cal_1", CalendarID: "b", ProviderID: "p3", SecretHash: []byte{1}, ExpiresAt: t0.Add(time.Hour)},
	} {
		if err := s.CreateCalendarWatch(ctx, w); err != nil {
			t.Fatal(err)
		}
	}
	if list, _ := s.UnwatchedCalendarSources(ctx, 10); len(list) != 0 {
		t.Fatalf("watched calendar listed: %+v", list)
	}
	orphans, err := s.OrphanCalendarWatches(ctx, 10)
	if err != nil || len(orphans) != 2 || orphans[0].ID == "cwt_2" || orphans[1].ID == "cwt_2" {
		t.Fatalf("orphans %+v %v", orphans, err)
	}
	if err := s.ExpireCalendarWatch(ctx, "cwt_2", t0); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.ExpiringCalendarWatches(ctx, t0.Add(time.Second), 10); len(list) != 1 || list[0].ID != "cwt_2" {
		t.Fatalf("expired %+v", list)
	}
	// a revoked connection's watches are all orphans
	if err := s.SetCalendarStatus(ctx, "cal_1", "revoked", nil, t0); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.OrphanCalendarWatches(ctx, 10); len(list) != 3 {
		t.Fatalf("revoked connection's watches %+v", list)
	}
	if err := s.SetCalendarStatus(ctx, "cal_1", "active", nil, t0); err != nil {
		t.Fatal(err)
	}
	// busy ids by calendar prefix; the weekly re-baseline
	if err := s.SaveCalendarBusy(ctx, "cal_1", []store.BusyBlock{{ExternalID: "a|1", StartsAt: t0, EndsAt: t0.Add(time.Hour)},
		{ExternalID: "ab|2", StartsAt: t0, EndsAt: t0.Add(time.Hour)}}, nil); err != nil {
		t.Fatal(err)
	}
	if ids, err := s.CalendarBusyIDs(ctx, "cal_1", "a|"); err != nil || len(ids) != 1 || ids[0] != "a|1" {
		t.Fatalf("busy ids %v %v", ids, err)
	}
	if err := s.SaveSourceSync(ctx, "cal_1", "a", ptr("delta"), false, t0.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := s.RebaselineCalendarSources(ctx, "google", t0); err != nil {
		t.Fatal(err)
	}
	if src, _ := s.CalendarSources(ctx, "cal_1"); src[0].FullResync {
		t.Fatal("another provider's calendar re-baselined")
	}
	if err := s.RebaselineCalendarSources(ctx, "microsoft", t0); err != nil {
		t.Fatal(err)
	}
	if src, _ := s.CalendarSources(ctx, "cal_1"); !src[0].FullResync || !src[0].DueAt.Equal(t0) || src[1].FullResync != true {
		t.Fatalf("re-baseline %+v", src)
	}
	// links of a connection
	if err := s.CreateSchedEvent(ctx, schedEvent("sev_1", "")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MaterialiseOccurrences(ctx, "wsp_a", "sev_1", []store.SchedSlot{slot("soc_1", t0), slot("soc_2", t0.Add(24*time.Hour))},
		"scheduled", nil, t0); err != nil {
		t.Fatal(err)
	}
	for _, o := range []string{"soc_2", "soc_1"} {
		if err := s.SaveCalendarLink(ctx, store.CalendarLink{ConnectionID: "cal_1", OccurrenceID: o, ExternalID: "a|" + o}); err != nil {
			t.Fatal(err)
		}
	}
	if links, err := s.CalendarLinksOfConnection(ctx, "cal_1"); err != nil || len(links) != 2 || links[0].OccurrenceID != "soc_1" {
		t.Fatalf("links %+v %v", links, err)
	}
}
