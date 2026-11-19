package store_test

import (
	"context"
	"testing"
	"time"
)

// TestPortalSignInPurgesExpiredSessions: a portal sign-in deletes every expired portal session (any client, any
// workspace) and keeps the live ones.
func TestPortalSignInPurgesExpiredSessions(t *testing.T) {
	s, exec := portalFixture(t)
	ctx := context.Background()
	exec(`INSERT INTO portal_sessions (id, token_hash, csrf_token, email, client_id, workspace_id, created_at, expires_at, last_active_at)
		VALUES ('pse_old', 'h_old', 'c', 'ana@acme.ch', 'cli_1', 'wsp_a', $1, $2, $1),
		       ('pse_live', 'h_live', 'c', 'ana@acme.ch', 'cli_1', 'wsp_a', $1, $3, $1)`, t0, t0.Add(time.Hour), t0.Add(48*time.Hour))
	now := t0.Add(2 * time.Hour)
	if err := s.CreatePortalSession(ctx, "pse_new", "h_new", "c", "ana@acme.ch", "cli_1", "wsp_a", false, now, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Q.PortalSessionByToken(ctx, "h_live", now); err != nil {
		t.Fatalf("live session gone: %v", err)
	}
	exec(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM portal_sessions WHERE id = 'pse_old') THEN RAISE EXCEPTION 'expired portal session kept'; END IF; END $$`)
}
