// Package retention applies storage protection (S3 Object Lock) to the objects of committed business records and keeps
// its state. The record's transaction calls Request; Settle locks right after the commit and the job retries whatever a
// failure or a crash left pending. A row is confirmed only with the lock storage reported back for the object's
// version; with protection off (S3_OBJECT_LOCK_DAYS=0) rows say not_requested and nothing is queued.
package retention

import (
	"context"
	"log/slog"
	"time"

	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
)

// Retainer is the storage's lock (*storage.S3). A storage without one cannot protect: its rows never confirm.
type Retainer interface {
	RetentionMode() string // "" when protection is off
	RetainUntil(requested time.Time, deadline *time.Time) time.Time
	Retain(ctx context.Context, key string, until time.Time) (storage.Lock, error)
}

const (
	lease    = 15 * time.Minute // a claimed object is left to its job this long
	maxDelay = 24 * time.Hour
	batch    = 100
)

// Mode: the protection files apply, "" when off or when files cannot protect at all.
func Mode(files any) string {
	if r, ok := files.(Retainer); ok {
		return r.RetentionMode()
	}
	return ""
}

// Deadline: the end of the tenth business year after day (OR Art. 958f, GeBüV: ten years from the end of the business
// year the record was made in), as the instant the object may go; nil when day is not a civil date.
// shortcut: the business year is the calendar year; use the workspace's business year once it has one.
func Deadline(day string) *time.Time {
	d, err := time.Parse(time.DateOnly, day)
	if err != nil {
		return nil
	}
	end := time.Date(d.Year()+11, 1, 1, 0, 0, 0, 0, time.UTC).Add(14 * time.Hour) // 1 January 14:00 UTC: past 31 December in every time zone
	return &end
}

// Request records, in the caller's transaction, the protection key needs for a record made on day.
func Request(ctx context.Context, q store.Q, files any, workspaceID, key, day string, now time.Time) error {
	return q.RequestRetention(ctx, store.RetentionRequest{WorkspaceID: workspaceID, Key: key, Mode: Mode(files),
		Until: Deadline(day)}, now)
}

// Settle locks keys after their record committed; a failure stays recorded for the job.
func Settle(ctx context.Context, db *store.Store, files any, log *slog.Logger, keys ...string) {
	ctx = context.WithoutCancel(ctx)
	for _, key := range keys {
		row, err := db.Retention(ctx, key)
		if err != nil {
			log.ErrorContext(ctx, "read retention request", "key", key, "error", err)
			continue
		}
		if row.NeedsLock() {
			settle(ctx, db, files, log, row, time.Now())
		}
	}
}

// settle locks one object and records what storage confirmed, or the failure and when to retry.
func settle(ctx context.Context, db *store.Store, files any, log *slog.Logger, row store.ObjectRetention, now time.Time) {
	r, ok := files.(Retainer)
	if !ok || r.RetentionMode() == "" {
		fail(ctx, db, log, row, "storage protection is not configured (S3_OBJECT_LOCK_DAYS=0)", now)
		return
	}
	lock, err := r.Retain(ctx, row.Key, r.RetainUntil(row.RequestedAt, row.RequestedUntil))
	if err != nil {
		fail(ctx, db, log, row, err.Error(), now)
		return
	}
	if err := db.RetentionConfirmed(ctx, row.Key, lock.VersionID, lock.Mode, lock.Until, now); err != nil {
		log.ErrorContext(ctx, "record confirmed retention", "key", row.Key, "error", err)
	}
}

func fail(ctx context.Context, db *store.Store, log *slog.Logger, row store.ObjectRetention, reason string, now time.Time) {
	log.ErrorContext(ctx, "object not retained yet", "key", row.Key, "attempts", row.Attempts, "error", reason)
	if err := db.RetentionFailed(ctx, row.Key, reason, now.Add(delay(row.Attempts))); err != nil {
		log.ErrorContext(ctx, "record failed retention", "key", row.Key, "error", err)
	}
}

// delay: 5 minutes after the first failure, doubling, at most a day.
func delay(attempts int) time.Duration {
	d := store.RetentionGrace
	for range attempts {
		if d >= maxDelay {
			return maxDelay
		}
		d *= 2
	}
	return min(d, maxDelay)
}

// Job retries the pending locks. main runs it only while protection is on.
type Job struct {
	db    *store.Store
	files any
	log   *slog.Logger
}

func NewJob(db *store.Store, files any, log *slog.Logger) *Job { return &Job{db, files, log} }

// Run ticks every 10 minutes until ctx ends.
func (j *Job) Run(ctx context.Context) {
	tick := time.NewTicker(10 * time.Minute)
	defer tick.Stop()
	for {
		if err := j.Tick(ctx, time.Now()); err != nil {
			j.log.ErrorContext(ctx, "retention job", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// Tick locks every due pending object once, batch by batch.
func (j *Job) Tick(ctx context.Context, now time.Time) error {
	for {
		due, err := j.db.ClaimRetentions(ctx, now, lease, batch)
		if err != nil {
			return err
		}
		for _, row := range due {
			settle(ctx, j.db, j.files, j.log, row, now)
		}
		if len(due) < batch {
			return nil
		}
	}
}

// Backfill requests protection, with the current mode, for up to limit business-record objects that have none yet
// (records from before this state was kept, or made while protection was off); with apply false it only lists them.
// It touches no storage: the job then locks or verifies each object. Run it again until it finds nothing.
func Backfill(ctx context.Context, db *store.Store, files any, limit int, apply bool, now time.Time) ([]store.BusinessObject, error) {
	mode := Mode(files)
	todo, err := db.UnprotectedBusinessObjects(ctx, mode != "", limit)
	if err != nil || !apply {
		return todo, err
	}
	for _, b := range todo {
		if err := db.RequestRetention(ctx, store.RetentionRequest{WorkspaceID: b.WorkspaceID, Key: b.Key, Mode: mode,
			Until: Deadline(b.Day.Format(time.DateOnly))}, now); err != nil {
			return nil, err
		}
	}
	return todo, nil
}
