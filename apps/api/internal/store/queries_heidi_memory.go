package store

import (
	"context"
	"errors"
)

type HeidiMemory struct {
	Enabled bool
	Topics  map[string]int
}

func (q Q) HeidiMemory(ctx context.Context, workspace, user string) (HeidiMemory, error) {
	var m HeidiMemory
	err := q.db.QueryRow(ctx, `SELECT enabled, topics FROM heidi_memory
		WHERE workspace_id=$1 AND user_id=$2`, workspace, user).Scan(&m.Enabled, &m.Topics)
	if errors.Is(err, ErrNotFound) {
		return HeidiMemory{Enabled: true}, nil
	}
	return m, err
}

// Update and increment take the same row lock, so switching memory off also stops concurrent increments.
func (q Q) SetHeidiMemory(ctx context.Context, workspace, user string, enabled *bool, clear bool) error {
	_, err := q.db.Exec(ctx, `INSERT INTO heidi_memory(workspace_id,user_id,enabled)
		VALUES ($1,$2,coalesce($3::boolean,true))
		ON CONFLICT (workspace_id,user_id) DO UPDATE SET
			enabled=coalesce($3,heidi_memory.enabled),
			topics=CASE WHEN $3 IS FALSE OR $4 THEN '{}'::jsonb ELSE heidi_memory.topics END`,
		workspace, user, enabled, clear)
	return err
}

func (q Q) CountHeidiTopic(ctx context.Context, workspace, user, topic string) error {
	_, err := q.db.Exec(ctx, `INSERT INTO heidi_memory(workspace_id,user_id,topics)
		VALUES ($1,$2,jsonb_build_object($3::text,1))
		ON CONFLICT (workspace_id,user_id) DO UPDATE SET topics=jsonb_set(heidi_memory.topics,ARRAY[$3],
			to_jsonb(least(coalesce((heidi_memory.topics->>$3)::int,0),999999)+1))
		WHERE heidi_memory.enabled`, workspace, user, topic)
	return err
}
