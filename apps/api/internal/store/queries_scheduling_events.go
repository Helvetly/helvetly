package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Scheduled sessions (00051_scheduling.sql): an event is a one-off or a series; its occurrences are materialised rows,
// each with its own status, attendance, requests, reminders and engagement entries.

// ScheduledEvents is the monthly limit an event's creation counts in (billing.ScheduledEvents).
const ScheduledEvents = "scheduled_events_per_month"

// Occurrence statuses; the open ones hold their slot, get reminders and count for conflicts.
const (
	SchedRequested       = "requested"
	SchedScheduled       = "scheduled"
	SchedRescheduled     = "rescheduled"
	SchedAttended        = "attended"
	SchedNoShow          = "no_show"
	SchedCancelledOnTime = "cancelled_on_time"
	SchedCancelledLate   = "cancelled_late"
	SchedDeclined        = "declined"
)

const openStatuses = `('requested', 'scheduled', 'rescheduled')`

// SchedEvent is a one-off session or a series (RRule set).
type SchedEvent struct {
	ID              string
	WorkspaceID     string
	ClientID        string
	EngagementID    *string
	EventTypeID     *string
	HostUserID      *string
	Title           string
	Description     *string
	ClientNote      *string
	Mode            string // online | live
	MeetingProvider *string
	MeetingURL      *string
	MeetingRef      *string
	Location        *string
	TimeZone        string
	StartsLocal     time.Time // wall clock in TimeZone (its location is ignored)
	DurationMinutes int
	RRule           *string
	UntilDate       *string
	Count           *int
	SkipHolidays    bool
	Attendees       []string
	UnitsPerSession *Quantity
	UnitPrice       *Money
	Currency        *string
	Sequence        int
	// MaterialisedUntil: occurrences exist up to here; nil for a one-off.
	MaterialisedUntil *time.Time
	CreatedBy         *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

const schedEventColumns = `id, workspace_id, client_id, engagement_id, event_type_id, host_user_id, title, description, client_note, mode,
	meeting_provider, meeting_url, meeting_ref, location, time_zone, starts_local, duration_minutes, rrule, until_date::text, count,
	skip_holidays, attendees, units_per_session, unit_price, currency, sequence, materialised_until, created_by, created_at, updated_at`

func scanSchedEvent(r interface{ Scan(...any) error }) (SchedEvent, error) {
	var e SchedEvent
	err := r.Scan(&e.ID, &e.WorkspaceID, &e.ClientID, &e.EngagementID, &e.EventTypeID, &e.HostUserID, &e.Title, &e.Description,
		&e.ClientNote, &e.Mode, &e.MeetingProvider, &e.MeetingURL, &e.MeetingRef, &e.Location, &e.TimeZone, &e.StartsLocal,
		&e.DurationMinutes, &e.RRule, &e.UntilDate, &e.Count, &e.SkipHolidays, &e.Attendees, &e.UnitsPerSession, &e.UnitPrice,
		&e.Currency, &e.Sequence, &e.MaterialisedUntil, &e.CreatedBy, &e.CreatedAt, &e.UpdatedAt)
	return e, err
}

// wallClock drops the zone, so a timestamp column stores the wall-clock reading as given.
func wallClock(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), 0, time.UTC)
}

// CreateSchedEvent stores a new event (staff's or a client's booking) and counts it once in
// scheduled_events_per_month, a series too; refused (ErrAdmissionDenied) over the cap or without the feature.
// Its occurrences follow with MaterialiseOccurrences in the same transaction.
func (q Q) CreateSchedEvent(ctx context.Context, e SchedEvent) error {
	return q.writeTx(ctx, func(q Q) error {
		if _, err := q.ConsumeUsage(ctx, e.WorkspaceID, UsageOp{Resource: ScheduledEvents, ID: "event.create:" + e.ID, Amount: 1}, e.CreatedAt); err != nil {
			return err
		}
		return q.InsertSchedEvent(ctx, e)
	})
}

// InsertSchedEvent stores an event without counting it: the new half of a series split ("following").
func (q Q) InsertSchedEvent(ctx context.Context, e SchedEvent) error {
	_, err := q.db.Exec(ctx, `INSERT INTO scheduling_events (`+strings.Replace(schedEventColumns, "::text", "", 1)+`) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
		$11, $12, $13, $14, $15, $16, $17, $18, $19::date, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)`,
		e.ID, e.WorkspaceID, e.ClientID, e.EngagementID, e.EventTypeID, e.HostUserID, e.Title, e.Description, e.ClientNote, e.Mode,
		e.MeetingProvider, e.MeetingURL, e.MeetingRef, e.Location, e.TimeZone, wallClock(e.StartsLocal), e.DurationMinutes, e.RRule,
		e.UntilDate, e.Count, e.SkipHolidays, nonNil(e.Attendees), e.UnitsPerSession, e.UnitPrice, e.Currency, e.Sequence,
		e.MaterialisedUntil, e.CreatedBy, e.CreatedAt, e.UpdatedAt)
	return err
}

// SaveSchedEvent writes every field but the id, workspace, client, creation and MaterialisedUntil (which
// MaterialiseOccurrences moves).
func (q Q) SaveSchedEvent(ctx context.Context, e SchedEvent) error {
	tag, err := q.db.Exec(ctx, `UPDATE scheduling_events SET engagement_id = $3, event_type_id = $4, host_user_id = $5, title = $6,
		description = $7, client_note = $8, mode = $9, meeting_provider = $10, meeting_url = $11, meeting_ref = $12, location = $13,
		time_zone = $14, starts_local = $15, duration_minutes = $16, rrule = $17, until_date = $18::date, count = $19,
		skip_holidays = $20, attendees = $21, units_per_session = $22, unit_price = $23, currency = $24, sequence = $25,
		updated_at = $26 WHERE workspace_id = $1 AND id = $2`,
		e.WorkspaceID, e.ID, e.EngagementID, e.EventTypeID, e.HostUserID, e.Title, e.Description, e.ClientNote, e.Mode,
		e.MeetingProvider, e.MeetingURL, e.MeetingRef, e.Location, e.TimeZone, wallClock(e.StartsLocal), e.DurationMinutes, e.RRule,
		e.UntilDate, e.Count, e.SkipHolidays, nonNil(e.Attendees), e.UnitsPerSession, e.UnitPrice, e.Currency, e.Sequence, e.UpdatedAt)
	return affected(tag, err)
}

// SchedEvent reads the event; forUpdate locks it until the transaction ends.
func (q Q) SchedEvent(ctx context.Context, workspaceID, id string, forUpdate bool) (SchedEvent, error) {
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE"
	}
	return scanSchedEvent(q.db.QueryRow(ctx, `SELECT `+schedEventColumns+` FROM scheduling_events WHERE workspace_id = $1 AND id = $2`+lock,
		workspaceID, id))
}

// ClaimSeriesToMaterialise locks up to limit series of live workspaces and clients whose occurrences end before
// horizon, oldest first, skipping those another transaction holds. Call it in the transaction that extends them.
func (q Q) ClaimSeriesToMaterialise(ctx context.Context, horizon time.Time, limit int) ([]SchedEvent, error) {
	rows, err := q.db.Query(ctx, `SELECT `+schedEventColumns+` FROM scheduling_events WHERE id IN (
		SELECT e.id FROM scheduling_events e JOIN workspaces w ON w.id = e.workspace_id JOIN clients c ON c.id = e.client_id
		WHERE e.rrule IS NOT NULL AND e.materialised_until < $1 AND w.deleted_at IS NULL AND c.deleted_at IS NULL
		ORDER BY e.materialised_until LIMIT $2 FOR UPDATE OF e SKIP LOCKED) ORDER BY materialised_until, id`, horizon, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SchedEvent, error) { return scanSchedEvent(r) })
}

// SchedSlot is one occurrence to materialise: its id, its slot in the rule and its time.
type SchedSlot struct {
	ID                              string
	OriginalStart, StartsAt, EndsAt time.Time
}

// MaterialiseOccurrences adds the event's occurrences in slots with status, taking host, client and engagement
// from the event, and moves the event's materialised_until to until (nil leaves it). A slot that already has a row
// (UNIQUE (event_id, original_start)) is left alone, so running it again adds nothing; it returns the rows added.
func (q Q) MaterialiseOccurrences(ctx context.Context, workspaceID, eventID string, slots []SchedSlot, status string,
	until *time.Time, now time.Time) (int64, error) {
	var n int64
	err := q.writeTx(ctx, func(q Q) error {
		ids, originals, starts, ends := make([]string, len(slots)), make([]time.Time, len(slots)), make([]time.Time, len(slots)),
			make([]time.Time, len(slots))
		for i, s := range slots {
			ids[i], originals[i], starts[i], ends[i] = s.ID, s.OriginalStart, s.StartsAt, s.EndsAt
		}
		tag, err := q.db.Exec(ctx, `INSERT INTO scheduling_occurrences (id, workspace_id, event_id, host_user_id, client_id, engagement_id,
			original_start, starts_at, ends_at, status, sequence, timed_at, created_at, updated_at)
			SELECT s.id, e.workspace_id, e.id, e.host_user_id, e.client_id, e.engagement_id, s.o, s.s, s.e, $7, e.sequence, $8, $8, $8
			FROM unnest($3::text[], $4::timestamptz[], $5::timestamptz[], $6::timestamptz[]) AS s(id, o, s, e)
			JOIN scheduling_events e ON e.workspace_id = $1 AND e.id = $2
			ON CONFLICT (event_id, original_start) DO NOTHING`, workspaceID, eventID, ids, originals, starts, ends, status, now)
		if err != nil {
			return err
		}
		n = tag.RowsAffected()
		if until == nil {
			return nil
		}
		tag, err = q.db.Exec(ctx, `UPDATE scheduling_events SET materialised_until = $3 WHERE workspace_id = $1 AND id = $2`,
			workspaceID, eventID, until)
		return affected(tag, err)
	})
	return n, err
}

// SchedOccurrence is one session of an event. Title, Location and MeetingURL are the occurrence's own (nil = the
// event's).
type SchedOccurrence struct {
	ID              string
	WorkspaceID     string
	EventID         string
	HostUserID      *string
	ClientID        string
	EngagementID    *string
	OriginalStart   time.Time
	StartsAt        time.Time
	EndsAt          time.Time
	Status          string
	Late            bool
	WaivedBy        *string
	WaivedAt        *time.Time
	WaiveReason     *string
	IsException     bool
	Title           *string
	Location        *string
	MeetingURL      *string
	Sequence        int
	InvoiceID       *string
	TimedAt         time.Time // when StartsAt was last set; reminders due before it are not sent
	StatusChangedBy *string
	StatusChangedAt *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

const occurrenceColumns = `o.id, o.workspace_id, o.event_id, o.host_user_id, o.client_id, o.engagement_id, o.original_start, o.starts_at,
	o.ends_at, o.status, o.late, o.waived_by, o.waived_at, o.waive_reason, o.is_exception, o.title, o.location, o.meeting_url,
	o.sequence, o.invoice_id, o.timed_at, o.status_changed_by, o.status_changed_at, o.created_at, o.updated_at`

func scanOccurrence(r interface{ Scan(...any) error }) (SchedOccurrence, error) {
	var o SchedOccurrence
	err := r.Scan(&o.ID, &o.WorkspaceID, &o.EventID, &o.HostUserID, &o.ClientID, &o.EngagementID, &o.OriginalStart, &o.StartsAt,
		&o.EndsAt, &o.Status, &o.Late, &o.WaivedBy, &o.WaivedAt, &o.WaiveReason, &o.IsException, &o.Title, &o.Location, &o.MeetingURL,
		&o.Sequence, &o.InvoiceID, &o.TimedAt, &o.StatusChangedBy, &o.StatusChangedAt, &o.CreatedAt, &o.UpdatedAt)
	return o, err
}

func collectOccurrences(rows pgx.Rows, err error) ([]SchedOccurrence, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SchedOccurrence, error) { return scanOccurrence(r) })
}

// SchedOccurrence reads the occurrence; forUpdate locks it until the transaction ends.
func (q Q) SchedOccurrence(ctx context.Context, workspaceID, id string, forUpdate bool) (SchedOccurrence, error) {
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE"
	}
	return scanOccurrence(q.db.QueryRow(ctx, `SELECT `+occurrenceColumns+` FROM scheduling_occurrences o
		WHERE o.workspace_id = $1 AND o.id = $2`+lock, workspaceID, id))
}

// SchedOccurrenceFilter narrows SchedOccurrences; zero fields do not filter. From and To bound the start (From
// inclusive, To exclusive).
type SchedOccurrenceFilter struct {
	From, To     *time.Time
	HostIDs      []string
	ClientID     string
	EngagementID string
	EventID      string
	Statuses     []string
}

// SchedOccurrences lists the workspace's occurrences by start.
func (q Q) SchedOccurrences(ctx context.Context, workspaceID string, f SchedOccurrenceFilter) ([]SchedOccurrence, error) {
	return collectOccurrences(q.db.Query(ctx, `SELECT `+occurrenceColumns+` FROM scheduling_occurrences o WHERE o.workspace_id = $1
		AND ($2::timestamptz IS NULL OR o.starts_at >= $2) AND ($3::timestamptz IS NULL OR o.starts_at < $3)
		AND (cardinality($4::text[]) = 0 OR o.host_user_id = ANY ($4)) AND ($5 = '' OR o.client_id = $5)
		AND ($6 = '' OR o.engagement_id = $6) AND ($7 = '' OR o.event_id = $7)
		AND (cardinality($8::text[]) = 0 OR o.status = ANY ($8)) ORDER BY o.starts_at, o.id`,
		workspaceID, f.From, f.To, nonNil(f.HostIDs), f.ClientID, f.EngagementID, f.EventID, nonNil(f.Statuses)))
}

// HostSessions lists the hosts' open occurrences overlapping [start, end), for conflicts and slots. An occurrence is
// at most 24 hours long, so the host index bounds the scan.
func (q Q) HostSessions(ctx context.Context, workspaceID string, hostIDs []string, start, end time.Time) ([]SchedOccurrence, error) {
	return collectOccurrences(q.db.Query(ctx, `SELECT `+occurrenceColumns+` FROM scheduling_occurrences o WHERE o.workspace_id = $1
		AND o.host_user_id = ANY ($2) AND o.starts_at < $4 AND o.starts_at > $3::timestamptz - interval '24 hours' AND o.ends_at > $3
		AND o.status IN `+openStatuses+` ORDER BY o.starts_at, o.id`, workspaceID, nonNil(hostIDs), start, end))
}

// SaveSchedOccurrence writes every field but the id, workspace, client and creation; a split ("following") moves it
// to another event by EventID and OriginalStart.
func (q Q) SaveSchedOccurrence(ctx context.Context, o SchedOccurrence) error {
	tag, err := q.db.Exec(ctx, `UPDATE scheduling_occurrences SET event_id = $3, host_user_id = $4, engagement_id = $5,
		original_start = $6, starts_at = $7, ends_at = $8, status = $9, late = $10, waived_by = $11, waived_at = $12, waive_reason = $13,
		is_exception = $14, title = $15, location = $16, meeting_url = $17, sequence = $18, invoice_id = $19, timed_at = $20,
		status_changed_by = $21, status_changed_at = $22, updated_at = $23 WHERE workspace_id = $1 AND id = $2`,
		o.WorkspaceID, o.ID, o.EventID, o.HostUserID, o.EngagementID, o.OriginalStart, o.StartsAt, o.EndsAt, o.Status, o.Late,
		o.WaivedBy, o.WaivedAt, o.WaiveReason, o.IsException, o.Title, o.Location, o.MeetingURL, o.Sequence, o.InvoiceID, o.TimedAt,
		o.StatusChangedBy, o.StatusChangedAt, o.UpdatedAt)
	return affected(tag, err)
}

// SchedEntryLink is an engagement entry an occurrence added, and why.
type SchedEntryLink struct {
	EntryID string
	Reason  string // attended | no_show | late_cancel | late_reschedule
}

func (q Q) LinkSchedEntry(ctx context.Context, occurrenceID, entryID, reason string) error {
	_, err := q.db.Exec(ctx, `INSERT INTO scheduling_occurrence_entries (occurrence_id, entry_id, reason) VALUES ($1, $2, $3)`,
		occurrenceID, entryID, reason)
	return err
}

func (q Q) SchedEntryLinks(ctx context.Context, occurrenceID string) ([]SchedEntryLink, error) {
	rows, err := q.db.Query(ctx, `SELECT entry_id, reason FROM scheduling_occurrence_entries WHERE occurrence_id = $1 ORDER BY reason`,
		occurrenceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SchedEntryLink, error) {
		var l SchedEntryLink
		return l, r.Scan(&l.EntryID, &l.Reason)
	})
}

// UnlinkSchedEntry forgets the occurrence's entry for reason and returns its id (the caller removes the entry
// through Engagements); ErrNotFound for none.
func (q Q) UnlinkSchedEntry(ctx context.Context, occurrenceID, reason string) (string, error) {
	var id string
	err := q.db.QueryRow(ctx, `DELETE FROM scheduling_occurrence_entries WHERE occurrence_id = $1 AND reason = $2 RETURNING entry_id`,
		occurrenceID, reason).Scan(&id)
	return id, err
}

// SchedRequest is a client's cancel, reschedule or booking request on an occurrence.
type SchedRequest struct {
	ID               string
	WorkspaceID      string
	OccurrenceID     string
	ClientID         string
	Kind             string // cancel | reschedule | booking
	Status           string // pending | proposed | approved | declined | accepted | withdrawn | expired
	Late             bool
	ProposedTimes    []time.Time
	StaffProposal    *time.Time
	Chosen           *time.Time
	Note             *string
	Reason           *string
	RequestedByEmail *string
	CreatedAt        time.Time
	DecidedAt        *time.Time
	DecidedBy        *string
}

// ErrSchedRequestOpen: the occurrence already has a pending or proposed request.
var ErrSchedRequestOpen = errors.New("occurrence has an open request")

const requestColumns = `r.id, r.workspace_id, r.occurrence_id, r.client_id, r.kind, r.status, r.late, r.proposed_times,
	r.staff_proposal, r.chosen, r.note, r.reason, r.requested_by_email, r.created_at, r.decided_at, r.decided_by`

func scanRequest(r interface{ Scan(...any) error }) (SchedRequest, error) {
	var s SchedRequest
	err := r.Scan(&s.ID, &s.WorkspaceID, &s.OccurrenceID, &s.ClientID, &s.Kind, &s.Status, &s.Late, &s.ProposedTimes, &s.StaffProposal,
		&s.Chosen, &s.Note, &s.Reason, &s.RequestedByEmail, &s.CreatedAt, &s.DecidedAt, &s.DecidedBy)
	return s, err
}

func (q Q) CreateSchedRequest(ctx context.Context, r SchedRequest) error {
	_, err := q.db.Exec(ctx, `INSERT INTO scheduling_requests (id, workspace_id, occurrence_id, client_id, kind, status, late,
		proposed_times, note, requested_by_email, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		r.ID, r.WorkspaceID, r.OccurrenceID, r.ClientID, r.Kind, r.Status, r.Late, nonNil(r.ProposedTimes), r.Note, r.RequestedByEmail,
		r.CreatedAt)
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" && pg.ConstraintName == "scheduling_requests_open" {
		return ErrSchedRequestOpen
	}
	return err
}

// SchedRequest reads the request; forUpdate locks it until the transaction ends.
func (q Q) SchedRequest(ctx context.Context, workspaceID, id string, forUpdate bool) (SchedRequest, error) {
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE"
	}
	return scanRequest(q.db.QueryRow(ctx, `SELECT `+requestColumns+` FROM scheduling_requests r WHERE r.workspace_id = $1 AND r.id = $2`+lock,
		workspaceID, id))
}

// OpenSchedRequest is the occurrence's pending or proposed request; ErrNotFound for none.
func (q Q) OpenSchedRequest(ctx context.Context, workspaceID, occurrenceID string) (SchedRequest, error) {
	return scanRequest(q.db.QueryRow(ctx, `SELECT `+requestColumns+` FROM scheduling_requests r WHERE r.workspace_id = $1
		AND r.occurrence_id = $2 AND r.status IN ('pending', 'proposed')`, workspaceID, occurrenceID))
}

// SchedRequests lists the workspace's requests in statuses on occurrences of hostIDs (empty = any), oldest first.
func (q Q) SchedRequests(ctx context.Context, workspaceID string, statuses, hostIDs []string) ([]SchedRequest, error) {
	rows, err := q.db.Query(ctx, `SELECT `+requestColumns+` FROM scheduling_requests r
		JOIN scheduling_occurrences o ON o.id = r.occurrence_id WHERE r.workspace_id = $1
		AND (cardinality($2::text[]) = 0 OR r.status = ANY ($2)) AND (cardinality($3::text[]) = 0 OR o.host_user_id = ANY ($3))
		ORDER BY r.created_at, r.id`, workspaceID, nonNil(statuses), nonNil(hostIDs))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SchedRequest, error) { return scanRequest(r) })
}

// SaveSchedRequest writes a decision: status, the business's proposal, the time chosen, its reason and who decided.
func (q Q) SaveSchedRequest(ctx context.Context, r SchedRequest) error {
	tag, err := q.db.Exec(ctx, `UPDATE scheduling_requests SET status = $3, staff_proposal = $4, chosen = $5, reason = $6,
		decided_at = $7, decided_by = $8 WHERE workspace_id = $1 AND id = $2`,
		r.WorkspaceID, r.ID, r.Status, r.StaffProposal, r.Chosen, r.Reason, r.DecidedAt, r.DecidedBy)
	return affected(tag, err)
}

// ExpireSchedRequests ends the open requests whose occurrence has started and returns them.
func (q Q) ExpireSchedRequests(ctx context.Context, now time.Time) ([]SchedRequest, error) {
	rows, err := q.db.Query(ctx, `UPDATE scheduling_requests r SET status = 'expired', decided_at = $1 FROM scheduling_occurrences o
		WHERE o.id = r.occurrence_id AND r.status IN ('pending', 'proposed') AND o.starts_at <= $1 RETURNING `+requestColumns, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SchedRequest, error) { return scanRequest(r) })
}

// PurgeSchedHistory deletes decided requests and sent reminders older than before (scheduling keeps them 2 years).
func (q Q) PurgeSchedHistory(ctx context.Context, before time.Time) error {
	if _, err := q.db.Exec(ctx, `DELETE FROM scheduling_requests WHERE status NOT IN ('pending', 'proposed') AND created_at < $1`, before); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `DELETE FROM scheduling_reminders WHERE sent_at < $1`, before)
	return err
}

// DueReminder is a reminder claimed for sending: the occurrence, minutes before its start, and to whom.
type DueReminder struct {
	WorkspaceID, OccurrenceID string
	OffsetMinutes             int
	Audience                  string // client | host
	StartsAt                  time.Time
}

// ClaimDueReminders records as sent up to limit reminders due at now and returns them, so each (occurrence, offset,
// audience) is claimed once across instances. Due: an upcoming scheduled or rescheduled occurrence of a live
// workspace (a requested one waits for its confirmation) whose start minus an offset of the workspace's settings
// (the defaults when it saved none) has passed, but not before the occurrence was made or moved, and no shorter
// offset has passed too (a 24 h reminder found an hour before the start gives way to the 1 h one). The caller sends
// them; one it may not send (no address, the plan lacks the feature) stays claimed and is not sent later.
func (q Q) ClaimDueReminders(ctx context.Context, now time.Time, limit int) ([]DueReminder, error) {
	d := DefaultSchedSettings()
	rows, err := q.db.Query(ctx, `WITH due AS (
		SELECT o.workspace_id, o.id, r.offset_minutes, r.audience, o.starts_at
		FROM scheduling_occurrences o JOIN workspaces w ON w.id = o.workspace_id AND w.deleted_at IS NULL
		LEFT JOIN scheduling_settings s ON s.workspace_id = o.workspace_id
		CROSS JOIN LATERAL (SELECT 'client', coalesce(s.client_reminders, $3::int[])
			UNION ALL SELECT 'host', coalesce(s.host_reminders, $4::int[])) AS l(audience, offsets)
		CROSS JOIN LATERAL (SELECT m, l.audience, l.offsets FROM unnest(l.offsets) AS m) AS r(offset_minutes, audience, offsets)
		WHERE o.status IN ('scheduled', 'rescheduled') AND o.starts_at > $1
			AND o.starts_at - make_interval(mins => r.offset_minutes) <= $1
			AND o.starts_at - make_interval(mins => r.offset_minutes) > o.timed_at
			AND NOT EXISTS (SELECT 1 FROM unnest(r.offsets) AS m WHERE m < r.offset_minutes
				AND o.starts_at - make_interval(mins => m) <= $1)
			AND NOT EXISTS (SELECT 1 FROM scheduling_reminders x WHERE x.occurrence_id = o.id AND x.offset_minutes = r.offset_minutes
				AND x.audience = r.audience)
		ORDER BY o.starts_at LIMIT $2),
	claimed AS (INSERT INTO scheduling_reminders (occurrence_id, offset_minutes, audience, sent_at)
		SELECT id, offset_minutes, audience, $1 FROM due ON CONFLICT DO NOTHING RETURNING occurrence_id, offset_minutes, audience)
	SELECT due.workspace_id, due.id, due.offset_minutes, due.audience, due.starts_at FROM due
	JOIN claimed c ON c.occurrence_id = due.id AND c.offset_minutes = due.offset_minutes AND c.audience = due.audience
	ORDER BY due.starts_at`, now, limit, d.ClientReminders, d.HostReminders)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DueReminder, error) {
		var x DueReminder
		return x, r.Scan(&x.WorkspaceID, &x.OccurrenceID, &x.OffsetMinutes, &x.Audience, &x.StartsAt)
	})
}
