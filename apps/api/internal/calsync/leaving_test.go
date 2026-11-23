package calsync

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestLeavingRevokesAfterTheRowsWent(t *testing.T) {
	for _, who := range []string{"member", "workspace"} {
		t.Run(who, func(t *testing.T) {
			e := newEnv(t)
			owner := e.workspace(pro, "owner")
			m := e.member(owner.ws, "member")
			other := e.workspace(pro, "owner") // another workspace's connection is never touched
			e.connect(m, "google")
			e.connect(other, "microsoft")
			for _, o := range []store.SchedOccurrence{e.session(owner, m.userID, e.clock.Add(24*time.Hour)),
				e.session(other, other.userID, e.clock.Add(24*time.Hour))} {
				e.change(o, func(*store.SchedOccurrence) {}) // queued for the push
			}
			ctx := context.Background()
			e.svc.PushTick(ctx)
			e.svc.WatchTick(ctx)
			primary := e.fake.PrimaryCalendar("google")
			if len(e.fake.Events("google", primary)) != 1 || len(e.fake.Watches()) != 2 {
				t.Fatalf("pushed %d, watches %d", len(e.fake.Events("google", primary)), len(e.fake.Watches()))
			}
			user := m.userID
			if who == "workspace" {
				user = ""
			}
			revoke, err := e.svc.Leaving(ctx, owner.ws, user)
			if err != nil {
				t.Fatal(err)
			}
			// the membership goes first (its rows cascade); the provider is cleaned up afterwards
			if err := e.st.RemoveMember(ctx, owner.ws, m.userID); err != nil {
				t.Fatal(err)
			}
			if e.count(`SELECT count(*) FROM calendar_connections WHERE workspace_id = $1`, owner.ws) != 0 {
				t.Fatal("the connection outlived the membership")
			}
			revoke()
			if len(e.fake.Events("google", primary)) != 0 || len(e.fake.Watches()) != 1 {
				t.Fatalf("left behind: %d events, %d watches", len(e.fake.Events("google", primary)), len(e.fake.Watches()))
			}
			if len(e.fake.Events("microsoft", e.fake.PrimaryCalendar("microsoft"))) != 1 {
				t.Fatal("another workspace's events were removed")
			}
			e.fake.mu.Lock()
			defer e.fake.mu.Unlock()
			for _, g := range e.fake.grants {
				if g.provider == "google" {
					t.Fatal("the Google grant was not revoked")
				}
			}
		})
	}
}
