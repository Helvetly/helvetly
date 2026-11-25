// Package store is the PostgreSQL database: the connection pool, the embedded migrations (goose, applied
// on Open) and hand-written queries (queries.go).
package store

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

//go:embed migrations/*.sql
var migrations embed.FS

// ErrNotFound: a query for one row found none.
var ErrNotFound = pgx.ErrNoRows

// Store runs queries on the pool (the embedded Q) or in a transaction (Tx).
type Store struct {
	Q
	pool *pgxpool.Pool
}

// Q runs the queries on a pool or a transaction.
type Q struct {
	db          dbtx
	adminAlerts bool
	admission   Admission
	features    FeatureGate
	waits       AutomationWait
	period      string // the quota month of the usage being admitted (AdmissionPeriod)
}

type dbtx interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// defaultMaxConns replaces pgxpool's max(4, NumCPU): some requests hold a transaction across S3, SMTP or Stripe
// calls, so a handful of slow ones would otherwise starve every other request.
const defaultMaxConns = 20

// defaultConnectTimeout bounds each dial when url sets no connect_timeout: without it an unreachable host holds startup
// and every redial during an outage for the OS TCP timeout (minutes) instead of failing fast.
const defaultConnectTimeout = 10 * time.Second

// poolConfig parses url and applies defaultMaxConns and defaultConnectTimeout unless url sets pool_max_conns or
// connect_timeout.
func poolConfig(url string) (*pgxpool.Config, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	if !strings.Contains(url, "pool_max_conns") {
		cfg.MaxConns = defaultMaxConns
	}
	if cfg.ConnConfig.ConnectTimeout == 0 {
		cfg.ConnConfig.ConnectTimeout = defaultConnectTimeout
	}
	return cfg, nil
}

// Open connects to the database and brings its schema up to date.
func Open(ctx context.Context, url string) (*Store, error) {
	cfg, err := poolConfig(url)
	if err != nil {
		return nil, fmt.Errorf("database: %w", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database: %w", err)
	}
	if err := migrate(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{Q: Q{db: pool}, pool: pool}, nil
}

// migrate applies the migrations under a session advisory lock, so instances starting at once take turns. The lock
// id is the schema's, so separate schemas (the tests') do not wait on each other.
func migrate(ctx context.Context, pool *pgxpool.Pool) error {
	files, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return err
	}
	var lockID int64
	if err := pool.QueryRow(ctx, `SELECT hashtextextended('goose:' || current_schema(), 0)`).Scan(&lockID); err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	locker, err := lock.NewPostgresSessionLocker(lock.WithLockID(lockID), lock.WithLockTimeout(1, 300))
	if err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	p, err := goose.NewProvider(goose.DialectPostgres, db, files, goose.WithSessionLocker(locker))
	if err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	if _, err := p.Up(ctx); err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	return nil
}

func (s *Store) Close() { s.pool.Close() }

// on is q on another connection or transaction, with the same admission and feature gate.
func (q Q) on(db dbtx) Q {
	q.db = db
	return q
}

// Ping checks that the database answers (readiness).
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// Tx runs fn in a transaction, committed when fn returns nil.
func (s *Store) Tx(ctx context.Context, fn func(Q) error) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error { return fn(s.Q.on(tx)) })
}

// MigrationsHash identifies the embedded migrations, so a database migrated once can be reused until they change.
func MigrationsHash() (string, error) {
	h := sha256.New()
	err := fs.WalkDir(migrations, "migrations", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := migrations.ReadFile(path)
		if err != nil {
			return err
		}
		fmt.Fprintf(h, "%s\x00%d\x00", path, len(b))
		h.Write(b)
		return nil
	})
	return hex.EncodeToString(h.Sum(nil)), err
}
