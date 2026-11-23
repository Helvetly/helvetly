package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func connection(id, user, provider, account string) store.CalendarConnection {
	return store.CalendarConnection{ID: id, WorkspaceID: "wsp_a", UserID: user, Provider: provider, AccountEmail: account + "@gmail.com",
		ExternalAccountID: account, Scopes: []string{"openid"}, RefreshToken: []byte("sealed-r"), AccessToken: []byte("sealed-a"), CreatedAt: t0}
}

func TestCalendarConnections(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	if err := s.CreateCalendarConnection(ctx, connection("cal_1", "usr_h", "google", "g1")); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateCalendarConnection(ctx, connection("cal_2", "usr_h", "google", "g2")); !errors.Is(err, store.ErrCalendarConnected) {
		t.Fatalf("a second Google connection: %v", err)
	}
	if err := s.CreateCalendarConnection(ctx, connection("cal_3", "usr_o", "google", "g1")); !errors.Is(err, store.ErrCalendarAccountInUse) {
		t.Fatalf("another member's account: %v", err)
	}
	other := connection("cal_4", "usr_b", "google", "g1")
	other.WorkspaceID = "wsp_b"
	if err := s.CreateCalendarConnection(ctx, other); err != nil {
		t.Fatalf("the same account in another workspace: %v", err)
	}
	bad := connection("cal_5", "usr_b", "microsoft", "m1")
	if err := s.CreateCalendarConnection(ctx, bad); err == nil {
		t.Fatal("a connection for someone who is not a member")
	}
	if _, err := s.CalendarConnection(ctx, "wsp_b", "cal_1"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("another workspace's connection: %v", err)
	}
	expires := t0.Add(time.Hour)
	if err := s.SaveCalendarTokens(ctx, "cal_1", []byte("new-a"), nil, &expires, t0); err != nil {
		t.Fatal(err)
	}
	if err := s.SetPushCalendar(ctx, "wsp_a", "cal_1", ptr("primary"), t0); err != nil {
		t.Fatal(err)
	}
	c, err := s.CalendarConnection(ctx, "wsp_a", "cal_1")
	if err != nil || string(c.AccessToken) != "new-a" || string(c.RefreshToken) != "sealed-r" || *c.PushCalendarID != "primary" || c.Status != "active" {
		t.Fatalf("%+v %v", c, err)
	}
	if err := s.SetCalendarStatus(ctx, "cal_1", "revoked", ptr("invalid_grant"), t0); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.CalendarConnections(ctx, "wsp_a", "usr_h"); len(list) != 1 || list[0].Status != "revoked" || list[0].RefreshToken != nil ||
		list[0].AccessToken != nil || *list[0].Error != "invalid_grant" {
		t.Fatalf("revoked %+v", list)
	}
	if err := s.DeleteCalendarConnection(ctx, "wsp_b", "cal_1"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleted through another workspace: %v", err)
	}
	if err := s.DeleteCalendarConnection(ctx, "wsp_a", "cal_1"); err != nil {
		t.Fatal(err)
	}
	// leaving the workspace removes the member's connections
	if err := s.CreateCalendarConnection(ctx, connection("cal_6", "usr_h", "microsoft", "m2")); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveMember(ctx, "wsp_a", "usr_h"); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.CalendarConnections(ctx, "wsp_a", "usr_h"); len(list) != 0 {
		t.Fatalf("connections of a member who left: %+v", list)
	}
}

func TestCalendarSourcesBusyAndClaims(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	if err := s.CreateCalendarConnection(ctx, connection("cal_1", "usr_h", "google", "g1")); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveCalendarSources(ctx, "cal_1", []store.CalendarSource{{CalendarID: "primary", Name: "Me", Primary: true},
		{CalendarID: "team", Name: "Team"}}, t0); err != nil {
		t.Fatal(err)
	}
	if err := s.SetBusyCalendars(ctx, "cal_1", []string{"primary"}, t0); err != nil {
		t.Fatal(err)
	}
	claimed, err := s.ClaimDueSources(ctx, t0, t0.Add(time.Minute), 10)
	if err != nil || len(claimed) != 1 || claimed[0].CalendarID != "primary" || !claimed[0].FullResync {
		t.Fatalf("claimed %+v %v", claimed, err)
	}
	if again, _ := s.ClaimDueSources(ctx, t0, t0.Add(time.Minute), 10); len(again) != 0 {
		t.Fatalf("a leased source claimed again: %+v", again)
	}
	if err := s.SaveSourceSync(ctx, "cal_1", "primary", ptr("tok"), false, t0.Add(15*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkSourceDue(ctx, "cal_1", "primary", false, t0.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if claimed, _ := s.ClaimDueSources(ctx, t0.Add(time.Minute), t0.Add(2*time.Minute), 10); len(claimed) != 1 || *claimed[0].SyncToken != "tok" ||
		claimed[0].FullResync {
		t.Fatalf("after a webhook hint %+v", claimed)
	}
	// renaming keeps the sync state; a calendar gone from the account is dropped
	if err := s.SaveCalendarSources(ctx, "cal_1", []store.CalendarSource{{CalendarID: "primary", Name: "Renamed", Primary: true}}, t0); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.CalendarSources(ctx, "cal_1"); len(list) != 1 || list[0].Name != "Renamed" || !list[0].Busy || *list[0].SyncToken != "tok" {
		t.Fatalf("sources %+v", list)
	}
	blocks := []store.BusyBlock{{ExternalID: "e1", StartsAt: t0, EndsAt: t0.Add(time.Hour)}, {ExternalID: "e2", StartsAt: t0.Add(3 * time.Hour),
		EndsAt: t0.Add(4 * time.Hour)}}
	if err := s.SaveCalendarBusy(ctx, "cal_1", blocks, nil); err != nil {
		t.Fatal(err)
	}
	blocks[0].EndsAt = t0.Add(90 * time.Minute)
	if err := s.SaveCalendarBusy(ctx, "cal_1", blocks[:1], []string{"e2"}); err != nil {
		t.Fatal(err)
	}
	busy, err := s.CalendarBusy(ctx, "wsp_a", []string{"usr_h"}, t0.Add(time.Hour), t0.Add(5*time.Hour))
	if err != nil || len(busy) != 1 || busy[0].ExternalID != "e1" || busy[0].UserID != "usr_h" || !busy[0].EndsAt.Equal(t0.Add(90*time.Minute)) {
		t.Fatalf("busy %+v %v", busy, err)
	}
	if busy, _ := s.CalendarBusy(ctx, "wsp_b", []string{"usr_h"}, t0, t0.Add(5*time.Hour)); len(busy) != 0 {
		t.Fatalf("another workspace sees busy times: %+v", busy)
	}
	if err := s.PurgePastBusy(ctx, t0.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if busy, _ := s.CalendarBusy(ctx, "wsp_a", []string{"usr_h"}, t0, t0.Add(5*time.Hour)); len(busy) != 0 {
		t.Fatalf("past busy times kept: %+v", busy)
	}
	// a revoked connection is not synced
	if err := s.MarkSourceDue(ctx, "cal_1", "primary", true, t0); err != nil {
		t.Fatal(err)
	}
	if err := s.SetCalendarStatus(ctx, "cal_1", "revoked", nil, t0); err != nil {
		t.Fatal(err)
	}
	if claimed, _ := s.ClaimDueSources(ctx, t0.Add(time.Hour), t0.Add(2*time.Hour), 10); len(claimed) != 0 {
		t.Fatalf("a revoked connection's source claimed: %+v", claimed)
	}
}

func TestCalendarWatchesAndFeeds(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	if err := s.CreateCalendarConnection(ctx, connection("cal_1", "usr_h", "google", "g1")); err != nil {
		t.Fatal(err)
	}
	w := store.CalendarWatch{ID: "cwt_1", ConnectionID: "cal_1", CalendarID: "primary", ProviderID: "chan-1", SecretHash: []byte("h"), ExpiresAt: t0.Add(time.Hour)}
	if err := s.CreateCalendarWatch(ctx, w); err != nil {
		t.Fatal(err)
	}
	w.ID = "cwt_2"
	if err := s.CreateCalendarWatch(ctx, w); err == nil {
		t.Fatal("two watches with one provider id")
	}
	if got, err := s.CalendarWatchByProviderID(ctx, "chan-1"); err != nil || got.ID != "cwt_1" {
		t.Fatalf("%+v %v", got, err)
	}
	if _, err := s.CalendarWatchByProviderID(ctx, "unknown"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown channel: %v", err)
	}
	if list, _ := s.ExpiringCalendarWatches(ctx, t0.Add(2*time.Hour), 10); len(list) != 1 {
		t.Fatalf("expiring %+v", list)
	}
	if list, _ := s.CalendarWatches(ctx, "cal_1"); len(list) != 1 {
		t.Fatalf("watches %+v", list)
	}
	if err := s.DeleteCalendarWatch(ctx, "cwt_1"); err != nil {
		t.Fatal(err)
	}

	feed := store.CalendarFeed{WorkspaceID: "wsp_a", UserID: "usr_h", TokenHash: []byte("one"), TokenSealed: []byte("s1"), CreatedAt: t0}
	if err := s.SaveCalendarFeed(ctx, feed); err != nil {
		t.Fatal(err)
	}
	if err := s.TouchCalendarFeed(ctx, "wsp_a", "usr_h", t0); err != nil {
		t.Fatal(err)
	}
	feed.TokenHash, feed.TokenSealed = []byte("two"), []byte("s2")
	if err := s.SaveCalendarFeed(ctx, feed); err != nil {
		t.Fatal(err)
	}
	if _, err := s.LiveCalendarFeed(ctx, []byte("one")); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("a rotated token still works: %v", err)
	}
	got, err := s.LiveCalendarFeed(ctx, []byte("two"))
	if err != nil || got.UserID != "usr_h" || string(got.TokenSealed) != "s2" || got.LastFetchedAt != nil {
		t.Fatalf("%+v %v", got, err)
	}
	if got, err := s.CalendarFeed(ctx, "wsp_a", "usr_h"); err != nil || string(got.TokenHash) != "two" {
		t.Fatalf("%+v %v", got, err)
	}
	if err := s.DeleteCalendarFeed(ctx, "wsp_a", "usr_h"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteCalendarFeed(ctx, "wsp_a", "usr_h"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
}

func TestCalendarLinksAndPushQueue(t *testing.T) {
	s := seedScheduling(t)
	ctx := context.Background()
	for _, c := range []store.CalendarConnection{connection("cal_h", "usr_h", "google", "g1"), connection("cal_o", "usr_o", "google", "g2")} {
		if err := s.CreateCalendarConnection(ctx, c); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.CreateSchedEvent(ctx, schedEvent("sev_1", "")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MaterialiseOccurrences(ctx, "wsp_a", "sev_1", []store.SchedSlot{slot("soc_1", t0.Add(24*time.Hour))}, store.SchedScheduled, nil, t0); err != nil {
		t.Fatal(err)
	}
	if err := s.EnqueueCalendarPush(ctx, "wsp_a", []string{"soc_1"}, t0); err != nil {
		t.Fatal(err)
	}
	claimed, err := s.ClaimPushQueue(ctx, t0, t0.Add(time.Minute), 10)
	if err != nil || len(claimed) != 1 || claimed[0].ConnectionID != "cal_h" {
		t.Fatalf("only the host's connection is pushed to: %+v %v", claimed, err)
	}
	if again, _ := s.ClaimPushQueue(ctx, t0, t0.Add(time.Minute), 10); len(again) != 0 {
		t.Fatalf("a leased push claimed again: %+v", again)
	}
	if err := s.SaveCalendarLink(ctx, store.CalendarLink{ConnectionID: "cal_h", OccurrenceID: "soc_1", ExternalID: "ext_1", PushedSequence: 0}); err != nil {
		t.Fatal(err)
	}
	// changed again while the push ran: it stays queued for the newer state
	if err := s.EnqueueCalendarPush(ctx, "wsp_a", []string{"soc_1"}, t0.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := s.FinishPush(ctx, "cal_h", "soc_1", claimed[0].DueAt); err != nil {
		t.Fatal(err)
	}
	next, _ := s.ClaimPushQueue(ctx, t0.Add(time.Second), t0.Add(time.Minute), 10)
	if len(next) != 1 || !next[0].QueuedAt.Equal(t0) {
		t.Fatalf("the newer change was lost: %+v", next)
	}
	if err := s.RetryPush(ctx, "cal_h", "soc_1", "503", t0.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if early, _ := s.ClaimPushQueue(ctx, t0.Add(time.Minute), t0.Add(2*time.Minute), 10); len(early) != 0 {
		t.Fatalf("retried before its time: %+v", early)
	}
	retried, _ := s.ClaimPushQueue(ctx, t0.Add(time.Hour), t0.Add(2*time.Hour), 10)
	if len(retried) != 1 || retried[0].Attempts != 1 || *retried[0].LastError != "503" {
		t.Fatalf("retried %+v", retried)
	}
	if err := s.FinishPush(ctx, "cal_h", "soc_1", retried[0].DueAt); err != nil {
		t.Fatal(err)
	}
	if left, _ := s.ClaimPushQueue(ctx, t0.Add(48*time.Hour), t0.Add(49*time.Hour), 10); len(left) != 0 {
		t.Fatalf("finished push left: %+v", left)
	}
	// a new host: the old host's calendar, which holds the link, gets the removal
	o, _ := s.SchedOccurrence(ctx, "wsp_a", "soc_1", true)
	o.HostUserID = ptr("usr_o")
	if err := s.SaveSchedOccurrence(ctx, o); err != nil {
		t.Fatal(err)
	}
	if err := s.EnqueueCalendarPush(ctx, "wsp_a", []string{"soc_1"}, t0.Add(50*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if both, _ := s.ClaimPushQueue(ctx, t0.Add(50*time.Hour), t0.Add(51*time.Hour), 10); len(both) != 2 {
		t.Fatalf("host change pushes %+v", both)
	}
	if err := s.EnqueueCalendarPush(ctx, "wsp_b", []string{"soc_1"}, t0); err != nil {
		t.Fatal(err)
	}

	if l, err := s.CalendarLinkByExternal(ctx, "cal_h", "ext_1"); err != nil || l.OccurrenceID != "soc_1" || l.State != "ok" {
		t.Fatalf("%+v %v", l, err)
	}
	if err := s.DetachCalendarLink(ctx, "cal_h", "soc_1"); err != nil {
		t.Fatal(err)
	}
	if l, _ := s.CalendarLink(ctx, "cal_h", "soc_1"); l.State != "detached" {
		t.Fatalf("detached %+v", l)
	}
	if list, _ := s.CalendarLinksOfOccurrence(ctx, "soc_1"); len(list) != 1 {
		t.Fatalf("links %+v", list)
	}
	if err := s.DeleteCalendarLink(ctx, "cal_h", "soc_1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CalendarLink(ctx, "cal_h", "soc_1"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleted link: %v", err)
	}
}
