package store

import (
	"context"
	"time"
)

// SchedAutoAttendDue lists up to limit scheduled or rescheduled occurrences of live workspaces whose settings set
// auto_attended_after_hours and that ended at least that many hours before now, the longest ended first. The job
// marks each attended in a transaction of its own (re-checked under the lock), so a run on two instances is harmless.
func (q Q) SchedAutoAttendDue(ctx context.Context, now time.Time, limit int) ([]SchedOccurrence, error) {
	return collectOccurrences(q.db.Query(ctx, `SELECT `+occurrenceColumns+` FROM scheduling_occurrences o
		JOIN scheduling_settings s ON s.workspace_id = o.workspace_id AND s.auto_attended_after_hours IS NOT NULL
		JOIN workspaces w ON w.id = o.workspace_id AND w.deleted_at IS NULL
		WHERE o.status IN ('scheduled', 'rescheduled') AND o.ends_at <= $1::timestamptz - make_interval(hours => s.auto_attended_after_hours)
		ORDER BY o.ends_at, o.id LIMIT $2`, now, limit))
}
