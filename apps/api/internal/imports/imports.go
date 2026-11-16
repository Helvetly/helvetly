// Package imports reads uploaded files into records with the AI model, lets a person review them and creates the
// chosen ones through each kind's canonical write (docs/imports-contract.md).
package imports

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
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
	// Provider is the AI model; nil when none is configured (uploads answer 409 ai_not_configured).
	Provider aimodel.Provider
	// Allowance is the plan's monthly token allowance, shared with Heidi; nil is unlimited.
	Allowance aimodel.Allowance
	// CostAllowance is the plan's monthly model cost guard in micro-USD, shared with Heidi; nil applies none.
	CostAllowance aimodel.Allowance
	AllowStorage  func(context.Context, store.Q, store.Session, int64) error
}

type Service struct {
	db           *store.Store
	auth         Auth
	files        Storage
	provider     aimodel.Provider
	budget       aimodel.Budget
	allowStorage func(context.Context, store.Q, store.Session, int64) error
	log          *slog.Logger
	now          func() time.Time
	limit        *auth.RateLimiter
}

func New(db *store.Store, a Auth, files Storage, log *slog.Logger, o Options) *Service {
	s := &Service{db: db, auth: a, files: files, provider: o.Provider, allowStorage: o.AllowStorage, log: log,
		now: func() time.Time { return time.Now().UTC() }, limit: auth.NewRateLimiter(20, time.Minute)}
	s.budget = aimodel.Budget{DB: db, Allowance: o.Allowance, CostAllowance: o.CostAllowance, Now: func() time.Time { return s.now() }, Gate: s.gate}
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
	handle("GET /api/v1/imports", s.list)
	handle("GET /api/v1/imports/{id}", s.get)
	handle("DELETE /api/v1/imports/{id}", s.discard)
	handle("PATCH /api/v1/imports/{id}/records/{record_id}", s.edit)
	handle("POST /api/v1/imports/{id}/commit", s.commit)
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

// gate refuses a model call the workspace's plan lacks (ai_import) or the server cannot make.
func (s *Service) gate(ctx context.Context, q store.Q, workspaceID string) error {
	if s.provider == nil {
		return auth.Error(http.StatusConflict, "ai_not_configured", "This server has no AI model configured, so files can't be read automatically.", nil)
	}
	return q.RequireFeature(ctx, workspaceID, store.FeatureAIImport)
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
	list, err := s.db.ImportBatches(r.Context(), sess.Workspace.ID, sess.User.ID, k.Name)
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

func (s *Service) discard(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	_, k, err := s.batch(r.Context(), s.db.Q, sess, r.PathValue("id"), "write")
	if err != nil {
		return err
	}
	var sources []string
	if k.Private { // HR files exist only for their batch: discarding it deletes them, with what was read from them
		if sources, err = s.db.PrivateImportSources(r.Context(), sess.Workspace.ID, r.PathValue("id")); err != nil {
			return err
		}
	}
	found, err := s.db.DeleteImportBatch(r.Context(), sess.Workspace.ID, sess.User.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	if found && len(sources) > 0 {
		keys, err := s.db.DeleteUnusedImportSources(r.Context(), sess.Workspace.ID, sources)
		if err != nil {
			return err
		}
		s.deleteKept(r.Context(), keys)
	}
	if !found {
		return store.ErrNotFound
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
