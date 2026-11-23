package clients

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// A deleted client's sessions ahead are cancelled quietly and queued to leave the host's calendar; past ones stay.
func TestDeleteCancelsTheClientsFutureSessions(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, map[string]any{"name": "Müller AG"})
	ctx, now := context.Background(), time.Now().UTC()
	host := store.User{ID: auth.NewID("usr"), Email: auth.NewID("h") + "@example.com", Name: "Host"}
	for _, err := range []error{e.st.CreateUser(ctx, host, now), e.st.AddMember(ctx, b.workspace, host.ID, "member", now),
		e.st.CreateCalendarConnection(ctx, store.CalendarConnection{ID: "cal_1", WorkspaceID: b.workspace, UserID: host.ID, Provider: "google",
			AccountEmail: "host@gmail.test", ExternalAccountID: "g-1", CreatedAt: now}),
		e.st.InsertSchedEvent(ctx, store.SchedEvent{ID: "sev_1", WorkspaceID: b.workspace, ClientID: c.ID, HostUserID: &host.ID, Title: "Lesson",
			Mode: "live", TimeZone: "UTC", StartsLocal: now, DurationMinutes: 60, CreatedAt: now, UpdatedAt: now}),
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	past, ahead := now.Add(-24*time.Hour).Truncate(time.Second), now.Add(24*time.Hour).Truncate(time.Second)
	if _, err := e.st.MaterialiseOccurrences(ctx, b.workspace, "sev_1", []store.SchedSlot{
		{ID: "soc_past", OriginalStart: past, StartsAt: past, EndsAt: past.Add(time.Hour)},
		{ID: "soc_next", OriginalStart: ahead, StartsAt: ahead, EndsAt: ahead.Add(time.Hour)},
	}, store.SchedScheduled, nil, now); err != nil {
		t.Fatal(err)
	}

	e.do(b, "DELETE", "/api/v1/clients/"+c.ID, nil, 204, nil)

	for id, want := range map[string]string{"soc_past": store.SchedScheduled, "soc_next": store.SchedCancelledOnTime} {
		if o, err := e.st.SchedOccurrence(ctx, b.workspace, id, false); err != nil || o.Status != want {
			t.Errorf("%s: %s (%v), want %s", id, o.Status, err, want)
		}
	}
	var queued int
	if err := e.st.Tx(ctx, func(q store.Q) error {
		list, err := q.ClaimPushQueue(ctx, now.Add(time.Minute), now.Add(2*time.Minute), 10)
		queued = len(list)
		for _, p := range list {
			if p.OccurrenceID != "soc_next" {
				t.Errorf("queued %s", p.OccurrenceID)
			}
		}
		return err
	}); err != nil || queued != 1 {
		t.Fatalf("queued %d: %v", queued, err)
	}
}
