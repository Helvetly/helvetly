package store_test

import (
	"context"
	"testing"
	"time"
)

// TestPortalChoicePurgesExpired: a new choice deletes every expired choice and ticket and keeps the live ones.
func TestPortalChoicePurgesExpired(t *testing.T) {
	s, exec := portalFixture(t)
	ctx := context.Background()
	exec(`INSERT INTO portal_sign_in_choices (id, token_hash, csrf_token, email, ticket_hash, client_id, workspace_id, created_at, expires_at) VALUES
		('pch_old', 'h_old', 'c', 'ana@acme.ch', NULL, NULL, NULL, $1, $2),
		('pch_ticket', NULL, 'c', 'ana@acme.ch', 't_old', 'cli_1', 'wsp_a', $1, $2),
		('pch_live', 'h_live', 'c', 'ana@acme.ch', NULL, NULL, NULL, $1, $3)`, t0, t0.Add(time.Minute), t0.Add(48*time.Hour))
	now := t0.Add(time.Hour)
	if err := s.CreatePortalChoice(ctx, "pch_new", "h_new", "c", "ana@acme.ch", now, now.Add(10*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Q.PortalChoiceByToken(ctx, "h_live", now); err != nil {
		t.Fatalf("live choice gone: %v", err)
	}
	exec(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM portal_sign_in_choices WHERE id IN ('pch_old', 'pch_ticket')) THEN RAISE EXCEPTION 'expired choice or ticket kept'; END IF; END $$`)
}
