// Package storetest gives each test its own database, cloned from a template migrated once per set of migrations
// and dropped when the test ends, so tests run in parallel, skip the migrations and leave nothing behind.
package storetest

import (
	"context"
	"crypto/rand"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/store"
)

const defaultURL = "postgres://helvetly:helvetly@localhost:5433/helvetly?sslmode=disable"

var (
	templateOnce sync.Once
	templateName string
	templateErr  error
)

// New returns a store on a fresh database, and a pool on the same database for raw SQL in the test.
func New(t *testing.T) (*store.Store, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	base := os.Getenv("HELVETLY_TEST_DATABASE_URL")
	if base == "" {
		base = defaultURL
	}
	u, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	// Small pools: every parallel test of every package holds its own, and Postgres allows 100 connections.
	q := u.Query()
	q.Set("pool_max_conns", "1")
	u.RawQuery = q.Encode()
	admin, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	templateOnce.Do(func() { templateName, templateErr = migratedTemplate(ctx, admin, *u) })
	if templateErr != nil {
		t.Fatalf("test template database (is Postgres up? `pnpm infra:up`): %v", templateErr)
	}
	name := randomName("test_")
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name+" TEMPLATE "+templateName); err != nil {
		t.Fatalf("create test database: %v", err)
	}
	// Registered before the pools below, so it runs after they close; FORCE ends any connection still open.
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP DATABASE "+name+" WITH (FORCE)"); err != nil {
			t.Errorf("drop test database: %v", err)
		}
	})

	u.Path = "/" + name
	q.Set("pool_max_conns", "2")
	u.RawQuery = q.Encode()
	s, err := store.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	raw, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(raw.Close)
	return s, raw
}

// migratedTemplate returns the name of a database holding the current migrations, building it once across every test
// process. It is built under another name and renamed when complete, so a crashed build is never cloned.
func migratedTemplate(ctx context.Context, admin *pgxpool.Pool, u url.URL) (string, error) {
	hash, err := store.MigrationsHash()
	if err != nil {
		return "", err
	}
	name := "helvetly_template_" + hash[:16]
	conn, err := admin.Acquire(ctx)
	if err != nil {
		return "", err
	}
	defer conn.Release()
	lock := fmt.Sprintf("hashtextextended('storetest:%s', 0)", name)
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock("+lock+")"); err != nil {
		return "", err
	}
	defer func() { _, _ = conn.Exec(ctx, "SELECT pg_advisory_unlock("+lock+")") }()
	var exists bool
	if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", name).Scan(&exists); err != nil {
		return "", err
	}
	if exists {
		return name, nil
	}
	build := randomName("build_")
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+build); err != nil {
		return "", err
	}
	u.Path = "/" + build
	q := u.Query()
	q.Set("pool_max_conns", "2") // goose holds one connection for its lock while migrating on another
	u.RawQuery = q.Encode()
	s, err := store.Open(ctx, u.String())
	if err == nil {
		s.Close()
		_, err = conn.Exec(ctx, "ALTER DATABASE "+build+" RENAME TO "+name)
	}
	if err != nil {
		_, _ = conn.Exec(ctx, "DROP DATABASE IF EXISTS "+build+" WITH (FORCE)")
		return "", err
	}
	return name, nil
}

func randomName(prefix string) string { return prefix + strings.ToLower(rand.Text()[:12]) }

// OutdateAIConsent makes a person's AI approvals in a workspace name an earlier notice, as a deploy of a new notice
// version does to every row written before it.
func OutdateAIConsent(t *testing.T, raw *pgxpool.Pool, workspaceID, userID string) {
	t.Helper()
	if _, err := raw.Exec(context.Background(), `UPDATE workspace_ai_consents SET version = '2000-01-01'
		WHERE workspace_id = $1 AND user_id = $2`, workspaceID, userID); err != nil {
		t.Fatal(err)
	}
}
