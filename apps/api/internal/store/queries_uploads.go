package store

import (
	"context"
	"slices"
)

type DuplicateUpload struct {
	ID        string  `json:"existing_id"`
	Name      string  `json:"existing_name"`
	Resource  string  `json:"resource"`
	ExpenseID *string `json:"expense_id,omitempty"`
}

type UnhashedUpload struct {
	ID, ObjectKey, Resource string
}

func (q Q) UnhashedUploads(ctx context.Context, workspaceID string, size int64) ([]UnhashedUpload, error) {
	rows, err := q.db.Query(ctx, `SELECT id, object_key, resource FROM (
		SELECT id, object_key, 'document' AS resource FROM documents WHERE workspace_id=$1 AND size=$2 AND sha256 IS NULL AND deleted_at IS NULL
		UNION ALL
		SELECT r.id, r.object_key, 'receipt' FROM expense_receipts r JOIN expenses e ON e.id=r.expense_id
		WHERE r.workspace_id=$1 AND r.size=$2 AND r.sha256 IS NULL AND e.deleted_at IS NULL
	) matched ORDER BY resource, id`, workspaceID, size)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []UnhashedUpload{}
	for rows.Next() {
		var f UnhashedUpload
		if err := rows.Scan(&f.ID, &f.ObjectKey, &f.Resource); err != nil {
			return nil, err
		}
		list = append(list, f)
	}
	return list, rows.Err()
}

func (q Q) SaveUploadHash(ctx context.Context, workspaceID string, f UnhashedUpload, sum string) error {
	table := "documents"
	if f.Resource == "receipt" {
		table = "expense_receipts"
	}
	_, err := q.db.Exec(ctx, `UPDATE `+table+` SET sha256=$3 WHERE workspace_id=$1 AND id=$2 AND sha256 IS NULL`, workspaceID, f.ID, sum)
	return err
}

// LockUploadHashes serializes matching uploads across both upload APIs and instances. Run in a transaction.
func (q Q) LockUploadHashes(ctx context.Context, workspaceID string, sums []string) error {
	sums = slices.Clone(sums)
	slices.Sort(sums)
	for _, sum := range slices.Compact(sums) {
		if _, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "upload:"+workspaceID+":"+sum); err != nil {
			return err
		}
	}
	return nil
}

func (q Q) DuplicateUpload(ctx context.Context, workspaceID, sum string) (DuplicateUpload, error) {
	var d DuplicateUpload
	err := q.db.QueryRow(ctx, `SELECT id, name, resource, expense_id FROM (
		SELECT id, name, 'document' AS resource, NULL::text AS expense_id FROM documents
		WHERE workspace_id = $1 AND sha256 = $2 AND deleted_at IS NULL AND NOT hr_private
		UNION ALL
		SELECT r.id, r.name, 'receipt', r.expense_id FROM expense_receipts r
		JOIN expenses e ON e.id = r.expense_id WHERE r.workspace_id = $1 AND r.sha256 = $2 AND e.deleted_at IS NULL
	) matched ORDER BY resource, id LIMIT 1`, workspaceID, sum).Scan(&d.ID, &d.Name, &d.Resource, &d.ExpenseID)
	return d, err
}
