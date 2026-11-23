package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// The calendar sync jobs' own reads (internal/calsync): a connection by id alone (queued pushes, sources and watches
// name only it), a connection's links, and the watches to make, renew or drop.

// CalendarConnectionByID reads a connection of any workspace, for a job holding only its id; ErrNotFound for none.
func (q Q) CalendarConnectionByID(ctx context.Context, id string) (CalendarConnection, error) {
	return scanConnection(q.db.QueryRow(ctx, `SELECT `+connectionColumns+` FROM calendar_connections c WHERE c.id = $1`, id))
}

// CalendarLinksOfConnection lists every event the connection pushed (to remove them on disconnect or a calendar change).
func (q Q) CalendarLinksOfConnection(ctx context.Context, connectionID string) ([]CalendarLink, error) {
	rows, err := q.db.Query(ctx, `SELECT `+linkColumns+` FROM calendar_event_links WHERE connection_id = $1 ORDER BY occurrence_id`, connectionID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanLink)
}

// UnwatchedCalendarSources lists up to limit busy calendars of active connections in live workspaces that have no
// watch yet.
func (q Q) UnwatchedCalendarSources(ctx context.Context, limit int) ([]CalendarSource, error) {
	rows, err := q.db.Query(ctx, `SELECT s.connection_id, s.calendar_id, s.name, s.is_primary, s.busy, s.sync_token, s.due_at, s.full_resync
		FROM calendar_sources s JOIN calendar_connections c ON c.id = s.connection_id JOIN workspaces w ON w.id = c.workspace_id
		WHERE s.busy AND c.status = 'active' AND w.deleted_at IS NULL
			AND NOT EXISTS (SELECT 1 FROM calendar_watches x WHERE x.connection_id = s.connection_id AND x.calendar_id = s.calendar_id)
		ORDER BY s.due_at LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanSource)
}

// OrphanCalendarWatches lists up to limit watches nothing needs: their calendar is no longer imported, or a second
// one on the same calendar (the older go first), or their connection is not active.
func (q Q) OrphanCalendarWatches(ctx context.Context, limit int) ([]CalendarWatch, error) {
	rows, err := q.db.Query(ctx, `SELECT `+watchColumns+` FROM calendar_watches x WHERE NOT EXISTS (
			SELECT 1 FROM calendar_sources s JOIN calendar_connections c ON c.id = s.connection_id
			WHERE s.connection_id = x.connection_id AND s.calendar_id = x.calendar_id AND s.busy AND c.status = 'active')
		OR EXISTS (SELECT 1 FROM calendar_watches y WHERE y.connection_id = x.connection_id AND y.calendar_id = x.calendar_id
			AND (y.expires_at, y.id) > (x.expires_at, x.id))
		ORDER BY x.expires_at LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanWatch)
}

// ExpireCalendarWatch makes the watch expire now, so the next round renews it (Microsoft asked for reauthorisation).
func (q Q) ExpireCalendarWatch(ctx context.Context, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE calendar_watches SET expires_at = $2 WHERE id = $1`, id, now)
	return err
}

// RebaselineCalendarSources makes every busy calendar of the provider's connections due for a full sync (a Microsoft
// delta link's window is fixed when it is made, so it is renewed weekly).
func (q Q) RebaselineCalendarSources(ctx context.Context, provider string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE calendar_sources s SET full_resync = true, due_at = least(s.due_at, $2)
		FROM calendar_connections c WHERE c.id = s.connection_id AND c.provider = $1 AND s.busy`, provider, now)
	return err
}

// CalendarBusyIDs lists the connection's busy blocks whose external id starts with prefix (one calendar's, before its
// full sync replaces them).
func (q Q) CalendarBusyIDs(ctx context.Context, connectionID, prefix string) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT external_id FROM calendar_busy WHERE connection_id = $1 AND starts_with(external_id, $2)
		ORDER BY external_id`, connectionID, prefix)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}
