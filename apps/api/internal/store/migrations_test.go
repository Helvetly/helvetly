package store

import (
	"context"
	"crypto/rand"
	"io/fs"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// TestClientFilesMoveToDocuments: 00007 turns every client file into a linked document (same id and object) in a
// "Clients" folder, and its Down gives them back.
func TestClientFilesMoveToDocuments(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 6); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO workspaces (id, name, timezone, created_at) VALUES ('wsp_a', 'A', 'UTC', now())`,
		`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at) VALUES
			('cli_1', 'wsp_a', 1, 'One', now(), now()), ('cli_2', 'wsp_a', 2, 'Two', now(), now())`,
		`INSERT INTO client_files (id, client_id, workspace_id, object_key, name, size, content_type, created_at) VALUES
			('fil_1', 'cli_1', 'wsp_a', 'k1', 'Offer.pdf', 10, 'application/pdf', now()),
			('fil_2', 'cli_2', 'wsp_a', 'k2', 'Offer.pdf', 20, 'application/pdf', now())`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := p.UpTo(ctx, 7); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM documents d JOIN document_folders f ON f.id = d.folder_id AND f.name = 'Clients'
		JOIN document_links l ON l.document_id = d.id AND l.target_type = 'client'
		WHERE (d.id, d.object_key, l.target_id) IN (('fil_1', 'k1', 'cli_1'), ('fil_2', 'k2', 'cli_2'))`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("moved %d of 2 files: %v", n, err)
	}
	if _, err := p.DownTo(ctx, 6); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM client_files WHERE (id, client_id, object_key) IN
		(('fil_1', 'cli_1', 'k1'), ('fil_2', 'cli_2', 'k2'))`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("restored %d of 2 files: %v", n, err)
	}
}

// migrationProvider: goose on a fresh, empty schema, to run migrations one at a time around test data.
func migrationProvider(t *testing.T) (*goose.Provider, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	base := os.Getenv("HELVETLY_TEST_DATABASE_URL")
	if base == "" {
		base = "postgres://helvetly:helvetly@localhost:5433/helvetly?sslmode=disable"
	}
	admin, err := pgxpool.New(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "test_" + strings.ToLower(rand.Text()[:12])
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") })
	u, _ := url.Parse(base)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	files, _ := fs.Sub(migrations, "migrations")
	db := stdlib.OpenDBFromPool(pool)
	t.Cleanup(func() { _ = db.Close() })
	p, err := goose.NewProvider(goose.DialectPostgres, db, files)
	if err != nil {
		t.Fatal(err)
	}
	return p, pool
}

// TestWorkspaceOnboarding: 00013 counts every workspace that exists as set up, so only new ones get the welcome.
func TestWorkspaceOnboarding(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 12); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO workspaces (id, name, timezone, created_at) VALUES ('wsp_old', 'Old', 'UTC', now())`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 13); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO workspaces (id, name, timezone, created_at) VALUES ('wsp_new', 'New', 'UTC', now())`); err != nil {
		t.Fatal(err)
	}
	var old, fresh bool
	if err := pool.QueryRow(ctx, `SELECT (SELECT onboarded_at IS NOT NULL FROM workspaces WHERE id = 'wsp_old'),
		(SELECT onboarded_at IS NOT NULL FROM workspaces WHERE id = 'wsp_new')`).Scan(&old, &fresh); err != nil {
		t.Fatal(err)
	}
	if !old || fresh {
		t.Fatalf("existing workspace set up: %v (want true); new one: %v (want false)", old, fresh)
	}
	if _, err := p.DownTo(ctx, 12); err != nil {
		t.Fatal(err)
	}
}

// TestConcurrentMigrate: instances starting at once with migrations pending all come up; the lock makes them take turns.
func TestConcurrentMigrate(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 1); err != nil { // the version table exists, so no instance waits out goose's create retry
		t.Fatal(err)
	}
	errs := make(chan error, 3)
	for range cap(errs) {
		go func() { errs <- migrate(ctx, pool) }()
	}
	for range cap(errs) {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	files, _ := fs.ReadDir(migrations, "migrations")
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM goose_db_version WHERE version_id > 0`).Scan(&n); err != nil || n != len(files) {
		t.Fatalf("%d of %d migrations recorded: %v", n, len(files), err)
	}
}

// TestConcurrentMigrateEmptySchema: the first deploy, where instances with their own pools (processes) all find an
// empty schema, still comes up with every migration applied once.
func TestConcurrentMigrateEmptySchema(t *testing.T) {
	ctx := context.Background()
	_, pool := migrationProvider(t)
	errs := make(chan error, 3)
	for range cap(errs) {
		go func() {
			own, err := pgxpool.New(ctx, pool.Config().ConnString())
			if err != nil {
				errs <- err
				return
			}
			defer own.Close()
			errs <- migrate(ctx, own)
		}()
	}
	for range cap(errs) {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	files, _ := fs.ReadDir(migrations, "migrations")
	var n, distinct int
	if err := pool.QueryRow(ctx, `SELECT count(*), count(DISTINCT version_id) FROM goose_db_version WHERE version_id > 0`).Scan(&n, &distinct); err != nil ||
		n != len(files) || distinct != n {
		t.Fatalf("%d rows, %d versions of %d migrations: %v", n, distinct, len(files), err)
	}
}

// TestFormerMembersTokensDeleted: 00066 deletes the API tokens of people no longer in the token's workspace and
// keeps current members' tokens.
func TestFormerMembersTokensDeleted(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 65); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO workspaces (id, name, timezone, created_at) VALUES ('wsp_a', 'A', 'UTC', now())`,
		`INSERT INTO users (id, email, created_at, updated_at) VALUES ('usr_in', 'in@example.test', now(), now()),
			('usr_out', 'out@example.test', now(), now())`,
		`INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ('wsp_a', 'usr_in', 'owner', now())`,
		`INSERT INTO api_tokens (id, user_id, workspace_id, name, scopes, token_hash, prefix, created_at) VALUES
			('tok_in', 'usr_in', 'wsp_a', 'In', ARRAY['read:*'], repeat('a', 64), 'hvt_a', now()),
			('tok_out', 'usr_out', 'wsp_a', 'Out', ARRAY['write:*'], repeat('b', 64), 'hvt_b', now())`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := p.UpTo(ctx, 66); err != nil {
		t.Fatal(err)
	}
	var ids []string
	rows, err := pool.Query(ctx, `SELECT id FROM api_tokens ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if len(ids) != 1 || ids[0] != "tok_in" {
		t.Fatalf("tokens left %v, want [tok_in]", ids)
	}
}
