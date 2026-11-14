package documents

import (
	"context"
	"errors"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

func TestConcurrentFolderMovesCannotCreateCycle(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	a, z := auth.NewID("fld"), auth.NewID("fld")
	for _, id := range []string{a, z} {
		if err := e.st.CreateFolder(ctx, b.workspace, id, id, nil, b.user, time.Now()); err != nil {
			t.Fatal(err)
		}
	}

	blocker, err := e.raw.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback(context.Background())
	var blockerPID int
	if err := blocker.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&blockerPID); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{a, z} {
		if _, err := blocker.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1 || '/' || $2, 0))`, b.workspace, id); err != nil {
			t.Fatal(err)
		}
	}

	sess := store.Session{Workspace: store.Workspace{ID: b.workspace}, User: store.User{ID: b.user}, Role: "owner"}
	results := make(chan error, 2)
	for _, move := range [][2]string{{a, z}, {z, a}} {
		go func() {
			results <- e.st.Tx(ctx, func(q store.Q) error {
				return e.svc.placeFolder(q, ctx, sess, move[0], move[0], &move[1], "fail")
			})
		}()
	}

	// Hold both destination locks until both moves have reached a database lock. A serialised tree
	// change blocks the second move behind the first, which itself waits on the test's destination lock.
	for {
		var waiting int
		err := e.raw.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity a
			WHERE $1 = ANY(pg_blocking_pids(a.pid)) OR EXISTS (
				SELECT 1 FROM unnest(pg_blocking_pids(a.pid)) AS b(pid)
				WHERE $1 = ANY(pg_blocking_pids(b.pid)))`, blockerPID).Scan(&waiting)
		if err != nil {
			t.Fatal(err)
		}
		if waiting == 2 {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("folder moves did not reach the locks")
		case <-time.After(5 * time.Millisecond):
		}
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var succeeded int
	for range 2 {
		if err := <-results; err == nil {
			succeeded++
		} else {
			var p *problem
			if !errors.As(err, &p) || p.reason != "A folder can't move into itself." {
				t.Fatalf("move failed for an unexpected reason: %v", err)
			}
		}
	}
	if succeeded != 1 {
		t.Fatalf("%d moves succeeded; want exactly one, with the inverse move rejected", succeeded)
	}
	var cycle bool
	if err := e.raw.QueryRow(ctx, `SELECT coalesce(a.parent_id = b.id AND b.parent_id = a.id, false)
		FROM document_folders a CROSS JOIN document_folders b WHERE a.id = $1 AND b.id = $2`, a, z).Scan(&cycle); err != nil {
		t.Fatal(err)
	}
	if cycle {
		t.Fatal("the folder tree contains a cycle")
	}
}
