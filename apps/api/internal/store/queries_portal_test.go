package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

func portalFixture(t *testing.T) (*store.Store, func(sql string, args ...any)) {
	t.Helper()
	s, raw := storetest.New(t)
	ctx := context.Background()
	if err := s.CreateWorkspace(ctx, store.Workspace{ID: "wsp_a", Name: "Studio"}, "UTC", t0); err != nil {
		t.Fatal(err)
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := raw.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO clients (id, workspace_id, number, name, email, portal_enabled, created_at, updated_at) VALUES ('cli_1','wsp_a',1,'Acme AG','Ana@Acme.ch',true,$1,$1)`, t0)
	// A contact's address is not a portal login.
	exec(`INSERT INTO client_contacts (id, client_id, workspace_id, name, email, created_at, updated_at) VALUES ('con_1','cli_1','wsp_a','Bob','bob@acme.ch',$1,$1)`, t0)
	return s, exec
}

func TestPortalAccessByClientAddress(t *testing.T) {
	s, exec := portalFixture(t)
	ctx := context.Background()
	got, err := s.Q.PortalAccessByEmail(ctx, "ANA@acme.ch", "")
	if err != nil || len(got) != 1 || got[0].ClientID != "cli_1" || got[0].ClientName != "Acme AG" || got[0].WorkspaceName != "Studio" {
		t.Fatalf("access: %+v %v", got, err)
	}
	if got, _ := s.Q.PortalAccessByEmail(ctx, "bob@acme.ch", ""); len(got) != 0 {
		t.Fatalf("contact address: %+v", got)
	}
	// The billing email is the login only while there is no email.
	exec(`UPDATE clients SET billing_email = 'books@acme.ch'`)
	if got, _ := s.Q.PortalAccessByEmail(ctx, "books@acme.ch", ""); len(got) != 0 {
		t.Fatalf("billing email next to an email: %+v", got)
	}
	exec(`UPDATE clients SET email = NULL`)
	if got, _ := s.Q.PortalAccessByEmail(ctx, "books@acme.ch", ""); len(got) != 1 {
		t.Fatalf("billing email fallback: %+v", got)
	}
	exec(`UPDATE clients SET email = 'ana@acme.ch', portal_enabled = false`)
	if got, _ := s.Q.PortalAccessByEmail(ctx, "ana@acme.ch", ""); len(got) != 0 {
		t.Fatalf("portal off: %+v", got)
	}
	exec(`UPDATE clients SET portal_enabled = true, deleted_at = $1`, t0)
	if got, _ := s.Q.PortalAccessByEmail(ctx, "ana@acme.ch", ""); len(got) != 0 {
		t.Fatalf("deleted client: %+v", got)
	}
	exec(`UPDATE clients SET deleted_at = NULL`)
	exec(`UPDATE workspaces SET deleted_at = $1`, t0)
	if got, _ := s.Q.PortalAccessByEmail(ctx, "ana@acme.ch", ""); len(got) != 0 {
		t.Fatalf("deleted workspace: %+v", got)
	}
}

func TestPortalSessionLifecycle(t *testing.T) {
	s, _ := portalFixture(t)
	ctx := context.Background()
	q := s.Q
	if err := q.CreatePortalSession(ctx, "ps_1", "h1", "csrf", "ANA@acme.ch", "cli_1", "wsp_a", false, t0, t0.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	got, err := q.PortalSessionByToken(ctx, "h1", t0.Add(time.Minute))
	if err != nil || got.Email != "ana@acme.ch" || got.ClientName != "Acme AG" || got.Workspace.Name != "Studio" || got.CSRFToken != "csrf" {
		t.Fatalf("session: %+v %v", got, err)
	}
	if _, err := q.PortalSessionByToken(ctx, "nope", t0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown: %v", err)
	}
	if _, err := q.PortalSessionByToken(ctx, "h1", t0.Add(2*time.Hour)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("expired: %v", err)
	}
	if err := q.TouchPortalSession(ctx, "ps_1", t0.Add(10*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got, _ := q.PortalSessionByToken(ctx, "h1", t0.Add(11*time.Minute)); !got.LastActiveAt.Equal(t0.Add(10 * time.Minute)) {
		t.Fatalf("touch: %v", got.LastActiveAt)
	}
}

func TestPortalSessionEndsWithTheLogin(t *testing.T) {
	for _, tc := range []struct{ name, change string }{
		{"portal off", `UPDATE clients SET portal_enabled = false`},
		{"email changed", `UPDATE clients SET email = 'new@acme.ch'`},
		{"email removed, billing email differs", `UPDATE clients SET email = NULL, billing_email = 'books@acme.ch'`},
		{"client deleted", `UPDATE clients SET deleted_at = now()`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, exec := portalFixture(t)
			ctx := context.Background()
			_ = s.Q.CreatePortalSession(ctx, "ps_1", "h1", "c", "ana@acme.ch", "cli_1", "wsp_a", false, t0, t0.Add(time.Hour))
			exec(tc.change)
			if _, err := s.Q.PortalSessionByToken(ctx, "h1", t0); !errors.Is(err, store.ErrNotFound) {
				t.Fatalf("got %v", err)
			}
		})
	}
}

func TestPortalSessionDeletes(t *testing.T) {
	s, _ := portalFixture(t)
	ctx := context.Background()
	q := s.Q
	for _, id := range []string{"1", "2"} {
		if err := q.CreatePortalSession(ctx, "ps_"+id, "h"+id, "c", "ana@acme.ch", "cli_1", "wsp_a", false, t0, t0.Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	_ = q.DeletePortalSession(ctx, "ps_1")
	if _, err := q.PortalSessionByToken(ctx, "h1", t0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("session delete: %v", err)
	}
	_ = q.DeletePortalSessionsForClient(ctx, "cli_1")
	if _, err := q.PortalSessionByToken(ctx, "h2", t0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("client delete: %v", err)
	}
}
