package invoices

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"helvetly.com/api/internal/retention"
	"helvetly.com/api/internal/retention/retentiontest"
	"helvetly.com/api/internal/store"
)

// lockingStorage is storage with Object Lock, down while Fail is set.
type lockingStorage struct {
	*fakeStorage
	retentiontest.Lock
}

func TestIssuedPDFLockFailureIsRetriedByTheJob(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	e.svc.files = &lockingStorage{fakeStorage: e.files, Lock: retentiontest.Lock{Fail: errors.New("s3 unavailable")}}
	inv := e.issued(b, clientID, nil) // issued although the lock failed
	pdfs := e.files.has(inv.ID)
	if len(pdfs) != 1 {
		t.Fatalf("issued PDFs %v", pdfs)
	}
	if r, err := e.st.Retention(context.Background(), pdfs[0]); err != nil || r.Status != store.RetentionFailed {
		t.Fatalf("after the failed lock: %+v %v", r, err)
	}
	healed := &lockingStorage{fakeStorage: e.files}
	if err := retention.NewJob(e.st, healed, slog.New(slog.NewTextHandler(io.Discard, nil))).Tick(context.Background(), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if keys := healed.Keys(); len(keys) != 1 || keys[0] != pdfs[0] {
		t.Fatalf("the job locked %v, want the issued PDF %v", keys, pdfs)
	}
	if r, _ := e.st.Retention(context.Background(), pdfs[0]); r.Status != store.RetentionConfirmed ||
		r.LockedUntil == nil || r.LockedUntil.Year() != time.Now().Year()+11 {
		t.Fatalf("confirmed to the end of the tenth business year: %+v", r)
	}
	left, err := e.st.ClaimRetentions(context.Background(), time.Now().Add(48*time.Hour), time.Hour, 10)
	if err != nil || len(left) != 0 {
		t.Fatalf("still pending: %v %v", left, err)
	}
}

// An invoice issued while protection was off says not_requested; the backfill lists it only in preview, queues it with
// -apply, and finds nothing more on the next run. A legacy PDF with no row at all is found the same way.
func TestBackfillQueuesRecordsMadeWithoutProtection(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	ctx := context.Background()
	first, second := e.files.has(e.issued(b, clientID, nil).ID)[0], e.files.has(e.issued(b, clientID, nil).ID)[0]
	if r, err := e.st.Retention(ctx, first); err != nil || r.Status != store.RetentionNotRequested {
		t.Fatalf("issued with protection off: %+v %v", r, err)
	}
	if _, err := e.raw.Exec(ctx, `DELETE FROM object_retention WHERE object_key = $1`, second); err != nil { // as before rows were kept
		t.Fatal(err)
	}
	off, err := retention.Backfill(ctx, e.st, e.files, 100, true, time.Now())
	if err != nil || len(off) != 1 || off[0].Key != second {
		t.Fatalf("backfill with protection off: %v %v", off, err)
	}
	locking := &lockingStorage{fakeStorage: e.files}
	preview, err := retention.Backfill(ctx, e.st, locking, 100, false, time.Now())
	if err != nil || len(preview) != 2 {
		t.Fatalf("preview: %v %v", preview, err)
	}
	if r, _ := e.st.Retention(ctx, first); r.Status != store.RetentionNotRequested {
		t.Fatalf("the preview changed %s: %+v", first, r)
	}
	if done, err := retention.Backfill(ctx, e.st, locking, 1, true, time.Now()); err != nil || len(done) != 1 {
		t.Fatalf("first batch: %v %v", done, err)
	}
	if done, err := retention.Backfill(ctx, e.st, locking, 100, true, time.Now()); err != nil || len(done) != 1 {
		t.Fatalf("resumed: %v %v", done, err)
	}
	if left, err := retention.Backfill(ctx, e.st, locking, 100, false, time.Now()); err != nil || len(left) != 0 {
		t.Fatalf("left after the backfill: %v %v", left, err)
	}
	for _, key := range []string{first, second} {
		if r, _ := e.st.Retention(ctx, key); r.Status != store.RetentionPending || r.RequestedUntil == nil ||
			r.RequestedUntil.Year() != time.Now().Year()+11 {
			t.Fatalf("queued %s: %+v", key, r)
		}
	}
}
