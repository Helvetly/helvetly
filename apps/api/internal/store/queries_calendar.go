package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Calendar sync (00052_calendar_sync.sql): each member's Google or Microsoft connection per workspace, its calendars,
// push channels, imported busy times, pushed-event links, the push queue and the private iCal feed. Tokens arrive
// sealed (internal/calsync); nothing here is exported.

// CalendarConnection is a member's calendar account in one workspace.
type CalendarConnection struct {
	ID                string
	WorkspaceID       string
	UserID            string
	Provider          string // google | microsoft
	AccountEmail      string
	ExternalAccountID string
	Scopes            []string
	RefreshToken      []byte // sealed
	AccessToken       []byte // sealed
	AccessExpiresAt   *time.Time
	PushCalendarID    *string
	Status            string // active | revoked | error
	Error             *string
	LastSyncedAt      *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// ErrCalendarConnected: the member already has a connection of that provider in the workspace.
// ErrCalendarAccountInUse: another member of the workspace connected that account.
var (
	ErrCalendarConnected    = errors.New("calendar provider already connected")
	ErrCalendarAccountInUse = errors.New("calendar account in use")
)

const connectionColumns = `c.id, c.workspace_id, c.user_id, c.provider, c.account_email, c.external_account_id, c.scopes,
	c.refresh_token, c.access_token, c.access_expires_at, c.push_calendar_id, c.status, c.error, c.last_synced_at, c.created_at,
	c.updated_at`

func scanConnection(r interface{ Scan(...any) error }) (CalendarConnection, error) {
	var c CalendarConnection
	err := r.Scan(&c.ID, &c.WorkspaceID, &c.UserID, &c.Provider, &c.AccountEmail, &c.ExternalAccountID, &c.Scopes, &c.RefreshToken,
		&c.AccessToken, &c.AccessExpiresAt, &c.PushCalendarID, &c.Status, &c.Error, &c.LastSyncedAt, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

func (q Q) CreateCalendarConnection(ctx context.Context, c CalendarConnection) error {
	_, err := q.db.Exec(ctx, `INSERT INTO calendar_connections (id, workspace_id, user_id, provider, account_email, external_account_id,
		scopes, refresh_token, access_token, access_expires_at, push_calendar_id, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12, $12)`, c.ID, c.WorkspaceID, c.UserID, c.Provider,
		c.AccountEmail, c.ExternalAccountID, nonNil(c.Scopes), c.RefreshToken, c.AccessToken, c.AccessExpiresAt, c.PushCalendarID,
		c.CreatedAt)
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" {
		if pg.ConstraintName == "calendar_connections_account" {
			return ErrCalendarAccountInUse
		}
		return ErrCalendarConnected
	}
	return err
}

// CalendarConnection reads one connection of the workspace; ErrNotFound for another's.
func (q Q) CalendarConnection(ctx context.Context, workspaceID, id string) (CalendarConnection, error) {
	return scanConnection(q.db.QueryRow(ctx, `SELECT `+connectionColumns+` FROM calendar_connections c
		WHERE c.workspace_id = $1 AND c.id = $2`, workspaceID, id))
}

// CalendarConnections lists the member's connections in the workspace by provider.
func (q Q) CalendarConnections(ctx context.Context, workspaceID, userID string) ([]CalendarConnection, error) {
	rows, err := q.db.Query(ctx, `SELECT `+connectionColumns+` FROM calendar_connections c WHERE c.workspace_id = $1 AND c.user_id = $2
		ORDER BY c.provider`, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (CalendarConnection, error) { return scanConnection(r) })
}

// SaveCalendarTokens stores refreshed sealed tokens; a nil refresh token keeps the one stored.
func (q Q) SaveCalendarTokens(ctx context.Context, id string, access, refresh []byte, expires *time.Time, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE calendar_connections SET access_token = $2, refresh_token = coalesce($3, refresh_token),
		access_expires_at = $4, updated_at = $5 WHERE id = $1`, id, access, refresh, expires, now)
	return affected(tag, err)
}

// SetCalendarStatus marks the connection active, revoked or in error (detail nil when active); a revoked one drops
// its tokens.
func (q Q) SetCalendarStatus(ctx context.Context, id, status string, detail *string, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE calendar_connections SET status = $2, error = $3, updated_at = $4,
		refresh_token = CASE WHEN $2 = 'revoked' THEN NULL ELSE refresh_token END,
		access_token = CASE WHEN $2 = 'revoked' THEN NULL ELSE access_token END WHERE id = $1`, id, status, detail, now)
	return affected(tag, err)
}

func (q Q) SetPushCalendar(ctx context.Context, workspaceID, id string, calendarID *string, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE calendar_connections SET push_calendar_id = $3, updated_at = $4 WHERE workspace_id = $1 AND id = $2`,
		workspaceID, id, calendarID, now)
	return affected(tag, err)
}

func (q Q) TouchCalendarSynced(ctx context.Context, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE calendar_connections SET last_synced_at = $2 WHERE id = $1`, id, now)
	return err
}

// DeleteCalendarConnection removes the connection with its sources, watches, busy times, links and queued pushes.
func (q Q) DeleteCalendarConnection(ctx context.Context, workspaceID, id string) error {
	tag, err := q.db.Exec(ctx, `DELETE FROM calendar_connections WHERE workspace_id = $1 AND id = $2`, workspaceID, id)
	return affected(tag, err)
}

// CalendarSource is one calendar of a connection; Busy ones are imported as busy times.
type CalendarSource struct {
	ConnectionID string
	CalendarID   string
	Name         string
	Primary      bool
	Busy         bool
	SyncToken    *string // Google's syncToken or Microsoft's delta link
	DueAt        time.Time
	FullResync   bool
}

// SaveCalendarSources makes list the connection's calendars, keeping the sync state and busy choice of those still
// there; a new calendar is due at once and needs a full sync.
func (q Q) SaveCalendarSources(ctx context.Context, connectionID string, list []CalendarSource, now time.Time) error {
	return q.writeTx(ctx, func(q Q) error {
		ids, names, primary, busy := make([]string, len(list)), make([]string, len(list)), make([]bool, len(list)), make([]bool, len(list))
		for i, s := range list {
			ids[i], names[i], primary[i], busy[i] = s.CalendarID, s.Name, s.Primary, s.Busy
		}
		if _, err := q.db.Exec(ctx, `DELETE FROM calendar_sources WHERE connection_id = $1 AND NOT calendar_id = ANY ($2)`,
			connectionID, ids); err != nil {
			return err
		}
		_, err := q.db.Exec(ctx, `INSERT INTO calendar_sources (connection_id, calendar_id, name, is_primary, busy, due_at, full_resync)
			SELECT $1, i, n, p, b, $6, true FROM unnest($2::text[], $3::text[], $4::bool[], $5::bool[]) AS s(i, n, p, b)
			ON CONFLICT (connection_id, calendar_id) DO UPDATE SET name = excluded.name, is_primary = excluded.is_primary`,
			connectionID, ids, names, primary, busy, now)
		return err
	})
}

func (q Q) CalendarSources(ctx context.Context, connectionID string) ([]CalendarSource, error) {
	rows, err := q.db.Query(ctx, `SELECT connection_id, calendar_id, name, is_primary, busy, sync_token, due_at, full_resync
		FROM calendar_sources WHERE connection_id = $1 ORDER BY NOT is_primary, lower(name), calendar_id`, connectionID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanSource)
}

func scanSource(r pgx.CollectableRow) (CalendarSource, error) {
	var s CalendarSource
	return s, r.Scan(&s.ConnectionID, &s.CalendarID, &s.Name, &s.Primary, &s.Busy, &s.SyncToken, &s.DueAt, &s.FullResync)
}

// SetBusyCalendars imports busy times from exactly calendarIDs. Busy times are not kept per calendar, so the
// connection's are cleared and every ticked calendar is due at once for a full sync.
func (q Q) SetBusyCalendars(ctx context.Context, connectionID string, calendarIDs []string, now time.Time) error {
	return q.writeTx(ctx, func(q Q) error {
		if _, err := q.db.Exec(ctx, `UPDATE calendar_sources SET busy = calendar_id = ANY ($2), sync_token = NULL, full_resync = true,
			due_at = $3 WHERE connection_id = $1`, connectionID, nonNil(calendarIDs), now); err != nil {
			return err
		}
		return q.ClearCalendarBusy(ctx, connectionID)
	})
}

// ClaimDueSources takes up to limit busy calendars of active connections in live workspaces whose sync is due, oldest
// first, and moves their due time to lease, so another instance skips them meanwhile.
func (q Q) ClaimDueSources(ctx context.Context, now, lease time.Time, limit int) ([]CalendarSource, error) {
	rows, err := q.db.Query(ctx, `UPDATE calendar_sources s SET due_at = $2 WHERE (s.connection_id, s.calendar_id) IN (
		SELECT x.connection_id, x.calendar_id FROM calendar_sources x JOIN calendar_connections c ON c.id = x.connection_id
		JOIN workspaces w ON w.id = c.workspace_id
		WHERE x.busy AND x.due_at <= $1 AND c.status = 'active' AND w.deleted_at IS NULL
		ORDER BY x.due_at LIMIT $3 FOR UPDATE OF x SKIP LOCKED)
		RETURNING s.connection_id, s.calendar_id, s.name, s.is_primary, s.busy, s.sync_token, s.due_at, s.full_resync`, now, lease, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanSource)
}

// SaveSourceSync stores a finished sync's token and when the calendar is due next.
func (q Q) SaveSourceSync(ctx context.Context, connectionID, calendarID string, syncToken *string, fullResync bool, due time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE calendar_sources SET sync_token = $3, full_resync = $4, due_at = $5
		WHERE connection_id = $1 AND calendar_id = $2`, connectionID, calendarID, syncToken, fullResync, due)
	return err
}

// MarkSourceDue makes the calendar due at now (a webhook's hint); fullResync forces a full sync.
func (q Q) MarkSourceDue(ctx context.Context, connectionID, calendarID string, fullResync bool, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE calendar_sources SET due_at = least(due_at, $3), full_resync = full_resync OR $4
		WHERE connection_id = $1 AND calendar_id = $2`, connectionID, calendarID, now, fullResync)
	return err
}

// CalendarWatch is a push channel (Google) or subscription (Microsoft) on one calendar; SecretHash is the SHA-256
// of its channel token or clientState.
type CalendarWatch struct {
	ID, ConnectionID, CalendarID, ProviderID string
	ResourceID                               *string
	SecretHash                               []byte
	ExpiresAt                                time.Time
}

func (q Q) CreateCalendarWatch(ctx context.Context, w CalendarWatch) error {
	_, err := q.db.Exec(ctx, `INSERT INTO calendar_watches (id, connection_id, calendar_id, provider_id, resource_id, secret_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, w.ID, w.ConnectionID, w.CalendarID, w.ProviderID, w.ResourceID, w.SecretHash, w.ExpiresAt)
	return err
}

const watchColumns = `id, connection_id, calendar_id, provider_id, resource_id, secret_hash, expires_at`

func scanWatch(r pgx.CollectableRow) (CalendarWatch, error) {
	var w CalendarWatch
	return w, r.Scan(&w.ID, &w.ConnectionID, &w.CalendarID, &w.ProviderID, &w.ResourceID, &w.SecretHash, &w.ExpiresAt)
}

// CalendarWatchByProviderID is the watch a webhook names; ErrNotFound for an unknown one.
func (q Q) CalendarWatchByProviderID(ctx context.Context, providerID string) (CalendarWatch, error) {
	rows, err := q.db.Query(ctx, `SELECT `+watchColumns+` FROM calendar_watches WHERE provider_id = $1`, providerID)
	if err != nil {
		return CalendarWatch{}, err
	}
	return pgx.CollectExactlyOneRow(rows, scanWatch)
}

// CalendarWatches lists the connection's watches.
func (q Q) CalendarWatches(ctx context.Context, connectionID string) ([]CalendarWatch, error) {
	rows, err := q.db.Query(ctx, `SELECT `+watchColumns+` FROM calendar_watches WHERE connection_id = $1 ORDER BY expires_at`, connectionID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanWatch)
}

// ExpiringCalendarWatches lists up to limit watches expiring before, soonest first.
func (q Q) ExpiringCalendarWatches(ctx context.Context, before time.Time, limit int) ([]CalendarWatch, error) {
	rows, err := q.db.Query(ctx, `SELECT `+watchColumns+` FROM calendar_watches WHERE expires_at < $1 ORDER BY expires_at LIMIT $2`,
		before, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanWatch)
}

func (q Q) DeleteCalendarWatch(ctx context.Context, id string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM calendar_watches WHERE id = $1`, id)
	return err
}

// BusyBlock is a stretch of a host's own calendar marked busy (no title is stored).
type BusyBlock struct {
	ExternalID       string
	UserID           string
	StartsAt, EndsAt time.Time
}

// SaveCalendarBusy upserts the connection's busy blocks and deletes those in gone (cancelled or freed outside).
func (q Q) SaveCalendarBusy(ctx context.Context, connectionID string, blocks []BusyBlock, gone []string) error {
	return q.writeTx(ctx, func(q Q) error {
		if _, err := q.db.Exec(ctx, `DELETE FROM calendar_busy WHERE connection_id = $1 AND external_id = ANY ($2)`,
			connectionID, nonNil(gone)); err != nil {
			return err
		}
		ids, starts, ends := make([]string, len(blocks)), make([]time.Time, len(blocks)), make([]time.Time, len(blocks))
		for i, b := range blocks {
			ids[i], starts[i], ends[i] = b.ExternalID, b.StartsAt, b.EndsAt
		}
		_, err := q.db.Exec(ctx, `INSERT INTO calendar_busy (connection_id, external_id, workspace_id, user_id, starts_at, ends_at)
			SELECT c.id, b.i, c.workspace_id, c.user_id, b.s, b.e FROM unnest($2::text[], $3::timestamptz[], $4::timestamptz[]) AS b(i, s, e)
			JOIN calendar_connections c ON c.id = $1
			ON CONFLICT (connection_id, external_id) DO UPDATE SET starts_at = excluded.starts_at, ends_at = excluded.ends_at`,
			connectionID, ids, starts, ends)
		return err
	})
}

// ClearCalendarBusy deletes every busy block of the connection (before a full resync).
func (q Q) ClearCalendarBusy(ctx context.Context, connectionID string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM calendar_busy WHERE connection_id = $1`, connectionID)
	return err
}

// CalendarBusy lists the hosts' busy blocks overlapping [from, to), by start.
func (q Q) CalendarBusy(ctx context.Context, workspaceID string, userIDs []string, from, to time.Time) ([]BusyBlock, error) {
	rows, err := q.db.Query(ctx, `SELECT b.external_id, b.user_id, b.starts_at, b.ends_at FROM calendar_busy b
		JOIN calendar_connections c ON c.id = b.connection_id AND c.status = 'active'
		WHERE b.workspace_id = $1 AND b.user_id = ANY ($2) AND b.starts_at < $4 AND b.ends_at > $3 ORDER BY b.starts_at, b.external_id`,
		workspaceID, nonNil(userIDs), from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (BusyBlock, error) {
		var b BusyBlock
		return b, r.Scan(&b.ExternalID, &b.UserID, &b.StartsAt, &b.EndsAt)
	})
}

// PurgePastBusy deletes busy blocks that ended before.
func (q Q) PurgePastBusy(ctx context.Context, before time.Time) error {
	_, err := q.db.Exec(ctx, `DELETE FROM calendar_busy WHERE ends_at < $1`, before)
	return err
}

// CalendarLink is the external event an occurrence was pushed as.
type CalendarLink struct {
	ConnectionID, OccurrenceID, ExternalID string
	ETag                                   *string
	PushedSequence                         int
	State                                  string // ok | detached
}

// SaveCalendarLink records a push (back to ok).
func (q Q) SaveCalendarLink(ctx context.Context, l CalendarLink) error {
	_, err := q.db.Exec(ctx, `INSERT INTO calendar_event_links (connection_id, occurrence_id, external_id, etag, pushed_sequence, state)
		VALUES ($1, $2, $3, $4, $5, 'ok') ON CONFLICT (connection_id, occurrence_id) DO UPDATE SET external_id = $3, etag = $4,
		pushed_sequence = $5, state = 'ok'`, l.ConnectionID, l.OccurrenceID, l.ExternalID, l.ETag, l.PushedSequence)
	return err
}

const linkColumns = `connection_id, occurrence_id, external_id, etag, pushed_sequence, state`

func scanLink(r pgx.CollectableRow) (CalendarLink, error) {
	var l CalendarLink
	return l, r.Scan(&l.ConnectionID, &l.OccurrenceID, &l.ExternalID, &l.ETag, &l.PushedSequence, &l.State)
}

func (q Q) calendarLink(ctx context.Context, where string, a, b string) (CalendarLink, error) {
	rows, err := q.db.Query(ctx, `SELECT `+linkColumns+` FROM calendar_event_links WHERE connection_id = $1 AND `+where+` = $2`, a, b)
	if err != nil {
		return CalendarLink{}, err
	}
	return pgx.CollectExactlyOneRow(rows, scanLink)
}

// CalendarLink is the occurrence's link on the connection; ErrNotFound for none.
func (q Q) CalendarLink(ctx context.Context, connectionID, occurrenceID string) (CalendarLink, error) {
	return q.calendarLink(ctx, "occurrence_id", connectionID, occurrenceID)
}

// CalendarLinkByExternal is the link of an external event, to recognise our own events in imports; ErrNotFound for none.
func (q Q) CalendarLinkByExternal(ctx context.Context, connectionID, externalID string) (CalendarLink, error) {
	return q.calendarLink(ctx, "external_id", connectionID, externalID)
}

// CalendarLinksOfOccurrence lists every connection's link of the occurrence (the warning when one is detached).
func (q Q) CalendarLinksOfOccurrence(ctx context.Context, occurrenceID string) ([]CalendarLink, error) {
	rows, err := q.db.Query(ctx, `SELECT `+linkColumns+` FROM calendar_event_links WHERE occurrence_id = $1 ORDER BY connection_id`, occurrenceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanLink)
}

// DetachCalendarLink marks the link detached: the event was deleted outside, the session stays.
func (q Q) DetachCalendarLink(ctx context.Context, connectionID, occurrenceID string) error {
	_, err := q.db.Exec(ctx, `UPDATE calendar_event_links SET state = 'detached' WHERE connection_id = $1 AND occurrence_id = $2`,
		connectionID, occurrenceID)
	return err
}

func (q Q) DeleteCalendarLink(ctx context.Context, connectionID, occurrenceID string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM calendar_event_links WHERE connection_id = $1 AND occurrence_id = $2`, connectionID, occurrenceID)
	return err
}

// QueuedPush is a push to make: bring the occurrence's external event on the connection up to date (or delete it).
type QueuedPush struct {
	ConnectionID, OccurrenceID string
	DueAt, QueuedAt            time.Time
	Attempts                   int
	LastError                  *string
}

// EnqueueCalendarPush queues a push of each occurrence to its host's active connections and to every connection that
// already holds a link of it (a host change removes the event from the old host's calendar). A push already queued
// is due at once again and keeps when it was first queued.
func (q Q) EnqueueCalendarPush(ctx context.Context, workspaceID string, occurrenceIDs []string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO calendar_push_queue (connection_id, occurrence_id, due_at, queued_at)
		SELECT DISTINCT c.id, o.id, $3::timestamptz, $3::timestamptz FROM scheduling_occurrences o
		JOIN calendar_connections c ON c.workspace_id = o.workspace_id AND c.status = 'active' AND (c.user_id = o.host_user_id
			OR EXISTS (SELECT 1 FROM calendar_event_links l WHERE l.connection_id = c.id AND l.occurrence_id = o.id))
		WHERE o.workspace_id = $1 AND o.id = ANY ($2)
		ON CONFLICT (connection_id, occurrence_id) DO UPDATE SET due_at = $3, attempts = 0, last_error = NULL`,
		workspaceID, nonNil(occurrenceIDs), now)
	return err
}

// ClaimPushQueue leases up to limit due pushes of active connections in live workspaces until lease, oldest first,
// skipping those another instance holds.
func (q Q) ClaimPushQueue(ctx context.Context, now, lease time.Time, limit int) ([]QueuedPush, error) {
	rows, err := q.db.Query(ctx, `UPDATE calendar_push_queue p SET leased_until = $2 WHERE (p.connection_id, p.occurrence_id) IN (
		SELECT x.connection_id, x.occurrence_id FROM calendar_push_queue x JOIN calendar_connections c ON c.id = x.connection_id
		JOIN workspaces w ON w.id = c.workspace_id
		WHERE x.due_at <= $1 AND (x.leased_until IS NULL OR x.leased_until <= $1) AND c.status = 'active' AND w.deleted_at IS NULL
		ORDER BY x.due_at LIMIT $3 FOR UPDATE OF x SKIP LOCKED)
		RETURNING p.connection_id, p.occurrence_id, p.due_at, p.queued_at, p.attempts, p.last_error`, now, lease, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (QueuedPush, error) {
		var p QueuedPush
		return p, r.Scan(&p.ConnectionID, &p.OccurrenceID, &p.DueAt, &p.QueuedAt, &p.Attempts, &p.LastError)
	})
}

// FinishPush removes a pushed entry unless the occurrence changed again since it was claimed (its due time moved
// past claimedDue), in which case it stays queued, released, for the newer state.
func (q Q) FinishPush(ctx context.Context, connectionID, occurrenceID string, claimedDue time.Time) error {
	if _, err := q.db.Exec(ctx, `DELETE FROM calendar_push_queue WHERE connection_id = $1 AND occurrence_id = $2 AND due_at <= $3`,
		connectionID, occurrenceID, claimedDue); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `UPDATE calendar_push_queue SET leased_until = NULL WHERE connection_id = $1 AND occurrence_id = $2`,
		connectionID, occurrenceID)
	return err
}

// RetryPush records a failed push and when to try again; giving up is the caller's (24 h after QueuedAt).
func (q Q) RetryPush(ctx context.Context, connectionID, occurrenceID, problem string, due time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE calendar_push_queue SET attempts = attempts + 1, last_error = $3, due_at = $4, leased_until = NULL
		WHERE connection_id = $1 AND occurrence_id = $2`, connectionID, occurrenceID, problem, due)
	return err
}

// CalendarFeed is a member's private iCal feed: the token's SHA-256 for lookup and the token sealed, to show again.
type CalendarFeed struct {
	WorkspaceID, UserID    string
	TokenHash, TokenSealed []byte
	CreatedAt              time.Time
	LastFetchedAt          *time.Time
}

// SaveCalendarFeed creates the member's feed or rotates its token (the old URL stops at once).
func (q Q) SaveCalendarFeed(ctx context.Context, f CalendarFeed) error {
	_, err := q.db.Exec(ctx, `INSERT INTO calendar_feeds (workspace_id, user_id, token_hash, token_sealed, created_at)
		VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id, user_id) DO UPDATE SET token_hash = $3, token_sealed = $4,
		created_at = $5, last_fetched_at = NULL`, f.WorkspaceID, f.UserID, f.TokenHash, f.TokenSealed, f.CreatedAt)
	return err
}

const feedColumns = `f.workspace_id, f.user_id, f.token_hash, f.token_sealed, f.created_at, f.last_fetched_at`

func scanFeed(r pgx.CollectableRow) (CalendarFeed, error) {
	var f CalendarFeed
	return f, r.Scan(&f.WorkspaceID, &f.UserID, &f.TokenHash, &f.TokenSealed, &f.CreatedAt, &f.LastFetchedAt)
}

// CalendarFeed is the member's feed; ErrNotFound for none.
func (q Q) CalendarFeed(ctx context.Context, workspaceID, userID string) (CalendarFeed, error) {
	rows, err := q.db.Query(ctx, `SELECT `+feedColumns+` FROM calendar_feeds f WHERE f.workspace_id = $1 AND f.user_id = $2`,
		workspaceID, userID)
	if err != nil {
		return CalendarFeed{}, err
	}
	return pgx.CollectExactlyOneRow(rows, scanFeed)
}

// LiveCalendarFeed is the feed whose token hashes to tokenHash while its workspace lives (the member's row goes with
// their membership); ErrNotFound otherwise.
func (q Q) LiveCalendarFeed(ctx context.Context, tokenHash []byte) (CalendarFeed, error) {
	rows, err := q.db.Query(ctx, `SELECT `+feedColumns+` FROM calendar_feeds f JOIN workspaces w ON w.id = f.workspace_id
		WHERE f.token_hash = $1 AND w.deleted_at IS NULL`, tokenHash)
	if err != nil {
		return CalendarFeed{}, err
	}
	return pgx.CollectExactlyOneRow(rows, scanFeed)
}

func (q Q) TouchCalendarFeed(ctx context.Context, workspaceID, userID string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE calendar_feeds SET last_fetched_at = $3 WHERE workspace_id = $1 AND user_id = $2`,
		workspaceID, userID, now)
	return err
}

func (q Q) DeleteCalendarFeed(ctx context.Context, workspaceID, userID string) error {
	tag, err := q.db.Exec(ctx, `DELETE FROM calendar_feeds WHERE workspace_id = $1 AND user_id = $2`, workspaceID, userID)
	return affected(tag, err)
}
