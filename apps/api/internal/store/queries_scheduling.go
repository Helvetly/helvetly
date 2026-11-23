package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Scheduling configuration (00051_scheduling.sql): the workspace's settings and holidays, each host's hours, the
// event types clients may book and the booking links made on demand. Times of day are "HH:MM", dates "YYYY-MM-DD".

// SchedSettings is the workspace's scheduling policy (scheduling-contract.md, "Settings").
type SchedSettings struct {
	BookingMode          string  `json:"booking_mode"` // staff | clients
	Confirmation         string  `json:"confirmation"` // auto | manual
	NoticeMinutes        int     `json:"notice_minutes"`
	CutoffTime           *string `json:"cutoff_time"`
	CutoffDays           []int   `json:"cutoff_days"` // ISO weekdays
	CutoffSkipsHolidays  bool    `json:"cutoff_skips_holidays"`
	AutoApproveOnTime    bool    `json:"auto_approve_on_time"`
	LateCancelCounts     bool    `json:"late_cancel_counts"`
	NoShowCounts         bool    `json:"no_show_counts"`
	LateRescheduleCounts bool    `json:"late_reschedule_counts"`
	// ClientReminders and HostReminders are minutes before the start; an empty list is no reminders.
	ClientReminders        []int      `json:"client_reminders"`
	HostReminders          []int      `json:"host_reminders"`
	AutoAttendedAfterHours *int       `json:"auto_attended_after_hours"`
	FeedDetails            string     `json:"feed_details"` // full | busy
	DefaultLocation        *string    `json:"default_location"`
	UpdatedBy              *string    `json:"-"`
	UpdatedAt              *time.Time `json:"-"`
}

// DefaultSchedSettings is the policy of a workspace that never saved one: staff schedule, 24 h notice on business
// days, late cancellations and no-shows count, a late reschedule does not, clients reminded 24 h and 1 h before.
func DefaultSchedSettings() SchedSettings {
	return SchedSettings{BookingMode: "staff", Confirmation: "auto", NoticeMinutes: 1440, CutoffDays: []int{1, 2, 3, 4, 5},
		CutoffSkipsHolidays: true, AutoApproveOnTime: true, LateCancelCounts: true, NoShowCounts: true,
		ClientReminders: []int{1440, 60}, HostReminders: []int{}, FeedDetails: "full"}
}

// SchedulingSettings is the workspace's saved policy, else DefaultSchedSettings.
func (q Q) SchedulingSettings(ctx context.Context, workspaceID string) (SchedSettings, error) {
	var s SchedSettings
	err := q.db.QueryRow(ctx, `SELECT booking_mode, confirmation, notice_minutes, to_char(cutoff_time, 'HH24:MI'), cutoff_days,
		cutoff_skips_holidays, auto_approve_on_time, late_cancel_counts, no_show_counts, late_reschedule_counts, client_reminders,
		host_reminders, auto_attended_after_hours, feed_details, default_location, updated_by, updated_at
		FROM scheduling_settings WHERE workspace_id = $1`, workspaceID).Scan(&s.BookingMode, &s.Confirmation, &s.NoticeMinutes,
		&s.CutoffTime, &s.CutoffDays, &s.CutoffSkipsHolidays, &s.AutoApproveOnTime, &s.LateCancelCounts, &s.NoShowCounts,
		&s.LateRescheduleCounts, &s.ClientReminders, &s.HostReminders, &s.AutoAttendedAfterHours, &s.FeedDetails,
		&s.DefaultLocation, &s.UpdatedBy, &s.UpdatedAt)
	if errors.Is(err, ErrNotFound) {
		return DefaultSchedSettings(), nil
	}
	return s, err
}

func (q Q) SaveSchedulingSettings(ctx context.Context, workspaceID string, s SchedSettings, by string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO scheduling_settings (workspace_id, booking_mode, confirmation, notice_minutes, cutoff_time,
		cutoff_days, cutoff_skips_holidays, auto_approve_on_time, late_cancel_counts, no_show_counts, late_reschedule_counts,
		client_reminders, host_reminders, auto_attended_after_hours, feed_details, default_location, updated_by, updated_at)
		VALUES ($1, $2, $3, $4, $5::time, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
		ON CONFLICT (workspace_id) DO UPDATE SET booking_mode = $2, confirmation = $3, notice_minutes = $4, cutoff_time = $5::time,
		cutoff_days = $6, cutoff_skips_holidays = $7, auto_approve_on_time = $8, late_cancel_counts = $9, no_show_counts = $10,
		late_reschedule_counts = $11, client_reminders = $12, host_reminders = $13, auto_attended_after_hours = $14,
		feed_details = $15, default_location = $16, updated_by = $17, updated_at = $18`,
		workspaceID, s.BookingMode, s.Confirmation, s.NoticeMinutes, s.CutoffTime, nonNil(s.CutoffDays), s.CutoffSkipsHolidays,
		s.AutoApproveOnTime, s.LateCancelCounts, s.NoShowCounts, s.LateRescheduleCounts, nonNil(s.ClientReminders),
		nonNil(s.HostReminders), s.AutoAttendedAfterHours, s.FeedDetails, s.DefaultLocation, by, now)
	return err
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

// SchedHoliday is a day the workspace does not work.
type SchedHoliday struct {
	Day  string `json:"date"`
	Name string `json:"name"`
}

// SchedulingHolidays lists the workspace's holidays by day, from and to inclusive ("" = no bound).
func (q Q) SchedulingHolidays(ctx context.Context, workspaceID, from, to string) ([]SchedHoliday, error) {
	rows, err := q.db.Query(ctx, `SELECT day::text, name FROM scheduling_holidays WHERE workspace_id = $1
		AND ($2 = '' OR day >= $2::date) AND ($3 = '' OR day <= $3::date) ORDER BY day`, workspaceID, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SchedHoliday, error) {
		var h SchedHoliday
		return h, r.Scan(&h.Day, &h.Name)
	})
}

// ReplaceSchedulingHolidays makes days the workspace's whole holiday list.
func (q Q) ReplaceSchedulingHolidays(ctx context.Context, workspaceID string, days []SchedHoliday) error {
	return q.writeTx(ctx, func(q Q) error {
		if _, err := q.db.Exec(ctx, `DELETE FROM scheduling_holidays WHERE workspace_id = $1`, workspaceID); err != nil {
			return err
		}
		dates, names := make([]string, len(days)), make([]string, len(days))
		for i, d := range days {
			dates[i], names[i] = d.Day, d.Name
		}
		_, err := q.db.Exec(ctx, `INSERT INTO scheduling_holidays (workspace_id, day, name)
			SELECT $1, d::date, n FROM unnest($2::text[], $3::text[]) AS h(d, n)`, workspaceID, dates, names)
		return err
	})
}

// SchedWindow is a weekly stretch of a host's hours (weekday 1 = Monday).
type SchedWindow struct {
	Weekday int    `json:"day"`
	Start   string `json:"start"`
	End     string `json:"end"`
}

// SchedOverride replaces a host's hours on one day; no start and end is the day off.
type SchedOverride struct {
	Day   string  `json:"date"`
	Start *string `json:"start"`
	End   *string `json:"end"`
}

// SchedHost is a member's scheduling profile: their zone (nil = the workspace's), whether clients may book them,
// their colour, weekly hours and date overrides.
type SchedHost struct {
	UserID    string          `json:"user_id"`
	TimeZone  *string         `json:"time_zone"`
	Bookable  bool            `json:"bookable"`
	Color     *string         `json:"color"`
	Weekly    []SchedWindow   `json:"weekly"`
	Overrides []SchedOverride `json:"overrides"`
}

// SchedulingHost is the member's profile; ErrNotFound when they never saved one.
func (q Q) SchedulingHost(ctx context.Context, workspaceID, userID string) (SchedHost, error) {
	hosts, err := q.schedulingHosts(ctx, workspaceID, userID)
	if err != nil {
		return SchedHost{}, err
	}
	if len(hosts) == 0 {
		return SchedHost{}, ErrNotFound
	}
	return hosts[0], nil
}

// SchedulingHosts lists every saved host profile of the workspace, with hours and overrides.
func (q Q) SchedulingHosts(ctx context.Context, workspaceID string) ([]SchedHost, error) {
	return q.schedulingHosts(ctx, workspaceID, "")
}

func (q Q) schedulingHosts(ctx context.Context, workspaceID, userID string) ([]SchedHost, error) {
	rows, err := q.db.Query(ctx, `SELECT h.user_id, h.time_zone, h.bookable, h.color,
		coalesce((SELECT jsonb_agg(jsonb_build_object('day', a.weekday, 'start', to_char(a.starts, 'HH24:MI'),
			'end', to_char(a.ends, 'HH24:MI')) ORDER BY a.weekday, a.starts)
			FROM scheduling_availability a WHERE a.workspace_id = h.workspace_id AND a.user_id = h.user_id), '[]'),
		coalesce((SELECT jsonb_agg(jsonb_build_object('date', o.day::text, 'start', to_char(o.starts, 'HH24:MI'),
			'end', to_char(o.ends, 'HH24:MI')) ORDER BY o.day)
			FROM scheduling_availability_overrides o WHERE o.workspace_id = h.workspace_id AND o.user_id = h.user_id), '[]')
		FROM scheduling_hosts h WHERE h.workspace_id = $1 AND ($2 = '' OR h.user_id = $2) ORDER BY h.user_id`, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SchedHost, error) {
		var h SchedHost
		return h, r.Scan(&h.UserID, &h.TimeZone, &h.Bookable, &h.Color, &h.Weekly, &h.Overrides)
	})
}

// SaveSchedulingHost writes the member's profile and replaces their hours and overrides; the member must be in the
// workspace (a foreign key refuses anyone else).
func (q Q) SaveSchedulingHost(ctx context.Context, workspaceID string, h SchedHost, now time.Time) error {
	return q.writeTx(ctx, func(q Q) error {
		if _, err := q.db.Exec(ctx, `INSERT INTO scheduling_hosts (workspace_id, user_id, time_zone, bookable, color, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (workspace_id, user_id) DO UPDATE SET time_zone = $3, bookable = $4,
			color = $5, updated_at = $6`, workspaceID, h.UserID, h.TimeZone, h.Bookable, h.Color, now); err != nil {
			return err
		}
		if _, err := q.db.Exec(ctx, `DELETE FROM scheduling_availability WHERE workspace_id = $1 AND user_id = $2`, workspaceID, h.UserID); err != nil {
			return err
		}
		if _, err := q.db.Exec(ctx, `DELETE FROM scheduling_availability_overrides WHERE workspace_id = $1 AND user_id = $2`, workspaceID, h.UserID); err != nil {
			return err
		}
		days, starts, ends := make([]int, len(h.Weekly)), make([]string, len(h.Weekly)), make([]string, len(h.Weekly))
		for i, w := range h.Weekly {
			days[i], starts[i], ends[i] = w.Weekday, w.Start, w.End
		}
		if _, err := q.db.Exec(ctx, `INSERT INTO scheduling_availability (workspace_id, user_id, weekday, starts, ends)
			SELECT $1, $2, d, s::time, e::time FROM unnest($3::int[], $4::text[], $5::text[]) AS w(d, s, e)`,
			workspaceID, h.UserID, days, starts, ends); err != nil {
			return err
		}
		dates, oStarts, oEnds := make([]string, len(h.Overrides)), make([]*string, len(h.Overrides)), make([]*string, len(h.Overrides))
		for i, o := range h.Overrides {
			dates[i], oStarts[i], oEnds[i] = o.Day, o.Start, o.End
		}
		_, err := q.db.Exec(ctx, `INSERT INTO scheduling_availability_overrides (workspace_id, user_id, day, starts, ends)
			SELECT $1, $2, d::date, s::time, e::time FROM unnest($3::text[], $4::text[], $5::text[]) AS o(d, s, e)`,
			workspaceID, h.UserID, dates, oStarts, oEnds)
		return err
	})
}

// SchedEventType is a kind of session clients may book (scheduling-contract.md, "Self-booking").
type SchedEventType struct {
	ID               string     `json:"id"`
	WorkspaceID      string     `json:"-"`
	Name             string     `json:"name"`
	Description      *string    `json:"description"`
	DurationMinutes  int        `json:"duration_minutes"`
	Mode             string     `json:"mode"`
	MeetingProvider  *string    `json:"meeting_provider"`
	Location         *string    `json:"location"`
	ProductID        *string    `json:"product_id"`
	UnitPrice        *Money     `json:"unit_price"`
	Currency         *string    `json:"currency"`
	HostIDs          []string   `json:"host_ids"`
	BufferBefore     int        `json:"buffer_before"`
	BufferAfter      int        `json:"buffer_after"`
	MinNoticeMinutes int        `json:"min_notice_minutes"`
	MaxHorizonDays   int        `json:"max_horizon_days"`
	SlotStepMinutes  *int       `json:"slot_step_minutes"`
	Bookable         bool       `json:"bookable"`
	Color            *string    `json:"color"`
	ArchivedAt       *time.Time `json:"archived_at"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// ErrSchedNameTaken: a live event type of the workspace already has the name.
var ErrSchedNameTaken = errors.New("event type name taken")

const eventTypeColumns = `id, workspace_id, name, description, duration_minutes, mode, meeting_provider, location, product_id,
	unit_price, currency, host_ids, buffer_before, buffer_after, min_notice_minutes, max_horizon_days, slot_step_minutes, bookable,
	color, archived_at, created_at, updated_at`

func scanEventType(r interface{ Scan(...any) error }) (SchedEventType, error) {
	var t SchedEventType
	err := r.Scan(&t.ID, &t.WorkspaceID, &t.Name, &t.Description, &t.DurationMinutes, &t.Mode, &t.MeetingProvider, &t.Location,
		&t.ProductID, &t.UnitPrice, &t.Currency, &t.HostIDs, &t.BufferBefore, &t.BufferAfter, &t.MinNoticeMinutes, &t.MaxHorizonDays,
		&t.SlotStepMinutes, &t.Bookable, &t.Color, &t.ArchivedAt, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

func nameTaken(err error) error {
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" && pg.ConstraintName == "scheduling_event_types_name" {
		return ErrSchedNameTaken
	}
	return err
}

func (q Q) CreateSchedEventType(ctx context.Context, t SchedEventType) error {
	_, err := q.db.Exec(ctx, `INSERT INTO scheduling_event_types (`+eventTypeColumns+`)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NULL, $20, $20)`,
		t.ID, t.WorkspaceID, t.Name, t.Description, t.DurationMinutes, t.Mode, t.MeetingProvider, t.Location, t.ProductID, t.UnitPrice,
		t.Currency, nonNil(t.HostIDs), t.BufferBefore, t.BufferAfter, t.MinNoticeMinutes, t.MaxHorizonDays, t.SlotStepMinutes,
		t.Bookable, t.Color, t.CreatedAt)
	return nameTaken(err)
}

// SaveSchedEventType writes every field but the id, workspace and creation; ErrNotFound for another workspace's.
func (q Q) SaveSchedEventType(ctx context.Context, t SchedEventType) error {
	tag, err := q.db.Exec(ctx, `UPDATE scheduling_event_types SET name = $3, description = $4, duration_minutes = $5, mode = $6,
		meeting_provider = $7, location = $8, product_id = $9, unit_price = $10, currency = $11, host_ids = $12, buffer_before = $13,
		buffer_after = $14, min_notice_minutes = $15, max_horizon_days = $16, slot_step_minutes = $17, bookable = $18, color = $19,
		archived_at = $20, updated_at = $21 WHERE workspace_id = $1 AND id = $2`,
		t.WorkspaceID, t.ID, t.Name, t.Description, t.DurationMinutes, t.Mode, t.MeetingProvider, t.Location, t.ProductID, t.UnitPrice,
		t.Currency, nonNil(t.HostIDs), t.BufferBefore, t.BufferAfter, t.MinNoticeMinutes, t.MaxHorizonDays, t.SlotStepMinutes,
		t.Bookable, t.Color, t.ArchivedAt, t.UpdatedAt)
	return affected(tag, nameTaken(err))
}

func affected(tag pgconn.CommandTag, err error) error {
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (q Q) SchedEventType(ctx context.Context, workspaceID, id string) (SchedEventType, error) {
	return scanEventType(q.db.QueryRow(ctx, `SELECT `+eventTypeColumns+` FROM scheduling_event_types WHERE workspace_id = $1 AND id = $2`,
		workspaceID, id))
}

// SchedEventTypes lists the workspace's event types by name, the archived ones only when asked.
func (q Q) SchedEventTypes(ctx context.Context, workspaceID string, archived bool) ([]SchedEventType, error) {
	rows, err := q.db.Query(ctx, `SELECT `+eventTypeColumns+` FROM scheduling_event_types WHERE workspace_id = $1
		AND ($2 OR archived_at IS NULL) ORDER BY lower(name), id`, workspaceID, archived)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SchedEventType, error) { return scanEventType(r) })
}

// DeleteSchedEventType deletes an event type no event uses, else archives it; archived reports which.
func (q Q) DeleteSchedEventType(ctx context.Context, workspaceID, id string, now time.Time) (archived bool, err error) {
	err = q.writeTx(ctx, func(q Q) error {
		var used bool
		if err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM scheduling_events WHERE workspace_id = $1 AND event_type_id = $2)`,
			workspaceID, id).Scan(&used); err != nil {
			return err
		}
		archived = used
		if used {
			tag, err := q.db.Exec(ctx, `UPDATE scheduling_event_types SET archived_at = coalesce(archived_at, $3), updated_at = $3
				WHERE workspace_id = $1 AND id = $2`, workspaceID, id, now)
			return affected(tag, err)
		}
		tag, err := q.db.Exec(ctx, `DELETE FROM scheduling_event_types WHERE workspace_id = $1 AND id = $2`, workspaceID, id)
		return affected(tag, err)
	})
	return archived, err
}

// SchedBookingLink is a public booking link a member made for a host or an event type (or both): it books for
// people who are not clients yet, until ExpiresAt (nil = no end) or until revoked.
type SchedBookingLink struct {
	ID          string     `json:"id"`
	WorkspaceID string     `json:"-"`
	HostUserID  *string    `json:"host_id"`
	EventTypeID *string    `json:"event_type_id"`
	TokenHash   []byte     `json:"-"`
	TokenSealed []byte     `json:"-"`
	ExpiresAt   *time.Time `json:"expires_at"`
	RevokedAt   *time.Time `json:"revoked_at"`
	CreatedBy   string     `json:"created_by"`
	CreatedAt   time.Time  `json:"created_at"`
	LastUsedAt  *time.Time `json:"last_used_at"`
}

const bookingLinkColumns = `l.id, l.workspace_id, l.host_user_id, l.event_type_id, l.token_hash, l.token_sealed, l.expires_at,
	l.revoked_at, l.created_by, l.created_at, l.last_used_at`

func scanBookingLink(r interface{ Scan(...any) error }) (SchedBookingLink, error) {
	var l SchedBookingLink
	err := r.Scan(&l.ID, &l.WorkspaceID, &l.HostUserID, &l.EventTypeID, &l.TokenHash, &l.TokenSealed, &l.ExpiresAt, &l.RevokedAt,
		&l.CreatedBy, &l.CreatedAt, &l.LastUsedAt)
	return l, err
}

func (q Q) CreateSchedBookingLink(ctx context.Context, l SchedBookingLink) error {
	_, err := q.db.Exec(ctx, `INSERT INTO scheduling_booking_links (id, workspace_id, host_user_id, event_type_id, token_hash,
		token_sealed, expires_at, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		l.ID, l.WorkspaceID, l.HostUserID, l.EventTypeID, l.TokenHash, l.TokenSealed, l.ExpiresAt, l.CreatedBy, l.CreatedAt)
	return err
}

// SchedBookingLinks lists the workspace's links, newest first, revoked and expired ones too.
func (q Q) SchedBookingLinks(ctx context.Context, workspaceID string) ([]SchedBookingLink, error) {
	rows, err := q.db.Query(ctx, `SELECT `+bookingLinkColumns+` FROM scheduling_booking_links l WHERE l.workspace_id = $1
		ORDER BY l.created_at DESC, l.id`, workspaceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SchedBookingLink, error) { return scanBookingLink(r) })
}

// LiveSchedBookingLink is the link whose token hashes to tokenHash while it is usable at now: not revoked, not
// expired, its workspace not deleted; ErrNotFound otherwise.
func (q Q) LiveSchedBookingLink(ctx context.Context, tokenHash []byte, now time.Time) (SchedBookingLink, error) {
	return scanBookingLink(q.db.QueryRow(ctx, `SELECT `+bookingLinkColumns+` FROM scheduling_booking_links l
		JOIN workspaces w ON w.id = l.workspace_id WHERE l.token_hash = $1 AND l.revoked_at IS NULL
		AND (l.expires_at IS NULL OR l.expires_at > $2) AND w.deleted_at IS NULL`, tokenHash, now))
}

// RevokeSchedBookingLink stops the link at once; revoking it again keeps the first time. ErrNotFound for another
// workspace's.
func (q Q) RevokeSchedBookingLink(ctx context.Context, workspaceID, id string, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE scheduling_booking_links SET revoked_at = coalesce(revoked_at, $3)
		WHERE workspace_id = $1 AND id = $2`, workspaceID, id, now)
	return affected(tag, err)
}

func (q Q) TouchSchedBookingLink(ctx context.Context, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE scheduling_booking_links SET last_used_at = $2 WHERE id = $1`, id, now)
	return err
}

// ClientTimeZone is the client's own zone; nil when unknown (the workspace's applies).
func (q Q) ClientTimeZone(ctx context.Context, workspaceID, clientID string) (*string, error) {
	var tz *string
	err := q.db.QueryRow(ctx, `SELECT time_zone FROM clients WHERE workspace_id = $1 AND id = $2`, workspaceID, clientID).Scan(&tz)
	return tz, err
}

// SetClientTimeZone sets the client's zone (nil clears it); onlyUnset leaves a zone already known (the portal's first
// sign-in), so staff's choice stands.
func (q Q) SetClientTimeZone(ctx context.Context, workspaceID, clientID string, tz *string, onlyUnset bool) error {
	_, err := q.db.Exec(ctx, `UPDATE clients SET time_zone = $3 WHERE workspace_id = $1 AND id = $2 AND (NOT $4 OR time_zone IS NULL)`,
		workspaceID, clientID, tz, onlyUnset)
	return err
}
