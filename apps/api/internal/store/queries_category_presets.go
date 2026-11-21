package store

import "context"

// ExpenseCategoryPresets maps each category id of the workspace to its catalogue preset key ("telecom"), for the
// receipt reader's category list; a category without one is absent.
// shortcut: to_jsonb reads the preset column whether or not migration 00043 (category catalogue) has run; read the
// column directly once that migration is on main.
func (q Q) ExpenseCategoryPresets(ctx context.Context, workspaceID string) (map[string]string, error) {
	rows, err := q.db.Query(ctx, `SELECT c.id, to_jsonb(c)->>'preset' FROM expense_categories c
		WHERE c.workspace_id = $1 AND to_jsonb(c)->>'preset' IS NOT NULL`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, preset string
		if err := rows.Scan(&id, &preset); err != nil {
			return nil, err
		}
		out[id] = preset
	}
	return out, rows.Err()
}
