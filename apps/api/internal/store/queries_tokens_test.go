package store

import (
	"context"
	"slices"
	"testing"
)

// TestAPITokenScopesMigration: 00063 turns a read token into read:* and a write token into read:* + write:*, and
// its Down maps any write scope back to a write token.
func TestAPITokenScopesMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 62); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO workspaces (id, name, timezone, created_at) VALUES ('wsp_a', 'A', 'UTC', now())`,
		`INSERT INTO users (id, email, name, created_at, updated_at) VALUES ('usr_a', 'a@example.com', 'A', now(), now())`,
		`INSERT INTO api_tokens (id, user_id, workspace_id, name, scope, token_hash, prefix, created_at) VALUES
			('tok_r', 'usr_a', 'wsp_a', 'Reader', 'read', repeat('a', 64), 'hvt_AAAA', now()),
			('tok_w', 'usr_a', 'wsp_a', 'Writer', 'write', repeat('b', 64), 'hvt_BBBB', now())`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := p.UpTo(ctx, 63); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string][]string{"tok_r": {"read:*"}, "tok_w": {"read:*", "write:*"}} {
		var got []string
		if err := pool.QueryRow(ctx, `SELECT scopes FROM api_tokens WHERE id = $1`, id).Scan(&got); err != nil || !slices.Equal(got, want) {
			t.Fatalf("%s: %v %v, want %v", id, got, err, want)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO api_tokens (id, user_id, workspace_id, name, scopes, token_hash, prefix, created_at) VALUES
		('tok_n', 'usr_a', 'wsp_a', 'Narrow', '{read:clients,write:clients}', repeat('c', 64), 'hvt_CCCC', now())`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE api_tokens SET scopes = '{}' WHERE id = 'tok_r'`); err == nil {
		t.Fatal("a token without scopes was accepted")
	}
	if _, err := p.DownTo(ctx, 62); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]string{"tok_r": "read", "tok_w": "write", "tok_n": "write"} {
		var got string
		if err := pool.QueryRow(ctx, `SELECT scope FROM api_tokens WHERE id = $1`, id).Scan(&got); err != nil || got != want {
			t.Fatalf("down %s: %q %v, want %q", id, got, err, want)
		}
	}
}

// TestAPITokenScopeReportsMigration: 00064 renames the dashboard scope to reports and leaves other scopes alone.
func TestAPITokenScopeReportsMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 63); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO workspaces (id, name, timezone, created_at) VALUES ('wsp_a', 'A', 'UTC', now())`,
		`INSERT INTO users (id, email, name, created_at, updated_at) VALUES ('usr_a', 'a@example.com', 'A', now(), now())`,
		`INSERT INTO api_tokens (id, user_id, workspace_id, name, scopes, token_hash, prefix, created_at) VALUES
			('tok_d', 'usr_a', 'wsp_a', 'Figures', '{read:clients,read:dashboard}', repeat('a', 64), 'hvt_AAAA', now()),
			('tok_o', 'usr_a', 'wsp_a', 'Other', '{read:*}', repeat('b', 64), 'hvt_BBBB', now())`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	check := func(step string, want map[string][]string) {
		t.Helper()
		for id, w := range want {
			var got []string
			if err := pool.QueryRow(ctx, `SELECT scopes FROM api_tokens WHERE id = $1`, id).Scan(&got); err != nil || !slices.Equal(got, w) {
				t.Fatalf("%s %s: %v %v, want %v", step, id, got, err, w)
			}
		}
	}
	if _, err := p.UpTo(ctx, 64); err != nil {
		t.Fatal(err)
	}
	check("up", map[string][]string{"tok_d": {"read:clients", "read:reports"}, "tok_o": {"read:*"}})
	if _, err := p.DownTo(ctx, 63); err != nil {
		t.Fatal(err)
	}
	check("down", map[string][]string{"tok_d": {"read:clients", "read:dashboard"}, "tok_o": {"read:*"}})
}
