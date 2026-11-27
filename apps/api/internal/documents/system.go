package documents

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// System folders (store/queries_system_folders.go): Clients/<client>/<record type>/<year> (and
// Clients/<client>/Documents/<year>/Contracts and …/Bank Statements), Expenses/<year>/<category> and Tax
// Documents/<year>. Nobody renames, moves or deletes them; typed ones are stored by their English name and
// answered in the asker's language.

var errSystemFolder = refuse(http.StatusConflict, "system_folder",
	"Helvetly keeps this folder for your records, so it can't be renamed, moved or deleted.", nil)

// systemNames: the names of the typed system folders in the other languages (English is the stored name).
var systemNames = map[string]map[string]string{
	"de": {"clients": "Kunden", "expenses": "Ausgaben", "tax_documents": "Steuerunterlagen", "invoices": "Rechnungen", "quotes": "Offerten",
		"engagements": "Aufträge", "signatures": "Unterschriften", "documents": "Dokumente", "contracts": "Verträge", "client_bank_statements": "Kontoauszüge", "uncategorised": "Ohne Kategorie"},
	"fr": {"clients": "Clients", "expenses": "Dépenses", "tax_documents": "Documents fiscaux", "invoices": "Factures", "quotes": "Devis",
		"engagements": "Mandats", "signatures": "Signatures", "documents": "Documents", "contracts": "Contrats", "client_bank_statements": "Relevés bancaires", "uncategorised": "Sans catégorie"},
	"it": {"clients": "Clienti", "expenses": "Spese", "tax_documents": "Documenti fiscali", "invoices": "Fatture", "quotes": "Preventivi",
		"engagements": "Incarichi", "signatures": "Firme", "documents": "Documenti", "contracts": "Contratti", "client_bank_statements": "Estratti conto", "uncategorised": "Senza categoria"},
}

// language: the asker's language among en, de, fr and it: ?lang, else the first supported of Accept-Language.
func language(r *http.Request) string { return cmp.Or(requestLanguage(r), "en") }

// folderName: a folder's name as the asker reads it (a client's or category's name and a year are never translated;
// the folder of expenses without a category is).
func folderName(lang string, kind *string, name string) string {
	if kind == nil {
		return name
	}
	key := *kind
	if key == "expense_category" {
		if name != store.UncategorisedFolder {
			return name
		}
		key = "uncategorised"
	}
	if t, ok := systemNames[lang][key]; ok {
		return t
	}
	return name
}

func localizeRef(lang string, f *store.FolderRef) {
	if f != nil {
		f.Name = folderName(lang, f.SystemKind, f.Name)
	}
}

func localizeFolders(r *http.Request, folders []store.Folder) {
	lang := language(r)
	for i := range folders {
		folders[i].Name = folderName(lang, folders[i].SystemKind, folders[i].Name)
	}
}

func localizeDocument(r *http.Request, d *store.Document) {
	lang := language(r)
	localizeRef(lang, d.Folder)
	if d.AIFiling != nil {
		localizeRef(lang, d.AIFiling.Folder)
	}
}

// BackfillSystemFolders files what came before the system folders: the missing top-level ones, the stored PDFs of
// issued invoices and sent quotes (one document each, sharing the record's object), the client files the app put
// straight into Clients and the earlier Expenses/<category>/<year> folders, turned into Expenses/<year>/<category>;
// then it repairs bank statements (repairStatementFolders). Idempotent: each step only picks what is still missing,
// under the workspace's lock.
func (s *Service) BackfillSystemFolders(ctx context.Context) error {
	const batch = 200
	for {
		ids, err := s.db.WorkspacesWithoutSystemRoots(ctx, batch)
		if err != nil {
			return err
		}
		for _, id := range ids {
			if err := s.db.Tx(ctx, func(q store.Q) error { return q.EnsureSystemRoots(ctx, id, s.now()) }); err != nil {
				return err
			}
		}
		if len(ids) < batch {
			break
		}
	}
	for {
		pending, err := s.db.PendingRecordFiles(ctx, batch)
		if err != nil {
			return err
		}
		for _, p := range pending {
			err := s.db.Tx(ctx, func(q store.Q) error {
				if err := q.LockAddress(ctx, "system-folders:"+p.WorkspaceID); err != nil {
					return err
				}
				if done, err := q.RecordFileExists(ctx, p.WorkspaceID, p.ObjectKey); err != nil || done {
					return err
				}
				return q.FileClientRecord(ctx, p.WorkspaceID, p.ClientID, p.Kind, p.Year, "", store.Document{ID: auth.NewID("doc"),
					Name: p.Name, Size: p.Size, ContentType: "application/pdf", ObjectKey: p.ObjectKey, CreatedAt: p.CreatedAt},
					p.TargetType, p.TargetID)
			})
			if err != nil {
				return err
			}
		}
		if len(pending) < batch {
			break
		}
	}
	for {
		loose, err := s.db.LooseClientFiles(ctx, batch)
		if err != nil {
			return err
		}
		for _, f := range loose {
			err := s.db.Tx(ctx, func(q store.Q) error {
				folder, err := q.ClientRecordFolder(ctx, f.WorkspaceID, f.ClientID, "documents", f.Year, "", s.now())
				if err != nil {
					return err
				}
				if err := q.LockContainer(ctx, f.WorkspaceID, &folder); err != nil {
					return err
				}
				name, err := q.FreeFileName(ctx, f.WorkspaceID, &folder, f.Name)
				if err != nil {
					return err
				}
				return q.UpdateDocument(ctx, f.WorkspaceID, f.DocumentID, name, &folder, s.now())
			})
			if err != nil {
				return err
			}
		}
		if len(loose) < batch {
			break
		}
	}
	for after := ""; ; {
		files, err := s.db.ImportedOriginals(ctx, after, batch)
		if err != nil {
			return err
		}
		for _, f := range files {
			err := s.db.Tx(ctx, func(q store.Q) error {
				return q.FileImportedOriginal(ctx, f.WorkspaceID, f.ID, "", s.now())
			})
			if err != nil && !errors.Is(err, store.ErrNotFound) {
				return err
			}
			after = f.ID
		}
		if len(files) < batch {
			break
		}
	}
	if err := s.backfillExpenseFolders(ctx, batch); err != nil {
		return err
	}
	return s.repairStatementFolders(ctx, batch)
}

// repairStatementFolders takes the top-level Bank Statements folders of migration 00079 apart and empties the plain
// folders of statements or payment confirmations in a client's Documents/<year> (such as "Gutschriften") into its
// Bank Statements, one folder per transaction under the workspace's lock, each audited (documents.folder_repaired).
func (s *Service) repairStatementFolders(ctx context.Context, batch int) error {
	for _, step := range []struct {
		what   string
		list   func(context.Context, int) ([]store.OldExpenseFolder, error)
		repair func(store.Q, context.Context, string, string, time.Time) (store.FolderRepair, error)
	}{
		{"bank_statements_root", s.db.BankStatementRoots, store.Q.RepairBankStatementsRoot},
		{"client_statements", s.db.MisfiledStatementFolders, store.Q.RepairMisfiledStatementFolder},
	} {
		for {
			found, err := step.list(ctx, batch)
			if err != nil {
				return err
			}
			for _, f := range found {
				var r store.FolderRepair
				err := s.db.Tx(ctx, func(q store.Q) error {
					if err := q.LockAddress(ctx, "system-folders:"+f.WorkspaceID); err != nil {
						return err
					}
					if r, err = step.repair(q, ctx, f.WorkspaceID, f.ID, s.now()); err != nil {
						return err
					}
					raw, err := json.Marshal(map[string]any{"repair": step.what, "folder": f.ID, "files": r.Moved,
						"deleted": r.Deleted, "unlocked": r.Unlocked})
					if err != nil {
						return err
					}
					return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: f.WorkspaceID, Kind: "documents.folder_repaired",
						SubjectType: "workspace", SubjectID: f.WorkspaceID, At: s.now(), Payload: raw})
				})
				if err != nil {
					return err
				}
				s.log.InfoContext(ctx, "documents: folder repaired", "repair", step.what, "workspace", f.WorkspaceID,
					"folder", f.ID, "files", r.Moved, "deleted", r.Deleted, "unlocked", r.Unlocked)
			}
			if len(found) < batch {
				break
			}
		}
	}
	return nil
}

// backfillExpenseFolders turns the earlier Expenses/<category>/<year> folders into Expenses/<year>/<category>, one
// category folder per transaction under the workspace's lock (on-demand filing makes the new layout meanwhile).
func (s *Service) backfillExpenseFolders(ctx context.Context, batch int) error {
	for {
		old, err := s.db.OldExpenseFolders(ctx, batch)
		if err != nil {
			return err
		}
		for _, f := range old {
			err := s.db.Tx(ctx, func(q store.Q) error {
				if err := q.LockAddress(ctx, "system-folders:"+f.WorkspaceID); err != nil {
					return err
				}
				return q.ConvertOldExpenseFolder(ctx, f.WorkspaceID, f.ID, s.now())
			})
			if err != nil {
				return err
			}
		}
		if len(old) < batch {
			return nil
		}
	}
}

// hasSystemRoots: every top-level system folder is among folders.
func hasSystemRoots(folders []store.Folder) bool {
	found := map[string]bool{}
	for _, f := range folders {
		if f.ParentID == nil && f.SystemKind != nil {
			found[*f.SystemKind] = true
		}
	}
	for _, kind := range store.SystemRootKinds {
		if !found[kind] {
			return false
		}
	}
	return true
}

// BackfillAutoTags tags pending files and restores protected facts dismissed before they became read-only.
func (s *Service) BackfillAutoTags(ctx context.Context) error {
	const batch = 500
	for {
		files, err := s.db.UntaggedDocuments(ctx, batch)
		if err != nil {
			return err
		}
		for _, f := range files {
			if err := s.db.Tx(ctx, func(q store.Q) error { return q.AutoTag(ctx, f.WorkspaceID, f.ID, s.now()) }); err != nil {
				return err
			}
		}
		if len(files) < batch {
			return nil
		}
	}
}
