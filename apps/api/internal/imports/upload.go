package imports

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

// upload is one uploaded file: its bytes, type and hash, the ZIP's entries, and where it is stored.
type upload struct {
	name, contentType, sum string
	data                   []byte
	entries                []entry
	documentID, key        string
	reused                 bool   // the bytes were already stored in the workspace
	written                string // the object this request put, deleted again when unused
}

func (s *Service) upload(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !s.limit.Allow(r) {
		return auth.Error(http.StatusTooManyRequests, "rate_limited", "Wait a minute before starting another import.", nil)
	}
	r.Body = http.MaxBytesReader(w, r.Body, uploads.MaxRequestBytes)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return auth.Error(http.StatusRequestEntityTooLarge, "payload_too_large", "Send at most 10 files of 25 MB each, 95 MB in all.", nil)
		}
		return invalid("Send a multipart form with kind and files[].")
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	form := r.MultipartForm
	for k, v := range form.Value {
		if k != "kind" || len(v) != 1 {
			return invalid("Send one kind and the files in files[].")
		}
	}
	for k := range form.File {
		if k != "files[]" {
			return invalid("Send the files in files[].")
		}
	}
	kind, err := kindOf(strings.Join(form.Value["kind"], ""))
	if err != nil {
		return err
	}
	scopes := []string{"write:" + kind.Resource, "write:documents"}
	if kind.Private {
		scopes = scopes[:1]
	}
	for _, scope := range scopes {
		if err := need(sess, scope); err != nil {
			return err
		}
	}
	if kind.Parse == nil {
		if err := s.gate(r.Context(), s.db.Q, sess.Workspace.ID); err != nil {
			return err
		}
	}
	headers := form.File["files[]"]
	if len(headers) == 0 || len(headers) > maxFiles {
		return invalid(fmt.Sprintf("Choose 1 to %d files.", maxFiles))
	}
	list := make([]upload, 0, len(headers))
	sums := map[string]string{}
	for _, h := range headers {
		u, err := readUpload(h.Filename, h.Size, func() (io.ReadCloser, error) { return h.Open() })
		if err != nil {
			return err
		}
		if err := uploads.CheckBatch(sums, u.sum, u.name); err != nil {
			return err
		}
		if kind.Parse != nil && u.contentType == typeZIP {
			return invalid(u.name + ": upload the file itself, not a ZIP archive.")
		}
		list = append(list, u)
	}
	b, err := s.store(r.Context(), sess, kind, list)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, map[string]any{"data": b})
	return nil
}

// readUpload reads and checks one multipart file. An unreadable file refuses the whole upload with its reason.
func readUpload(filename string, size int64, open func() (io.ReadCloser, error)) (upload, error) {
	name := path.Base(strings.ReplaceAll(filename, `\`, "/"))
	if name == "." || name == "/" || !utf8.ValidString(name) || len(name) > 255 || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return upload{}, invalid("A filename is invalid.")
	}
	if size <= 0 || size > maxFileBytes {
		return upload{}, auth.Error(http.StatusRequestEntityTooLarge, "payload_too_large", name+": each file must be nonempty and at most 25 MB.", nil)
	}
	f, err := open()
	if err != nil {
		return upload{}, fmt.Errorf("open import upload: %w", err)
	}
	data, err := io.ReadAll(io.LimitReader(f, maxFileBytes+1))
	closeErr := f.Close()
	if err != nil {
		return upload{}, fmt.Errorf("read import upload: %w", err)
	}
	if closeErr != nil {
		return upload{}, closeErr
	}
	u := upload{name: name, data: data}
	if u.contentType, err = sniff(name, data); err != nil {
		return upload{}, unsupportedFile(err)
	}
	if u.contentType == typeZIP {
		if u.entries, err = zipEntries(name, data); err != nil {
			return upload{}, unsupportedFile(err)
		}
	}
	sum := sha256.Sum256(data)
	u.sum = hex.EncodeToString(sum[:])
	return u, nil
}

func unsupportedFile(err error) error {
	return auth.Error(http.StatusBadRequest, "unsupported_file", err.Error(), nil)
}

// store keeps every upload as a Document (reusing the stored object when the bytes are already in the workspace) and
// records the batch. Objects are put between two transactions, so no lock waits on storage; the second transaction
// repeats the duplicate check under the same locks, which covers simultaneous uploads from any entry point.
func (s *Service) store(ctx context.Context, sess store.Session, kind Kind, list []upload) (b store.ImportBatch, err error) {
	if err = s.db.Tx(ctx, func(q store.Q) error { return s.admit(ctx, q, sess, list, kind.Private) }); err != nil {
		return b, err
	}
	defer func() {
		cleanup, cancel := uploads.CleanupContext(ctx)
		defer cancel()
		for _, u := range list {
			if u.written != "" && (err != nil || u.reused) {
				if e := s.files.Delete(cleanup, u.written); e != nil {
					err = errors.Join(err, fmt.Errorf("clean up import upload: %w", e))
				}
			}
		}
	}()
	for i := range list {
		u := &list[i]
		if u.reused {
			continue
		}
		u.documentID = auth.NewID("doc")
		u.key = sess.Workspace.ID + "/documents/" + u.documentID
		u.written = u.key
		if err = s.files.Put(ctx, u.key, bytes.NewReader(u.data), int64(len(u.data)), u.contentType, u.name); err != nil {
			return b, err
		}
	}
	batch := store.ImportBatch{ID: auth.NewID("imp"), WorkspaceID: sess.Workspace.ID, UserID: sess.User.ID, Kind: kind.Name}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := s.admit(ctx, q, sess, list, kind.Private); err != nil {
			return err
		}
		for _, u := range list {
			if !u.reused {
				if err := s.createDocument(ctx, q, sess, u, kind.Private); err != nil {
					return err
				}
			}
		}
		return q.CreateImportBatch(ctx, batch, importFiles(list), s.now())
	})
	if err != nil {
		return b, err
	}
	return s.db.ImportBatch(ctx, sess.Workspace.ID, sess.User.ID, batch.ID)
}

// admit locks the uploads' hashes, marks the ones already stored in the workspace as reused and admits the new bytes.
func (s *Service) admit(ctx context.Context, q store.Q, sess store.Session, list []upload, private bool) error {
	sums, sizes := []string{}, []int64{}
	for _, u := range list {
		sums, sizes = append(sums, u.sum), append(sizes, int64(len(u.data)))
	}
	if err := q.LockUploadHashes(ctx, sess.Workspace.ID, sums); err != nil {
		return err
	}
	if err := uploads.Backfill(ctx, q, sess.Workspace.ID, sizes, s.files.Open); err != nil {
		return err
	}
	var add int64
	for i := range list {
		u := &list[i]
		id, key, err := q.ExistingUpload(ctx, sess.Workspace.ID, u.sum, private)
		switch {
		case err == nil:
			u.reused, u.documentID, u.key = true, id, key
		case errors.Is(err, store.ErrNotFound):
			add += int64(len(u.data))
		default:
			return err
		}
	}
	// Document copies lock the destination before storage admission; keep the same lock order.
	if err := q.LockContainer(ctx, sess.Workspace.ID, nil); err != nil {
		return err
	}
	if s.allowStorage != nil && add > 0 {
		return s.allowStorage(ctx, q, sess, add)
	}
	return nil
}

func (s *Service) createDocument(ctx context.Context, q store.Q, sess store.Session, u upload, private bool) error {
	name := u.name
	if private { // an HR file has no place among Documents, so no name there to avoid
		sum := u.sum
		return q.CreateDocument(ctx, sess.Workspace.ID, sess.User.ID, store.Document{ID: u.documentID, Name: name,
			Size: int64(len(u.data)), ContentType: u.contentType, SHA256: &sum, ObjectKey: u.key, CreatedAt: s.now(), HRPrivate: true})
	}
	taken, err := q.FileNameTaken(ctx, sess.Workspace.ID, nil, name, "")
	if err != nil {
		return err
	}
	if taken != "" {
		if name, err = q.FreeFileName(ctx, sess.Workspace.ID, nil, name); err != nil {
			return err
		}
	}
	sum := u.sum
	return q.CreateDocument(ctx, sess.Workspace.ID, sess.User.ID, store.Document{ID: u.documentID, Name: name,
		Size: int64(len(u.data)), ContentType: u.contentType, SHA256: &sum, ObjectKey: u.key, CreatedAt: s.now()})
}

// importFiles: one file to read per plain upload and per ZIP entry; an unreadable entry is a failed file.
func importFiles(list []upload) []store.ImportFile {
	var out []store.ImportFile
	add := func(f store.ImportFile, u upload) {
		key, doc := u.key, u.documentID
		f.ID, f.Position, f.ObjectKey, f.DocumentID, f.Reused, f.Status = auth.NewID("imf"), len(out), &key, &doc, u.reused, "queued"
		out = append(out, f)
	}
	for _, u := range list {
		if u.entries == nil {
			add(store.ImportFile{Name: u.name, Size: int64(len(u.data)), ContentType: u.contentType}, u)
			continue
		}
		for _, e := range u.entries {
			index := e.index
			f := store.ImportFile{Name: e.name, Size: e.size, ContentType: e.contentType, EntryIndex: &index}
			if e.unsupportedR != "" {
				reason := e.unsupportedR
				f.ContentType, f.Error = "application/octet-stream", &reason
			}
			add(f, u)
			if e.unsupportedR != "" {
				out[len(out)-1].Status = "failed"
			}
		}
	}
	return out
}
