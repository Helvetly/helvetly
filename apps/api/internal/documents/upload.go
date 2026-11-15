package documents

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

func contentDisposition(kind, name string) string {
	return mime.FormatMediaType(kind, map[string]string{"filename": name})
}

// upload hashes the spooled multipart file before storing it; matching uploads serialize across APIs and instances.
func (s *Service) upload(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	limitMB := s.maxSize >> 20
	tooLarge := refuse(http.StatusRequestEntityTooLarge, "payload_too_large", fmt.Sprintf("Upload files of up to %d MB.", limitMB), nil)
	r.Body = http.MaxBytesReader(w, r.Body, min(s.maxSize+1<<20, uploads.MaxRequestBytes))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return tooLarge
		}
		return badRequest("Send the file as multipart/form-data in file.")
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	form := r.MultipartForm
	if len(form.File["file"]) != 1 {
		return validationFailed(map[string]string{"file": "Send one file per request."})
	}
	h := form.File["file"][0]
	if h.Size > s.maxSize {
		return tooLarge
	}
	mode, err := onConflict(formValue(form, "on_conflict"))
	if err != nil {
		return err
	}
	name := displayName(h.Filename)
	head, err := readHead(h)
	if err != nil {
		return err
	}
	ct := detectType(name, head)
	if ct == "" {
		return validationFailed(map[string]string{"file": name + " is not a supported file: use PDF, images, Office or " +
			"OpenDocument files, CSV, text, XML, JSON or ZIP."})
	}
	var folder *string
	if id := formValue(form, "folder_id"); id != "" {
		if err := liveFolder(s.db.Q, r.Context(), sess, id, "folder_id"); err != nil {
			return err
		}
		folder = &id
	}
	clientID := formValue(form, "client_id")
	if clientID != "" {
		ok, err := s.db.LinkTargetExists(r.Context(), sess.Workspace.ID, "client", clientID)
		if err != nil {
			return err
		}
		if !ok {
			return validationFailed(map[string]string{"client_id": "This client doesn't exist."})
		}
	}

	id := auth.NewID("doc")
	key := objectKey(sess, id, name)
	sum, err := uploads.Hash(h)
	if err != nil {
		return err
	}
	// an unlocked look first spares storing a known duplicate; the check under the lock below decides
	if duplicate, err := s.db.DuplicateUpload(r.Context(), sess.Workspace.ID, sum); err == nil {
		return uploads.Duplicate(sess, duplicate)
	} else if !errors.Is(err, store.ErrNotFound) {
		return err
	}
	// stored before the transaction, so no row lock waits on the upload; no row points at it until the commit
	if err := s.put(r, h, key, ct, name); err != nil {
		s.removeObjects(r.Context(), key)
		return err
	}
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockUploadHashes(r.Context(), sess.Workspace.ID, []string{sum}); err != nil {
			return err
		}
		if clientID != "" {
			found, err := q.LockClient(r.Context(), sess.Workspace.ID, clientID)
			if err != nil {
				return err
			}
			if !found {
				return validationFailed(map[string]string{"client_id": "This client doesn't exist."})
			}
		}
		if err := uploads.Backfill(r.Context(), q, sess.Workspace.ID, []int64{h.Size}, s.files.Open); err != nil {
			return err
		}
		duplicate, err := q.DuplicateUpload(r.Context(), sess.Workspace.ID, sum)
		if err == nil {
			return uploads.Duplicate(sess, duplicate)
		}
		if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		final, err := s.placeFile(q, r.Context(), sess, "", name, folder, mode)
		if err != nil {
			return err
		}
		now := s.now()
		if err := q.CreateDocument(r.Context(), sess.Workspace.ID, sess.User.ID, store.Document{ID: id, FolderID: folder,
			Name: final, Size: h.Size, ContentType: ct, SHA256: &sum, ObjectKey: key, CreatedAt: now}); err != nil {
			return err
		}
		if clientID == "" {
			return nil
		}
		return q.AddDocumentLink(r.Context(), sess.Workspace.ID, id, "client", clientID, sess.User.ID, now)
	})
	if err != nil {
		s.removeObjects(r.Context(), key)
		return err
	}
	return s.writeDocument(w, r, sess, http.StatusCreated, id)
}

func formValue(form *multipart.Form, key string) string {
	if v := form.Value[key]; len(v) > 0 {
		return strings.TrimSpace(v[0])
	}
	return ""
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

func (s *Service) put(r *http.Request, h *multipart.FileHeader, key, contentType, name string) error {
	f, err := h.Open()
	if err != nil {
		return fmt.Errorf("open upload: %w", err)
	}
	defer f.Close()
	return s.files.Put(r.Context(), key, f, h.Size, contentType, name)
}
