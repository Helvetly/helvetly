package store

import (
	"context"
	"errors"
	"strconv"
	"time"
)

// Bank statement repairs (start-up, idempotent): bank statements live in each client's Documents/<year>/Bank
// Statements. The top-level Bank Statements/<year> of migration 00079 is taken apart, and a plain folder of statements
// or payment confirmations straight in a client's Documents/<year> (such as "Gutschriften") is emptied into it.

// FolderRepair: what a repair did to one folder.
type FolderRepair struct {
	Moved    int  // files moved into a client's Bank Statements
	Deleted  bool // the folder (and its year folders) deleted, empty
	Unlocked int  // system folders left as plain folders
}

// statementFolderNames: names (lower case) of a plain folder of bank statements, credit advices or payment
// confirmations in the app's languages; only such a folder is emptied into the client's Bank Statements.
var statementFolderNames = []string{"bank statements", "statements", "account statements", "credit advices",
	"payment confirmations", "payments", "gutschriften", "gutschrift", "kontoauszüge", "kontoauszuege", "bankauszüge",
	"zahlungsbestätigungen", "zahlungsbestaetigungen", "zahlungseingänge", "zahlungen", "relevés bancaires",
	"releves bancaires", "relevés", "avis de crédit", "confirmations de paiement", "paiements", "estratti conto",
	"accrediti", "conferme di pagamento", "pagamenti"}

// statementKindSQL: a document d is a bank statement or payment confirmation by its filed kind, else its tags.
const statementKindSQL = `coalesce(d.filed_kind IN ('bank-statement', 'payment-confirmation'),
	(d.tags || d.auto_tags) && '{bank-statement,payment-confirmation}')`

// BankStatementRoots: up to limit live top-level Bank Statements folders (every workspace).
func (q Q) BankStatementRoots(ctx context.Context, limit int) ([]OldExpenseFolder, error) {
	return q.workspaceFolders(ctx, `SELECT workspace_id, id FROM document_folders WHERE parent_id IS NULL
		AND system_kind = 'bank_statements' AND deleted_at IS NULL ORDER BY workspace_id, id LIMIT $1`, limit)
}

// MisfiledStatementFolders: up to limit plain folders straight in a client's Documents/<year>, named like a folder of
// statements (statementFolderNames), without folders inside, whose files (one at least) are all bank statements or
// payment confirmations of no invoice or expense.
func (q Q) MisfiledStatementFolders(ctx context.Context, limit int) ([]OldExpenseFolder, error) {
	return q.workspaceFolders(ctx, `SELECT f.workspace_id, f.id FROM document_folders f
		JOIN document_folders y ON y.id = f.parent_id AND y.system_kind = 'year' AND y.deleted_at IS NULL
		JOIN document_folders t ON t.id = y.parent_id AND t.system_kind = 'documents' AND t.deleted_at IS NULL
		JOIN document_folders c ON c.id = t.parent_id AND c.system_kind = 'client' AND c.deleted_at IS NULL
		WHERE f.system_kind IS NULL AND f.deleted_at IS NULL AND lower(f.name) = ANY($2)
			AND NOT EXISTS (SELECT 1 FROM document_folders s WHERE s.workspace_id = f.workspace_id AND s.parent_id = f.id)
			AND EXISTS (SELECT 1 FROM documents d WHERE d.workspace_id = f.workspace_id AND d.folder_id = f.id AND d.deleted_at IS NULL)
			AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.workspace_id = f.workspace_id AND d.folder_id = f.id
				AND (NOT `+statementKindSQL+` OR EXISTS (SELECT 1 FROM document_links l WHERE l.document_id = d.id
					AND l.target_type IN ('invoice', 'expense'))))
		ORDER BY f.workspace_id, f.id LIMIT $1`, limit, statementFolderNames)
}

func (q Q) workspaceFolders(ctx context.Context, sql string, args ...any) ([]OldExpenseFolder, error) {
	rows, err := q.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OldExpenseFolder
	for rows.Next() {
		var f OldExpenseFolder
		if err := rows.Scan(&f.WorkspaceID, &f.ID); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// RepairMisfiledStatementFolder moves what the folder holds (live and trashed) into its client's Documents/<year>/Bank
// Statements and deletes it; a file without a filed kind keeps the kind its tags give (payment confirmation first).
// Nothing when it is no longer such a folder. Run it in a transaction.
func (q Q) RepairMisfiledStatementFolder(ctx context.Context, workspaceID, folderID string, now time.Time) (FolderRepair, error) {
	var clientID, yearName string
	err := q.db.QueryRow(ctx, `SELECT c.system_ref, y.name FROM document_folders f
		JOIN document_folders y ON y.id = f.parent_id AND y.system_kind = 'year'
		JOIN document_folders t ON t.id = y.parent_id AND t.system_kind = 'documents'
		JOIN document_folders c ON c.id = t.parent_id AND c.system_kind = 'client'
		JOIN clients cl ON cl.workspace_id = f.workspace_id AND cl.id = c.system_ref
		WHERE f.workspace_id = $1 AND f.id = $2 AND f.system_kind IS NULL AND f.deleted_at IS NULL`,
		workspaceID, folderID).Scan(&clientID, &yearName)
	if errors.Is(err, ErrNotFound) {
		return FolderRepair{}, nil
	} else if err != nil {
		return FolderRepair{}, err
	}
	year, err := strconv.Atoi(yearName)
	if err != nil {
		return FolderRepair{}, nil
	}
	if err := q.keepStatementKinds(ctx, workspaceID, []string{folderID}); err != nil {
		return FolderRepair{}, err
	}
	to, err := q.ClientBankStatementsFolder(ctx, workspaceID, clientID, year, "", now)
	if err != nil {
		return FolderRepair{}, err
	}
	ids, err := q.liveFiles(ctx, workspaceID, []string{folderID})
	if err != nil {
		return FolderRepair{}, err
	}
	if to != folderID { // a folder by a name of Bank Statements was adopted as it: nothing to move
		if err := q.moveContents(ctx, workspaceID, folderID, "", to, now); err != nil {
			return FolderRepair{}, err
		}
		if _, err := q.db.Exec(ctx, `DELETE FROM document_folders WHERE workspace_id = $1 AND id = $2`, workspaceID, folderID); err != nil {
			return FolderRepair{}, err
		}
	}
	return FolderRepair{Moved: len(ids), Deleted: to != folderID}, q.autoTagAll(ctx, workspaceID, ids, now)
}

// RepairBankStatementsRoot takes the top-level Bank Statements folder apart: empty (no file, trashed ones included,
// and no folder but its year folders) it is deleted with its year folders; else each live file of one client moves to
// that client's Documents/<year>/Bank Statements (the year folder's year, else the upload's), the emptied year folders
// go, and what remains stays as plain folders. Its files keep the bank statement kind. Nothing when it is no longer
// such a folder. Run it in a transaction.
func (q Q) RepairBankStatementsRoot(ctx context.Context, workspaceID, rootID string, now time.Time) (FolderRepair, error) {
	var found bool
	if err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM document_folders WHERE workspace_id = $1 AND id = $2
		AND parent_id IS NULL AND system_kind = 'bank_statements' AND deleted_at IS NULL)`, workspaceID, rootID).Scan(&found); err != nil || !found {
		return FolderRepair{}, err
	}
	if err := q.LockContainer(ctx, workspaceID, nil); err != nil {
		return FolderRepair{}, err
	}
	tree, err := q.subtree(ctx, workspaceID, rootID)
	if err != nil {
		return FolderRepair{}, err
	}
	var r FolderRepair
	if err := q.keepStatementKinds(ctx, workspaceID, tree); err != nil {
		return r, err
	}
	rows, err := q.db.Query(ctx, `SELECT d.id, d.name, l.client, coalesce(CASE WHEN f.system_kind = 'year' AND f.name ~ '^[0-9]{4}$'
			THEN f.name::int END, extract(year FROM d.created_at AT TIME ZONE (SELECT w.timezone FROM workspaces w WHERE w.id = $1))::int)
		FROM documents d JOIN document_folders f ON f.id = d.folder_id
		JOIN LATERAL (SELECT min(k.target_id) AS client FROM document_links k JOIN clients c ON c.id = k.target_id
			AND c.workspace_id = $1 AND c.deleted_at IS NULL
			WHERE k.document_id = d.id AND k.target_type = 'client' HAVING count(DISTINCT k.target_id) = 1) l ON true
		WHERE d.workspace_id = $1 AND d.folder_id = ANY($2) AND d.deleted_at IS NULL ORDER BY d.created_at, d.id`, workspaceID, tree)
	if err != nil {
		return r, err
	}
	type move struct {
		id, name, client string
		year             int
	}
	var moves []move
	for rows.Next() {
		var m move
		if err := rows.Scan(&m.id, &m.name, &m.client, &m.year); err != nil {
			rows.Close()
			return r, err
		}
		moves = append(moves, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return r, err
	}
	for _, m := range moves {
		to, err := q.ClientBankStatementsFolder(ctx, workspaceID, m.client, m.year, "", now)
		if err != nil {
			return r, err
		}
		if err := q.LockContainer(ctx, workspaceID, &to); err != nil {
			return r, err
		}
		name, err := q.FreeFileName(ctx, workspaceID, &to, m.name)
		if err != nil {
			return r, err
		}
		if err := q.UpdateDocument(ctx, workspaceID, m.id, name, &to, now); err != nil {
			return r, err
		}
		r.Moved++
	}
	// the year folders left with nothing (no file, trashed ones included, no folder) go
	if _, err := q.db.Exec(ctx, `DELETE FROM document_folders f WHERE f.workspace_id = $1 AND f.parent_id = $2
		AND f.system_kind = 'year'
		AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.workspace_id = $1 AND d.folder_id = f.id)
		AND NOT EXISTS (SELECT 1 FROM document_folders c WHERE c.workspace_id = $1 AND c.parent_id = f.id)`, workspaceID, rootID); err != nil {
		return r, err
	}
	tag, err := q.db.Exec(ctx, `DELETE FROM document_folders f WHERE f.workspace_id = $1 AND f.id = $2
		AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.workspace_id = $1 AND d.folder_id = f.id)
		AND NOT EXISTS (SELECT 1 FROM document_folders c WHERE c.workspace_id = $1 AND c.parent_id = f.id)`, workspaceID, rootID)
	if err != nil {
		return r, err
	}
	if r.Deleted = tag.RowsAffected() > 0; r.Deleted {
		return r, nil
	}
	tree, err = q.subtree(ctx, workspaceID, rootID)
	if err != nil {
		return r, err
	}
	tag, err = q.db.Exec(ctx, `UPDATE document_folders SET system_kind = NULL, system_ref = NULL, updated_at = $3
		WHERE workspace_id = $1 AND id = ANY($2) AND system_kind IS NOT NULL`, workspaceID, tree, now)
	if err != nil {
		return r, err
	}
	r.Unlocked = int(tag.RowsAffected())
	left, err := q.liveFiles(ctx, workspaceID, tree)
	if err != nil {
		return r, err
	}
	return r, q.autoTagAll(ctx, workspaceID, left, now)
}

// subtree: the folder and every folder below it, live and trashed.
func (q Q) subtree(ctx context.Context, workspaceID, rootID string) ([]string, error) {
	rows, err := q.db.Query(ctx, `WITH RECURSIVE t AS (SELECT id FROM document_folders WHERE workspace_id = $1 AND id = $2
		UNION SELECT f.id FROM document_folders f JOIN t ON f.parent_id = t.id WHERE f.workspace_id = $1)
		SELECT id FROM t`, workspaceID, rootID)
	if err != nil {
		return nil, err
	}
	return collect(rows)
}

// keepStatementKinds records the kind of each file in the folders that has none: payment confirmation or bank
// statement when its tags say so, else bank statement (what its folder told so far).
func (q Q) keepStatementKinds(ctx context.Context, workspaceID string, folders []string) error {
	_, err := q.db.Exec(ctx, `UPDATE documents d SET filed_kind = CASE WHEN (d.tags || d.auto_tags) && '{payment-confirmation}'
			THEN 'payment-confirmation' ELSE 'bank-statement' END
		WHERE d.workspace_id = $1 AND d.folder_id = ANY($2) AND d.filed_kind IS NULL AND NOT d.hr_private`, workspaceID, folders)
	return err
}

func (q Q) liveFiles(ctx context.Context, workspaceID string, folders []string) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT id FROM documents WHERE workspace_id = $1 AND folder_id = ANY($2) AND deleted_at IS NULL
		ORDER BY id`, workspaceID, folders)
	if err != nil {
		return nil, err
	}
	return collect(rows)
}

func (q Q) autoTagAll(ctx context.Context, workspaceID string, ids []string, now time.Time) error {
	for _, id := range ids {
		if err := q.AutoTag(ctx, workspaceID, id, now); err != nil {
			return err
		}
	}
	return nil
}
