package store

import (
	"context"
	"time"
)

type User struct {
	ID, Email, Name, AvatarURL string
}

type Workspace struct {
	ID, Name  string
	Timezone  string // IANA name: civil dates, periods and the digest hour follow it (Location, Today)
	Onboarded bool   // its welcome was finished or skipped
}

// Session is a live session with its person, workspace and the person's role there.
type Session struct {
	ID, CSRFToken string
	LastActiveAt  time.Time
	User          User
	Workspace     Workspace
	Role          string
	Scopes        []string // a member's permission scopes; nil for owners and admins
}

type EmailCode struct {
	ID, CodeHash string
	Attempts     int
	CreatedAt    time.Time
}

type Passkey struct {
	ID, UserID, Name string
	Credential       []byte // JSON
	CreatedAt        time.Time
	LastUsedAt       *time.Time
}

// ---- people ----

// UserAvatarPath is where a person's own photo is served (internal/avatars): …/{user id}/avatar.
const UserAvatarPath = "/api/v1/users/"

// avatarColumn is the picture shown for a person: their own photo when they uploaded one (its URL changes with the
// bytes, so no cache shows an old one), else Google's picture, else "".
const avatarColumn = `CASE WHEN u.photo_sha256 IS NULL THEN u.avatar_url
	ELSE '` + UserAvatarPath + `' || u.id || '/avatar?v=' || left(u.photo_sha256, 12) END`

const userColumns = `u.id, u.email, u.name, ` + avatarColumn

func scanUser(row interface{ Scan(...any) error }) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.AvatarURL)
	return u, err
}

func (q Q) User(ctx context.Context, id string) (User, error) {
	return scanUser(q.db.QueryRow(ctx, `SELECT `+userColumns+` FROM users u WHERE u.id = $1`, id))
}

func (q Q) UserByIdentity(ctx context.Context, provider, subject string) (User, error) {
	return scanUser(q.db.QueryRow(ctx, `SELECT `+userColumns+` FROM users u
		JOIN user_identities i ON i.user_id = u.id WHERE i.provider = $1 AND i.subject = $2`, provider, subject))
}

func (q Q) UserByEmail(ctx context.Context, email string) (User, error) {
	return scanUser(q.db.QueryRow(ctx, `SELECT `+userColumns+` FROM users u WHERE u.email = $1`, email))
}

func (q Q) CreateUser(ctx context.Context, u User, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO users (id, email, name, avatar_url, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $5)`, u.ID, u.Email, u.Name, u.AvatarURL, now)
	return err
}

// UpdateUserProfile sets the name and, when picture is not nil, Google's picture (an own photo still wins over it).
func (q Q) UpdateUserProfile(ctx context.Context, id, name string, picture *string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE users SET name = $2, avatar_url = coalesce($3, avatar_url), updated_at = $4 WHERE id = $1`,
		id, name, picture, now)
	return err
}

func (q Q) CreateIdentity(ctx context.Context, provider, subject, userID, email string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO user_identities (provider, subject, user_id, email, created_at)
		VALUES ($1, $2, $3, $4, $5)`, provider, subject, userID, email, now)
	return err
}

// ---- workspaces ----

// HomeWorkspace: the person's first workspace.
func (q Q) HomeWorkspace(ctx context.Context, userID string) (string, error) {
	var id string
	err := q.db.QueryRow(ctx, `SELECT m.workspace_id FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
		WHERE m.user_id = $1 AND w.deleted_at IS NULL ORDER BY m.created_at, m.workspace_id LIMIT 1`, userID).Scan(&id)
	return id, err
}

func (q Q) CreateWorkspace(ctx context.Context, w Workspace, timezone string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO workspaces (id, name, timezone, created_at) VALUES ($1, $2, $3, $4)`,
		w.ID, w.Name, timezone, now)
	return err
}

func (q Q) AddMember(ctx context.Context, workspaceID, userID, role string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role, scopes, created_at)
		VALUES ($1, $2, $3, CASE WHEN $3 = 'member' THEN '{"*:*"}'::text[] END, $4)`,
		workspaceID, userID, role, now)
	return err
}

// SetWorkspaceOnboarded keeps the first time: repeating it changes nothing.
func (q Q) SetWorkspaceOnboarded(ctx context.Context, workspaceID string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE workspaces SET onboarded_at = coalesce(onboarded_at, $2) WHERE id = $1`, workspaceID, now)
	return err
}

// ---- sessions ----

func (q Q) CreateSession(ctx context.Context, id, tokenHash, csrfToken, userID, workspaceID string, now, expires time.Time) error {
	// Expired sessions are never read again: each sign-in clears them, like the codes and passkey challenges.
	if _, err := q.db.Exec(ctx, `DELETE FROM sessions WHERE expires_at < $1`, now); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `INSERT INTO sessions (id, token_hash, csrf_token, user_id, workspace_id, created_at, expires_at,last_active_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7,$6)`, id, tokenHash, csrfToken, userID, workspaceID, now, expires)
	return err
}

// SessionByToken: an unexpired session whose person is still a member of its workspace.
func (q Q) SessionByToken(ctx context.Context, tokenHash string, now time.Time) (Session, error) {
	var s Session
	err := q.db.QueryRow(ctx, `SELECT s.id, s.csrf_token, `+userColumns+`, w.id, w.name, w.timezone, w.onboarded_at IS NOT NULL, m.role, m.scopes, s.last_active_at FROM sessions s
		JOIN users u ON u.id = s.user_id
		JOIN workspaces w ON w.id = s.workspace_id
		JOIN workspace_members m ON m.workspace_id = s.workspace_id AND m.user_id = s.user_id
		WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.deleted_at IS NULL AND w.deleted_at IS NULL`, tokenHash, now).
		Scan(&s.ID, &s.CSRFToken, &s.User.ID, &s.User.Email, &s.User.Name, &s.User.AvatarURL, &s.Workspace.ID, &s.Workspace.Name, &s.Workspace.Timezone, &s.Workspace.Onboarded, &s.Role, &s.Scopes, &s.LastActiveAt)
	return s, err
}

func (q Q) DeleteSession(ctx context.Context, id string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, id)
	return err
}

// ---- email codes ----

// LockAddress serialises work on one email address (sending codes, creating its person) until the
// transaction ends.
func (q Q) LockAddress(ctx context.Context, email string) error {
	_, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "address:"+email)
	return err
}

func (q Q) LatestEmailCode(ctx context.Context, email string) (EmailCode, error) {
	var c EmailCode
	err := q.db.QueryRow(ctx, `SELECT id, code_hash, attempts, created_at FROM email_codes WHERE email = $1
		ORDER BY created_at DESC, id DESC LIMIT 1`, email).Scan(&c.ID, &c.CodeHash, &c.Attempts, &c.CreatedAt)
	return c, err
}

// CountEmailCodes: codes sent to the address since a time, by one asker (client) or, with "", by anyone.
func (q Q) CountEmailCodes(ctx context.Context, email, client string, since time.Time) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM email_codes WHERE email = $1 AND created_at > $2 AND ($3 = '' OR client = $3)`,
		email, since, client).Scan(&n)
	return n, err
}

func (q Q) PurgeEmailCodes(ctx context.Context, before time.Time) error {
	_, err := q.db.Exec(ctx, `DELETE FROM email_codes WHERE created_at < $1`, before)
	return err
}

// CreateEmailCode replaces the address's open code with a new one.
func (q Q) CreateEmailCode(ctx context.Context, id, email, codeHash, client string, now, expires time.Time) error {
	if _, err := q.db.Exec(ctx, `UPDATE email_codes SET used_at = $2 WHERE email = $1 AND used_at IS NULL`, email, now); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `INSERT INTO email_codes (id, email, code_hash, client, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)`, id, email, codeHash, client, now, expires)
	return err
}

// SpendEmailCodeAttempt counts one try on an open code and returns the tries spent; ErrNotFound when the
// code is used, expired or out of tries. Counted before the comparison, so concurrent guesses cannot
// exceed the limit.
func (q Q) SpendEmailCodeAttempt(ctx context.Context, id string, maxAttempts int, now time.Time) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, `UPDATE email_codes SET attempts = attempts + 1
		WHERE id = $1 AND used_at IS NULL AND attempts < $2 AND expires_at > $3 RETURNING attempts`, id, maxAttempts, now).Scan(&n)
	return n, err
}

// UseEmailCode marks the code used; false when it already was (a concurrent use).
func (q Q) UseEmailCode(ctx context.Context, id string, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE email_codes SET used_at = $2 WHERE id = $1 AND used_at IS NULL`, id, now)
	return tag.RowsAffected() == 1, err
}

// ---- passkeys ----

const passkeyColumns = `id, user_id, name, credential, created_at, last_used_at`

func scanPasskey(row interface{ Scan(...any) error }) (Passkey, error) {
	var p Passkey
	err := row.Scan(&p.ID, &p.UserID, &p.Name, &p.Credential, &p.CreatedAt, &p.LastUsedAt)
	return p, err
}

func (q Q) ListPasskeys(ctx context.Context, userID string) ([]Passkey, error) {
	rows, err := q.db.Query(ctx, `SELECT `+passkeyColumns+` FROM passkeys WHERE user_id = $1 ORDER BY created_at, id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Passkey{}
	for rows.Next() {
		p, err := scanPasskey(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (q Q) PasskeyByCredentialID(ctx context.Context, credentialID string) (Passkey, error) {
	return scanPasskey(q.db.QueryRow(ctx, `SELECT `+passkeyColumns+` FROM passkeys WHERE credential_id = $1`, credentialID))
}

func (q Q) CreatePasskey(ctx context.Context, id, userID, credentialID, name string, credential []byte, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO passkeys (id, user_id, credential_id, name, credential, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)`, id, userID, credentialID, name, credential, now)
	return err
}

// UsePasskey stores the credential after a sign-in (its new sign counter) and when it was used.
func (q Q) UsePasskey(ctx context.Context, id string, credential []byte, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE passkeys SET credential = $2, last_used_at = $3 WHERE id = $1`, id, credential, now)
	return err
}

func (q Q) DeletePasskey(ctx context.Context, id, userID string) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM passkeys WHERE id = $1 AND user_id = $2`, id, userID)
	return tag.RowsAffected() == 1, err
}

// CreatePasskeyChallenge stores a ceremony (userID "" to sign in) and purges ones older than `purgeBefore`.
func (q Q) CreatePasskeyChallenge(ctx context.Context, id, purpose, userID string, session []byte, now, expires, purgeBefore time.Time) error {
	if _, err := q.db.Exec(ctx, `DELETE FROM passkey_challenges WHERE created_at < $1`, purgeBefore); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `INSERT INTO passkey_challenges (id, purpose, user_id, session, created_at, expires_at)
		VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6)`, id, purpose, userID, session, now, expires)
	return err
}

// TakePasskeyChallenge deletes the ceremony as it reads it, so an answer works once; ErrNotFound when it
// is gone, expired, or of another purpose or person.
func (q Q) TakePasskeyChallenge(ctx context.Context, id, purpose, userID string, now time.Time) ([]byte, error) {
	var session []byte
	err := q.db.QueryRow(ctx, `DELETE FROM passkey_challenges
		WHERE id = $1 AND purpose = $2 AND user_id IS NOT DISTINCT FROM NULLIF($3, '') AND expires_at > $4
		RETURNING session`, id, purpose, userID, now).Scan(&session)
	return session, err
}
