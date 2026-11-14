package products

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestConcurrentPartialUpdatesKeepBothChanges(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	p := e.create(b, map[string]string{"name": "Original", "unit_price": "100.00"})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	blocker, err := e.raw.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback(context.Background())
	var blockerPID int
	if err := blocker.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&blockerPID); err != nil {
		t.Fatal(err)
	}
	if _, err := blocker.Exec(ctx, "SELECT id FROM products WHERE id = $1 FOR UPDATE", p.ID); err != nil {
		t.Fatal(err)
	}
	results := make(chan int, 2)
	for _, body := range []map[string]string{{"name": "Renamed"}, {"unit_price": "125.00"}} {
		go func() {
			res, _ := e.send(b, http.MethodPatch, "/api/v1/products/"+p.ID, body)
			results <- res.StatusCode
		}()
	}
	// Both edits reach the same row while its previous version is still visible to ordinary reads.
	for {
		var waiting int
		if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity a
			WHERE $1 = ANY(pg_blocking_pids(a.pid)) OR EXISTS (
				SELECT 1 FROM unnest(pg_blocking_pids(a.pid)) AS b(pid)
				WHERE $1 = ANY(pg_blocking_pids(b.pid)))`, blockerPID).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting == 2 {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("both edits did not reach the product lock")
		case <-time.After(5 * time.Millisecond):
		}
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if code := <-results; code != http.StatusOK {
			t.Fatalf("partial update returned %d", code)
		}
	}
	var out struct{ Data product }
	e.do(b, http.MethodGet, "/api/v1/products/"+p.ID, nil, http.StatusOK, &out)
	if out.Data.Name != "Renamed" || out.Data.UnitPrice != "125.00" {
		t.Fatalf("one concurrent edit was lost: name %q, price %s", out.Data.Name, out.Data.UnitPrice)
	}
}
