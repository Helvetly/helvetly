package store

import (
	"context"
	"testing"
)

// TestObjectRetentionMigration: 00067 carries old pending locks over as pending, confirms nothing (the old queue also
// cleared no-ops), keeps invoice_xml_retention as history, and goes back down without losing pending work.
func TestObjectRetentionMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 66); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO retention_pending (object_key, workspace_id, created_at, next_attempt_at, attempts, last_error)
		VALUES ('a.pdf', 'wsp_a', now(), now(), 3, 'AccessDenied')`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 67); err != nil {
		t.Fatal(err)
	}
	var status, lastErr string
	var attempts, confirmed int
	if err := pool.QueryRow(ctx, `SELECT status, attempts, last_error FROM object_retention WHERE object_key = 'a.pdf'`).
		Scan(&status, &attempts, &lastErr); err != nil || status != "pending" || attempts != 3 || lastErr != "AccessDenied" {
		t.Fatalf("carried over: %s %d %s %v", status, attempts, lastErr, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM object_retention WHERE status = 'confirmed'`).Scan(&confirmed); err != nil || confirmed != 0 {
		t.Fatalf("confirmed without evidence: %d %v", confirmed, err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO object_retention (object_key, workspace_id, status, requested_at) VALUES ('b.pdf', 'wsp_a', 'confirmed', now())`); err == nil {
		t.Fatal("confirmed without a lock was accepted")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO object_versions (object_key, version_id, recorded_at) VALUES ('c.pdf', 'null', now())`); err == nil {
		t.Fatal("the null version was recorded")
	}
	if _, err := p.DownTo(ctx, 66); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM retention_pending WHERE object_key = 'a.pdf' AND attempts = 3`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("down: %d %v", n, err)
	}
}
