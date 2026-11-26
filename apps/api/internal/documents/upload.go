package documents

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/permissions"
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
	if duplicate, err := s.db.DuplicateUpload(r.Context(), sess.Workspace.ID, sum); err == nil && duplicate.Resource == "document" {
		var reused string
		err := s.db.Tx(r.Context(), func(q store.Q) error {
			if err := q.LockUploadHashes(r.Context(), sess.Workspace.ID, []string{sum}); err != nil {
				return err
			}
			if clientID != "" {
				if found, err := q.LockClient(r.Context(), sess.Workspace.ID, clientID); err != nil {
					return err
				} else if !found {
					return validationFailed(map[string]string{"client_id": "This client doesn't exist."})
				}
			}
			var err error
			reused, err = s.reuse(q, r.Context(), sess, sum, folder, clientID)
			return err
		})
		if err != nil {
			return err
		}
		if reused != "" {
			return s.writeReused(w, r, sess, reused)
		}
	} else if err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	// counted before the write, so a full workspace sends no bytes to storage
	if err := s.db.ReserveObject(r.Context(), sess.Workspace.ID, key, h.Size, true, s.now()); err != nil {
		return err
	}
	// stored before the transaction, so no row lock waits on the upload; no row points at it until the commit
	if err := s.put(r, h, key, ct, name); err != nil {
		s.removeObjects(r.Context(), key)
		return err
	}
	var reused string
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
		if reused, err = s.reuse(q, r.Context(), sess, sum, folder, clientID); err != nil || reused != "" {
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
	if reused != "" { // an equal file was stored meanwhile: the copy just written is not kept
		s.removeObjects(r.Context(), key)
		return s.writeReused(w, r, sess, reused)
	}
	s.queueFiling(r.Context(), sess, id, folder == nil, requestLanguage(r))
	return s.writeDocument(w, r, sess, http.StatusCreated, id)
}

// reuse is the upload's answer when the workspace already holds a live Document with these bytes: that Document
// stays where it is (a top-level one moves into the folder the upload named) and is linked to the client sent. Run it
// in a transaction holding the hash lock; "" means no Document has the bytes (a receipt alone is no Documents duplicate).
func (s *Service) reuse(q store.Q, ctx context.Context, sess store.Session, sum string, folder *string, clientID string) (string, error) {
	d, err := q.DuplicateUpload(ctx, sess.Workspace.ID, sum)
	if errors.Is(err, store.ErrNotFound) || (err == nil && d.Resource != "document") {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !permissions.Allows(sess.Role, sess.Scopes, "read:documents") {
		return "", uploads.Duplicate(sess, d)
	}
	doc, err := q.Document(ctx, sess.Workspace.ID, d.ID)
	if err != nil {
		return "", err
	}
	now := s.now()
	if doc.FolderID == nil && folder != nil && !doc.MoveLocked(s.today()) {
		name, err := s.placeFile(q, ctx, sess, doc.ID, doc.Name, folder, "keep_both")
		if err != nil {
			return "", err
		}
		if err := q.UpdateDocument(ctx, sess.Workspace.ID, doc.ID, name, folder, now); err != nil {
			return "", err
		}
	}
	if clientID != "" {
		if err := q.AddDocumentLink(ctx, sess.Workspace.ID, doc.ID, "client", clientID, sess.User.ID, now); err != nil {
			return "", err
		}
	}
	return doc.ID, nil
}

// writeReused answers 200 with the existing Document and "reused": true beside "data".
func (s *Service) writeReused(w http.ResponseWriter, r *http.Request, sess store.Session, id string) error {
	d, err := s.document(r.Context(), sess, id)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": d, "reused": true})
	return nil
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
