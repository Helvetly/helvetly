package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// Template is a PDF from Documents with client-data boxes and signing fields (docs/templates-contract.md).
type Template struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Description *string          `json:"description"`
	Document    *FolderRef       `json:"document"`
	Signers     []TemplateSigner `json:"signers"`
	Fields      []TemplateField  `json:"fields"`
	UsedCount   int              `json:"used_count"`
	LastUsedAt  *time.Time       `json:"last_used_at"`
	CreatedAt   time.Time        `json:"created_at"`
	UpdatedAt   time.Time        `json:"updated_at"`
}

type TemplateSigner struct {
	Label string `json:"label"`
	Fill  string `json:"fill"` // client | manual
}

type TemplateField struct {
	ID     string  `json:"id"`
	Kind   string  `json:"kind"`
	Signer *int    `json:"signer"`
	Page   int     `json:"page"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	W      float64 `json:"w"`
	H      float64 `json:"h"`
	Label  *string `json:"label"`
	// How a client data field's value is printed: points (nil: 10, so templates saved before print alike),
	// shrunk to the box with auto-fit, and left, center or right ("" is left).
	FontSize *float64 `json:"font_size,omitempty"`
	AutoFit  bool     `json:"auto_fit,omitempty"`
	Align    string   `json:"align,omitempty"`
}

const templateSelect = `SELECT t.id, t.name, t.description, d.id, d.name, t.signers, t.fields, t.used_count, t.last_used_at,
		t.created_at, t.updated_at
	FROM templates t LEFT JOIN documents d ON d.id = t.document_id `

func scanTemplate(row interface{ Scan(...any) error }) (Template, error) {
	var t Template
	var docID, docName *string
	err := row.Scan(&t.ID, &t.Name, &t.Description, &docID, &docName, &t.Signers, &t.Fields, &t.UsedCount, &t.LastUsedAt,
		&t.CreatedAt, &t.UpdatedAt)
	if docID != nil {
		t.Document = &FolderRef{ID: *docID, Name: *docName}
	}
	return t, err
}

// Templates: the workspace's templates, last changed first.
func (q Q) Templates(ctx context.Context, workspaceID string) ([]Template, error) {
	rows, err := q.db.Query(ctx, templateSelect+`WHERE t.workspace_id = $1 ORDER BY t.updated_at DESC, t.id DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Template{}
	for rows.Next() {
		t, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

func (q Q) Template(ctx context.Context, workspaceID, id string) (Template, error) {
	return scanTemplate(q.db.QueryRow(ctx, templateSelect+`WHERE t.workspace_id = $1 AND t.id = $2`, workspaceID, id))
}

func (q Q) CreateTemplate(ctx context.Context, workspaceID, documentID string, t Template) error {
	_, err := q.db.Exec(ctx, `INSERT INTO templates (id, workspace_id, name, description, document_id, signers, fields,
			created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
		t.ID, workspaceID, t.Name, t.Description, documentID, t.Signers, t.Fields, t.CreatedAt)
	return err
}

// UpdateTemplate replaces the template's content; ErrNotFound when there is none.
func (q Q) UpdateTemplate(ctx context.Context, workspaceID, documentID string, t Template) error {
	return changed(q.db.Exec(ctx, `UPDATE templates SET name = $3, description = $4, document_id = $5, signers = $6, fields = $7,
		updated_at = $8 WHERE workspace_id = $1 AND id = $2`, workspaceID, t.ID, t.Name, t.Description, documentID, t.Signers,
		t.Fields, t.UpdatedAt))
}

// DeleteTemplate: ErrNotFound when there is none. The documents made from it and its PDF stay.
func (q Q) DeleteTemplate(ctx context.Context, workspaceID, id string) error {
	return changed(q.db.Exec(ctx, `DELETE FROM templates WHERE workspace_id = $1 AND id = $2`, workspaceID, id))
}

// UseTemplate counts a document made from the template; ErrNotFound when it was deleted meanwhile.
func (q Q) UseTemplate(ctx context.Context, workspaceID, id string, now time.Time) error {
	return changed(q.db.Exec(ctx, `UPDATE templates SET used_count = used_count + 1, last_used_at = $3
		WHERE workspace_id = $1 AND id = $2`, workspaceID, id, now))
}

// changed: ErrNotFound when a write matched no row.
func changed(tag pgconn.CommandTag, err error) error {
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
