package store_test

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

func TestCreateSessionPurgesExpired(t *testing.T) {
	s, raw := storetest.New(t)
	ctx := context.Background()
	for _, err := range []error{
		s.CreateWorkspace(ctx, store.Workspace{ID: "wsp_a", Name: "Acme"}, "UTC", t0),
		s.CreateUser(ctx, store.User{ID: "usr_a", Email: "a@x.ch", Name: "A"}, t0),
		s.AddMember(ctx, "wsp_a", "usr_a", "owner", t0),
		s.CreateSession(ctx, "ses_old", "h1", "c", "usr_a", "wsp_a", t0.Add(-2*time.Hour), t0.Add(-time.Minute)),
		s.CreateSession(ctx, "ses_live", "h2", "c", "usr_a", "wsp_a", t0.Add(-2*time.Hour), t0.Add(time.Minute)),
		s.CreateSession(ctx, "ses_new", "h3", "c", "usr_a", "wsp_a", t0, t0.Add(time.Hour)), // a sign-in at t0
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	var ids []string
	if err := raw.QueryRow(ctx, `SELECT array_agg(id ORDER BY id) FROM sessions`).Scan(&ids); err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 || ids[0] != "ses_live" || ids[1] != "ses_new" {
		t.Fatalf("sessions after a sign-in: %v", ids)
	}
}
