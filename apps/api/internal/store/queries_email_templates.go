package store

import (
	"context"
	"time"
)

// EmailTemplate is a workspace's subject and body for sending one kind of document in one language.
type EmailTemplate struct {
	Kind, Language, Subject, Body string
	UpdatedAt                     time.Time
}

// EmailTemplates lists the workspace's own templates.
func (q Q) EmailTemplates(ctx context.Context, workspaceID string) ([]EmailTemplate, error) {
	rows, err := q.db.Query(ctx, `SELECT kind,language,subject,body,updated_at FROM email_templates WHERE workspace_id=$1 ORDER BY kind,language`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EmailTemplate
	for rows.Next() {
		var t EmailTemplate
		if err := rows.Scan(&t.Kind, &t.Language, &t.Subject, &t.Body, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// EmailTemplate is one template; ErrNotFound when the workspace has none for it.
func (q Q) EmailTemplate(ctx context.Context, workspaceID, kind, language string) (EmailTemplate, error) {
	t := EmailTemplate{Kind: kind, Language: language}
	err := q.db.QueryRow(ctx, `SELECT subject,body,updated_at FROM email_templates WHERE workspace_id=$1 AND kind=$2 AND language=$3`,
		workspaceID, kind, language).Scan(&t.Subject, &t.Body, &t.UpdatedAt)
	if err != nil {
		return EmailTemplate{}, err
	}
	return t, nil
}

// SetEmailTemplate stores the template, replacing the one for the same kind and language.
func (q Q) SetEmailTemplate(ctx context.Context, workspaceID string, t EmailTemplate, by string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO email_templates(workspace_id,kind,language,subject,body,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (workspace_id,kind,language) DO UPDATE SET subject=EXCLUDED.subject,body=EXCLUDED.body,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by`,
		workspaceID, t.Kind, t.Language, t.Subject, t.Body, now, by)
	return err
}

// DeleteEmailTemplate returns the kind and language to the built-in text; deleting a missing one is not an error.
func (q Q) DeleteEmailTemplate(ctx context.Context, workspaceID, kind, language string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM email_templates WHERE workspace_id=$1 AND kind=$2 AND language=$3`, workspaceID, kind, language)
	return err
}
