package expenses

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"path"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/retention"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/tags"
	fileuploads "helvetly.com/api/internal/uploads"
)

const (
	maxFiles    = 10
	maxFileSize = fileuploads.MaxFileBytes
)

// receiptType: the content type to store for a receipt with this name and these first bytes, or "" when the
// file is not a PDF or an image a phone or scanner makes. The bytes decide, never the name alone.
func receiptType(name string, head []byte) string {
	ext := strings.ToLower(path.Ext(name))
	sniffed := http.DetectContentType(head)
	switch {
	case ext == ".pdf" && sniffed == "application/pdf":
		return "application/pdf"
	case ext == ".png" && sniffed == "image/png":
		return "image/png"
	case (ext == ".jpg" || ext == ".jpeg") && sniffed == "image/jpeg":
		return "image/jpeg"
	case ext == ".webp" && sniffed == "image/webp":
		return "image/webp"
	case (ext == ".heic" || ext == ".heif") && len(head) >= 12 && bytes.Equal(head[4:8], []byte("ftyp")) &&
		bytes.Contains([]byte(" heic heix heim heis hevc mif1 msf1 "), append(append([]byte(" "), head[8:12]...), ' ')):
		return "image/heic"
	}
	return ""
}

// displayName: the uploaded name without any path or control characters, at most 255 characters.
func displayName(name string) string {
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, path.Base(strings.ReplaceAll(name, `\`, "/")))
	name = strings.TrimSpace(name)
	if runes := []rune(name); len(runes) > 255 {
		name = string(runes[:255])
	}
	if name == "" || name == "." || name == "/" {
		return "receipt"
	}
	return name
}

// keyName: the display name reduced to characters safe in an object key.
func keyName(name string) string {
	safe := strings.Map(func(r rune) rune {
		if r < utf8.RuneSelf && (unicode.IsLetter(r) || unicode.IsDigit(r) || r == '.' || r == '-' || r == '_') {
			return r
		}
		return '_'
	}, name)
	if len(safe) > 100 {
		safe = safe[len(safe)-100:] // keep the extension
	}
	return safe
}

func (s *Service) expense(r *http.Request, sess store.Session) (store.Expense, error) {
	return s.db.Expense(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), false)
}

func (s *Service) listReceipts(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	e, err := s.expense(r, sess)
	if err != nil {
		return err
	}
	list, err := s.db.Receipts(r.Context(), e.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

type upload struct {
	header   *multipart.FileHeader
	receipt  store.Receipt
	docID    string // the linked copy in Documents
	linkOnly bool   // a Document with these bytes existed: no copy is stored
}

func (u upload) docKey(workspaceID string) string { return workspaceID + "/documents/" + u.docID }

func (s *Service) uploadReceipts(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	e, err := s.expense(r, sess)
	if err != nil {
		return err
	}
	if e.Status == "void" {
		return invalidState("A voided expense takes no more receipts.")
	}
	r.Body = http.MaxBytesReader(w, r.Body, fileuploads.MaxRequestBytes)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return auth.Error(http.StatusRequestEntityTooLarge, "payload_too_large",
				"Send at most 95 MB per request, in receipts of up to 25 MB each.", nil)
		}
		return badRequest("Send the receipts as multipart/form-data in files[].")
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()

	headers := r.MultipartForm.File["files[]"]
	switch {
	case len(headers) == 0:
		return validationFailed(map[string]string{"files": "Choose at least one receipt."})
	case len(headers) > maxFiles:
		return validationFailed(map[string]string{"files": fmt.Sprintf("Upload at most %d receipts at a time.", maxFiles)})
	}
	now := s.now()
	uploads := make([]upload, len(headers))
	sums := make([]string, len(headers))
	sizes := make([]int64, len(headers))
	seen := map[string]string{}
	for i, h := range headers { // check every file before storing any
		name := displayName(h.Filename)
		if h.Size > maxFileSize {
			return validationFailed(map[string]string{"files": name + " is larger than 25 MB."})
		}
		head, err := readHead(h)
		if err != nil {
			return err
		}
		ct := receiptType(name, head)
		if ct == "" {
			return validationFailed(map[string]string{"files": name + " is not a receipt we can keep: use PDF, JPEG, PNG, WebP or HEIC."})
		}
		id := auth.NewID("rcp")
		sum, err := fileuploads.Hash(h)
		if err != nil {
			return err
		}
		if err := fileuploads.CheckBatch(seen, sum, name); err != nil {
			return err
		}
		sums[i] = sum
		sizes[i] = h.Size
		uploads[i] = upload{header: h, docID: auth.NewID("doc"), receipt: store.Receipt{ID: id, Name: name, Size: h.Size, ContentType: ct, CreatedAt: now,
			SHA256:     sum,
			UploadedBy: &store.Uploader{ID: sess.User.ID, Name: sess.User.Name},
			ObjectKey:  "workspaces/" + sess.Workspace.ID + "/expenses/" + e.ID + "/" + id + "/" + keyName(name)}}
	}

	var stored []string
	cleanup := func() {
		ctx, cancel := fileuploads.CleanupContext(r.Context())
		defer cancel()
		for _, key := range stored {
			if err := s.files.Delete(ctx, key); err != nil {
				s.log.WarnContext(ctx, "orphaned upload", "key", key, "error", err)
			}
		}
	}
	// An unlocked look spares storing a known duplicate; the check under the lock decides. Objects are stored before
	// the transaction, so no lock waits on the uploads, and locked (GeBüV) only once a booked expense's rows commit.
	for i, sum := range sums { // another expense's receipt is a duplicate expense; a Document is reused instead
		if duplicate, err := s.db.DuplicateReceipt(r.Context(), sess.Workspace.ID, sum); err == nil {
			return fileuploads.Duplicate(sess, duplicate)
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		if _, _, _, err := s.db.LiveDocumentBySum(r.Context(), sess.Workspace.ID, sum); err == nil {
			uploads[i].linkOnly = true
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
	}
	for _, u := range uploads {
		// counted before the write, so a full workspace sends no bytes to storage
		if err := s.db.ReserveObject(r.Context(), sess.Workspace.ID, u.receipt.ObjectKey, u.receipt.Size, true, s.now()); err != nil {
			cleanup()
			return err
		}
		stored = append(stored, u.receipt.ObjectKey)
		if err := s.put(r, u, u.receipt.ObjectKey); err != nil {
			cleanup()
			return err
		}
		if u.linkOnly {
			continue
		}
		if err := s.db.ReserveObject(r.Context(), sess.Workspace.ID, u.docKey(sess.Workspace.ID), u.receipt.Size, true, s.now()); err != nil {
			cleanup()
			return err
		}
		stored = append(stored, u.docKey(sess.Workspace.ID))
		if err := s.put(r, u, u.docKey(sess.Workspace.ID)); err != nil {
			cleanup()
			return err
		}
	}
	list := make([]store.Receipt, len(uploads))
	booked := false
	var unusedKeys []string
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockUploadHashes(r.Context(), sess.Workspace.ID, sums); err != nil {
			return err
		}
		if err := fileuploads.Backfill(r.Context(), q, sess.Workspace.ID, sizes, s.files.Open); err != nil {
			return err
		}
		for _, sum := range sums {
			duplicate, err := q.DuplicateReceipt(r.Context(), sess.Workspace.ID, sum)
			if err == nil {
				return fileuploads.Duplicate(sess, duplicate)
			}
			if !errors.Is(err, store.ErrNotFound) {
				return err
			}
		}
		current, err := q.Expense(r.Context(), sess.Workspace.ID, e.ID, s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		if current.Status == "void" {
			return invalidState("A voided expense takes no more receipts.")
		}
		booked = current.Status == "booked"
		day := ""
		if current.DocumentDate != nil {
			day = *current.DocumentDate
		}
		for i, u := range uploads {
			if err := q.CreateReceipt(r.Context(), sess.Workspace.ID, e.ID, sess.User.ID, u.receipt); err != nil {
				return err
			}
			if booked {
				if err := retention.Request(r.Context(), q, s.files, sess.Workspace.ID, u.receipt.ObjectKey, day, s.now()); err != nil {
					return err
				}
			}
			unused, err := s.fileCopy(r.Context(), q, sess, current, u)
			if err != nil {
				return err
			}
			if unused != "" && !u.linkOnly {
				unusedKeys = append(unusedKeys, unused)
			}
			list[i] = u.receipt
		}
		return nil
	})
	if err != nil {
		cleanup()
		return err
	}
	for _, key := range unusedKeys { // stored, then a Document with the bytes appeared: no duplicate in Documents
		if err := s.files.Delete(r.Context(), key); err != nil {
			s.log.WarnContext(r.Context(), "orphaned upload", "key", key, "error", err)
		}
	}
	if booked {
		for _, u := range uploads {
			s.retain(r.Context(), u.receipt.ObjectKey)
		}
	}
	auth.WriteJSON(w, http.StatusCreated, data(list))
	return nil
}

// fileCopy keeps the receipt in Documents, linked to the expense. A live Document with the same bytes is reused (Documents
// hold no duplicates): moved to Expenses/<year>/<category> only while no person has placed it. Otherwise the stored
// copy becomes the Document. Returns the copy's key when it turned out unneeded.
func (s *Service) fileCopy(ctx context.Context, q store.Q, sess store.Session, e store.Expense, u upload) (unused string, err error) {
	ws, now := sess.Workspace.ID, s.now()
	folder, err := q.FolderPath(ctx, ws, sess.User.ID, store.ExpenseFolder(e.DocumentDate, s.today(sess.Workspace), categoryName(e)), now)
	if err != nil {
		return "", err
	}
	tags := func(id string, existing []string) error {
		return q.SetDocumentTags(ctx, ws, id, expenseTags(existing, categoryName(e)), now)
	}
	id, at, unplaced, err := q.LiveDocumentBySum(ctx, ws, u.receipt.SHA256)
	switch {
	case err == nil:
		if err := q.AddDocumentLink(ctx, ws, id, "expense", e.ID, sess.User.ID, now); err != nil {
			return "", err
		}
		if unplaced && (at == nil || *at != folder) {
			doc, err := q.Document(ctx, ws, id)
			if err != nil {
				return "", err
			}
			name, err := q.FreeFileName(ctx, ws, &folder, doc.Name)
			if err != nil {
				return "", err
			}
			if err := q.UpdateDocument(ctx, ws, id, name, &folder, now); err != nil {
				return "", err
			}
			return u.docKey(ws), tags(id, doc.Tags)
		}
		return u.docKey(ws), nil
	case !errors.Is(err, store.ErrNotFound):
		return "", err
	case u.linkOnly: // the Document was trashed meanwhile and no copy was stored: the receipt alone stands
		return "", nil
	}
	name, err := q.FreeFileName(ctx, ws, &folder, u.receipt.Name)
	if err != nil {
		return "", err
	}
	sum := u.receipt.SHA256
	// One timestamp for file and link marks this copy as made with the receipt (see ExpenseDocument.OwnCopy).
	if err := q.CreateDocument(ctx, ws, sess.User.ID, store.Document{ID: u.docID, Name: name, FolderID: &folder,
		Size: u.receipt.Size, ContentType: u.receipt.ContentType, SHA256: &sum, ObjectKey: u.docKey(ws), CreatedAt: now}); err != nil {
		return "", err
	}
	if err := q.AddDocumentLink(ctx, ws, u.docID, "expense", e.ID, sess.User.ID, now); err != nil {
		return "", err
	}
	return "", tags(u.docID, nil)
}

func categoryName(e store.Expense) string {
	if e.CategoryID == nil || e.Category == nil {
		return ""
	}
	return e.Category.Name
}

// expenseTags: the tags plus "expense" and the category as a tag ("Büromaterial" → bueromaterial), at most 10.
func expenseTags(have []string, category string) []string {
	out := slices.Clone(have)
	for _, t := range []string{"expense", tags.Slug(category)} {
		if t != "" && len(out) < 10 && !slices.Contains(out, t) {
			out = append(out, t)
		}
	}
	return out
}

func readHead(h *multipart.FileHeader) ([]byte, error) {
	f, err := h.Open()
	if err != nil {
		return nil, fmt.Errorf("open upload: %w", err)
	}
	defer f.Close()
	head := make([]byte, 512)
	n, err := io.ReadFull(f, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("read upload: %w", err)
	}
	return head[:n], nil
}

func (s *Service) put(r *http.Request, u upload, key string) error {
	f, err := u.header.Open()
	if err != nil {
		return fmt.Errorf("open upload: %w", err)
	}
	defer f.Close()
	return s.files.Put(r.Context(), key, f, u.receipt.Size, u.receipt.ContentType, u.receipt.Name)
}

// downloadReceipt redirects to a short-lived link; ?inline=1 serves the bytes for the in-app preview (the stored
// objects download as attachments, which an <iframe> would not show).
func (s *Service) downloadReceipt(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	e, err := s.expense(r, sess)
	if err != nil {
		return err
	}
	f, err := s.db.Receipt(r.Context(), e.ID, r.PathValue("receipt_id"))
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if r.URL.Query().Get("inline") == "1" {
		b, err := s.files.Get(r.Context(), f.ObjectKey)
		if err != nil {
			return err
		}
		w.Header().Set("Content-Type", f.ContentType) // one of the sniffed receipt types, never HTML
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": f.Name}))
		_, _ = w.Write(b)
		return nil
	}
	return storage.Serve(w, r, s.files, sess.Workspace.ID, f.ObjectKey, f.Name, f.ContentType)
}

// deleteReceipt: drafts only (a booked expense keeps its evidence). Row and object go together: if the object
// cannot be removed, the row stays.
func (s *Service) deleteReceipt(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		e, err := q.Expense(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), true)
		if err != nil {
			return err
		}
		if e.Status != "draft" {
			return invalidState("A booked expense keeps its receipts.")
		}
		f, err := q.Receipt(r.Context(), e.ID, r.PathValue("receipt_id"))
		if err != nil {
			return err
		}
		if err := q.DeleteReceipt(r.Context(), e.ID, f.ID); err != nil {
			return err
		}
		// The linked copy in Documents goes to the Trash with it, so the same file can be uploaded again.
		docs, err := q.ExpenseDocuments(r.Context(), sess.Workspace.ID, e.ID)
		if err != nil {
			return err
		}
		for _, d := range docs {
			if d.SHA256 == nil || *d.SHA256 != f.SHA256 {
				continue
			}
			if !d.OwnCopy { // a Document that was there before only loses its link
				if err := q.RemoveDocumentLink(r.Context(), d.ID, "expense", e.ID); err != nil {
					return err
				}
				continue
			}
			if _, err := q.TrashDocument(r.Context(), sess.Workspace.ID, d.ID, sess.User.ID, s.today(sess.Workspace), s.now()); err != nil {
				return err
			}
		}
		return s.files.Delete(r.Context(), f.ObjectKey)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
