package store

import (
	"context"
	"crypto/rand"
	"strings"
	"time"
)

// FolderPath: the folder at names (top level first), each level found by name (case-insensitive, live) or made;
// returns the last one's id. Run it in a transaction.
func (q Q) FolderPath(ctx context.Context, workspaceID, userID string, names []string, now time.Time) (string, error) {
	var parent *string
	for _, name := range names {
		if err := q.LockContainer(ctx, workspaceID, parent); err != nil {
			return "", err
		}
		id, err := q.FolderNameTaken(ctx, workspaceID, parent, name, "")
		if err != nil {
			return "", err
		}
		if id == "" {
			id = "fld_" + strings.ToLower(rand.Text())
			if err := q.CreateFolder(ctx, workspaceID, id, name, parent, userID, now); err != nil {
				return "", err
			}
		}
		parent = &id
	}
	if parent == nil {
		return "", nil
	}
	return *parent, nil
}

// ExistingFolderPath: like FolderPath but makes nothing; "" when a level is missing.
func (q Q) ExistingFolderPath(ctx context.Context, workspaceID string, names []string) (string, error) {
	var parent *string
	for _, name := range names {
		id, err := q.FolderNameTaken(ctx, workspaceID, parent, name, "")
		if err != nil || id == "" {
			return "", err
		}
		parent = &id
	}
	if parent == nil {
		return "", nil
	}
	return *parent, nil
}

// ExpenseDocument: a live Documents file linked to an expense, with where it sits and its tags.
type ExpenseDocument struct {
	ID       string
	Name     string
	SHA256   *string
	FolderID *string
	Tags     []string
	OwnCopy  bool // made with the receipt itself: its link and the file share one timestamp
}

// ExpenseDocuments: the live, non-HR files linked to the expense.
func (q Q) ExpenseDocuments(ctx context.Context, workspaceID, expenseID string) ([]ExpenseDocument, error) {
	rows, err := q.db.Query(ctx, `SELECT d.id, d.name, d.sha256, d.folder_id, d.tags, l.created_at = d.created_at FROM documents d
		JOIN document_links l ON l.document_id = d.id AND l.target_type = 'expense' AND l.target_id = $2
		WHERE d.workspace_id = $1 AND d.deleted_at IS NULL AND NOT d.hr_private ORDER BY d.id`, workspaceID, expenseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ExpenseDocument
	for rows.Next() {
		var d ExpenseDocument
		if err := rows.Scan(&d.ID, &d.Name, &d.SHA256, &d.FolderID, &d.Tags, &d.OwnCopy); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DuplicateReceipt: the other expense receipt with these bytes, ErrNotFound when none. Documents do not count here.
func (q Q) DuplicateReceipt(ctx context.Context, workspaceID, sum string) (DuplicateUpload, error) {
	d := DuplicateUpload{Resource: "receipt"}
	err := q.db.QueryRow(ctx, `SELECT r.id, r.name, r.expense_id FROM expense_receipts r
		JOIN expenses e ON e.id = r.expense_id WHERE r.workspace_id = $1 AND r.sha256 = $2 AND e.deleted_at IS NULL
		ORDER BY r.id LIMIT 1`, workspaceID, sum).Scan(&d.ID, &d.Name, &d.ExpenseID)
	return d, err
}

// LiveDocumentBySum: the live non-HR document with these bytes, whether it sits at the top level or where AI filing
// put it (so a person has not placed it), or ErrNotFound.
func (q Q) LiveDocumentBySum(ctx context.Context, workspaceID, sum string) (id string, folderID *string, unplaced bool, err error) {
	err = q.db.QueryRow(ctx, `SELECT d.id, d.folder_id, d.folder_id IS NULL OR coalesce(ff.status = 'filed' AND ff.folder_id = d.folder_id, false)
		FROM documents d LEFT JOIN document_filings ff ON ff.document_id = d.id
		WHERE d.workspace_id = $1 AND d.sha256 = $2 AND d.deleted_at IS NULL AND NOT d.hr_private ORDER BY d.id LIMIT 1`,
		workspaceID, sum).Scan(&id, &folderID, &unplaced)
	return
}
