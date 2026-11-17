package documents

import (
	"context"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

// HR files are documents of an employee (docs/planning/2026-11-15-employees.md): stored, typed, limited and hashed
// like any document, but kept out of the document system's lists, shares, links and signed download links. Only
// internal/employees reaches them, after its own permission check.

// HRRecord adds the caller's record of a new HR file in the upload's transaction; the form carries its fields.
type HRRecord func(q store.Q, d store.Document, form *multipart.Form) error

// UploadEmployeeFile stores the multipart "file" as an HR file of the employee: the documents' size and type rules,
// SHA-256 computed from the bytes, and a duplicate check among that employee's files under the workspace's upload
// lock. Equal bytes elsewhere in the workspace are not looked at: an HR file never points at, or reveals, a document.
func (s *Service) UploadEmployeeFile(w http.ResponseWriter, r *http.Request, sess store.Session, employeeID string, record HRRecord) (string, error) {
	tooLarge := refuse(http.StatusRequestEntityTooLarge, "payload_too_large", fmt.Sprintf("Upload files of up to %d MB.", s.maxSize>>20), nil)
	r.Body = http.MaxBytesReader(w, r.Body, min(s.maxSize+1<<20, uploads.MaxRequestBytes))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return "", tooLarge
		}
		return "", badRequest("Send the file as multipart/form-data in file.")
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	form := r.MultipartForm
	if len(form.File["file"]) != 1 {
		return "", validationFailed(map[string]string{"file": "Send one file per request."})
	}
	h := form.File["file"][0]
	if h.Size > s.maxSize {
		return "", tooLarge
	}
	name := displayName(h.Filename)
	head, err := readHead(h)
	if err != nil {
		return "", err
	}
	ct := detectType(name, head)
	if ct == "" {
		return "", validationFailed(map[string]string{"file": name + " is not a supported file: use PDF, images, Office or " +
			"OpenDocument files, CSV, text, XML or JSON."})
	}
	sum, err := uploads.Hash(h)
	if err != nil {
		return "", err
	}
	duplicate := func(q store.Q) error {
		dup, err := q.DuplicateEmployeeFile(r.Context(), sess.Workspace.ID, employeeID, sum)
		if err == nil {
			return refuse(http.StatusConflict, "duplicate_file", "This employee already has this file.",
				map[string]any{"existing_id": dup.ID, "existing_name": dup.Name, "resource": "employee_document"})
		}
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		return err
	}
	// checked before the write too, so a repeated upload sends no bytes; the transaction below decides under the lock
	if err := duplicate(s.db.Q); err != nil {
		return "", err
	}
	id := auth.NewID("doc")
	key := "workspaces/" + sess.Workspace.ID + "/employees/" + employeeID + "/" + id + "/" + keyName(name)
	// counted against the plan's storage before the write, like every workspace object
	if err := s.db.ReserveObject(r.Context(), sess.Workspace.ID, key, h.Size, true, s.now()); err != nil {
		return "", err
	}
	if err := s.put(r, h, key, ct, name); err != nil {
		s.removeObjects(r.Context(), key)
		return "", err
	}
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockUploadHashes(r.Context(), sess.Workspace.ID, []string{sum}); err != nil {
			return err
		}
		if err := duplicate(q); err != nil {
			return err
		}
		d := store.Document{ID: id, Name: name, Size: h.Size, ContentType: ct, SHA256: &sum, ObjectKey: key,
			CreatedAt: s.now(), EmployeeID: &employeeID}
		if err := q.CreateDocument(r.Context(), sess.Workspace.ID, sess.User.ID, d); err != nil {
			return err
		}
		return record(q, d, form)
	})
	if err != nil {
		s.removeObjects(r.Context(), key)
		return "", err
	}
	return id, nil
}

// ServeHRFile streams an HR file through the API on every request, so the caller's permission check runs each time:
// never a presigned or /api/media link that would outlive it. Downloads only, never cached by shared caches.
func (s *Service) ServeHRFile(w http.ResponseWriter, r *http.Request, workspaceID string, d store.Document) error {
	obj, err := s.files.Open(r.Context(), d.ObjectKey)
	if err != nil {
		return err
	}
	defer obj.Close()
	h := w.Header()
	h.Set("Content-Type", d.ContentType)
	h.Set("Content-Disposition", contentDisposition("attachment", d.Name))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, "", d.CreatedAt, obj)
	return nil
}

// RemoveObject deletes a removed HR file's bytes after its row is gone; a failure leaves an orphan, logged.
func (s *Service) RemoveObject(ctx context.Context, key string) { s.removeObjects(ctx, key) }
