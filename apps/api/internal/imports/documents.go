package imports

import (
	"io"
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

// fromDocuments starts an auto import of files already kept in Documents: the batch an upload of the same bytes would
// make, every file reused, so nothing is stored or counted against storage again.
func (s *Service) fromDocuments(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !s.limit.Allow(r) {
		return auth.Error(http.StatusTooManyRequests, "rate_limited", "Wait a minute before starting another import.", nil)
	}
	var body struct {
		DocumentIDs []string `json:"document_ids"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if len(body.DocumentIDs) == 0 || len(body.DocumentIDs) > maxFiles {
		return invalid("Choose 1 to 25 files.")
	}
	for _, scope := range append(scopesFor(autoKind), "read:documents") {
		if err := need(sess, scope); err != nil {
			return err
		}
	}
	ctx := r.Context()
	if err := s.gate(ctx, s.db.Q, sess.Workspace.ID, sess.User.ID); err != nil {
		return err
	}
	list := make([]upload, 0, len(body.DocumentIDs))
	seen := map[string]bool{}
	var total int64
	for _, id := range body.DocumentIDs {
		d, err := s.db.Document(ctx, sess.Workspace.ID, id) // never an HR file, never another workspace's
		if err != nil {
			return err
		}
		if d.DeletedAt != nil {
			return invalid(d.Name + " is in the Trash. Restore it first.")
		}
		// The bytes are held while the batch is made, as an upload's are: the same bound in all.
		if total += d.Size; total > uploads.MaxRequestBytes {
			return auth.Error(http.StatusRequestEntityTooLarge, "payload_too_large", "Choose at most 25 files of 25 MB each, 95 MB in all.", nil)
		}
		u, err := readUpload(d.Name, d.Size, func() (io.ReadCloser, error) { return s.files.Open(ctx, d.ObjectKey) })
		if err != nil {
			return err
		}
		if seen[u.sum] { // the same bytes twice are read once
			continue
		}
		seen[u.sum] = true
		u.reused, u.documentID, u.key = true, d.ID, d.ObjectKey
		list = append(list, u)
	}
	if err := s.fits(ctx, sess.Workspace.ID, list); err != nil {
		return err
	}
	batch := store.ImportBatch{ID: auth.NewID("imp"), WorkspaceID: sess.Workspace.ID, UserID: sess.User.ID, Kind: autoKind.Name}
	err := s.db.Tx(ctx, func(q store.Q) error { return q.CreateImportBatch(ctx, batch, importFiles(list), s.now()) })
	if err != nil {
		return err
	}
	b, err := s.db.ImportBatch(ctx, sess.Workspace.ID, sess.User.ID, batch.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, map[string]any{"data": b})
	return nil
}
