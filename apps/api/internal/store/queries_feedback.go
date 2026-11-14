package store

import (
	"context"
	"time"
)

type Feedback struct {
	ID, WorkspaceID, UserID, Kind, Description, PagePath string
	CreatedAt                                            time.Time
}

type FeedbackFile struct {
	Position        int
	ObjectKey, Type string
	Size            int64
	SHA256          string
}

// LockFeedbackReporter serializes one person's reports, so the hourly cap holds under concurrent sends.
func (q Q) LockFeedbackReporter(ctx context.Context, userID string) error {
	_, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "feedback:"+userID)
	return err
}

func (q Q) CountFeedbackSince(ctx context.Context, userID string, since time.Time) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM product_feedback WHERE user_id=$1 AND created_at>$2`, userID, since).Scan(&n)
	return n, err
}

func (q Q) CreateFeedback(ctx context.Context, f Feedback, files []FeedbackFile) error {
	if _, err := q.db.Exec(ctx, `INSERT INTO product_feedback(id,workspace_id,user_id,kind,description,page_path,created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, f.ID, f.WorkspaceID, f.UserID, f.Kind, f.Description, f.PagePath, f.CreatedAt); err != nil {
		return err
	}
	for _, file := range files {
		if _, err := q.db.Exec(ctx, `INSERT INTO product_feedback_files(feedback_id,position,object_key,content_type,size,sha256)
			VALUES ($1,$2,$3,$4,$5,$6)`, f.ID, file.Position, file.ObjectKey, file.Type, file.Size, file.SHA256); err != nil {
			return err
		}
	}
	return nil
}

func (q Q) MarkFeedbackEmailed(ctx context.Context, id string, at time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE product_feedback SET emailed_at=$2 WHERE id=$1`, id, at)
	return err
}
