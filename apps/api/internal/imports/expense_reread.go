package imports

import (
	"io"
	"net/http"
	"slices"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// expenseReread is POST /api/v1/expenses/{id}/read {request_id}: the draft's stored receipts (oldest first, up to
// five, as the pages of one document) are read again and the checked reading comes back for the person to compare;
// applying it is their own PATCH, which resets an open approval. Nothing is stored. A booked or void expense is
// refused: its figures are records.
func (s *Service) expenseReread(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.readerAdmitted(r, sess); err != nil {
		return err
	}
	var body struct {
		RequestID string `json:"request_id"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if !previewRequestID.MatchString(body.RequestID) {
		return invalid("Send a request_id of 8 to 64 letters, digits, - or _.")
	}
	ctx := r.Context()
	e, err := s.db.Expense(ctx, sess.Workspace.ID, r.PathValue("id"), sess.Workspace.Today(s.now()), false)
	if err != nil {
		return err
	}
	if e.Status != "draft" {
		return auth.Error(http.StatusConflict, "expense_not_draft", "Only a draft's receipts can be read again; this expense is booked or void.", nil)
	}
	receipts, err := s.db.Receipts(ctx, e.ID)
	if err != nil {
		return err
	}
	slices.Reverse(receipts) // the first uploaded is the first page
	var files []previewFile
	size := 0
	for _, rc := range receipts {
		if _, ok := receiptExt[rc.ContentType]; !ok || len(files) == previewMaxFiles {
			continue
		}
		f, err := s.files.Open(ctx, rc.ObjectKey)
		if err != nil {
			return err
		}
		data, err := io.ReadAll(io.LimitReader(f, int64(maxFileBytes-size+1)))
		_ = f.Close()
		if err != nil {
			return err
		}
		if size += len(data); size > maxFileBytes {
			return previewTooLarge
		}
		if err := checkPreviewFile(rc.ContentType, data); err != nil {
			return err
		}
		files = append(files, previewFile{contentType: rc.ContentType, data: data})
	}
	if len(files) == 0 {
		return auth.Error(http.StatusUnprocessableEntity, "no_readable_file", "This expense has no file that can be read (PDF, PNG, JPEG or WebP).", nil)
	}
	reading, err := s.readReceipt(ctx, sess, body.RequestID, files)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": reading})
	return nil
}
