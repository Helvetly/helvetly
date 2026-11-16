package store

import (
	"context"
	"time"
)

// Workspace members and invitations (internal/members, internal/invitations).

type Member struct {
	UserID, Name, Email, AvatarURL, Role string
	Scopes                               []string // nil for owners and admins
	JoinedAt                             time.Time
	LastActiveAt                         *time.Time // newest session in this workspace
}

type WorkspaceRole struct{ ID, Name, Role string }

// Invitation: InvitedBy is the inviter's id when written and the inviter's name (else email) when read.
type Invitation struct {
	ID, WorkspaceID, Email, Role, InvitedBy string
	Scopes                                  []string // copied to the member on accept; nil for owners and admins
	CreatedAt, ExpiresAt                    time.Time
	AcceptedAt, RevokedAt                   *time.Time
	AcceptedBy                              string
}

func (q Q) ListMembers(ctx context.Context, workspaceID string) ([]Member, error) {
	rows, err := q.db.Query(ctx, `SELECT u.id, u.name, u.email, `+avatarColumn+`, m.role, m.scopes, m.created_at,
			(SELECT max(s.created_at) FROM sessions s WHERE s.user_id = m.user_id AND s.workspace_id = m.workspace_id)
		FROM workspace_members m JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = $1
		ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, lower(u.name), u.email`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.UserID, &m.Name, &m.Email, &m.AvatarURL, &m.Role, &m.Scopes, &m.JoinedAt, &m.LastActiveAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// MemberRole: ErrNotFound when the person is not a member.
func (q Q) MemberRole(ctx context.Context, workspaceID, userID string) (string, error) {
	var role string
	err := q.db.QueryRow(ctx, `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
		workspaceID, userID).Scan(&role)
	return role, err
}

// MemberScopes is a membership's stored scopes (nil for owners and admins).
func (q Q) MemberScopes(ctx context.Context, workspaceID, userID string) ([]string, error) {
	var scopes []string
	err := q.db.QueryRow(ctx, `SELECT scopes FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
		workspaceID, userID).Scan(&scopes)
	return scopes, err
}

func (q Q) CountOwners(ctx context.Context, workspaceID string) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'`,
		workspaceID).Scan(&n)
	return n, err
}

// AdminHR is the HR access an admin holds while their scopes are nil (the owner never set any): an outside
// accountant's level, the payroll register to view. permissions.EffectiveHR and the session answer read it.
var AdminHR = []string{"read:payroll"}

// SetMemberRole stores the role and the scopes the caller worked out (members.nextScopes): none for an owner; an
// admin's HR scopes (nil for the admin default); a member's scopes.
func (q Q) SetMemberRole(ctx context.Context, workspaceID, userID, role string, scopes []string) error {
	_, err := q.db.Exec(ctx, `UPDATE workspace_members
		SET role = $3, scopes = CASE WHEN $3 = 'owner' THEN NULL ELSE $4::text[] END
		WHERE workspace_id = $1 AND user_id = $2`, workspaceID, userID, role, scopes)
	return err
}

// RemoveMember also ends the person's sessions and API tokens in that workspace (a token would come back to life if
// they were invited again).
func (q Q) RemoveMember(ctx context.Context, workspaceID, userID string) error {
	for _, table := range []string{"sessions", "api_tokens"} {
		if _, err := q.db.Exec(ctx, `DELETE FROM `+table+` WHERE workspace_id = $1 AND user_id = $2`, workspaceID, userID); err != nil {
			return err
		}
	}
	_, err := q.db.Exec(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, userID)
	return err
}

func (q Q) UserWorkspaces(ctx context.Context, userID string) ([]WorkspaceRole, error) {
	rows, err := q.db.Query(ctx, `SELECT w.id, w.name, m.role FROM workspace_members m
		JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY lower(w.name), w.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WorkspaceRole{}
	for rows.Next() {
		var w WorkspaceRole
		if err := rows.Scan(&w.ID, &w.Name, &w.Role); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (q Q) WorkspaceName(ctx context.Context, id string) (string, error) {
	var name string
	err := q.db.QueryRow(ctx, `SELECT name FROM workspaces WHERE id = $1`, id).Scan(&name)
	return name, err
}

// JoinMember adds the person with the invitation's role and scopes, or gives them to an existing member whose
// role is not higher (a role is raised, never lowered).
func (q Q) JoinMember(ctx context.Context, workspaceID, userID, role string, scopes []string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role, scopes, created_at) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, scopes = EXCLUDED.scopes
		WHERE CASE EXCLUDED.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
		    <= CASE workspace_members.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END`,
		workspaceID, userID, role, scopes, now)
	return err
}

// ---- invitations ----

const invitationSelect = `SELECT i.id, i.workspace_id, i.email, i.role, i.scopes, coalesce(nullif(u.name, ''), u.email, ''),
		i.created_at, i.expires_at, i.accepted_at, i.revoked_at, coalesce(i.accepted_by, '')
	FROM workspace_invitations i LEFT JOIN users u ON u.id = i.invited_by `

func scanInvitations(q Q, ctx context.Context, sql string, args ...any) ([]Invitation, error) {
	rows, err := q.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Invitation{}
	for rows.Next() {
		var i Invitation
		if err := rows.Scan(&i.ID, &i.WorkspaceID, &i.Email, &i.Role, &i.Scopes, &i.InvitedBy, &i.CreatedAt, &i.ExpiresAt,
			&i.AcceptedAt, &i.RevokedAt, &i.AcceptedBy); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func oneInvitation(q Q, ctx context.Context, sql string, args ...any) (Invitation, error) {
	list, err := scanInvitations(q, ctx, sql, args...)
	if err != nil {
		return Invitation{}, err
	}
	if len(list) == 0 {
		return Invitation{}, ErrNotFound
	}
	return list[0], nil
}

// CreateInvitation fails on a second open invitation for the address: revoke the old one first.
func (q Q) createInvitation(ctx context.Context, inv Invitation, tokenHash string) error {
	_, err := q.db.Exec(ctx, `INSERT INTO workspace_invitations (id, workspace_id, email, role, scopes, token_hash, invited_by, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, nullif($7, ''), $8, $9)`,
		inv.ID, inv.WorkspaceID, inv.Email, inv.Role, inv.Scopes, tokenHash, inv.InvitedBy, inv.CreatedAt, inv.ExpiresAt)
	return err
}

// OpenInvitations: not accepted, not revoked, not expired; newest first.
func (q Q) OpenInvitations(ctx context.Context, workspaceID string, now time.Time) ([]Invitation, error) {
	return scanInvitations(q, ctx, invitationSelect+`WHERE i.workspace_id = $1 AND i.accepted_at IS NULL
		AND i.revoked_at IS NULL AND i.expires_at > $2 ORDER BY i.created_at DESC, i.id`, workspaceID, now)
}

// Invitation: any state; ErrNotFound for another workspace's id.
func (q Q) Invitation(ctx context.Context, workspaceID, id string) (Invitation, error) {
	return oneInvitation(q, ctx, invitationSelect+`WHERE i.workspace_id = $1 AND i.id = $2`, workspaceID, id)
}

// InvitationByToken: any state.
func (q Q) InvitationByToken(ctx context.Context, tokenHash string) (Invitation, error) {
	return oneInvitation(q, ctx, invitationSelect+`WHERE i.token_hash = $1`, tokenHash)
}

func (q Q) RevokeOpenInvitations(ctx context.Context, workspaceID, email string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE workspace_invitations SET revoked_at = $3
		WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`, workspaceID, email, now)
	return err
}

// RevokeInvitation reports whether an open invitation was revoked.
func (q Q) RevokeInvitation(ctx context.Context, workspaceID, id string, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE workspace_invitations SET revoked_at = $3
		WHERE workspace_id = $1 AND id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`, workspaceID, id, now)
	return tag.RowsAffected() == 1, err
}

// RetokenInvitation gives an invitation a new link and expiry (resend) and restamps its sent time,
// so a resend counts toward the rate limit.
func (q Q) retokenInvitation(ctx context.Context, workspaceID, id, tokenHash string, expires, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE workspace_invitations SET token_hash = $3, expires_at = $4, created_at = $5
		WHERE workspace_id = $1 AND id = $2`, workspaceID, id, tokenHash, expires, now)
	return err
}

// ClaimInvitation marks an open invitation accepted; true for exactly one of any concurrent claims.
func (q Q) ClaimInvitation(ctx context.Context, id, userID string, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE workspace_invitations SET accepted_at = $3, accepted_by = $2
		WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`, id, userID, now)
	return tag.RowsAffected() == 1, err
}

// CountInvitationsSince counts every invitation created in the workspace since the time (rate limit).
func (q Q) CountInvitationsSince(ctx context.Context, workspaceID string, since time.Time) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM workspace_invitations WHERE workspace_id = $1 AND created_at >= $2`,
		workspaceID, since).Scan(&n)
	return n, err
}

// OpenInvitationsForEmail: open invitations across workspaces, for auto-join on first sign-in.
func (q Q) OpenInvitationsForEmail(ctx context.Context, email string, now time.Time) ([]Invitation, error) {
	return scanInvitations(q, ctx, invitationSelect+`WHERE i.email = $1 AND i.accepted_at IS NULL
		AND i.revoked_at IS NULL AND i.expires_at > $2 ORDER BY i.created_at, i.id`, email, now)
}
