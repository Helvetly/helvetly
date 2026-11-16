package store

import (
	"context"
	"slices"
	"testing"
)

// TestMemberAreasMigration: the old "settings" area becomes view of each settings area at any level, members keep
// their API tokens, wildcards and owners stay as they were; Down folds the areas back into read:settings.
func TestMemberAreasMigration(t *testing.T) {
	areas := []string{"read:audit-log", "read:invoice-settings", "read:ledger", "read:periods", "read:vat-return", "read:workspace"}
	cases := []struct {
		name   string
		scopes []string
		want   []string
		down   []string
	}{
		{"full access", []string{"*:*"}, []string{"*:*"}, []string{"*:*"}},
		{"read only", []string{"read:*"}, []string{"read:*"}, []string{"read:*"}},
		{"former accountant", []string{"read:*", "write:invoices", "write:expenses"},
			[]string{"read:*", "write:expenses", "write:invoices"}, []string{"read:*", "write:expenses", "write:invoices"}},
		{"view settings", []string{"read:clients", "read:settings"},
			append([]string{"read:api", "read:clients"}, areas...), []string{"read:clients", "read:settings"}},
		{"write settings stays view", []string{"write:settings", "write:invoices"},
			slices.Concat([]string{"read:api"}, areas, []string{"write:invoices"}), []string{"read:settings", "write:invoices"}},
		{"any settings", []string{"*:settings"}, append([]string{"read:api"}, areas...), []string{"read:settings"}},
		{"no settings keeps tokens", []string{"write:invoices"}, []string{"read:api", "write:invoices"}, []string{"write:invoices"}},
		{"write wildcard", []string{"write:*"}, []string{"write:*"}, []string{"write:*"}},
	}
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 10); err != nil {
		t.Fatal(err)
	}
	mustExec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	mustExec(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws_1', 'A', now())`)
	mustExec(`INSERT INTO users (id, email, name, created_at, updated_at) VALUES ('usr_owner', 'o@x.ch', 'O', now(), now())`)
	mustExec(`INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ('ws_1', 'usr_owner', 'owner', now())`)
	for i, c := range cases {
		id := "usr_" + string(rune('a'+i))
		mustExec(`INSERT INTO users (id, email, name, created_at, updated_at) VALUES ($1, $1 || '@x.ch', 'M', now(), now())`, id)
		mustExec(`INSERT INTO workspace_members (workspace_id, user_id, role, scopes, created_at) VALUES ('ws_1', $1, 'member', $2, now())`, id, c.scopes)
		mustExec(`INSERT INTO workspace_invitations (id, workspace_id, email, role, scopes, token_hash, created_at, expires_at)
			VALUES ($1, 'ws_1', $1 || '@y.ch', 'member', $2, $1, now(), now())`, id, c.scopes)
	}
	check := func(stage string, want func(int) []string) {
		t.Helper()
		for i, c := range cases {
			id := "usr_" + string(rune('a'+i))
			for _, table := range []string{"workspace_members WHERE user_id", "workspace_invitations WHERE id"} {
				var got []string
				if err := pool.QueryRow(ctx, `SELECT scopes FROM `+table+` = $1`, id).Scan(&got); err != nil {
					t.Fatal(err)
				}
				// the stored order is the database's collation; compare as sets
				if slices.Sort(got); !slices.Equal(got, slices.Sorted(slices.Values(want(i)))) {
					t.Errorf("%s %s (%s): %v, want %v", stage, c.name, table, got, want(i))
				}
			}
		}
		var owner []string
		if err := pool.QueryRow(ctx, `SELECT scopes FROM workspace_members WHERE user_id = 'usr_owner'`).Scan(&owner); err != nil || owner != nil {
			t.Errorf("%s owner scopes %v: %v", stage, owner, err)
		}
	}
	if _, err := p.UpTo(ctx, 11); err != nil {
		t.Fatal(err)
	}
	check("up", func(i int) []string { return cases[i].want })
	if _, err := p.DownTo(ctx, 10); err != nil {
		t.Fatal(err)
	}
	check("down", func(i int) []string { return cases[i].down })
}
