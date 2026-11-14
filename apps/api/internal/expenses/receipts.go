package expenses

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/retention"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
	fileuploads "helvetly.com/api/internal/uploads"
)

const (
	maxFiles    = 10
	maxFileSize = 20 << 20
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
	header  *multipart.FileHeader
	receipt store.Receipt
}

func (s *Service) uploadReceipts(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	e, err := s.expense(r, sess)
	if err != nil {
		return err
	}
	if e.Status == "void" {
		return invalidState("A voided expense takes no more receipts.")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxFiles*maxFileSize+1<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return auth.Error(http.StatusRequestEntityTooLarge, "payload_too_large",
				fmt.Sprintf("Upload at most %d receipts of up to 20 MB each.", maxFiles), nil)
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
			return validationFailed(map[string]string{"files": name + " is larger than 20 MB."})
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
		uploads[i] = upload{h, store.Receipt{ID: id, Name: name, Size: h.Size, ContentType: ct, CreatedAt: now,
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
	for _, sum := range sums {
		if duplicate, err := s.db.DuplicateUpload(r.Context(), sess.Workspace.ID, sum); err == nil {
			return fileuploads.Duplicate(sess, duplicate)
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
	}
	for _, u := range uploads {
		stored = append(stored, u.receipt.ObjectKey)
		if err := s.put(r, u); err != nil {
			cleanup()
			return err
		}
	}
	list := make([]store.Receipt, len(uploads))
	booked := false
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockUploadHashes(r.Context(), sess.Workspace.ID, sums); err != nil {
			return err
		}
		if err := fileuploads.Backfill(r.Context(), q, sess.Workspace.ID, sizes, s.files.Open); err != nil {
			return err
		}
		for _, sum := range sums {
			duplicate, err := q.DuplicateUpload(r.Context(), sess.Workspace.ID, sum)
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
			list[i] = u.receipt
		}
		return nil
	})
	if err != nil {
		cleanup()
		return err
	}
	if booked {
		for _, u := range uploads {
			s.retain(r.Context(), u.receipt.ObjectKey)
		}
	}
	auth.WriteJSON(w, http.StatusCreated, data(list))
	return nil
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

func (s *Service) put(r *http.Request, u upload) error {
	f, err := u.header.Open()
	if err != nil {
		return fmt.Errorf("open upload: %w", err)
	}
	defer f.Close()
	return s.files.Put(r.Context(), u.receipt.ObjectKey, f, u.receipt.Size, u.receipt.ContentType, u.receipt.Name)
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
	return storage.Serve(w, r, s.files, f.ObjectKey, f.Name, f.ContentType)
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
		return s.files.Delete(r.Context(), f.ObjectKey)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
