package documents

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"slices"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

// Staged upload: Documents' Upload first stages every file (the upload's usual checks, hashing, storage admission
// and duplicate refusal; no Document yet, so nothing lists it), then the person either files the batch where they are
// ("Just upload", with the usual AI filing) or lets the AI propose a place for each file and applies the rows they
// keep. Cancelling, or leaving a batch for store.StagedExpiry, deletes the files. A batch is its member's own.
// Session-only: none of these routes is a public operation or an MCP tool.

// stagedBatchID: the batch id the platform makes for one upload (a UUID).
var stagedBatchID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

func (s *Service) registerStaged(handle func(string, handler)) {
	handle("POST /api/v1/documents/staged", s.stage)
	handle("POST /api/v1/documents/staged/{batch}/cancel", s.cancelStaged)
	handle("POST /api/v1/documents/staged/{batch}/analyze", s.analyzeStaged)
	handle("POST /api/v1/documents/staged/{batch}/confirm", s.confirmStaged)
}

func batchParam(r *http.Request) (string, error) {
	batch := r.PathValue("batch")
	if !stagedBatchID.MatchString(batch) {
		return "", store.ErrNotFound
	}
	return batch, nil
}

// stage stores one file of a batch. The same bytes as a live Document, or as a file already in the batch, are
// refused (409 duplicate_file) before anything is stored, and again under the hash lock.
func (s *Service) stage(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	form, h, name, ct, err := s.receive(w, r)
	if form != nil {
		defer func() { _ = form.RemoveAll() }()
	}
	if err != nil {
		return err
	}
	batch := formValue(form, "batch_id")
	if !stagedBatchID.MatchString(batch) {
		return validationFailed(map[string]string{"batch_id": "Send the upload's batch id."})
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	sum, err := uploads.Hash(h)
	if err != nil {
		return err
	}
	duplicate := func(q store.Q) error {
		if d, err := q.DuplicateUpload(ctx, ws, sum); err == nil {
			return uploads.Duplicate(sess, d)
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		first, err := q.StagedInBatch(ctx, ws, sess.User.ID, batch, sum)
		if err != nil || first == "" {
			return err
		}
		return uploads.CheckBatch(map[string]string{sum: first}, sum, name)
	}
	if err := duplicate(s.db.Q); err != nil { // spares storing a known duplicate; the check under the lock decides
		return err
	}
	u := store.StagedUpload{ID: auth.NewID("doc"), WorkspaceID: ws, UserID: sess.User.ID, Purpose: "documents",
		BatchID: batch, Name: name, Size: h.Size, ContentType: ct, SHA256: sum, CreatedAt: s.now()}
	u.ObjectKey = objectKey(sess, u.ID, name)
	if err := s.db.ReserveObject(ctx, ws, u.ObjectKey, h.Size, true, s.now()); err != nil {
		return err
	}
	if err := s.put(r, h, u.ObjectKey, ct, name); err != nil {
		s.removeObjects(ctx, u.ObjectKey)
		return err
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockUploadHashes(ctx, ws, []string{sum}); err != nil {
			return err
		}
		if err := uploads.Backfill(ctx, q, ws, []int64{h.Size}, s.files.Open); err != nil {
			return err
		}
		if err := duplicate(q); err != nil {
			return err
		}
		return q.CreateStagedUpload(ctx, u)
	})
	if err != nil {
		s.removeObjects(ctx, u.ObjectKey)
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(u))
	return nil
}

// cancelStaged deletes the member's staged files of a batch and their objects; cancelling twice is fine.
func (s *Service) cancelStaged(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	batch, err := batchParam(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	var keys []string
	err = s.db.Tx(ctx, func(q store.Q) error {
		list, err := q.StagedBatch(ctx, sess.Workspace.ID, sess.User.ID, batch, true)
		if err != nil {
			return err
		}
		keys, err = q.DeleteStaged(ctx, sess.Workspace.ID, stagedIDs(list))
		return err
	})
	if err != nil {
		return err
	}
	s.removeObjects(ctx, keys...)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func stagedIDs(list []store.StagedUpload) []string {
	ids := make([]string, len(list))
	for i, u := range list {
		ids[i] = u.ID
	}
	return ids
}

// stagedDocument is a staged file as the filing logic reads a Document: not yet anywhere, about to go to folder.
func stagedDocument(u store.StagedUpload, folder *string) store.Document {
	sum := u.SHA256
	return store.Document{ID: u.ID, FolderID: folder, Name: u.Name, Size: u.Size, ContentType: u.ContentType,
		SHA256: &sum, ObjectKey: u.ObjectKey, CreatedAt: u.CreatedAt, Tags: []string{}}
}

// analyzeStaged proposes a place for some of a batch's files (the platform asks a few at a time, to show progress), as
// Organize with AI does for stored ones: a record it is decides, else the model, from the automation pool. Nothing
// changes; a file's proposal keeps folder_id when nothing better fits.
func (s *Service) analyzeStaged(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	batch, err := batchParam(r)
	if err != nil {
		return err
	}
	var body struct {
		IDs      []string `json:"ids"`
		FolderID *string  `json:"folder_id"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if s.filer == nil {
		return auth.Error(http.StatusServiceUnavailable, "ai_unavailable", "AI isn't available on this server.", nil)
	}
	if len(body.IDs) == 0 || len(body.IDs) > organizeMax {
		return validationFailed(map[string]string{"ids": "Choose 1 to 150 files."})
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	if err := s.filingGate(ctx, s.db.Q, ws, sess.User.ID); err != nil {
		return err
	}
	if body.FolderID != nil {
		if err := liveFolder(s.db.Q, ctx, sess, *body.FolderID, "folder_id"); err != nil {
			return err
		}
	}
	list, err := s.db.StagedBatch(ctx, ws, sess.User.ID, batch, false)
	if err != nil {
		return err
	}
	docs := []store.Document{}
	for _, u := range list {
		if slices.Contains(body.IDs, u.ID) {
			docs = append(docs, stagedDocument(u, body.FolderID))
		}
	}
	if len(docs) == 0 {
		return store.ErrNotFound
	}
	folders, err := s.db.DocumentFolders(ctx, ws, sess.User.ID)
	if err != nil {
		return err
	}
	proposals, considered, err := s.propose(ctx, sess, requestLanguage(r), docs, folders)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"proposals": proposals, "considered": considered}))
	return nil
}

// confirmStaged files the member's whole batch at once: each file becomes a Document in folder_id (the top level when
// none), and the rows of items then move to their proposed paths with their tags and kind, as an applied organize
// does. Without items ("Just upload") the files are queued for AI filing as any upload; with them nothing is queued.
// A file whose bytes became a Document meanwhile is not stored twice (duplicates). Audited as documents.upload_filed.
func (s *Service) confirmStaged(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	batch, err := batchParam(r)
	if err != nil {
		return err
	}
	var body struct {
		FolderID *string        `json:"folder_id"`
		Items    []organizeItem `json:"items"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	paths, err := checkItems(body.Items)
	if err != nil {
		return err
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	names, err := s.recordNames(ctx, ws)
	if err != nil {
		return err
	}
	var created []string
	var duplicates []store.StagedUpload
	var dropped []string
	moved := 0
	err = s.db.Tx(ctx, func(q store.Q) error {
		created, duplicates, dropped, moved = nil, []store.StagedUpload{}, nil, 0
		list, err := q.StagedBatch(ctx, ws, sess.User.ID, batch, true)
		if err != nil {
			return err
		}
		if len(list) == 0 {
			return store.ErrNotFound
		}
		if body.FolderID != nil {
			if err := q.LockContainer(ctx, ws, body.FolderID); err != nil {
				return err
			}
			if err := liveFolder(q, ctx, sess, *body.FolderID, "folder_id"); err != nil {
				return err
			}
		}
		sums := make([]string, len(list))
		for i, u := range list {
			sums[i] = u.SHA256
		}
		if err := q.LockUploadHashes(ctx, ws, sums); err != nil {
			return err
		}
		for _, u := range list {
			if _, err := q.DuplicateUpload(ctx, ws, u.SHA256); err == nil {
				duplicates = append(duplicates, u)
				continue
			} else if !errors.Is(err, store.ErrNotFound) {
				return err
			}
			name, err := s.placeFile(q, ctx, sess, "", u.Name, body.FolderID, "keep_both")
			if err != nil {
				return err
			}
			d := stagedDocument(u, body.FolderID)
			d.Name = name
			if err := q.CreateDocument(ctx, ws, sess.User.ID, d); err != nil {
				return err
			}
			created = append(created, u.ID)
		}
		if err := q.ForgetStaged(ctx, ws, created); err != nil {
			return err
		}
		if dropped, err = q.DeleteStaged(ctx, ws, stagedIDs(duplicates)); err != nil {
			return err
		}
		var keep []organizeItem
		var keepPaths [][]string
		for i, it := range body.Items { // only this batch's files
			if slices.Contains(created, it.DocumentID) {
				keep, keepPaths = append(keep, it), append(keepPaths, paths[i])
			}
		}
		if moved, _, _, err = s.applyItems(ctx, q, sess, keep, keepPaths, names); err != nil {
			return err
		}
		payload, err := json.Marshal(map[string]any{"batch_id": batch, "files": len(created), "placed_by_ai": len(keep),
			"moved": moved, "duplicates": len(duplicates)})
		if err != nil {
			return err
		}
		actor := sess.User.ID
		return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: ws, Kind: "documents.upload_filed", SubjectType: "documents",
			SubjectID: batch, ActorID: &actor, At: s.now(), Payload: payload})
	})
	if err != nil {
		return err
	}
	s.removeObjects(ctx, dropped...)
	if len(body.Items) == 0 {
		for _, id := range created {
			s.queueFiling(ctx, sess, id, body.FolderID == nil, requestLanguage(r))
		}
	}
	docs := make([]store.Document, 0, len(created))
	for _, id := range created {
		d, err := s.document(ctx, sess, id)
		if err != nil {
			return err
		}
		localizeDocument(r, &d)
		docs = append(docs, d)
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"documents": docs, "duplicates": duplicates}))
	return nil
}

// ExpireStaged deletes the staged files nobody confirmed within store.StagedExpiry (an open import's sources wait for
// the import's own expiry), a page at a time; storage releases their bytes once it confirms each delete.
func (s *Service) ExpireStaged(ctx context.Context) {
	for ctx.Err() == nil {
		keys, err := s.db.ClaimExpiredStaged(ctx, s.now().Add(-store.StagedExpiry), 100)
		if err != nil {
			s.log.ErrorContext(ctx, "expire staged uploads", "error", err)
			return
		}
		s.removeObjects(ctx, keys...)
		if len(keys) < 100 {
			return
		}
	}
}

// StageLegacySources takes the files earlier imports kept in Documents only as their source (a ZIP or CSV nobody
// placed, tagged, linked or shared, and no record's original) out of Documents into the staging area, from where the
// staged expiry deletes them a day later; audited per workspace. Idempotent.
func (s *Service) StageLegacySources(ctx context.Context) error {
	workspaces, err := s.db.LegacySourceWorkspaces(ctx)
	if err != nil {
		return err
	}
	for _, ws := range workspaces {
		var n int
		if err := s.db.Tx(ctx, func(q store.Q) error {
			n, err = q.StageLegacySources(ctx, ws, s.now())
			return err
		}); err != nil {
			return err
		}
		s.log.InfoContext(ctx, "import sources taken out of Documents", "workspace", ws, "files", n)
	}
	return nil
}
