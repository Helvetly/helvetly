// Package documents is a workspace's file manager: folders, files, the Trash and links to records
// (docs/documents-contract.md).
package documents

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

// Auth is what the handlers use of internal/auth: the session, and its error and JSON conventions.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Storage keeps the files' bytes (internal/storage in production, a fake in tests).
type Storage interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType, filename string) error
	storage.Source // Open, PresignDownload, ProxyDownloads
	Copy(ctx context.Context, src, dst string) error
	Delete(ctx context.Context, key string) error
}

type Service struct {
	db      *store.Store
	auth    Auth
	files   Storage
	log     *slog.Logger
	maxSize int64
	now     func() time.Time
	filer   aimodel.Provider // nil: AI filing is off
	budget  aimodel.Budget
	text    func([]byte, int) string
}

func New(db *store.Store, a Auth, files Storage, maxSize int64, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, files: files, log: log, maxSize: maxSize, now: func() time.Time { return time.Now().UTC() }}
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/documents/folders", s.listFolders)
	handle("POST /api/v1/documents/folders", s.createFolder)
	handle("PATCH /api/v1/documents/folders/{id}", s.updateFolder)
	handle("PUT /api/v1/documents/folders/{id}/star", s.star(true))
	handle("DELETE /api/v1/documents/folders/{id}/star", s.star(false))
	handle("GET /api/v1/documents", s.list)
	handle("POST /api/v1/documents", s.upload)
	handle("POST /api/v1/documents/bulk", s.bulk)
	handle("GET /api/v1/documents/usage", s.usage)
	handle("GET /api/v1/documents/trash", s.trash)
	handle("POST /api/v1/documents/trash/empty", s.emptyTrash)
	handle("GET /api/v1/documents/{id}", s.get)
	handle("PATCH /api/v1/documents/{id}", s.update)
	handle("POST /api/v1/documents/{id}/copy", s.copy)
	handle("DELETE /api/v1/documents/{id}/filing", s.undoFiling)
	handle("GET /api/v1/documents/{id}/download", s.download)
	handle("GET /api/v1/documents/{id}/content", s.content)
	handle("POST /api/v1/documents/{id}/links", s.link)
	handle("DELETE /api/v1/documents/{id}/links/{type}/{target}", s.unlink)
	s.registerShares(handle)
}

// Run purges the Trash of what is older than 30 days, hourly, until ctx ends.
func (s *Service) Run(ctx context.Context) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		s.PurgeExpired(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// PurgeExpired deletes forever what has been in the Trash for longer than store.TrashDays (business records stay).
func (s *Service) PurgeExpired(ctx context.Context) {
	items, err := s.db.ExpiredTrash(ctx, s.now().AddDate(0, 0, -store.TrashDays))
	if err != nil {
		s.log.ErrorContext(ctx, "list expired trash", "error", err)
		return
	}
	for _, it := range items {
		if _, err := s.purge(ctx, it[0], it[1], it[2]); err != nil {
			s.log.ErrorContext(ctx, "purge trash", "id", it[2], "error", err)
		}
	}
}

// problem is an answer the client can act on (an auth.Error), with the sentence a bulk action reports for the item.
type problem struct {
	reason string
	err    error
}

func (p *problem) Error() string { return p.err.Error() }
func (p *problem) Unwrap() error { return p.err }

func refuse(status int, code, reason string, details map[string]any) error {
	return &problem{reason, auth.Error(status, code, reason, details)}
}

var (
	errForbidden = refuse(http.StatusForbidden, "forbidden", "Only owners and admins can delete files forever.", nil)
	errTrashed   = refuse(http.StatusConflict, "trashed", "This is in the Trash. Restore it first.", nil)
	errRetained  = refuse(http.StatusConflict, "retained",
		"This file is a business record linked to a booked invoice or expense, so it is kept for 10 years.", nil)
	errNotInTrash = refuse(http.StatusConflict, "not_trashed", "It isn't in the Trash.", nil)
)

func canDelete(sess store.Session) bool { return sess.Role == "owner" || sess.Role == "admin" }

func data(v any) map[string]any { return map[string]any{"data": v} }

func validationFailed(fields map[string]string) error {
	p := refuse(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.", map[string]any{"fields": fields})
	for _, msg := range fields {
		p.(*problem).reason = msg
	}
	return p
}

func badRequest(msg string) error {
	return auth.Error(http.StatusBadRequest, "invalid_request", msg, nil)
}

func nameTaken(what, existingID, suggestion string) error {
	return refuse(http.StatusConflict, "name_taken", what+" with this name is already here.",
		map[string]any{"existing_id": existingID, "suggestion": suggestion})
}

func (s *Service) today() string { return s.now().Format(time.DateOnly) }

func present(d *store.Document) {
	d.Kind = kindOf(d.ContentType)
	d.Previewable = previewable(d.ContentType)
}

// ---- folders ----

func (s *Service) listFolders(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	folders, err := s.db.DocumentFolders(r.Context(), sess.Workspace.ID, sess.User.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(folders))
	return nil
}

// star stars (or unstars) a folder for the person asking; doing it twice is fine.
func (s *Service) star(on bool) handler {
	return func(w http.ResponseWriter, r *http.Request, sess store.Session) error {
		ok, err := s.db.StarFolder(r.Context(), sess.Workspace.ID, sess.User.ID, r.PathValue("id"), on, s.now())
		if err != nil {
			return err
		}
		if !ok {
			return store.ErrNotFound
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func (s *Service) folder(ctx context.Context, sess store.Session, id string) (store.Folder, error) {
	folders, err := s.db.DocumentFolders(ctx, sess.Workspace.ID, sess.User.ID)
	if err != nil {
		return store.Folder{}, err
	}
	for _, f := range folders {
		if f.ID == id {
			return f, nil
		}
	}
	return store.Folder{}, store.ErrNotFound
}

// container reads an optional folder id (absent or null = top level) and checks the folder is live.
func container(q store.Q, ctx context.Context, sess store.Session, raw json.RawMessage, field string) (*string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var id string
	if err := json.Unmarshal(raw, &id); err != nil || id == "" {
		return nil, validationFailed(map[string]string{field: "Choose a folder."})
	}
	return &id, liveFolder(q, ctx, sess, id, field)
}

func liveFolder(q store.Q, ctx context.Context, sess store.Session, id, field string) error {
	if _, err := q.DocumentFolder(ctx, sess.Workspace.ID, id); errors.Is(err, store.ErrNotFound) {
		return validationFailed(map[string]string{field: "This folder doesn't exist any more."})
	} else if err != nil {
		return err
	}
	return nil
}

func (s *Service) createFolder(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Name     string          `json:"name"`
		ParentID json.RawMessage `json:"parent_id"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	name, problem := checkName(body.Name)
	if problem != "" {
		return validationFailed(map[string]string{"name": problem})
	}
	id := auth.NewID("fld")
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		parent, err := container(q, r.Context(), sess, body.ParentID, "parent_id")
		if err != nil {
			return err
		}
		if err := q.LockContainer(r.Context(), sess.Workspace.ID, parent); err != nil {
			return err
		}
		if err := folderNameFree(q, r.Context(), sess, parent, name, ""); err != nil {
			return err
		}
		return q.CreateFolder(r.Context(), sess.Workspace.ID, id, name, parent, sess.User.ID, s.now())
	})
	if err != nil {
		return err
	}
	f, err := s.folder(r.Context(), sess, id)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(f))
	return nil
}

func folderNameFree(q store.Q, ctx context.Context, sess store.Session, parent *string, name, exceptID string) error {
	existing, err := q.FolderNameTaken(ctx, sess.Workspace.ID, parent, name, exceptID)
	if err != nil || existing == "" {
		return err
	}
	suggestion, err := q.FreeFolderName(ctx, sess.Workspace.ID, parent, name)
	if err != nil {
		return err
	}
	return nameTaken("A folder", existing, suggestion)
}

func (s *Service) updateFolder(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	for k := range body {
		if k != "name" && k != "parent_id" {
			return badRequest("Unknown field " + strconv.Quote(k) + ".")
		}
	}
	id := r.PathValue("id")
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		f, err := q.DocumentFolder(r.Context(), sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		name, parent := f.Name, f.ParentID
		if raw, ok := body["name"]; ok {
			var typed string
			if err := json.Unmarshal(raw, &typed); err != nil {
				return validationFailed(map[string]string{"name": "Enter a name."})
			}
			var problem string
			if name, problem = checkName(typed); problem != "" {
				return validationFailed(map[string]string{"name": problem})
			}
		}
		if raw, ok := body["parent_id"]; ok {
			if parent, err = container(q, r.Context(), sess, raw, "parent_id"); err != nil {
				return err
			}
		}
		return s.placeFolder(q, r.Context(), sess, f.ID, name, parent, "fail")
	})
	if err != nil {
		return err
	}
	f, err := s.folder(r.Context(), sess, id)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(f))
	return nil
}

// placeFolder renames and/or moves a live folder, refusing a cycle and resolving a name clash by onConflict.
func (s *Service) placeFolder(q store.Q, ctx context.Context, sess store.Session, id, name string, parent *string, onConflict string) error {
	// Inverse moves must see each other's committed parent before checking for a cycle.
	if err := q.LockAddress(ctx, "document-tree:"+sess.Workspace.ID); err != nil {
		return err
	}
	if parent != nil {
		within, err := q.FolderWithin(ctx, *parent, id)
		if err != nil {
			return err
		}
		if within {
			return validationFailed(map[string]string{"parent_id": "A folder can't move into itself."})
		}
	}
	if err := q.LockContainer(ctx, sess.Workspace.ID, parent); err != nil {
		return err
	}
	if err := folderNameFree(q, ctx, sess, parent, name, id); err != nil {
		if onConflict != "keep_both" {
			return err
		}
		if name, err = q.FreeFolderName(ctx, sess.Workspace.ID, parent, name); err != nil {
			return err
		}
	}
	return q.UpdateFolder(ctx, sess.Workspace.ID, id, name, parent, s.now())
}

// ---- files ----

const (
	defaultPageSize = 100
	maxPageSize     = 500
)

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	v := r.URL.Query()
	f := store.DocumentFilter{Folder: v.Get("folder_id"), Search: strings.TrimSpace(v.Get("search")),
		UploadedBy: v.Get("uploaded_by"), ClientID: v.Get("client_id"), From: v.Get("from"), To: v.Get("to"),
		Tag: strings.ToLower(strings.TrimSpace(v.Get("tag")))}
	for _, k := range v["kind"] {
		if !slices.Contains(kinds, k) {
			return badRequest("Unknown kind " + strconv.Quote(k) + ".")
		}
	}
	if len(v["kind"]) > 0 {
		f.ContentTypes = contentTypes(v["kind"])
	}
	for _, d := range []string{f.From, f.To} {
		if _, err := time.Parse(time.DateOnly, d); d != "" && err != nil {
			return badRequest("Dates are YYYY-MM-DD.")
		}
	}
	f.Sort = strings.TrimPrefix(v.Get("sort"), "-")
	f.Desc = strings.HasPrefix(v.Get("sort"), "-")
	if _, ok := store.DocumentSorts[f.Sort]; !ok && f.Sort != "" {
		return badRequest("Unknown sort " + strconv.Quote(f.Sort) + ".")
	}
	page, size := 1, defaultPageSize
	if p := v.Get("page"); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil || n < 1 {
			return badRequest("page must be a positive number.")
		}
		page = n
	}
	if p := v.Get("page_size"); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil || n < 1 || n > maxPageSize {
			return badRequest("page_size must be from 1 to 500.")
		}
		size = n
	}
	docs, total, err := s.db.ListDocuments(r.Context(), sess.Workspace.ID, f, size, (page-1)*size)
	if err != nil {
		return err
	}
	for i := range docs {
		present(&docs[i])
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": docs, "meta": map[string]int{"page": page, "page_size": size,
		"total": total, "total_pages": int(math.Ceil(float64(total) / float64(size)))}})
	return nil
}

func (s *Service) document(ctx context.Context, sess store.Session, id string) (store.Document, error) {
	d, err := s.db.Document(ctx, sess.Workspace.ID, id)
	present(&d)
	return d, err
}

func (s *Service) writeDocument(w http.ResponseWriter, r *http.Request, sess store.Session, status int, id string) error {
	d, err := s.document(r.Context(), sess, id)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, status, data(d))
	return nil
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.writeDocument(w, r, sess, http.StatusOK, r.PathValue("id"))
}

func onConflict(raw string) (string, error) {
	switch raw {
	case "":
		return "fail", nil
	case "fail", "keep_both", "replace":
		return raw, nil
	}
	return "", validationFailed(map[string]string{"on_conflict": "Use fail, keep_both or replace."})
}

// placeFile decides a file's name in folder (it may be new there): a clash fails (409 with a suggestion), keeps both
// under a free name, or replaces the other file by moving it to the Trash. Run it in a transaction.
func (s *Service) placeFile(q store.Q, ctx context.Context, sess store.Session, id, name string, folder *string, mode string) (string, error) {
	if err := q.LockContainer(ctx, sess.Workspace.ID, folder); err != nil {
		return "", err
	}
	existing, err := q.FileNameTaken(ctx, sess.Workspace.ID, folder, name, id)
	if err != nil || existing == "" {
		return name, err
	}
	switch mode {
	case "keep_both":
		return q.FreeFileName(ctx, sess.Workspace.ID, folder, name)
	case "replace":
		trashed, err := q.TrashDocument(ctx, sess.Workspace.ID, existing, sess.User.ID, s.today(), s.now())
		if err != nil {
			return "", err
		}
		if !trashed {
			return "", errRetained
		}
		return name, nil
	}
	suggestion, err := q.FreeFileName(ctx, sess.Workspace.ID, folder, name)
	if err != nil {
		return "", err
	}
	return "", nameTaken("A file", existing, suggestion)
}

func (s *Service) update(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	mode := ""
	var tags []string
	for k, raw := range body {
		switch k {
		case "tags":
			var typed []string
			if err := json.Unmarshal(raw, &typed); err != nil {
				return validationFailed(map[string]string{"tags": "Send tags as a list of words."})
			}
			var problem string
			if tags, problem = cleanTags(typed); problem != "" {
				return validationFailed(map[string]string{"tags": problem})
			}
		case "name", "folder_id":
		case "on_conflict":
			_ = json.Unmarshal(raw, &mode)
		default:
			return badRequest("Unknown field " + strconv.Quote(k) + ".")
		}
	}
	mode, err := onConflict(mode)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		d, err := q.Document(r.Context(), sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		if d.DeletedAt != nil {
			return errTrashed
		}
		name, folder := d.Name, d.FolderID
		if raw, ok := body["name"]; ok {
			var typed string
			if err := json.Unmarshal(raw, &typed); err != nil {
				return validationFailed(map[string]string{"name": "Enter a name."})
			}
			var problem string
			if name, problem = checkName(typed); problem != "" {
				return validationFailed(map[string]string{"name": problem})
			}
		}
		if raw, ok := body["folder_id"]; ok {
			if folder, err = container(q, r.Context(), sess, raw, "folder_id"); err != nil {
				return err
			}
		}
		if name, err = s.placeFile(q, r.Context(), sess, d.ID, name, folder, mode); err != nil {
			return err
		}
		if tags != nil {
			if err := q.SetDocumentTags(r.Context(), sess.Workspace.ID, d.ID, tags, s.now()); err != nil {
				return err
			}
		}
		return q.UpdateDocument(r.Context(), sess.Workspace.ID, d.ID, name, folder, s.now())
	})
	if err != nil {
		return err
	}
	return s.writeDocument(w, r, sess, http.StatusOK, id)
}

func (s *Service) copy(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		FolderID json.RawMessage `json:"folder_id"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	src, err := s.db.Document(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	if src.DeletedAt != nil {
		return errTrashed
	}
	id := auth.NewID("doc")
	key := objectKey(sess, id, src.Name)
	if err := s.db.ReserveObject(r.Context(), sess.Workspace.ID, key, src.Size, true, s.now()); err != nil {
		return err
	}
	if err := s.files.Copy(r.Context(), src.ObjectKey, key); err != nil {
		return err
	}
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		folder := src.FolderID
		if body.FolderID != nil {
			if folder, err = container(q, r.Context(), sess, body.FolderID, "folder_id"); err != nil {
				return err
			}
		}
		name, err := s.placeFile(q, r.Context(), sess, "", src.Name, folder, "keep_both")
		if err != nil {
			return err
		}
		return q.CreateDocument(r.Context(), sess.Workspace.ID, sess.User.ID, store.Document{ID: id, FolderID: folder, Name: name,
			Size: src.Size, ContentType: src.ContentType, SHA256: src.SHA256, ObjectKey: key, CreatedAt: s.now()})
	})
	if err != nil {
		s.removeObjects(r.Context(), key)
		return err
	}
	return s.writeDocument(w, r, sess, http.StatusCreated, id)
}

func objectKey(sess store.Session, id, name string) string {
	return "workspaces/" + sess.Workspace.ID + "/documents/" + id + "/" + keyName(name)
}

func (s *Service) download(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	d, err := s.db.Document(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	return storage.Serve(w, r, s.files, sess.Workspace.ID, d.ObjectKey, d.Name, d.ContentType)
}

// content serves the bytes through the API (same origin, so pdf.js and thumbnails need no bucket CORS); PDF and
// images inline, anything else as a download, never sniffed or run by the browser.
func (s *Service) content(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	d, err := s.db.Document(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	obj, err := s.files.Open(r.Context(), d.ObjectKey)
	if err != nil {
		return err
	}
	defer obj.Close()
	disposition := "attachment"
	if previewable(d.ContentType) {
		disposition = "inline"
	}
	h := w.Header()
	h.Set("Content-Type", d.ContentType)
	h.Set("Content-Disposition", contentDisposition(disposition, d.Name))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cache-Control", "private, max-age=300")
	if d.SHA256 != nil {
		h.Set("ETag", `"`+*d.SHA256+`"`)
	}
	http.ServeContent(w, r, "", d.CreatedAt, obj)
	return nil
}

func (s *Service) link(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if body.Type != "client" && body.Type != "invoice" && body.Type != "expense" {
		return validationFailed(map[string]string{"type": "Use client, invoice or expense."})
	}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		var ok bool
		var err error
		if body.Type == "client" {
			ok, err = q.LockClient(r.Context(), sess.Workspace.ID, body.ID)
		} else {
			ok, err = q.LinkTargetExists(r.Context(), sess.Workspace.ID, body.Type, body.ID)
		}
		if err != nil {
			return err
		}
		if !ok {
			return validationFailed(map[string]string{"id": "This record doesn't exist."})
		}
		d, err := q.Document(r.Context(), sess.Workspace.ID, r.PathValue("id"))
		if err != nil {
			return err
		}
		if d.DeletedAt != nil {
			return errTrashed
		}
		return q.AddDocumentLink(r.Context(), sess.Workspace.ID, d.ID, body.Type, body.ID, sess.User.ID, s.now())
	})
	if err != nil {
		return err
	}
	return s.writeDocument(w, r, sess, http.StatusCreated, r.PathValue("id"))
}

func (s *Service) unlink(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	d, err := s.db.Document(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	for _, l := range d.Links {
		if l.Type == r.PathValue("type") && l.ID == r.PathValue("target") {
			if l.Retains {
				return auth.Error(http.StatusConflict, "retained", "A business record stays linked to its invoice, expense or signed contract.", nil)
			}
			if err := s.db.RemoveDocumentLink(r.Context(), d.ID, l.Type, l.ID); err != nil {
				return err
			}
			return s.writeDocument(w, r, sess, http.StatusOK, d.ID)
		}
	}
	return store.ErrNotFound
}

// ---- the Trash and bulk actions ----

func (s *Service) trash(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	items, err := s.db.Trash(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(items))
	return nil
}

func (s *Service) emptyTrash(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canDelete(sess) {
		return errForbidden
	}
	items, err := s.db.Trash(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	n := 0
	for _, it := range items {
		done, err := s.purge(r.Context(), sess.Workspace.ID, it.Type, it.ID)
		if err != nil {
			return err
		}
		if done {
			n++
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]int{"updated": n}))
	return nil
}

// purge deletes a Trash entry forever, rows first and then the objects; false when it is (or holds) a business record.
func (s *Service) purge(ctx context.Context, workspaceID, kind, id string) (bool, error) {
	var keys []string
	var done bool
	err := s.db.Tx(ctx, func(q store.Q) error {
		if kind == "folder" {
			var err error
			keys, done, err = q.PurgeFolder(ctx, workspaceID, id, s.today())
			return err
		}
		key, err := q.PurgeDocument(ctx, workspaceID, id, s.today())
		if key != "" {
			keys, done = []string{key}, true
		}
		return err
	})
	if err != nil {
		return false, err
	}
	s.removeObjects(ctx, keys...)
	return done, nil
}

// removeObjects deletes objects whose rows are gone; a failure only leaves an orphan in the bucket.
func (s *Service) removeObjects(ctx context.Context, keys ...string) {
	ctx, cancel := uploads.CleanupContext(ctx)
	defer cancel()
	for _, key := range keys {
		if err := s.files.Delete(ctx, key); err != nil {
			s.log.WarnContext(ctx, "orphaned object", "key", key, "error", err)
		}
	}
}

type skip struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

func (s *Service) bulk(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Action      string          `json:"action"`
		DocumentIDs []string        `json:"document_ids"`
		FolderIDs   []string        `json:"folder_ids"`
		FolderID    json.RawMessage `json:"folder_id"`
		OnConflict  string          `json:"on_conflict"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	switch n := len(body.DocumentIDs) + len(body.FolderIDs); {
	case n == 0:
		return validationFailed(map[string]string{"ids": "Choose at least one item."})
	case n > 500:
		return validationFailed(map[string]string{"ids": "Choose at most 500 items at a time."})
	}
	mode, err := onConflict(body.OnConflict)
	if err != nil {
		return err
	}
	var target *string
	switch body.Action {
	case "move":
		if target, err = container(s.db.Q, r.Context(), sess, body.FolderID, "folder_id"); err != nil {
			return err
		}
	case "trash", "restore":
	case "delete":
		if !canDelete(sess) {
			return errForbidden
		}
	default:
		return validationFailed(map[string]string{"action": "Use move, trash, restore or delete."})
	}

	updated, skipped := 0, []skip{}
	apply := func(id string, fn func() error) error {
		err := fn()
		var p *problem
		switch {
		case err == nil:
			updated++
		case errors.Is(err, store.ErrNotFound):
			skipped = append(skipped, skip{id, "Not found."})
		case errors.As(err, &p):
			skipped = append(skipped, skip{id, p.reason})
		default:
			return err
		}
		return nil
	}
	for _, id := range body.FolderIDs {
		if err := apply(id, func() error { return s.bulkFolder(r.Context(), sess, body.Action, id, target, mode) }); err != nil {
			return err
		}
	}
	for _, id := range body.DocumentIDs {
		if err := apply(id, func() error { return s.bulkFile(r.Context(), sess, body.Action, id, target, mode) }); err != nil {
			return err
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"updated": updated, "skipped": skipped}))
	return nil
}

func (s *Service) bulkFolder(ctx context.Context, sess store.Session, action, id string, target *string, mode string) error {
	ws := sess.Workspace.ID
	if action == "delete" {
		done, err := s.purgeChecked(ctx, sess, "folder", id)
		if err != nil || done {
			return err
		}
		return errRetained
	}
	return s.db.Tx(ctx, func(q store.Q) error {
		switch action {
		case "move":
			f, err := q.DocumentFolder(ctx, ws, id)
			if err != nil {
				return err
			}
			return s.placeFolder(q, ctx, sess, id, f.Name, target, mode)
		case "trash":
			if _, err := q.DocumentFolder(ctx, ws, id); err != nil {
				return err
			}
			retained, err := q.FolderRetained(ctx, ws, id, s.today())
			if err != nil {
				return err
			}
			if retained {
				return refuse(http.StatusConflict, "retained", "It holds business records, which are kept for 10 years.", nil)
			}
			return q.TrashFolder(ctx, ws, id, sess.User.ID, s.now())
		default: // restore
			name, parent, err := q.TrashedFolder(ctx, ws, id)
			if errors.Is(err, store.ErrNotFound) {
				return errNotInTrash
			} else if err != nil {
				return err
			}
			if err := q.LockContainer(ctx, ws, parent); err != nil {
				return err
			}
			if name, err = q.FreeFolderName(ctx, ws, parent, name); err != nil {
				return err
			}
			return q.RestoreFolder(ctx, ws, id, name, parent, s.now())
		}
	})
}

func (s *Service) bulkFile(ctx context.Context, sess store.Session, action, id string, target *string, mode string) error {
	ws := sess.Workspace.ID
	if action == "delete" {
		done, err := s.purgeChecked(ctx, sess, "file", id)
		if err != nil || done {
			return err
		}
		return errRetained
	}
	return s.db.Tx(ctx, func(q store.Q) error {
		d, err := q.Document(ctx, ws, id)
		if err != nil {
			return err
		}
		switch action {
		case "move":
			if d.DeletedAt != nil {
				return errTrashed
			}
			name, err := s.placeFile(q, ctx, sess, d.ID, d.Name, target, mode)
			if err != nil {
				return err
			}
			return q.UpdateDocument(ctx, ws, d.ID, name, target, s.now())
		case "trash":
			if d.DeletedAt != nil {
				return nil
			}
			trashed, err := q.TrashDocument(ctx, ws, d.ID, sess.User.ID, s.today(), s.now())
			if err == nil && !trashed {
				return errRetained
			}
			return err
		default: // restore
			if d.DeletedAt == nil || d.TrashedWith != nil {
				return refuse(http.StatusConflict, "not_trashed", "Restore the folder it was in.", nil)
			}
			folder := d.FolderID
			if d.Folder == nil { // its folder is gone or in the Trash
				folder = nil
			}
			if err := q.LockContainer(ctx, ws, folder); err != nil {
				return err
			}
			name, err := q.FreeFileName(ctx, ws, folder, d.Name)
			if err != nil {
				return err
			}
			return q.RestoreDocument(ctx, ws, d.ID, name, folder)
		}
	})
}

// purgeChecked deletes a Trash entry forever after checking it is one.
func (s *Service) purgeChecked(ctx context.Context, sess store.Session, kind, id string) (bool, error) {
	items, err := s.db.Trash(ctx, sess.Workspace.ID)
	if err != nil {
		return false, err
	}
	if !slices.ContainsFunc(items, func(t store.TrashItem) bool { return t.Type == kind && t.ID == id }) {
		return false, errNotInTrash
	}
	return s.purge(ctx, sess.Workspace.ID, kind, id)
}
