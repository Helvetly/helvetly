package store

import (
	"context"
	"time"
)

// APIToken is a personal access token without its secret (docs/api-tokens-contract.md).
type APIToken struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Scopes     []string   `json:"scopes"`
	Prefix     string     `json:"prefix"`
	Workspace  TokenSpace `json:"workspace"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at"`
	ExpiresAt  *time.Time `json:"expires_at"`
}

type TokenSpace struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// TokenSession is the session a bearer token stands for, with the token's own limits.
type TokenSession struct {
	Session
	TokenScopes []string // the token's own scopes ("read:invoices", "write:*"); Session.Scopes are the member's
	LastUsedAt  *time.Time
}

// MaxAPITokens per person.
const MaxAPITokens = 20

// CreateAPIToken adds the token unless the person already has MaxAPITokens; false then.
// shortcut: two simultaneous creates can both pass the count, a soft cap; lock the user row if it ever matters.
func (q Q) CreateAPIToken(ctx context.Context, t APIToken, userID, tokenHash string) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO api_tokens (id, user_id, workspace_id, name, scopes, token_hash, prefix, created_at, expires_at)
		SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9 WHERE (SELECT count(*) FROM api_tokens WHERE user_id = $2) < $10`,
		t.ID, userID, t.Workspace.ID, t.Name, t.Scopes, tokenHash, t.Prefix, t.CreatedAt, t.ExpiresAt, MaxAPITokens)
	return tag.RowsAffected() == 1, err
}

// APITokens: the person's tokens in workspaces that still exist, newest first.
func (q Q) APITokens(ctx context.Context, userID string) ([]APIToken, error) {
	rows, err := q.db.Query(ctx, `SELECT t.id, t.name, t.scopes, t.prefix, w.id, w.name, t.created_at, t.last_used_at, t.expires_at
		FROM api_tokens t JOIN workspaces w ON w.id = t.workspace_id WHERE t.user_id = $1 AND w.deleted_at IS NULL
		ORDER BY t.created_at DESC, t.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []APIToken{}
	for rows.Next() {
		var t APIToken
		if err := rows.Scan(&t.ID, &t.Name, &t.Scopes, &t.Prefix, &t.Workspace.ID, &t.Workspace.Name, &t.CreatedAt, &t.LastUsedAt, &t.ExpiresAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DeleteAPIToken revokes one of the person's tokens; ErrNotFound when it is not theirs.
func (q Q) DeleteAPIToken(ctx context.Context, userID, id string) error {
	tag, err := q.db.Exec(ctx, `DELETE FROM api_tokens WHERE id = $1 AND user_id = $2`, id, userID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// SessionByAPIToken: an unexpired token whose person is still a member of its workspace, with the live role and
// scopes, as SessionByToken does for a cookie.
func (q Q) SessionByAPIToken(ctx context.Context, tokenHash string, now time.Time) (TokenSession, error) {
	var s TokenSession
	err := q.db.QueryRow(ctx, `SELECT t.id, `+userColumns+`, w.id, w.name, w.timezone, w.onboarded_at IS NOT NULL, m.role, m.scopes,
		t.scopes, t.last_used_at FROM api_tokens t
		JOIN users u ON u.id = t.user_id
		JOIN workspaces w ON w.id = t.workspace_id
		JOIN workspace_members m ON m.workspace_id = t.workspace_id AND m.user_id = t.user_id
		WHERE t.token_hash = $1 AND (t.expires_at IS NULL OR t.expires_at > $2) AND u.deleted_at IS NULL AND w.deleted_at IS NULL`, tokenHash, now).
		Scan(&s.ID, &s.User.ID, &s.User.Email, &s.User.Name, &s.User.AvatarURL, &s.Workspace.ID, &s.Workspace.Name, &s.Workspace.Timezone,
			&s.Workspace.Onboarded, &s.Role, &s.Scopes, &s.TokenScopes, &s.LastUsedAt)
	s.LastActiveAt = now
	return s, err
}

func (q Q) TouchAPIToken(ctx context.Context, id string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE api_tokens SET last_used_at = $2 WHERE id = $1`, id, now)
	return err
}
