// Package imports reads uploaded files into records with the AI model, lets a person review them and creates the
// chosen ones through each kind's canonical write (docs/imports-contract.md).
package imports

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

type Storage interface {
	Put(context.Context, string, io.Reader, int64, string, string) error
	Open(context.Context, string) (io.ReadSeekCloser, error)
	Delete(context.Context, string) error
}

type Options struct {
	// Provider is the AI model; nil when none is configured (uploads answer 503 ai_unavailable).
	Provider aimodel.Provider
	// Allowance is the automation pool's monthly token allowance (billing's AIAutomationTokens), never Heidi's; nil
	// is unlimited.
	Allowance aimodel.Allowance
	// CostAllowance is the automation pool's monthly model cost guard in micro-USD (AIAutomationCost); nil applies none.
	CostAllowance aimodel.Allowance
	AllowStorage  func(context.Context, store.Q, store.Session, int64) error
	// File queues a stored file for AI filing (folder and tags) in Documents; nil files nothing.
	File func(context.Context, store.Session, string)
}

type Service struct {
	db           *store.Store
	auth         Auth
	files        Storage
	provider     aimodel.Provider
	budget       aimodel.Budget
	allowStorage func(context.Context, store.Q, store.Session, int64) error
	file         func(context.Context, store.Session, string)
	log          *slog.Logger
	now          func() time.Time
	limit        *auth.RateLimiter
}

func New(db *store.Store, a Auth, files Storage, log *slog.Logger, o Options) *Service {
	s := &Service{db: db, auth: a, files: files, provider: o.Provider, allowStorage: o.AllowStorage, file: o.File, log: log,
		now: func() time.Time { return time.Now().UTC() }, limit: auth.NewRateLimiter(20, time.Minute)}
	s.budget = aimodel.Budget{DB: db, Pool: aimodel.PoolAutomation, Allowance: o.Allowance, CostAllowance: o.CostAllowance, Now: func() time.Time { return s.now() }}
	return s
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, fn handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := fn(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("POST /api/v1/imports", s.upload)
	handle("POST /api/v1/imports/documents", s.fromDocuments)
	handle("GET /api/v1/imports", s.list)
	handle("GET /api/v1/imports/{id}", s.get)
	handle("DELETE /api/v1/imports/{id}", s.discard)
	handle("GET /api/v1/imports/{id}/files/{file}/content", s.content)
	handle("PATCH /api/v1/imports/{id}/records/{record_id}", s.edit)
	handle("POST /api/v1/imports/{id}/commit", s.commit)
	s.RegisterExpensePreview(mux)
}

func invalid(message string) error {
	return auth.Error(http.StatusBadRequest, "invalid_request", message, nil)
}

func need(sess store.Session, scope string) error {
	if !permissions.Allows(sess.Role, sess.Scopes, scope) {
		return auth.Error(http.StatusForbidden, "forbidden", "You are not allowed to do that.", map[string]any{"scope": scope})
	}
	return nil
}

// kindOf: a registered kind, or 400.
func kindOf(name string) (Kind, error) {
	if name == Auto {
		return autoKind, nil
	}
	k, ok := Kinds[name]
	if !ok {
		return Kind{}, invalid("Choose what to import: one of the registered kinds.")
	}
	return k, nil
}

// scopesFor: what starting an import of k needs, and what its queued reading keeps needing.
func scopesFor(k Kind) []string {
	if k.Private { // private kinds keep no document
		return []string{"write:" + k.Resource}
	}
	return []string{"write:" + k.Resource, "write:documents"}
}

// uploaderGate is gate for queued reading: the person who started the import must still be a member holding the
// upload's scopes, with their own approval; nobody else's approval or access stands in for theirs.
func (s *Service) uploaderGate(ctx context.Context, q store.Q, workspaceID, userID string, k Kind) error {
	role, err := q.MemberRole(ctx, workspaceID, userID)
	if errors.Is(err, store.ErrNotFound) {
		return auth.Error(http.StatusForbidden, "forbidden", "Whoever started this import is no longer a member of this workspace. Nothing more was sent to the AI model.", nil)
	}
	if err != nil {
		return err
	}
	scopes, err := q.MemberScopes(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	for _, scope := range scopesFor(k) {
		if !permissions.Allows(role, scopes, scope) {
			return auth.Error(http.StatusForbidden, "forbidden", "Whoever started this import may no longer "+strings.ReplaceAll(scope, ":", " ")+". Nothing more was sent to the AI model.", nil)
		}
	}
	return s.gate(ctx, q, workspaceID, userID)
}

// gate refuses a model call the server cannot make, the workspace's plan lacks (ai_import) or the person has not
// approved in this workspace (the same approval as Heidi's). userID is whoever started the import.
func (s *Service) gate(ctx context.Context, q store.Q, workspaceID, userID string) error {
	if s.provider == nil {
		return auth.Error(http.StatusServiceUnavailable, "ai_unavailable", "This server has no AI model configured, so files can't be read automatically.", nil)
	}
	if err := q.RequireFeature(ctx, workspaceID, store.FeatureAIImport); err != nil {
		return err
	}
	return auth.RequireAIConsent(ctx, q, workspaceID, userID)
}

// batch: the person's batch and its kind, after checking the session may act on that kind.
func (s *Service) batch(ctx context.Context, q store.Q, sess store.Session, id, action string) (store.ImportBatch, Kind, error) {
	b, err := q.ImportBatch(ctx, sess.Workspace.ID, sess.User.ID, id)
	if err != nil {
		return b, Kind{}, err
	}
	k, err := kindOf(b.Kind)
	if err != nil {
		return b, Kind{}, store.ErrNotFound // a kind this build no longer offers
	}
	return b, k, need(sess, action+":"+k.Resource)
}

// recordKind is the kind a record is created as (its own, in an auto batch), after checking the session may write it.
func recordKind(sess store.Session, rec store.ImportRecord) (Kind, error) {
	k, ok := Kinds[rec.Kind]
	if !ok {
		return Kind{}, store.ErrNotFound
	}
	return k, need(sess, "write:"+k.Resource)
}

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	k, err := kindOf(r.URL.Query().Get("kind"))
	if err != nil {
		return err
	}
	if err := need(sess, "read:"+k.Resource); err != nil {
		return err
	}
	// The page's context: a client's drawer lists only that client's batches, every other entry point none of them.
	clientID, err := s.batchClient(r.Context(), sess, k, r.URL.Query()["client_id"])
	if err != nil {
		return err
	}
	list, err := s.db.ImportBatches(r.Context(), sess.Workspace.ID, sess.User.ID, k.Name, clientID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": list})
	return nil
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	b, _, err := s.batch(r.Context(), s.db.Q, sess, r.PathValue("id"), "read")
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": b})
	return nil
}

// content streams one file of the batch inline, for viewing beside its records. It goes through the API rather than
// storage.Serve: that one answers attachments, and a ZIP entry has no object of its own to redirect to.
func (s *Service) content(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	b, _, err := s.batch(r.Context(), s.db.Q, sess, r.PathValue("id"), "read")
	if err != nil {
		return err
	}
	i := slices.IndexFunc(b.Files, func(f store.ImportFile) bool { return f.ID == r.PathValue("file") })
	if i < 0 {
		return store.ErrNotFound
	}
	f := b.Files[i]
	data, err := s.read(r.Context(), f)
	if err != nil {
		return err
	}
	h := w.Header()
	h.Set("Content-Type", f.ContentType)
	h.Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": f.Name}))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(data))
	return nil
}

func (s *Service) discard(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	_, k, err := s.batch(r.Context(), s.db.Q, sess, r.PathValue("id"), "write")
	if err != nil {
		return err
	}
	var keys []string
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		keys, err = drop(r.Context(), q, sess.Workspace.ID, sess.User.ID, r.PathValue("id"), k.Private)
		return err
	})
	if err != nil {
		return err
	}
	s.deleteKept(r.Context(), keys)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// drop deletes a batch with its files and records, its staged uploads, and for a private kind the HR files it stored
// that nothing else refers to, returning their object keys to delete once q commits (storage then releases their bytes). ErrNotFound
// when the batch is gone.
func drop(ctx context.Context, q store.Q, workspaceID, userID, id string, private bool) ([]string, error) {
	var sources []string
	if private { // HR files exist only for their batch: discarding it deletes them, with what was read from them
		var err error
		if sources, err = q.PrivateImportSources(ctx, workspaceID, id); err != nil {
			return nil, err
		}
	}
	found, err := q.DeleteImportBatch(ctx, workspaceID, userID, id)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, store.ErrNotFound
	}
	keys, err := q.DropImportSources(ctx, workspaceID, id) // the staged uploads no other open import reads
	if err != nil || len(sources) == 0 {
		return keys, err
	}
	hr, err := q.DeleteUnusedImportSources(ctx, workspaceID, sources)
	return append(keys, hr...), err
}

// errExpired: an unfinished import past store.ImportExpiry cannot be continued; the expiry job discards it.
var errExpired = auth.Error(http.StatusGone, "import_expired",
	"This import expired 48 hours after its last change and was discarded. Start a new one.", nil)

// live refuses to continue an expired import.
func (s *Service) live(b store.ImportBatch) error {
	if b.Expired(s.now()) {
		return errExpired
	}
	return nil
}
