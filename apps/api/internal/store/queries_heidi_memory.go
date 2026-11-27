package store

import (
	"context"
	"errors"
)

type HeidiMemory struct {
	Enabled    bool
	ReplyStyle string
	Topics     map[string]int
}

func (q Q) HeidiMemory(ctx context.Context, workspace, user string) (HeidiMemory, error) {
	var m HeidiMemory
	err := q.db.QueryRow(ctx, `SELECT enabled, reply_style, topics FROM heidi_memory
		WHERE workspace_id=$1 AND user_id=$2`, workspace, user).Scan(&m.Enabled, &m.ReplyStyle, &m.Topics)
	if errors.Is(err, ErrNotFound) {
		return HeidiMemory{Enabled: true, ReplyStyle: "auto"}, nil
	}
	return m, err
}

// Update and increment take the same row lock, so switching memory off also stops concurrent increments.
func (q Q) SetHeidiMemory(ctx context.Context, workspace, user string, enabled *bool, style *string, clear bool) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO heidi_memory(workspace_id,user_id,enabled,reply_style)
		VALUES ($1,$2,coalesce($3::boolean,true),coalesce($4::text,'auto'))
		ON CONFLICT (workspace_id,user_id) DO UPDATE SET
			enabled=coalesce($3,heidi_memory.enabled),
			reply_style=CASE WHEN $3 IS FALSE OR $5 THEN 'auto' ELSE coalesce($4,heidi_memory.reply_style) END,
			topics=CASE WHEN $3 IS FALSE OR $5 THEN '{}'::jsonb ELSE heidi_memory.topics END
		WHERE heidi_memory.enabled OR $4 IS NULL`, workspace, user, enabled, style, clear)
	return tag.RowsAffected() == 1, err
}

func (q Q) CountHeidiTopic(ctx context.Context, workspace, user, topic string) error {
	_, err := q.db.Exec(ctx, `INSERT INTO heidi_memory(workspace_id,user_id,topics)
		VALUES ($1,$2,jsonb_build_object($3::text,1))
		ON CONFLICT (workspace_id,user_id) DO UPDATE SET topics=jsonb_set(heidi_memory.topics,ARRAY[$3],
			to_jsonb(least(coalesce((heidi_memory.topics->>$3)::int,0),999999)+1))
		WHERE heidi_memory.enabled`, workspace, user, topic)
	return err
}
