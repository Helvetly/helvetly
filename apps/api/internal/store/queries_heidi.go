package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// LockHeidiConversation serializes turns and confirmations across API instances.
func (q Q) LockHeidiConversation(ctx context.Context, workspace, user, id string, create bool, now time.Time) error {
	if _, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "heidi:"+workspace+":"+user+":"+id); err != nil {
		return err
	}
	if create {
		if _, err := q.db.Exec(ctx, `INSERT INTO heidi_conversations(workspace_id,user_id,id,created_at,updated_at)
			VALUES ($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING`, workspace, user, id, now); err != nil {
			return err
		}
	}
	var found string
	return q.db.QueryRow(ctx, `SELECT id FROM heidi_conversations WHERE workspace_id=$1 AND user_id=$2 AND id=$3 FOR UPDATE`, workspace, user, id).Scan(&found)
}

func (q Q) HeidiMessages(ctx context.Context, workspace, user, id string) ([]json.RawMessage, error) {
	var found bool
	if err := q.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM heidi_conversations WHERE workspace_id=$1 AND user_id=$2 AND id=$3)`, workspace, user, id).Scan(&found); err != nil {
		return nil, err
	}
	if !found {
		return nil, ErrNotFound
	}
	rows, err := q.db.Query(ctx, `SELECT payload || jsonb_build_object('created_at', created_at) FROM heidi_messages WHERE workspace_id=$1 AND user_id=$2 AND conversation_id=$3 ORDER BY position`, workspace, user, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []json.RawMessage{}
	for rows.Next() {
		var b json.RawMessage
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		list = append(list, b)
	}
	return list, rows.Err()
}

type HeidiConversation struct {
	ID, Title string
	// Snippet is the start of the latest answer, which tells chats with the same question apart.
	Snippet   string
	Messages  int
	UpdatedAt time.Time
}

// HeidiConversations lists one person's conversations in a workspace, newest first, titled by
// their first question, with the start of the latest answer and the number of messages;
// conversations without a message are left out.
func (q Q) HeidiConversations(ctx context.Context, workspace, user string, limit int) ([]HeidiConversation, error) {
	rows, err := q.db.Query(ctx, `SELECT c.id, coalesce(left((SELECT m.payload->>'text' FROM heidi_messages m
			WHERE m.workspace_id=c.workspace_id AND m.user_id=c.user_id AND m.conversation_id=c.id AND m.payload->>'role'='user'
			ORDER BY m.position LIMIT 1), 120), ''),
		  coalesce(left((SELECT m.payload->>'text' FROM heidi_messages m
			WHERE m.workspace_id=c.workspace_id AND m.user_id=c.user_id AND m.conversation_id=c.id AND m.payload->>'role'='assistant'
			  AND coalesce(m.payload->>'text','')<>''
			ORDER BY m.position DESC LIMIT 1), 160), ''),
		  n.messages, c.updated_at
		FROM heidi_conversations c
		CROSS JOIN LATERAL (SELECT count(*)::int AS messages FROM heidi_messages m
			WHERE m.workspace_id=c.workspace_id AND m.user_id=c.user_id AND m.conversation_id=c.id) n
		WHERE c.workspace_id=$1 AND c.user_id=$2 AND n.messages > 0
		ORDER BY c.updated_at DESC, c.id LIMIT $3`, workspace, user, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []HeidiConversation{}
	for rows.Next() {
		var c HeidiConversation
		if err := rows.Scan(&c.ID, &c.Title, &c.Snippet, &c.Messages, &c.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, rows.Err()
}

func (q Q) AppendHeidiMessage(ctx context.Context, workspace, user, conversation, id string, payload any, now time.Time) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err = q.db.Exec(ctx, `INSERT INTO heidi_messages(id,workspace_id,user_id,conversation_id,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6)`, id, workspace, user, conversation, b, now); err != nil {
		return err
	}
	_, err = q.db.Exec(ctx, `UPDATE heidi_conversations SET updated_at=$4 WHERE workspace_id=$1 AND user_id=$2 AND id=$3`, workspace, user, conversation, now)
	return err
}

type HeidiConfirmation struct {
	ID, Kind  string
	Payload   json.RawMessage
	ExpiresAt time.Time
}

func (q Q) HeidiConfirmation(ctx context.Context, workspace, user, conversation string) (HeidiConfirmation, error) {
	var c HeidiConfirmation
	err := q.db.QueryRow(ctx, `SELECT id,kind,payload,expires_at FROM heidi_confirmations WHERE workspace_id=$1 AND user_id=$2 AND conversation_id=$3 FOR UPDATE`, workspace, user, conversation).Scan(&c.ID, &c.Kind, &c.Payload, &c.ExpiresAt)
	return c, err
}
func (q Q) PutHeidiConfirmation(ctx context.Context, workspace, user, conversation string, c HeidiConfirmation) error {
	_, err := q.db.Exec(ctx, `INSERT INTO heidi_confirmations(id,workspace_id,user_id,conversation_id,kind,payload,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, c.ID, workspace, user, conversation, c.Kind, c.Payload, c.ExpiresAt)
	return err
}
func (q Q) DeleteHeidiConfirmation(ctx context.Context, workspace, user, conversation, id string) error {
	tag, err := q.db.Exec(ctx, `DELETE FROM heidi_confirmations WHERE workspace_id=$1 AND user_id=$2 AND conversation_id=$3 AND id=$4`, workspace, user, conversation, id)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return err
}

// HeidiUsage is a workspace's model usage of one pool in one month (aimodel.PoolHeidi for Heidi, PoolAutomation for
// AI import and filing): tokens and their cost in micro-USD, used and reserved by calls in flight or not yet
// reconciled (ai_calls).
type HeidiUsage struct {
	TokensUsed, TokensReserved int64
	CostMicros, CostReserved   int64
	Uncertain                  bool
}

const heidiUsageColumns = `tokens_used,tokens_reserved,cost_micros,cost_reserved_micros,uncertain`

func (u *HeidiUsage) fields() []any {
	return []any{&u.TokensUsed, &u.TokensReserved, &u.CostMicros, &u.CostReserved, &u.Uncertain}
}

func (q Q) HeidiUsage(ctx context.Context, workspace, pool, period string) (HeidiUsage, error) {
	var u HeidiUsage
	err := q.db.QueryRow(ctx, `SELECT `+heidiUsageColumns+` FROM heidi_usage WHERE workspace_id=$1 AND period=$2 AND pool=$3`, workspace, period, pool).Scan(u.fields()...)
	if errors.Is(err, pgx.ErrNoRows) {
		return HeidiUsage{}, nil
	}
	return u, err
}

// LockHeidiUsage protects provider admission; a missing row is zero usage, never a fabricated provider result.
func (q Q) LockHeidiUsage(ctx context.Context, workspace, pool, period string, now time.Time) (HeidiUsage, error) {
	if _, err := q.db.Exec(ctx, `INSERT INTO heidi_usage(workspace_id,period,pool,updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, workspace, period, pool, now); err != nil {
		return HeidiUsage{}, err
	}
	var u HeidiUsage
	err := q.db.QueryRow(ctx, `SELECT `+heidiUsageColumns+` FROM heidi_usage WHERE workspace_id=$1 AND period=$2 AND pool=$3 FOR UPDATE`, workspace, period, pool).Scan(u.fields()...)
	return u, err
}
func (q Q) SaveHeidiUsage(ctx context.Context, workspace, pool, period string, u HeidiUsage, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE heidi_usage SET tokens_used=$3,tokens_reserved=$4,cost_micros=$5,cost_reserved_micros=$6,uncertain=$7,updated_at=$8 WHERE workspace_id=$1 AND period=$2 AND pool=$9`,
		workspace, period, u.TokensUsed, u.TokensReserved, u.CostMicros, u.CostReserved, u.Uncertain, now, pool)
	return err
}

// AIConsent: one member's current approval of the AI model in a workspace (their latest own row); ChangedAt is nil
// until they choose. Rows written by other members never count.
type AIConsent struct {
	Granted   bool       `json:"granted"`
	ChangedAt *time.Time `json:"changed_at"`
	ChangedBy string     `json:"changed_by"` // the person's name, or email when the name is empty
}

func (q Q) AIConsent(ctx context.Context, workspaceID, userID string) (AIConsent, error) {
	var c AIConsent
	err := q.db.QueryRow(ctx, `SELECT c.granted, c.at, coalesce(nullif(u.name, ''), u.email)
		FROM workspace_ai_consents c JOIN users u ON u.id = c.user_id
		WHERE c.workspace_id = $1 AND c.user_id = $2 ORDER BY c.id DESC LIMIT 1`, workspaceID, userID).Scan(&c.Granted, &c.ChangedAt, &c.ChangedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return AIConsent{}, nil
	}
	return c, err
}

func (q Q) SetAIConsent(ctx context.Context, workspaceID, userID string, granted bool, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO workspace_ai_consents (workspace_id, granted, user_id, at) VALUES ($1, $2, $3, $4)`,
		workspaceID, granted, userID, now)
	return err
}
