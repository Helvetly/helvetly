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

// migrationProvider: goose on a fresh, empty schema, to run migrations one at a time around test data.
func migrationProvider(t *testing.T, options ...goose.ProviderOption) (*goose.Provider, *pgxpool.Pool) {
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
	p, err := goose.NewProvider(goose.DialectPostgres, db, files, options...)
	if err != nil {
		t.Fatal(err)
	}
	return p, pool
}

func TestMigrateFromDocumentRecordTags(t *testing.T) {
	ctx := context.Background()
	// The document record tags release went directly from version 70 to 74.
	released, pool := migrationProvider(t, goose.WithExcludeVersions([]int64{71, 72, 73}))
	if _, err := released.UpTo(ctx, 74); err != nil {
		t.Fatal(err)
	}
	if err := migrate(ctx, pool); err != nil {
		t.Fatal(err)
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

// TestDownUp: the squashed migration's Down removes everything its Up made, so Up runs again on the same schema.
func TestDownUp(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	for _, step := range []func(context.Context) error{
		func(ctx context.Context) error { _, err := p.Up(ctx); return err },
		func(ctx context.Context) error { _, err := p.DownTo(ctx, 0); return err },
		func(ctx context.Context) error { _, err := p.Up(ctx); return err },
	} {
		if err := step(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM limits`).Scan(&n); err != nil || n == 0 {
		t.Fatalf("limits has %d rows after Down and Up: %v", n, err)
	}
}
