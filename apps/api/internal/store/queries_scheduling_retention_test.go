package store_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestCancelClientSessionsEndsOnlyTheFutureOpenOnes(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	series := schedEvent("sev_1", "")
	series.RRule = ptr("FREQ=WEEKLY")
	if err := s.CreateSchedEvent(ctx, series); err != nil {
		t.Fatal(err)
	}
	past, ahead := t0.Add(-48*time.Hour), t0.Add(48*time.Hour)
	if _, err := s.MaterialiseOccurrences(ctx, "wsp_a", "sev_1", []store.SchedSlot{slot("soc_past", past), slot("soc_next", ahead),
		slot("soc_attended", ahead.Add(time.Hour*24*7))}, store.SchedScheduled, &ahead, t0); err != nil {
		t.Fatal(err)
	}
	attended, _ := s.SchedOccurrence(ctx, "wsp_a", "soc_attended", false)
	attended.Status = store.SchedAttended
	if err := s.SaveSchedOccurrence(ctx, attended); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSchedRequest(ctx, store.SchedRequest{ID: "srq_1", WorkspaceID: "wsp_a", OccurrenceID: "soc_next", ClientID: "cli_a",
		Kind: "cancel", Status: "pending", CreatedAt: t0}); err != nil {
		t.Fatal(err)
	}

	// another workspace's call changes nothing
	if ids, err := s.CancelClientSessions(ctx, "wsp_b", []string{"cli_a"}, t0); err != nil || len(ids) != 0 {
		t.Fatalf("through another workspace: %v %v", ids, err)
	}
	ids, err := s.CancelClientSessions(ctx, "wsp_a", []string{"cli_a"}, t0)
	if err != nil || !slices.Equal(ids, []string{"soc_next"}) {
		t.Fatalf("cancelled %v: %v", ids, err)
	}
	for id, want := range map[string]string{"soc_past": store.SchedScheduled, "soc_next": store.SchedCancelledOnTime, "soc_attended": store.SchedAttended} {
		o, _ := s.SchedOccurrence(ctx, "wsp_a", id, false)
		if o.Status != want {
			t.Errorf("%s: %s, want %s", id, o.Status, want)
		}
		if id == "soc_next" && (o.Sequence != 1 || o.Late || o.StatusChangedAt == nil || !o.StatusChangedAt.Equal(t0)) {
			t.Errorf("cancelled row %+v", o)
		}
	}
	if r, _ := s.SchedRequest(ctx, "wsp_a", "srq_1", false); r.Status != "expired" || r.DecidedAt == nil {
		t.Fatalf("open request %+v", r)
	}
	if ids, err := s.CancelClientSessions(ctx, "wsp_a", []string{"cli_a"}, t0); err != nil || len(ids) != 0 {
		t.Fatalf("again: %v %v", ids, err)
	}
}

func TestSeriesOfDeletedClientsAreNotExtended(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	series := schedEvent("sev_1", "")
	series.RRule = ptr("FREQ=WEEKLY")
	if err := s.CreateSchedEvent(ctx, series); err != nil {
		t.Fatal(err)
	}
	until := t0
	if _, err := s.MaterialiseOccurrences(ctx, "wsp_a", "sev_1", nil, store.SchedScheduled, &until, t0); err != nil {
		t.Fatal(err)
	}
	horizon := t0.Add(400 * 24 * time.Hour)
	claim := func() []store.SchedEvent {
		var got []store.SchedEvent
		if err := s.Tx(ctx, func(q store.Q) (err error) { got, err = q.ClaimSeriesToMaterialise(ctx, horizon, 10); return err }); err != nil {
			t.Fatal(err)
		}
		return got
	}
	if got := claim(); len(got) != 1 {
		t.Fatalf("a live client's series: %d", len(got))
	}
	if _, err := s.BulkClients(ctx, "wsp_a", []string{"cli_a"}, "delete", t0); err != nil {
		t.Fatal(err)
	}
	if got := claim(); len(got) != 0 {
		t.Fatalf("a deleted client's series was claimed: %+v", got)
	}
}
