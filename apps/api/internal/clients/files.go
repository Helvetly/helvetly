package clients

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"path"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
	fileuploads "helvetly.com/api/internal/uploads"
)

const (
	maxFiles    = 10
	maxFileSize = fileuploads.MaxFileBytes
)

// fileTypes: the allowed extensions, the content type stored for each, and what the first bytes must look like.
var fileTypes = map[string]struct{ contentType, sniff string }{
	".pdf":  {"application/pdf", "application/pdf"},
	".png":  {"image/png", "image/png"},
	".jpg":  {"image/jpeg", "image/jpeg"},
	".jpeg": {"image/jpeg", "image/jpeg"},
	".webp": {"image/webp", "image/webp"},
	".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"},
	".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"},
	".xls":  {"application/vnd.ms-excel", "ole"},
	".doc":  {"application/msword", "ole"},
	".csv":  {"text/csv", "text/plain"},
	".txt":  {"text/plain", "text/plain"},
}

// oleMagic starts the legacy Office formats (.xls, .doc), which http.DetectContentType does not name.
var oleMagic = []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}

// fileType: the content type to store for a file with this name and these first bytes, or "" when not allowed.
func fileType(name string, head []byte) string {
	t, ok := fileTypes[strings.ToLower(path.Ext(name))]
	switch {
	case !ok:
		return ""
	case t.sniff == "ole" && bytes.HasPrefix(head, oleMagic),
		t.sniff != "ole" && strings.HasPrefix(http.DetectContentType(head), t.sniff):
		return t.contentType
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
		return "file"
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

func (s *Service) clientExists(r *http.Request, sess store.Session) error {
	found, err := s.db.LockClient(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	if !found {
		return store.ErrNotFound
	}
	return nil
}

func (s *Service) listFiles(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.clientExists(r, sess); err != nil {
		return err
	}
	files, err := s.db.ClientFiles(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(files))
	return nil
}

type upload struct {
	header *multipart.FileHeader
	file   store.ClientFile
}

func (s *Service) uploadFiles(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.clientExists(r, sess); err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, fileuploads.MaxRequestBytes)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return auth.Error(http.StatusRequestEntityTooLarge, "payload_too_large",
				"Send at most 95 MB per request, in files of up to 25 MB each.", nil)
		}
		return auth.Error(http.StatusBadRequest, "invalid_request", "Send the files as multipart/form-data in files[].", nil)
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()

	headers := r.MultipartForm.File["files[]"]
	switch {
	case len(headers) == 0:
		return validationFailed(map[string]string{"files": "Choose at least one file."})
	case len(headers) > maxFiles:
		return validationFailed(map[string]string{"files": fmt.Sprintf("Upload at most %d files at a time.", maxFiles)})
	}
	clientID, now := r.PathValue("id"), s.now()
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
		ct := fileType(name, head)
		if ct == "" {
			return validationFailed(map[string]string{"files": name +
				" is not a supported file: use PDF, PNG, JPEG, WebP, Excel, Word, CSV or text."})
		}
		id := auth.NewID("fil")
		sum, err := fileuploads.Hash(h)
		if err != nil {
			return err
		}
		if err := fileuploads.CheckBatch(seen, sum, name); err != nil {
			return err
		}
		sums[i] = sum
		sizes[i] = h.Size
		uploads[i] = upload{h, store.ClientFile{ID: id, Name: name, Size: h.Size, ContentType: ct, CreatedAt: now,
			SHA256:     sum,
			UploadedBy: &store.Uploader{ID: sess.User.ID, Name: sess.User.Name},
			ObjectKey:  "workspaces/" + sess.Workspace.ID + "/clients/" + clientID + "/" + id + "/" + keyName(name)}}
	}

	var stored []string
	cleanup := func(keys []string) {
		ctx, cancel := fileuploads.CleanupContext(r.Context())
		defer cancel()
		for _, key := range keys {
			if err := s.files.Delete(ctx, key); err != nil {
				s.log.WarnContext(ctx, "orphaned upload", "key", key, "error", err)
			}
		}
	}
	// Objects are stored before the transaction, so no lock waits on the uploads. An unlocked look skips the files
	// that are known duplicates; the check under the lock below decides, storing a file it finds new after all.
	isStored := func(key string) bool { return slices.Contains(stored, key) }
	for i, sum := range sums {
		if _, err := s.db.DuplicateUpload(r.Context(), sess.Workspace.ID, sum); err == nil {
			continue
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		stored = append(stored, uploads[i].file.ObjectKey)
		if err := s.put(r, &uploads[i]); err != nil {
			cleanup(stored)
			return err
		}
	}
	files := make([]store.ClientFile, len(uploads))
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockUploadHashes(r.Context(), sess.Workspace.ID, sums); err != nil {
			return err
		}
		found, err := q.LockClient(r.Context(), sess.Workspace.ID, clientID)
		if err != nil {
			return err
		}
		if !found {
			return store.ErrNotFound
		}
		if err := fileuploads.Backfill(r.Context(), q, sess.Workspace.ID, sizes, s.files.Open); err != nil {
			return err
		}
		existing := make(map[int]store.DuplicateUpload)
		for i, sum := range sums {
			duplicate, err := q.DuplicateUpload(r.Context(), sess.Workspace.ID, sum)
			if err == nil {
				if duplicate.Resource != "document" {
					return fileuploads.Duplicate(sess, duplicate)
				}
				if !permissions.Allows(sess.Role, sess.Scopes, "read:documents") {
					if _, err := q.ClientFile(r.Context(), clientID, duplicate.ID); err != nil {
						if errors.Is(err, store.ErrNotFound) {
							return fileuploads.Duplicate(sess, duplicate)
						}
						return err
					}
				}
				existing[i] = duplicate
			} else if !errors.Is(err, store.ErrNotFound) {
				return err
			}
		}
		for i := range uploads {
			if _, ok := existing[i]; ok {
				continue
			}
			u := &uploads[i]
			if isStored(u.file.ObjectKey) {
				continue
			}
			stored = append(stored, u.file.ObjectKey)
			if err := s.put(r, u); err != nil {
				return err
			}
		}
		for i := range uploads {
			if duplicate, ok := existing[i]; ok {
				if err := q.AddDocumentLink(r.Context(), sess.Workspace.ID, duplicate.ID, "client", clientID, sess.User.ID, now); err != nil {
					return err
				}
				f, err := q.ClientFile(r.Context(), clientID, duplicate.ID)
				if err != nil {
					return err
				}
				files[i] = f
				continue
			}
			u := &uploads[i]
			if err := q.CreateClientFile(r.Context(), sess.Workspace.ID, clientID, sess.User.ID, &u.file); err != nil {
				return err
			}
			files[i] = u.file
		}
		return nil
	})
	if err != nil {
		cleanup(stored)
		return err
	}
	var unused []string // stored, then found to be a duplicate linked instead
	for i, f := range files {
		if f.ID != uploads[i].file.ID && isStored(uploads[i].file.ObjectKey) {
			unused = append(unused, uploads[i].file.ObjectKey)
		}
	}
	cleanup(unused)
	auth.WriteJSON(w, http.StatusCreated, data(files))
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

func (s *Service) put(r *http.Request, u *upload) error {
	f, err := u.header.Open()
	if err != nil {
		return fmt.Errorf("open upload: %w", err)
	}
	defer f.Close()
	return s.files.Put(r.Context(), u.file.ObjectKey, f, u.file.Size, u.file.ContentType, u.file.Name)
}

func (s *Service) downloadFile(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.clientExists(r, sess); err != nil {
		return err
	}
	f, err := s.db.ClientFile(r.Context(), r.PathValue("id"), r.PathValue("file_id"))
	if err != nil {
		return err
	}
	return storage.Serve(w, r, s.files, sess.Workspace.ID, f.ObjectKey, f.Name, f.ContentType)
}

// deleteFile moves the file to the Documents Trash (restorable for 30 days); a business record stays (409).
func (s *Service) deleteFile(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	clientID := r.PathValue("id")
	err := s.inClient(r.Context(), sess, clientID, func(q store.Q) error {
		f, err := q.ClientFile(r.Context(), clientID, r.PathValue("file_id"))
		if err != nil {
			return err
		}
		today := s.now().Format(time.DateOnly)
		trashed, err := q.TrashDocument(r.Context(), sess.Workspace.ID, f.ID, sess.User.ID, today, s.now())
		if err != nil {
			return err
		}
		if !trashed {
			return auth.Error(http.StatusConflict, "retained",
				"This file is a business record linked to a booked invoice or expense, so it is kept.", nil)
		}
		return nil
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
