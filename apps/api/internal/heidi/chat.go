package heidi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"path"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/imports"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

const maxFileBytes = 8 << 20

const maxAttachmentText = 128 << 10

type upload struct {
	ModelFile        ProviderFile
	Header           *multipart.FileHeader
	Name, Type, Hash string
	ID, Key          string // set by putUploads
	Reused           string // set by checkUploads: the live Document that already holds these bytes
}

// input is one chat message: its text, the conversation, and either attachments or the import its files went to.
type input struct {
	conversation, message, importID string
	path                            string // the app screen it was sent from; context only, never for access
	lang                            string // the interface's language, Heidi's last fallback for the reply's
	files                           []upload
}

func readInput(w http.ResponseWriter, r *http.Request) (input, error) {
	r.Body = http.MaxBytesReader(w, r.Body, 4*maxFileBytes+1<<20)
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return input{}, auth.Error(413, "payload_too_large", "Send at most four files of 8 MB each.", nil)
		}
		return input{}, auth.Error(400, "invalid_request", "Send a multipart message with at most four files of 8 MB each.", nil)
	}
	f := r.MultipartForm
	bad := func(message string) (input, error) { return input{}, invalid(message) }
	for k, v := range f.Value {
		if !slices.Contains([]string{"message", "conversation_id", "page", "path", "import_id", "lang", "controls"}, k) || len(v) != 1 {
			return bad("The message contains repeated or unknown fields.")
		}
	}
	for k := range f.File {
		if k != "files[]" {
			return bad("Send attachments in files[].")
		}
	}
	value := func(key string) string {
		if list := f.Value[key]; len(list) == 1 {
			return list[0]
		}
		return ""
	}
	if _, ok := offeredControls(value("controls")); !ok {
		return bad("Invalid screen controls.")
	}
	message, id := strings.TrimSpace(value("message")), value("conversation_id")
	if !conversationID.MatchString(id) || message == "" || !utf8.ValidString(message) || utf8.RuneCountInString(message) > 4000 {
		return bad("The message or conversation is invalid.")
	}
	if page := value("page"); page != "" && !slices.Contains(pages, page) {
		return bad("Unknown page.")
	}
	screenPath := value("path")
	if screenPath != "" && !pagePath.MatchString(screenPath) {
		return bad("The page path is invalid.")
	}
	if screenPath != "/" {
		screenPath = strings.TrimSuffix(screenPath, "/") // the static export's URLs end in a slash, the guide's paths do not
	}
	if len(f.File["files[]"]) > 4 {
		return bad("Send up to four attachments.")
	}
	importID := value("import_id")
	if importID != "" && (!importIDPattern.MatchString(importID) || len(f.File["files[]"]) > 0) {
		return bad("Send either attachments or the import their files went to.")
	}
	files := []upload{}
	sums := map[string]string{}
	textBudget := maxAttachmentText
	for _, h := range f.File["files[]"] {
		if h.Size <= 0 || h.Size > maxFileBytes {
			return input{}, auth.Error(413, "payload_too_large", "Each attachment must be nonempty and at most 8 MB.", nil)
		}
		name := path.Base(strings.ReplaceAll(h.Filename, `\`, "/"))
		if name == "." || name == "/" || !utf8.ValidString(name) || len(name) > 255 || strings.IndexFunc(name, unicode.IsControl) >= 0 {
			return bad("The attachment filename is invalid.")
		}
		file, err := h.Open()
		if err != nil {
			return input{}, fmt.Errorf("open Heidi attachment: %w", err)
		}
		data, readErr := io.ReadAll(io.LimitReader(file, maxFileBytes+1))
		closeErr := file.Close()
		if readErr != nil {
			return input{}, readErr
		}
		if closeErr != nil {
			return input{}, closeErr
		}
		if len(data) > maxFileBytes {
			return input{}, auth.Error(413, "payload_too_large", "Each attachment may be at most 8 MB.", nil)
		}
		ct, modelFile, err := imports.ChatAttachment(name, data, textBudget)
		if err != nil {
			return input{}, auth.Error(400, "unsupported_file", err.Error(), nil)
		}
		if modelFile.ContentType == "text/plain" {
			textBudget -= len(modelFile.Bytes)
		}
		sum, err := uploads.Hash(h)
		if err != nil {
			return input{}, err
		}
		if err = uploads.CheckBatch(sums, sum, name); err != nil {
			return input{}, err
		}
		files = append(files, upload{Header: h, Name: name, Type: ct, Hash: sum, ModelFile: modelFile})
	}
	return input{conversation: id, message: message, importID: importID, path: screenPath, lang: value("lang"), files: files}, nil
}

var (
	importIDPattern = regexp.MustCompile(`^imp_[A-Za-z0-9_-]{1,64}$`)
	// pagePath is a relative app path: it reaches the model's instructions, so nothing but lowercase path segments.
	pagePath = regexp.MustCompile(`^/[a-z0-9/-]{0,100}$`)
)

func (s *Service) checkUploads(ctx context.Context, q store.Q, sess store.Session, files []upload) error {
	if len(files) == 0 {
		return nil
	}
	if err := need(sess, "write:documents"); err != nil {
		return err
	}
	if s.files == nil {
		return auth.Error(503, "storage_unavailable", "Attachment storage is unavailable.", nil)
	}
	sums, sizes := []string{}, []int64{}
	for _, f := range files {
		sums = append(sums, f.Hash)
		sizes = append(sizes, f.Header.Size)
	}
	if err := q.LockUploadHashes(ctx, sess.Workspace.ID, sums); err != nil {
		return err
	}
	if err := uploads.Backfill(ctx, q, sess.Workspace.ID, sizes, s.files.Open); err != nil {
		return err
	}
	var total int64
	for i := range files {
		files[i].Reused = ""
		d, err := q.DuplicateUpload(ctx, sess.Workspace.ID, files[i].Hash)
		switch {
		case err == nil && d.Resource == "document": // the attachment is that Document: nothing new is stored
			if !permissions.Allows(sess.Role, sess.Scopes, "read:documents") {
				return uploads.Duplicate(sess, d)
			}
			files[i].Reused = d.ID
			continue
		case err != nil && !errors.Is(err, store.ErrNotFound):
			return err
		}
		total += files[i].Header.Size
	}
	// Document copies lock the destination before storage admission; keep the same lock order.
	if err := q.LockContainer(ctx, sess.Workspace.ID, nil); err != nil {
		return err
	}
	if s.allowStorage != nil && total > 0 { // reused Documents add no bytes
		if err := s.allowStorage(ctx, q, sess, total); err != nil {
			return err
		}
	}
	return nil
}

// putUploads stores the attachments' objects before the transaction that records them, so no lock waits on storage.
func (s *Service) putUploads(ctx context.Context, sess store.Session, files []upload, written *[]string) error {
	for i := range files {
		f := &files[i]
		if f.Reused != "" { // already a Document: nothing is stored
			continue
		}
		f.ID = auth.NewID("doc")
		f.Key = sess.Workspace.ID + "/documents/" + f.ID
		body, err := f.Header.Open()
		if err != nil {
			return err
		}
		*written = append(*written, f.Key)
		err = s.files.Put(ctx, f.Key, body, f.Header.Size, f.Type, f.Name)
		closeErr := body.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

// storeUploads records the stored attachments as documents, under a free name.
func (s *Service) storeUploads(ctx context.Context, q store.Q, sess store.Session, files []upload) error {
	if len(files) == 0 {
		return nil
	}
	if err := q.LockContainer(ctx, sess.Workspace.ID, nil); err != nil {
		return err
	}
	for _, f := range files {
		if f.Reused != "" {
			continue
		}
		name := f.Name
		existing, err := q.FileNameTaken(ctx, sess.Workspace.ID, nil, name, "")
		if err != nil {
			return err
		}
		if existing != "" {
			name, err = q.FreeFileName(ctx, sess.Workspace.ID, nil, name)
			if err != nil {
				return err
			}
		}
		if err = q.CreateDocument(ctx, sess.Workspace.ID, sess.User.ID, store.Document{ID: f.ID, Name: name, Size: f.Header.Size, ContentType: f.Type, SHA256: &f.Hash, ObjectKey: f.Key, CreatedAt: s.now()}); err != nil {
			return err
		}
	}
	return nil
}

const localHelp = "I can still show overdue or recent invoices, expenses, clients, documents and engagement balances, and log work after your confirmation. Attachments are saved in Documents; they have not been analyzed."

func (s *Service) chat(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	st := &stream{w: w}
	defer st.keepAlive(s.keepAlive)()
	if err := s.turn(w, r, sess, st); err != nil {
		if !st.started {
			return err
		}
		st.fail(r.Context(), err)
	}
	return nil
}

// turn answers one message. A model turn streams its steps as they start (st), so an error after the first one
// is an error frame (chat).
func (s *Service) turn(w http.ResponseWriter, r *http.Request, sess store.Session, st *stream) error {
	if !s.limit.Allow(r) {
		return auth.Error(429, "rate_limited", "Wait before sending another message.", nil)
	}
	in, err := readInput(w, r)
	id, message, files := in.conversation, in.message, in.files
	if r.MultipartForm != nil {
		defer func() { _ = r.MultipartForm.RemoveAll() }()
	}
	if err != nil {
		return err
	}
	if err = s.db.Tx(r.Context(), func(q store.Q) error { return s.checkUploads(r.Context(), q, sess, files) }); err != nil {
		return err
	}
	var result turn
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		var e error
		if in.importID != "" {
			result, e = importTurn(r.Context(), q, sess, in.importID)
			return e
		}
		result, e = s.answer(r.Context(), q, sess, id, message, len(files) > 0)
		return e
	})
	if err != nil {
		return err
	}
	if result.Provider {
		consent := store.AIConsent{}
		if s.provider != nil {
			if consent, err = s.db.AIConsent(r.Context(), sess.Workspace.ID, sess.User.ID); err != nil {
				return err
			}
		}
		section, howTo := guideAnswer(message)
		switch {
		case (s.provider == nil || !consent.Granted) && howTo && len(files) == 0:
			result.Text = section + "\n\n_From the Helvetly guide. If this does not answer it, tell us in Help & feedback._"
			result.Provider = false
		case s.provider == nil:
			result.Text = "This message needs an AI model. OpenAI is not configured for this server. " + localHelp
			result.Provider = false
		case !consent.Granted:
			result.Text = "This message needs an AI model, and you have not approved AI use in this workspace yet. Nothing was sent to OpenAI. " + localHelp
			result.Provider = false
		default:
			progress := func(label string) { _ = st.status(label) }
			result, err = s.modelAnswer(r, sess, id, message, in.path, uiLanguage(r, in.lang), files, localVerdict(message) == inScope, progress)
			if err != nil {
				return err
			}
		}
	}
	written := []string{}
	if err = s.putUploads(r.Context(), sess, files, &written); err == nil {
		err = s.db.Tx(r.Context(), func(q store.Q) error {
			if err := s.requireCurrentAccess(r.Context(), q, r, sess); err != nil {
				return err
			}
			if err := s.checkUploads(r.Context(), q, sess, files); err != nil {
				return err
			}
			for _, f := range files {
				if f.Reused == "" && f.Key == "" { // its twin was trashed after the first look: nothing was stored for it
					return auth.Error(409, "upload_changed", "This file changed while it was being saved. Send it again.", nil)
				}
			}
			if err := q.LockHeidiConversation(r.Context(), sess.Workspace.ID, sess.User.ID, id, true, s.now()); err != nil {
				return err
			}
			pending, e := q.HeidiConfirmation(r.Context(), sess.Workspace.ID, sess.User.ID, id)
			if e == nil && pending.ExpiresAt.After(s.now()) && pending.ID != result.ConsumePendingID {
				return auth.Error(409, "confirmation_pending", "Answer the pending confirmation before sending another message.", nil)
			}
			if e != nil && !errors.Is(e, store.ErrNotFound) {
				return e
			}
			if e == nil {
				if e = q.DeleteHeidiConfirmation(r.Context(), sess.Workspace.ID, sess.User.ID, id, pending.ID); e != nil {
					return e
				}
			}
			messages, e := q.HeidiMessages(r.Context(), sess.Workspace.ID, sess.User.ID, id)
			if e != nil {
				return e
			}
			if len(messages) >= 500 {
				return auth.Error(409, "conversation_full", "Start a new conversation to continue.", nil)
			}
			if err := s.storeUploads(r.Context(), q, sess, files); err != nil {
				return err
			}
			user := Message{ID: auth.NewID("msg"), Role: "user", Text: message}
			for _, f := range files {
				user.Attachments = append(user.Attachments, f.Name)
			}
			user.Attachments = append(user.Attachments, result.importFiles...)
			assistant := Message{Access: accessKey(sess), ID: auth.NewID("msg"), Role: "assistant", Text: result.Text, Actions: result.Actions, Records: result.Records, Form: result.Form, ImportID: result.ImportID, GeneratedBy: result.generatedBy()}
			if result.Confirmation != nil {
				assistant.ProposalID = result.Confirmation.ID
			}
			for _, m := range []Message{user, assistant} {
				if err := q.AppendHeidiMessage(r.Context(), sess.Workspace.ID, sess.User.ID, id, m.ID, m, s.now()); err != nil {
					return err
				}
			}
			if result.memoryTopic != "" {
				if err := s.learn(r.Context(), q, sess, result.memoryTopic); err != nil {
					return err
				}
			}
			if result.Pending != nil {
				return q.PutHeidiConfirmation(r.Context(), sess.Workspace.ID, sess.User.ID, id, *result.Pending)
			}
			return nil
		})
	}
	if err != nil {
		ctx, cancel := uploads.CleanupContext(r.Context())
		defer cancel()
		for _, key := range written {
			if e := s.files.Delete(ctx, key); e != nil {
				err = errors.Join(err, fmt.Errorf("clean up Heidi attachment: %w", e))
			}
		}
		return err
	}
	for _, f := range files { // a twin was stored meanwhile: this request's own object is not kept
		if f.Reused != "" && f.Key != "" {
			cleanup, cancel := uploads.CleanupContext(r.Context())
			if e := s.files.Delete(cleanup, f.Key); e != nil {
				slog.WarnContext(cleanup, "orphaned Heidi attachment", "key", f.Key, "error", e)
			}
			cancel()
		}
	}
	if s.file != nil {
		for _, f := range files {
			if f.Reused == "" {
				s.file(r.Context(), sess, f.ID) // after the commit: filing can never fail the upload
			}
		}
	}
	if len(files) > 0 {
		result.Statuses = append(result.Statuses, "Saved documents")
	}
	_ = writeEvents(st, result)
	return nil
}
