package documents

import (
	"context"
	"net/http"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// System folders (store/queries_system_folders.go): Clients/<client>/<record type>/<year> and
// Expenses/<category>/<year>. Nobody renames, moves or deletes them; typed ones are stored by their English name and
// answered in the asker's language.

var errSystemFolder = refuse(http.StatusConflict, "system_folder",
	"Helvetly keeps this folder for your records, so it can't be renamed, moved or deleted.", nil)

// systemNames: the names of the typed system folders in the other languages (English is the stored name).
var systemNames = map[string]map[string]string{
	"de": {"clients": "Kunden", "expenses": "Ausgaben", "invoices": "Rechnungen", "quotes": "Offerten",
		"engagements": "Aufträge", "signatures": "Unterschriften", "documents": "Dokumente", "uncategorised": "Ohne Kategorie"},
	"fr": {"clients": "Clients", "expenses": "Dépenses", "invoices": "Factures", "quotes": "Devis",
		"engagements": "Mandats", "signatures": "Signatures", "documents": "Documents", "uncategorised": "Sans catégorie"},
	"it": {"clients": "Clienti", "expenses": "Spese", "invoices": "Fatture", "quotes": "Preventivi",
		"engagements": "Incarichi", "signatures": "Firme", "documents": "Documenti", "uncategorised": "Senza categoria"},
}

// language: the asker's language among en, de, fr and it: ?lang, else the first supported of Accept-Language.
func language(r *http.Request) string {
	tags := []string{r.URL.Query().Get("lang")}
	for _, part := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		tags = append(tags, strings.TrimSpace(strings.SplitN(part, ";", 2)[0]))
	}
	for _, tag := range tags {
		lang := strings.ToLower(strings.SplitN(tag, "-", 2)[0])
		if _, ok := systemNames[lang]; ok || lang == "en" {
			return lang
		}
	}
	return "en"
}

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
// straight into Clients and the expenses' files in the earlier Expenses/<year>[/<category>] folders, which then end.
// Idempotent: each step only picks what is still missing, under the workspace's lock.
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
	return s.backfillExpenseFolders(ctx, batch)
}

// backfillExpenseFolders moves the expenses' files out of the year folders straight in Expenses into
// Expenses/<category>/<year>, then retires those year folders (plain from then on, trashed when nothing is left).
func (s *Service) backfillExpenseFolders(ctx context.Context, batch int) error {
	for {
		files, err := s.db.LegacyExpenseFiles(ctx, batch)
		if err != nil {
			return err
		}
		for _, f := range files {
			err := s.db.Tx(ctx, func(q store.Q) error {
				if err := q.LockAddress(ctx, "system-folders:"+f.WorkspaceID); err != nil {
					return err
				}
				if still, err := q.InLegacyExpenseFolder(ctx, f.WorkspaceID, f.DocumentID); err != nil || !still {
					return err // moved or trashed meanwhile: the person's choice stands
				}
				folder, err := q.ExpenseYearFolder(ctx, f.WorkspaceID, f.CategoryID, f.Year, "", s.now())
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
		if len(files) < batch {
			break
		}
	}
	for {
		var n int
		err := s.db.Tx(ctx, func(q store.Q) (err error) {
			n, err = q.RetireLegacyExpenseFolders(ctx, batch, s.now())
			return err
		})
		if err != nil || n < batch {
			return err
		}
	}
}

// hasSystemRoots: both top-level system folders are among folders.
func hasSystemRoots(folders []store.Folder) bool {
	found := map[string]bool{}
	for _, f := range folders {
		if f.ParentID == nil && f.SystemKind != nil {
			found[*f.SystemKind] = true
		}
	}
	return found["clients"] && found["expenses"]
}
