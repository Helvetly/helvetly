package store

import (
	"context"
	"strings"
	"time"
)

// PortalAccess is one client an address may sign in to.
type PortalAccess struct {
	ClientID, ClientName       string
	WorkspaceID, WorkspaceName string
	WorkspaceLogoFileID        *string
}

// PortalSession is a live client-portal session with the address it signed in with, its client and workspace.
type PortalSession struct {
	ID, CSRFToken        string
	Email                string
	Scoped               bool // opened under the workspace's portal address, valid only there
	ClientID, ClientName string
	LastActiveAt         time.Time
	Workspace            Workspace
}

// portalLogin is a client's portal address: its email, else its billing email.
const portalLogin = `lower(coalesce(nullif(c.email, ''), nullif(c.billing_email, '')))`

// PortalAccessByEmail: the live clients with the portal on whose portal address is this one (any case), only in
// workspaceID unless it is "".
func (q Q) PortalAccessByEmail(ctx context.Context, email, workspaceID string) ([]PortalAccess, error) {
	rows, err := q.db.Query(ctx, `SELECT c.id, c.name, w.id, w.name, w.logo_file_id FROM clients c
		JOIN workspaces w ON w.id = c.workspace_id
		WHERE `+portalLogin+` = lower($1) AND c.portal_enabled AND NOT w.portal_off AND c.deleted_at IS NULL AND w.deleted_at IS NULL
			AND ($2 = '' OR w.id = $2)
		ORDER BY c.name, c.id`, email, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PortalAccess
	for rows.Next() {
		var a PortalAccess
		if err := rows.Scan(&a.ClientID, &a.ClientName, &a.WorkspaceID, &a.WorkspaceName, &a.WorkspaceLogoFileID); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (q Q) CreatePortalSession(ctx context.Context, id, tokenHash, csrf, email, clientID, workspaceID string, scoped bool, now, expires time.Time) error {
	// Expired portal sessions are never read again: each portal sign-in clears them, as staff sign-in does its own.
	if _, err := q.db.Exec(ctx, `DELETE FROM portal_sessions WHERE expires_at < $1`, now); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `INSERT INTO portal_sessions (id, token_hash, csrf_token, email, client_id, workspace_id, created_at, expires_at, last_active_at, scoped)
		VALUES ($1, $2, $3, lower($4), $5, $6, $7, $8, $7, $9)`, id, tokenHash, csrf, email, clientID, workspaceID, now, expires, scoped)
	return err
}

// PortalSessionByToken re-checks access on every read: turning the portal off (for the client or the whole
// workspace) or changing the client's portal address ends the session at once.
func (q Q) PortalSessionByToken(ctx context.Context, tokenHash string, now time.Time) (PortalSession, error) {
	var s PortalSession
	err := q.db.QueryRow(ctx, `SELECT s.id, s.csrf_token, s.email, c.id, c.name, w.id, w.name, w.timezone, w.onboarded_at IS NOT NULL, s.last_active_at, s.scoped
		FROM portal_sessions s
		JOIN clients c ON c.id = s.client_id
		JOIN workspaces w ON w.id = s.workspace_id
		WHERE s.token_hash = $1 AND s.expires_at > $2 AND c.portal_enabled AND NOT w.portal_off AND `+portalLogin+` = s.email
			AND c.deleted_at IS NULL AND w.deleted_at IS NULL`, tokenHash, now).
		Scan(&s.ID, &s.CSRFToken, &s.Email, &s.ClientID, &s.ClientName,
			&s.Workspace.ID, &s.Workspace.Name, &s.Workspace.Timezone, &s.Workspace.Onboarded, &s.LastActiveAt, &s.Scoped)
	return s, err
}

// PortalPaymentsByCurrency totals recorded payments in the current year, according to the workspace's calendar.
func (q Q) PortalPaymentsByCurrency(ctx context.Context, workspaceID, clientID, today string) (map[string]Money, error) {
	rows, err := q.db.Query(ctx, `SELECT i.currency, sum(p.amount)::bigint
		FROM invoices i JOIN invoice_payments p ON p.invoice_id = i.id
		WHERE i.workspace_id = $1 AND i.client_id = $2 AND i.status <> 'draft'
			AND p.paid_on BETWEEN date_trunc('year', $3::date)::date AND $3::date
		GROUP BY i.currency`, workspaceID, clientID, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	totals := map[string]Money{}
	for rows.Next() {
		var currency string
		var amount Money
		if err := rows.Scan(&currency, &amount); err != nil {
			return nil, err
		}
		totals[currency] = amount
	}
	return totals, rows.Err()
}

func (q Q) TouchPortalSession(ctx context.Context, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE portal_sessions SET last_active_at = $2 WHERE id = $1 AND last_active_at < $2::timestamptz - interval '5 minutes'`, id, now)
	return err
}

// MarkPortalSignedIn records the client's first portal sign-in; true only the first time.
func (q Q) MarkPortalSignedIn(ctx context.Context, clientID string, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE clients SET portal_signed_in_at = $2 WHERE id = $1 AND portal_signed_in_at IS NULL`,
		clientID, now)
	return tag.RowsAffected() == 1, err
}

// MarkPortalInvited records that the portal invitation went to the client.
func (q Q) MarkPortalInvited(ctx context.Context, clientID string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE clients SET portal_invited_at = $2 WHERE id = $1`, clientID, now)
	return err
}

func (q Q) DeletePortalSession(ctx context.Context, id string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM portal_sessions WHERE id = $1`, id)
	return err
}

func (q Q) DeletePortalSessionsForClient(ctx context.Context, clientID string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM portal_sessions WHERE client_id = $1`, clientID)
	return err
}

// PortalAvatar is the photo of one client's portal login: its stored object and the SHA-256 of its bytes.
type PortalAvatar struct {
	ObjectKey, ContentType, SHA256 string
	Size                           int64
	UpdatedAt                      time.Time
}

// LockPortalAvatar serializes photo changes of one login in one workspace until the transaction ends.
func (q Q) LockPortalAvatar(ctx context.Context, workspaceID, clientID, email string) error {
	_, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"portal-avatar:"+workspaceID+":"+clientID+":"+strings.ToLower(email))
	return err
}

func (q Q) PortalAvatar(ctx context.Context, clientID, email string) (PortalAvatar, error) {
	var a PortalAvatar
	err := q.db.QueryRow(ctx, `SELECT object_key, content_type, sha256, size, updated_at FROM portal_avatars
		WHERE client_id = $1 AND email = lower($2)`, clientID, email).Scan(&a.ObjectKey, &a.ContentType, &a.SHA256, &a.Size, &a.UpdatedAt)
	return a, err
}

func (q Q) PutPortalAvatar(ctx context.Context, workspaceID, clientID, email string, a PortalAvatar) error {
	_, err := q.db.Exec(ctx, `INSERT INTO portal_avatars (client_id, email, workspace_id, object_key, content_type, size, sha256, updated_at)
		VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8)
		ON CONFLICT (client_id, email) DO UPDATE SET object_key = $4, content_type = $5, size = $6, sha256 = $7, updated_at = $8`,
		clientID, email, workspaceID, a.ObjectKey, a.ContentType, a.Size, a.SHA256, a.UpdatedAt)
	return err
}

// DeletePortalAvatar removes the login's photo and returns its object key; ErrNotFound when there was none.
func (q Q) DeletePortalAvatar(ctx context.Context, clientID, email string) (string, error) {
	var key string
	err := q.db.QueryRow(ctx, `DELETE FROM portal_avatars WHERE client_id = $1 AND email = lower($2) RETURNING object_key`,
		clientID, email).Scan(&key)
	return key, err
}
