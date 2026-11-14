package store

import (
	"context"
	"encoding/json"
	"time"
)

// A person's notifications (internal/notifications).

type Notification struct {
	ID                   int64
	WorkspaceID, UserID  string
	Event                string
	Data                 json.RawMessage
	CreatedAt            time.Time
	ReadAt               *time.Time
	Email, WorkspaceName string // the email batch only
	WorkspaceTimezone    string // the email batch only
}

// NotificationChoice is one event's setting; NotificationPrefs keeps only the events a person changed.
type NotificationChoice struct {
	Email bool `json:"email"`
	InApp bool `json:"in_app"`
}

type NotificationPrefs map[string]NotificationChoice

// NotifyTo picks the recipients among the workspace's members: by role or by id, never Except. Once, when set, skips
// whoever already has a notification with that key (an event a job sees again on every run).
type NotifyTo struct {
	Roles, UserIDs []string
	Except         string
	Once           string
}

// EventDefaults: what a person who never changed the event's switches gets. EmailOffered false: never an email.
type EventDefaults struct{ Bell, Email, EmailOffered bool }

// Notify writes the event for each recipient who has the bell or (when the event emails) the email on, in the
// caller's transaction. An email that is off or not offered is marked done at once.
func (q Q) Notify(ctx context.Context, workspaceID, event string, data map[string]any, d EventDefaults, to NotifyTo, now time.Time) error {
	_, err := q.db.Exec(ctx, `
		WITH r AS (
			SELECT u.id,
				coalesce((u.notification_prefs -> $2 ->> 'in_app')::boolean, $9) AS in_app,
				$7 AND coalesce((u.notification_prefs -> $2 ->> 'email')::boolean, $10) AS email
			FROM workspace_members m JOIN users u ON u.id = m.user_id
			WHERE m.workspace_id = $1 AND u.deleted_at IS NULL AND u.id <> $6
				AND (m.role = ANY($4) OR m.user_id = ANY($5))
				AND ($11 = '' OR NOT EXISTS (SELECT 1 FROM notifications x
					WHERE x.user_id = u.id AND x.workspace_id = $1 AND x.once_key = $11)))
		INSERT INTO notifications (workspace_id, user_id, event, data, in_app, created_at, emailed_at, once_key)
		SELECT $1, r.id, $2, $3, r.in_app, $8, CASE WHEN r.email THEN NULL ELSE $8::timestamptz END, NULLIF($11, '')
		FROM r WHERE r.in_app OR r.email
		ON CONFLICT DO NOTHING`,
		workspaceID, event, data, to.Roles, to.UserIDs, to.Except, d.EmailOffered, now, d.Bell, d.Email, to.Once)
	return err
}

// NotificationFilter narrows the bell: before an id (0: from the newest), only unread ones, only these events, or
// (ReadAfter) the unread ones and those read after the time, which is what the bell's bubble shows.
type NotificationFilter struct {
	Before    int64
	Limit     int
	Unread    bool
	Events    []string
	ReadAfter *time.Time
}

// Notifications is the person's bell in the workspace, newest first.
func (q Q) Notifications(ctx context.Context, workspaceID, userID string, f NotificationFilter) ([]Notification, error) {
	rows, err := q.db.Query(ctx, `SELECT id, event, data, created_at, read_at FROM notifications
		WHERE user_id = $1 AND workspace_id = $2 AND in_app AND ($3 = 0 OR id < $3)
			AND (NOT $5 OR read_at IS NULL) AND ($6::text[] IS NULL OR event = ANY($6))
			AND ($7::timestamptz IS NULL OR read_at IS NULL OR read_at > $7)
		ORDER BY id DESC LIMIT $4`, userID, workspaceID, f.Before, f.Limit, f.Unread, f.Events, f.ReadAfter)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Notification{}
	for rows.Next() {
		n := Notification{WorkspaceID: workspaceID, UserID: userID}
		if err := rows.Scan(&n.ID, &n.Event, &n.Data, &n.CreatedAt, &n.ReadAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (q Q) UnreadNotifications(ctx context.Context, workspaceID, userID string) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM notifications
		WHERE user_id = $1 AND workspace_id = $2 AND in_app AND read_at IS NULL`, userID, workspaceID).Scan(&n)
	return n, err
}

// SetNotificationRead marks one of the person's notifications read at the time (keeping an earlier read time), or
// unread when at is nil. False: no such notification of theirs in the workspace.
func (q Q) SetNotificationRead(ctx context.Context, workspaceID, userID string, id int64, at *time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE notifications
		SET read_at = CASE WHEN $4::timestamptz IS NULL THEN NULL ELSE coalesce(read_at, $4) END
		WHERE id = $3 AND user_id = $1 AND workspace_id = $2 AND in_app`, userID, workspaceID, id, at)
	return tag.RowsAffected() == 1, err
}

func (q Q) ReadNotifications(ctx context.Context, workspaceID, userID string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE notifications SET read_at = $3
		WHERE user_id = $1 AND workspace_id = $2 AND read_at IS NULL`, userID, workspaceID, now)
	return err
}

// UserNotificationPrefs: lock true takes the row lock, so a settings save and an unsubscribe link merge.
func (q Q) UserNotificationPrefs(ctx context.Context, userID string, lock bool) (NotificationPrefs, error) {
	sql := `SELECT notification_prefs FROM users WHERE id = $1 AND deleted_at IS NULL`
	if lock {
		sql += ` FOR UPDATE`
	}
	p := NotificationPrefs{}
	err := q.db.QueryRow(ctx, sql, userID).Scan(&p)
	return p, err
}

func (q Q) SetUserNotificationPrefs(ctx context.Context, userID string, p NotificationPrefs, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE users SET notification_prefs = $2, updated_at = $3 WHERE id = $1`, userID, p, now)
	return err
}

// ClaimNotificationEmails takes the emails due: every pending one of a (person, workspace, event) whose newest
// is older than quiet, so a burst goes out once it has settled. They are marked sent before sending (at most
// once); the email setting is the person's current one, and a deleted workspace or person, or one who has left
// the workspace since, sends nothing.
func (q Q) ClaimNotificationEmails(ctx context.Context, quiet time.Duration, now time.Time) ([]Notification, error) {
	rows, err := q.db.Query(ctx, `
		WITH due AS (
			SELECT user_id, workspace_id, event FROM notifications WHERE emailed_at IS NULL
			GROUP BY 1, 2, 3 HAVING max(created_at) <= $1
		), claimed AS (
			UPDATE notifications n SET emailed_at = $2 FROM due
			WHERE n.emailed_at IS NULL AND (n.user_id, n.workspace_id, n.event) = (due.user_id, due.workspace_id, due.event)
			RETURNING n.id, n.workspace_id, n.user_id, n.event, n.data, n.created_at)
		SELECT c.id, c.workspace_id, c.user_id, c.event, c.data, c.created_at, u.email, w.name, w.timezone
		FROM claimed c JOIN users u ON u.id = c.user_id JOIN workspaces w ON w.id = c.workspace_id
		WHERE u.deleted_at IS NULL AND w.deleted_at IS NULL
			AND EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = c.workspace_id AND m.user_id = c.user_id)
			AND coalesce((u.notification_prefs -> c.event ->> 'email')::boolean, true)
		ORDER BY c.user_id, c.workspace_id, c.event, c.id`, now.Add(-quiet), now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Notification{}
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.WorkspaceID, &n.UserID, &n.Event, &n.Data, &n.CreatedAt, &n.Email, &n.WorkspaceName, &n.WorkspaceTimezone); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
