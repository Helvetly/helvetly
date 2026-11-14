package retention

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/retention/retentiontest"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// commit requests protection the way a record's transaction does, for a record of 2 January 2026.
func commit(t *testing.T, db *store.Store, files any, now time.Time, keys ...string) {
	t.Helper()
	err := db.Tx(context.Background(), func(q store.Q) error {
		for _, k := range keys {
			if err := Request(context.Background(), q, files, "ws_1", k, "2026-01-02", now); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func status(t *testing.T, db *store.Store, key string) store.ObjectRetention {
	t.Helper()
	r, err := db.Retention(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// due counts the objects a job could still claim, without claiming them.
func due(t *testing.T, db *store.Store) int {
	t.Helper()
	n := 0
	err := db.Tx(context.Background(), func(q store.Q) error {
		got, err := q.ClaimRetentions(context.Background(), time.Now().Add(100*365*24*time.Hour), 0, 1000)
		n = len(got)
		if err != nil {
			return err
		}
		return errors.New("rollback: only counting")
	})
	if err != nil && err.Error() != "rollback: only counting" {
		t.Fatal(err)
	}
	return n
}

func TestConfirmedLockStaysRecorded(t *testing.T) {
	t.Parallel()
	db, _ := storetest.New(t)
	files := &retentiontest.Lock{}
	now := time.Now()
	commit(t, db, files, now, "a.pdf")
	Settle(context.Background(), db, files, quiet, "a.pdf")
	r := status(t, db, "a.pdf")
	want := time.Date(2037, 1, 1, 14, 0, 0, 0, time.UTC) // the end of 2036, ten years after the record's year
	if r.Status != store.RetentionConfirmed || r.VersionID == nil || *r.VersionID != "v-a.pdf" || r.LockedUntil == nil ||
		!r.LockedUntil.Equal(want) || !files.Until("a.pdf").Equal(want) || due(t, db) != 0 {
		t.Fatalf("confirmed: %+v, locked to %v, due %d", r, files.Until("a.pdf"), due(t, db))
	}
}

func TestProtectionOffQueuesNothingAndConfirmsNothing(t *testing.T) {
	t.Parallel()
	db, _ := storetest.New(t)
	for name, files := range map[string]any{"off": &retentiontest.Lock{Off: true}, "no lock at all": struct{}{}} {
		key := name + ".pdf"
		commit(t, db, files, time.Now(), key)
		Settle(context.Background(), db, files, quiet, key)
		if r := status(t, db, key); r.Status != store.RetentionNotRequested || r.RequestedMode != nil {
			t.Fatalf("%s: %+v", name, r)
		}
	}
	if due(t, db) != 0 {
		t.Fatal("protection off left work for the job")
	}
}

func TestStorageThatCannotLockNeverConfirms(t *testing.T) {
	t.Parallel()
	db, _ := storetest.New(t)
	commit(t, db, &retentiontest.Lock{}, time.Now(), "a.pdf") // requested while protection was on
	if err := NewJob(db, struct{}{}, quiet).Tick(context.Background(), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if r := status(t, db, "a.pdf"); r.Status != store.RetentionFailed || r.LastError == nil {
		t.Fatalf("no lock: %+v", r)
	}
}

func TestFailedLockIsRetriedByTheJob(t *testing.T) {
	t.Parallel()
	db, _ := storetest.New(t)
	files := &retentiontest.Lock{Fail: errors.New("s3 unavailable")}
	now := time.Now()
	commit(t, db, files, now, "a.pdf")
	Settle(context.Background(), db, files, quiet, "a.pdf")
	if r := status(t, db, "a.pdf"); r.Status != store.RetentionFailed || r.LastError == nil || *r.LastError != "s3 unavailable" {
		t.Fatalf("failed lock: %+v", r)
	}
	job := NewJob(db, files, quiet)
	files.SetFail(nil)
	if err := job.Tick(context.Background(), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if files.Count("a.pdf") != 0 {
		t.Fatal("the job retried before the backoff")
	}
	if err := job.Tick(context.Background(), now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if r := status(t, db, "a.pdf"); files.Count("a.pdf") != 1 || r.Status != store.RetentionConfirmed || r.LastError != nil {
		t.Fatalf("after the retry: locked %d, %+v", files.Count("a.pdf"), r)
	}
	// the deadline comes from the record, not from when the retry ran
	if !files.Until("a.pdf").Equal(time.Date(2037, 1, 1, 14, 0, 0, 0, time.UTC)) {
		t.Fatalf("locked to %v", files.Until("a.pdf"))
	}
}

func TestConfirmedIsNeverSetBackByALateFailure(t *testing.T) {
	t.Parallel()
	db, _ := storetest.New(t)
	files := &retentiontest.Lock{}
	commit(t, db, files, time.Now(), "a.pdf")
	Settle(context.Background(), db, files, quiet, "a.pdf")
	if err := db.RetentionFailed(context.Background(), "a.pdf", "late", time.Now()); err != nil {
		t.Fatal(err)
	}
	if r := status(t, db, "a.pdf"); r.Status != store.RetentionConfirmed {
		t.Fatalf("set back: %+v", r)
	}
}

func TestCrashBetweenCommitAndLockIsHealed(t *testing.T) {
	t.Parallel()
	db, _ := storetest.New(t)
	files := &retentiontest.Lock{}
	now := time.Now()
	commit(t, db, files, now, "b.pdf") // the process dies here: Settle never runs
	if err := NewJob(db, files, quiet).Tick(context.Background(), now.Add(store.RetentionGrace)); err != nil {
		t.Fatal(err)
	}
	if files.Count("b.pdf") != 1 || status(t, db, "b.pdf").Status != store.RetentionConfirmed {
		t.Fatalf("healed: locked %d, %+v", files.Count("b.pdf"), status(t, db, "b.pdf"))
	}
}

func TestRollbackLeavesNothing(t *testing.T) {
	t.Parallel()
	db, _ := storetest.New(t)
	err := db.Tx(context.Background(), func(q store.Q) error {
		if err := Request(context.Background(), q, &retentiontest.Lock{}, "ws_1", "c.pdf", "2026-01-02", time.Now()); err != nil {
			return err
		}
		return errors.New("the record failed")
	})
	if _, getErr := db.Retention(context.Background(), "c.pdf"); err == nil || !errors.Is(getErr, store.ErrNotFound) {
		t.Fatalf("rolled back: err %v, row %v", err, getErr)
	}
}

func TestConcurrentJobsLockEachObjectOnce(t *testing.T) {
	t.Parallel()
	db, _ := storetest.New(t)
	files := &retentiontest.Lock{}
	now := time.Now()
	keys := make([]string, 250)
	for i := range keys {
		keys[i] = "k" + string(rune('a'+i%26)) + time.Duration(i).String() + ".pdf"
	}
	commit(t, db, files, now, keys...)
	var wg sync.WaitGroup
	for range 3 {
		wg.Go(func() {
			if err := NewJob(db, files, quiet).Tick(context.Background(), now.Add(time.Hour)); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	for _, k := range keys {
		if n := files.Count(k); n != 1 {
			t.Fatalf("%s locked %d times", k, n)
		}
	}
	if n := due(t, db); n != 0 {
		t.Fatalf("pending after the jobs: %d", n)
	}
}

func TestRequestWhileOffIsUpgradedByARequestWithAMode(t *testing.T) {
	t.Parallel()
	db, _ := storetest.New(t)
	commit(t, db, &retentiontest.Lock{Off: true}, time.Now(), "a.pdf")
	commit(t, db, &retentiontest.Lock{}, time.Now(), "a.pdf")
	if r := status(t, db, "a.pdf"); r.Status != store.RetentionPending || r.RequestedMode == nil {
		t.Fatalf("upgraded: %+v", r)
	}
}

func TestDeadline(t *testing.T) {
	for day, want := range map[string]string{"2026-01-02": "2037-01-01", "2026-12-31": "2037-01-01", "2030-06-15": "2041-01-01"} {
		if got := Deadline(day); got == nil || got.Format(time.DateOnly) != want || got.Hour() != 14 {
			t.Errorf("Deadline(%s) = %v, want %s 14:00 UTC", day, got, want)
		}
	}
	if Deadline("") != nil {
		t.Error("an unknown day has no deadline")
	}
}

func TestBackoffDoublesUpToADay(t *testing.T) {
	for attempts, want := range map[int]time.Duration{0: 5 * time.Minute, 1: 10 * time.Minute, 3: 40 * time.Minute, 20: 24 * time.Hour} {
		if got := delay(attempts); got != want {
			t.Errorf("delay(%d) = %v, want %v", attempts, got, want)
		}
	}
}

// A later record day (a signature's original once it is signed) extends a confirmed lock; an earlier one never
// shortens it, and a failed extension keeps the confirmed lock it had.
func TestLaterDeadlineExtendsAConfirmedLock(t *testing.T) {
	t.Parallel()
	db, _ := storetest.New(t)
	files := &retentiontest.Lock{}
	ctx := context.Background()
	request := func(day string) {
		t.Helper()
		if err := db.Tx(ctx, func(q store.Q) error { return Request(ctx, q, files, "ws_1", "o.pdf", day, time.Now()) }); err != nil {
			t.Fatal(err)
		}
	}
	request("2026-12-31")
	Settle(ctx, db, files, quiet, "o.pdf")
	request("2025-06-01") // earlier: nothing changes
	if r := status(t, db, "o.pdf"); r.NeedsLock() || r.RequestedUntil.Year() != 2037 {
		t.Fatalf("an earlier day changed the request: %+v", r)
	}
	request("2027-01-02")
	files.SetFail(errors.New("s3 unavailable"))
	Settle(ctx, db, files, quiet, "o.pdf")
	if r := status(t, db, "o.pdf"); r.Status != store.RetentionConfirmed || r.LockedUntil.Year() != 2037 || r.LastError == nil || !r.NeedsLock() {
		t.Fatalf("failed extension: %+v", r)
	}
	files.SetFail(nil)
	if err := NewJob(db, files, quiet).Tick(ctx, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	want := time.Date(2038, 1, 1, 14, 0, 0, 0, time.UTC)
	if r := status(t, db, "o.pdf"); r.Status != store.RetentionConfirmed || !r.LockedUntil.Equal(want) || r.NeedsLock() ||
		r.LastError != nil || files.Count("o.pdf") != 2 {
		t.Fatalf("extended: %+v, locked %d times", r, files.Count("o.pdf"))
	}
}
