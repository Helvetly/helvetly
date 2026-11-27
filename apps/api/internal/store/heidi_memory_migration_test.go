package store

import "testing"

func TestRemoveHeidiReplyStyleMigration(t *testing.T) {
	ctx := t.Context()
	migrations, pool := migrationProvider(t)
	if _, err := migrations.UpTo(ctx, 89); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO workspaces (id, name, created_at) VALUES ('ws_heidi', 'Heidi', now());
		INSERT INTO users (id, email, created_at, updated_at) VALUES
			('usr_brief', 'brief@example.test', now(), now()),
			('usr_detailed', 'detailed@example.test', now(), now());
		INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES
			('ws_heidi', 'usr_brief', 'owner', now()), ('ws_heidi', 'usr_detailed', 'member', now());
		INSERT INTO heidi_memory (workspace_id, user_id, enabled, reply_style, topics) VALUES
			('ws_heidi', 'usr_brief', true, 'brief', '{"list_clients":2}'),
			('ws_heidi', 'usr_detailed', false, 'detailed', '{}');
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := migrations.UpTo(ctx, 90); err != nil {
		t.Fatal(err)
	}
	var kept int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM heidi_memory m WHERE NOT (to_jsonb(m) ? 'reply_style')
		AND ((user_id='usr_brief' AND enabled AND topics='{"list_clients":2}')
			OR (user_id='usr_detailed' AND NOT enabled AND topics='{}'))`).Scan(&kept); err != nil || kept != 2 {
		t.Fatalf("preserved memory rows without reply style: %d, %v", kept, err)
	}
	if _, err := migrations.DownTo(ctx, 89); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM heidi_memory WHERE reply_style='auto'`).Scan(&kept); err != nil || kept != 2 {
		t.Fatalf("memory rows with default reply style after rollback: %d, %v", kept, err)
	}
}
