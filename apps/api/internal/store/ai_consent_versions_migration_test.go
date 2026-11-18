package store

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/ainotice"
)

// TestAIConsentVersionsMigration: 00023 keeps every approval written before notice versions as history, and none of
// them counts as approval of the notice in force; from then on an approval must name its version.
func TestAIConsentVersionsMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 22); err != nil {
		t.Fatal(err)
	}
	exec := func(sql string) error {
		_, err := pool.Exec(ctx, sql)
		return err
	}
	for _, sql := range []string{
		`INSERT INTO workspaces (id, name, created_at) VALUES ('ws_1', 'A', now())`,
		`INSERT INTO users (id, email, name, created_at, updated_at) VALUES ('usr_a', 'a@x.ch', 'A', now(), now()), ('usr_b', 'b@x.ch', '', now(), now())`,
		// usr_a approved; usr_b approved, withdrew and approved again
		`INSERT INTO workspace_ai_consents (workspace_id, granted, user_id, at) VALUES ('ws_1', true, 'usr_a', now()),
			('ws_1', true, 'usr_b', now()), ('ws_1', false, 'usr_b', now()), ('ws_1', true, 'usr_b', now())`,
	} {
		if err := exec(sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	if _, err := p.UpTo(ctx, 23); err != nil {
		t.Fatal(err)
	}
	q := Q{db: pool}
	for _, user := range []string{"usr_a", "usr_b"} {
		c, err := q.AIConsent(ctx, "ws_1", user)
		if err != nil || c.Granted || c.Version != "" || c.CurrentVersion != ainotice.Version || c.ChangedAt == nil {
			t.Fatalf("%s's approval from before versions: %+v %v", user, c, err)
		}
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM workspace_ai_consents WHERE version IS NULL`).Scan(&rows); err != nil || rows != 4 {
		t.Fatalf("%d rows kept without a version: %v", rows, err)
	}
	if err := exec(`INSERT INTO workspace_ai_consents (workspace_id, granted, user_id, at) VALUES ('ws_1', true, 'usr_a', now())`); err == nil {
		t.Fatal("an approval without a version was accepted")
	}
	if err := exec(`INSERT INTO workspace_ai_consents (workspace_id, granted, user_id, at) VALUES ('ws_1', false, 'usr_a', now())`); err != nil {
		t.Fatalf("a withdrawal without a version: %v", err)
	}
	if err := q.SetAIConsent(ctx, "ws_1", "usr_a", true, time.Now()); err != nil {
		t.Fatal(err)
	}
	if c, err := q.AIConsent(ctx, "ws_1", "usr_a"); err != nil || !c.Granted || c.Version != ainotice.Version {
		t.Fatalf("after approving the notice in force: %+v %v", c, err)
	}
	if _, err := p.DownTo(ctx, 22); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM workspace_ai_consents`).Scan(&rows); err != nil || rows != 6 {
		t.Fatalf("%d rows after Down: %v", rows, err)
	}
}
