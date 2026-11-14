package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type AccountIdentity struct {
	Provider  string    `json:"provider"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
}

func (q Q) LockAccount(ctx context.Context, userID string) error {
	var id string
	return q.db.QueryRow(ctx, `SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, userID).Scan(&id)
}

func (q Q) AccountIdentities(ctx context.Context, userID string) ([]AccountIdentity, error) {
	rows, err := q.db.Query(ctx, `SELECT provider,email,created_at FROM user_identities WHERE user_id=$1
		UNION ALL SELECT 'email',email,created_at FROM users WHERE id=$1 AND NOT EXISTS
		(SELECT 1 FROM user_identities WHERE user_id=$1 AND provider='email') ORDER BY provider,created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AccountIdentity{}
	for rows.Next() {
		var i AccountIdentity
		if err := rows.Scan(&i.Provider, &i.Email, &i.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (q Q) UpdateAccountName(ctx context.Context, userID, name string, now time.Time) (User, error) {
	return scanUser(q.db.QueryRow(ctx, `UPDATE users u SET name=$2,updated_at=$3 WHERE id=$1 AND deleted_at IS NULL RETURNING `+userColumns, userID, name, now))
}

type AccountSession struct {
	ID            string
	UserAgent     string
	IP            string
	WorkspaceName string
	CreatedAt     time.Time
	LastActiveAt  time.Time
}

func (q Q) AccountSessionLive(ctx context.Context, userID, id string, now time.Time) (bool, error) {
	var ok bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions s JOIN workspaces w ON w.id=s.workspace_id WHERE s.user_id=$1 AND s.id=$2 AND s.expires_at>$3 AND w.deleted_at IS NULL)`, userID, id, now).Scan(&ok)
	return ok, err
}

func (q Q) SetSessionMetadata(ctx context.Context, id, userAgent, ip string) error {
	_, err := q.db.Exec(ctx, `UPDATE sessions SET user_agent=$2,ip=$3 WHERE id=$1`, id, userAgent, ip)
	return err
}

func (q Q) TouchSession(ctx context.Context, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE sessions SET last_active_at=$2 WHERE id=$1 AND last_active_at < $2::timestamptz - interval '5 minutes'`, id, now)
	return err
}

func (q Q) AccountSessions(ctx context.Context, userID string, now time.Time) ([]AccountSession, error) {
	rows, err := q.db.Query(ctx, `SELECT s.id,s.user_agent,s.ip,w.name,s.created_at,s.last_active_at FROM sessions s
		JOIN workspaces w ON w.id=s.workspace_id WHERE s.user_id=$1 AND s.expires_at>$2 AND w.deleted_at IS NULL
		ORDER BY s.last_active_at DESC,s.id`, userID, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AccountSession{}
	for rows.Next() {
		var s AccountSession
		if err := rows.Scan(&s.ID, &s.UserAgent, &s.IP, &s.WorkspaceName, &s.CreatedAt, &s.LastActiveAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (q Q) DeleteAccountSession(ctx context.Context, userID, id string) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM sessions WHERE user_id=$1 AND id=$2`, userID, id)
	return tag.RowsAffected() > 0, err
}

func (q Q) DeleteOtherAccountSessions(ctx context.Context, userID, keepID string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM sessions WHERE user_id=$1 AND id<>$2`, userID, keepID)
	return err
}

func (q Q) DeleteAccountIdentity(ctx context.Context, userID, provider string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM user_identities WHERE user_id=$1 AND provider=$2`, userID, provider)
	return err
}

// AccountSoleOwner locks the memberships' workspaces in the same order as member management.
func (q Q) AccountSoleOwner(ctx context.Context, userID string) (bool, error) {
	rows, err := q.db.Query(ctx, `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
		WHERE m.user_id=$1 AND w.deleted_at IS NULL ORDER BY w.id FOR UPDATE OF w`, userID)
	if err != nil {
		return false, err
	}
	for rows.Next() {
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return false, err
	}
	var sole bool
	err = q.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
		WHERE m.user_id=$1 AND m.role='owner' AND w.deleted_at IS NULL AND NOT EXISTS
		(SELECT 1 FROM workspace_members o WHERE o.workspace_id=m.workspace_id AND o.role='owner' AND o.user_id<>$1))`, userID).Scan(&sole)
	return sole, err
}

// CloseAccount removes authentication and personal data (sign-in methods, API tokens, the person's own Heidi chats,
// inbox, folder stars, notification settings and feedback text), retaining record authorship IDs and financial
// records. It returns the stored objects that were the person's own (photo, feedback screenshots), which the caller
// removes from storage after the commit.
func (q Q) CloseAccount(ctx context.Context, userID string, now time.Time) ([]string, error) {
	rows, err := q.db.Query(ctx, `DELETE FROM product_feedback_files f USING product_feedback p
		WHERE p.id = f.feedback_id AND p.user_id = $1 RETURNING f.object_key`, userID)
	if err != nil {
		return nil, err
	}
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	for _, sql := range []string{
		`DELETE FROM account_login_challenges WHERE user_id=$1`,
		`DELETE FROM account_recovery_codes WHERE user_id=$1`,
		`DELETE FROM account_two_factor WHERE user_id=$1`,
		`DELETE FROM sessions WHERE user_id=$1`,
		`DELETE FROM api_tokens WHERE user_id=$1`,
		`DELETE FROM passkey_challenges WHERE user_id=$1`,
		`DELETE FROM passkeys WHERE user_id=$1`,
		`DELETE FROM user_identities WHERE user_id=$1`,
		`DELETE FROM heidi_conversations WHERE user_id=$1`, // messages and confirmations cascade
		`DELETE FROM notifications WHERE user_id=$1`,
		`DELETE FROM document_folder_stars WHERE user_id=$1`,
		`UPDATE product_feedback SET description='(account deleted)', page_path='' WHERE user_id=$1`,
		`DELETE FROM workspace_members WHERE user_id=$1`,
	} {
		if _, err := q.db.Exec(ctx, sql, userID); err != nil {
			return nil, err
		}
	}
	var photo *string
	err = q.db.QueryRow(ctx, `UPDATE users n SET email=n.id||'@deleted.invalid',name='',avatar_url='',photo_key=NULL,photo_type=NULL,
		photo_size=NULL,photo_sha256=NULL,notification_prefs='{}',deleted_at=$2,updated_at=$2 FROM users o WHERE n.id=$1 AND o.id=n.id
		RETURNING o.photo_key`, userID, now).Scan(&photo)
	if err != nil {
		return nil, err
	}
	if photo != nil {
		keys = append(keys, *photo)
	}
	return keys, nil
}

// UserPhoto is a person's own photo: its stored object and the SHA-256 of its bytes.
type UserPhoto struct {
	ObjectKey, ContentType, SHA256 string
	Size                           int64
}

// LockUserPhoto locks the person's row until the transaction ends and returns the current photo; ErrNotFound when
// there is none (or the account is closed).
func (q Q) LockUserPhoto(ctx context.Context, userID string) (UserPhoto, error) {
	var key, ct, sum *string
	var size *int64
	err := q.db.QueryRow(ctx, `SELECT photo_key, photo_type, photo_sha256, photo_size FROM users
		WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, userID).Scan(&key, &ct, &sum, &size)
	if err != nil {
		return UserPhoto{}, err
	}
	if key == nil {
		return UserPhoto{}, ErrNotFound
	}
	return UserPhoto{ObjectKey: *key, ContentType: *ct, SHA256: *sum, Size: *size}, nil
}

// VisibleUserPhoto is the photo of a person the viewer may see: themself, or a member of the viewer's workspace.
func (q Q) VisibleUserPhoto(ctx context.Context, workspaceID, viewerID, userID string) (UserPhoto, error) {
	var p UserPhoto
	err := q.db.QueryRow(ctx, `SELECT u.photo_key, u.photo_type, u.photo_sha256, u.photo_size FROM users u
		WHERE u.id = $3 AND u.photo_key IS NOT NULL AND u.deleted_at IS NULL AND (u.id = $2::text OR EXISTS
			(SELECT 1 FROM workspace_members m WHERE m.workspace_id = $1 AND m.user_id = u.id))`,
		workspaceID, viewerID, userID).Scan(&p.ObjectKey, &p.ContentType, &p.SHA256, &p.Size)
	return p, err
}

// SetUserPhoto points the person at a stored photo, or at none when p is the zero value.
func (q Q) SetUserPhoto(ctx context.Context, userID string, p UserPhoto, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE users SET photo_key = nullif($2, ''), photo_type = nullif($3, ''),
		photo_sha256 = nullif($4, ''), photo_size = CASE WHEN $2 = '' THEN NULL ELSE $5::bigint END, updated_at = $6
		WHERE id = $1`, userID, p.ObjectKey, p.ContentType, p.SHA256, p.Size, now)
	return err
}
