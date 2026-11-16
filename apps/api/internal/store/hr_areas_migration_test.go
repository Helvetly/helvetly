package store

import (
	"context"
	"slices"
	"testing"
)

// TestHRAreasMigration: grants of the earlier finer HR scopes move to the employees or payroll area, the highest level
// winning; other scopes, members without HR access and owners stay as they were.
func TestHRAreasMigration(t *testing.T) {
	cases := []struct {
		name   string
		scopes []string
		want   []string
	}{
		{"no HR", []string{"*:*", "read:api"}, []string{"*:*", "read:api"}},
		{"areas already", []string{"read:*", "read:payroll", "write:employees"}, []string{"read:*", "read:payroll", "write:employees"}},
		{"documents to employees", []string{"read:clients", "read:employee-documents"}, []string{"read:clients", "read:employees"}},
		{"employees highest wins", []string{"read:employees", "write:employee-documents"}, []string{"write:employees"}},
		{"approval to payroll edit", []string{"read:payroll", "write:payroll-approval"}, []string{"write:payroll"}},
		{"export view stays view", []string{"read:payroll-export"}, []string{"read:payroll"}},
		{"any approval", []string{"*:payroll-approval", "read:employees"}, []string{"read:employees", "write:payroll"}},
	}
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 11); err != nil {
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
	if _, err := p.UpTo(ctx, 12); err != nil {
		t.Fatal(err)
	}
	for i, c := range cases {
		id := "usr_" + string(rune('a'+i))
		for _, table := range []string{"workspace_members WHERE user_id", "workspace_invitations WHERE id"} {
			var got []string
			if err := pool.QueryRow(ctx, `SELECT scopes FROM `+table+` = $1`, id).Scan(&got); err != nil {
				t.Fatal(err)
			}
			if slices.Sort(got); !slices.Equal(got, slices.Sorted(slices.Values(c.want))) {
				t.Errorf("%s (%s): %v, want %v", c.name, table, got, c.want)
			}
		}
	}
	var owner []string
	if err := pool.QueryRow(ctx, `SELECT scopes FROM workspace_members WHERE user_id = 'usr_owner'`).Scan(&owner); err != nil || owner != nil {
		t.Errorf("owner scopes %v: %v", owner, err)
	}
	if _, err := p.DownTo(ctx, 11); err != nil {
		t.Fatalf("down: %v", err)
	}
}
