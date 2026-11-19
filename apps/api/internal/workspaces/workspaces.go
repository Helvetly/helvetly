// Package workspaces creates, updates (name, time zone), deletes and restores workspaces (docs/workspaces-contract.md);
// listing and switching are sessions, in internal/auth.
package workspaces

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
	SwitchWorkspace(http.ResponseWriter, *http.Request, store.Session, string) error
}

// Billing ends a workspace's subscription before the workspace goes.
type Billing interface {
	EndSubscription(ctx context.Context, workspaceID string) error
	WriteError(http.ResponseWriter, *http.Request, error)
}

// Storage keeps the workspace logo objects.
type Storage interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType, filename string) error
	Get(ctx context.Context, key string) ([]byte, error)
	Delete(ctx context.Context, key string) error
	storage.Source
}

type Service struct {
	db      *store.Store
	files   Storage
	auth    Auth
	billing Billing
	log     *slog.Logger
	now     func() time.Time
	// namer is the model of the one-time name suggestion (nil: off); limit is its per-address rate limit.
	namer aimodel.Provider
	limit *auth.RateLimiter
	// slugLimit caps each person's portal address checks (typing, debounced).
	slugLimit *auth.RateLimiter
	// portal is the client portal's address (nil: its settings are off).
	portal PortalAddresses
}

func New(db *store.Store, a Auth, b Billing, files Storage, log *slog.Logger) *Service {
	return &Service{db: db, files: files, auth: a, billing: b, log: log, now: func() time.Time { return time.Now().UTC() }, limit: auth.NewRateLimiter(6, time.Minute), slugLimit: auth.NewRateLimiter(slugChecksPerMinute, time.Minute)}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/workspaces", s.auth.SignedIn(s.create))
	mux.HandleFunc("PATCH /api/v1/workspace", s.auth.SignedIn(s.update))
	mux.HandleFunc("DELETE /api/v1/workspace", s.auth.SignedIn(s.delete))
	mux.HandleFunc("GET /api/v1/workspaces/deleted", s.auth.SignedIn(s.deleted))
	mux.HandleFunc("POST /api/v1/workspaces/deleted/{id}/restore", s.auth.SignedIn(s.restore))
	mux.HandleFunc("POST /api/v1/workspace/name-suggestion", s.auth.SignedIn(s.suggestName))
	mux.HandleFunc("GET /api/v1/workspace/logo", s.auth.SignedIn(s.getLogo))
	mux.HandleFunc("PUT /api/v1/workspace/logo", s.auth.SignedIn(s.putLogo))
	mux.HandleFunc("DELETE /api/v1/workspace/logo", s.auth.SignedIn(s.deleteLogo))
	mux.HandleFunc("GET /api/v1/workspaces/{id}/logo", s.auth.SignedIn(s.getWorkspaceLogo))
	if s.portal != nil {
		s.registerPortal(mux)
	}
}

var errOwnerOnly = auth.Error(http.StatusForbidden, "forbidden", "Only an owner can change or delete the workspace.", nil)

// maxNameRunes is the longest name a workspace can be given; longer ones stored earlier stay as they are.
const maxNameRunes = 50

// validName trims the name; "" when it is empty, too long or has control characters.
func validName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > maxNameRunes || strings.ContainsFunc(name, unicode.IsControl) {
		return ""
	}
	return name
}

func invalidName() error {
	return auth.Error(http.StatusBadRequest, "invalid_request", fmt.Sprintf("Give the workspace a name of up to %d characters.", maxNameRunes),
		map[string]any{"fields": map[string]string{"name": "invalid"}})
}

// create makes a workspace with the person as its owner and moves the session into it (answering {csrf_token});
// it is not set up yet, so its owner sees the welcome.
func (s *Service) create(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var in struct {
		Name     string `json:"name"`
		Timezone string `json:"timezone"`
	}
	if !s.auth.Decode(w, r, &in) {
		return
	}
	name := validName(in.Name)
	if name == "" {
		s.auth.WriteError(w, r, invalidName())
		return
	}
	tz := strings.TrimSpace(in.Timezone)
	if _, err := time.LoadLocation(tz); tz == "" || tz == "Local" || len(tz) > 64 || err != nil {
		tz = "UTC"
	}
	id, now := auth.NewID("wsp"), s.now()
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.CreateWorkspace(r.Context(), store.Workspace{ID: id, Name: name}, tz, now); err != nil {
			return err
		}
		return q.AddMember(r.Context(), id, sess.User.ID, "owner", now)
	})
	if err == nil {
		err = s.auth.SwitchWorkspace(w, r, sess, id)
	}
	if err != nil {
		s.auth.WriteError(w, r, err)
	}
}

var errAdminOnly = auth.Error(http.StatusForbidden, "forbidden", "Only an owner or admin can change the workspace's time zone.", nil)

// update changes the name (owner only) and the time zone (owner or admin); an absent field stays as it is.
func (s *Service) update(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var in struct {
		Name     *string `json:"name"`
		Timezone *string `json:"timezone"`
	}
	if !s.auth.Decode(w, r, &in) {
		return
	}
	ws := sess.Workspace
	if in.Name != nil {
		// Saving the name already stored (a longer one from before the limit) is not a change to refuse.
		if name := strings.TrimSpace(*in.Name); name != sess.Workspace.Name {
			if ws.Name = validName(name); ws.Name == "" {
				s.auth.WriteError(w, r, invalidName())
				return
			}
		}
	}
	if in.Timezone != nil {
		if ws.Timezone = strings.TrimSpace(*in.Timezone); !store.ValidTimezone(ws.Timezone) {
			s.auth.WriteError(w, r, auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Choose a time zone from the list.",
				map[string]any{"fields": map[string]string{"timezone": "invalid"}}))
			return
		}
	}
	switch {
	case ws.Name != sess.Workspace.Name && sess.Role != "owner":
		s.auth.WriteError(w, r, errOwnerOnly)
		return
	case sess.Role != "owner" && sess.Role != "admin":
		s.auth.WriteError(w, r, errAdminOnly)
		return
	}
	if err := s.db.UpdateWorkspace(r.Context(), ws); err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]string{"id": ws.ID, "name": ws.Name, "timezone": ws.Timezone}})
}

// restoreWindow is how long whoever deleted a workspace can restore it.
const restoreWindow = 30 * 24 * time.Hour

// delete needs the workspace's name typed as confirm. A live subscription is cancelled at once first (a Stripe
// failure stops the deletion, so it can be retried). The session moves to another of the person's workspaces
// ({csrf_token}); without one it ends (204).
func (s *Service) delete(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if sess.Role != "owner" {
		s.auth.WriteError(w, r, errOwnerOnly)
		return
	}
	var in struct {
		Confirm string `json:"confirm"`
	}
	if !s.auth.Decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Confirm) != sess.Workspace.Name {
		s.auth.WriteError(w, r, auth.Error(http.StatusBadRequest, "invalid_request", "Type the workspace's name to delete it.",
			map[string]any{"fields": map[string]string{"confirm": "mismatch"}}))
		return
	}
	if err := s.billing.EndSubscription(r.Context(), sess.Workspace.ID); err != nil {
		s.billing.WriteError(w, r, err)
		return
	}
	if err := s.db.Tx(r.Context(), func(q store.Q) error {
		return q.DeleteWorkspace(r.Context(), sess.Workspace.ID, auth.NewID("wdl"), sess.User.ID, s.now())
	}); err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	s.log.InfoContext(r.Context(), "workspace deleted", "workspace", sess.Workspace.ID, "by", sess.User.ID)
	others, err := s.db.UserWorkspaces(r.Context(), sess.User.ID)
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	if len(others) > 0 {
		err := s.auth.SwitchWorkspace(w, r, sess, others[0].ID)
		if err == nil {
			return
		}
		if !errors.Is(err, auth.ErrNotFound) { // not found: they left it meanwhile, so the session just ends
			s.auth.WriteError(w, r, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// deleted lists the workspaces the person deleted that they can still restore, with the last moment they can.
func (s *Service) deleted(w http.ResponseWriter, r *http.Request, sess store.Session) {
	list, err := s.db.DeletedWorkspaces(r.Context(), sess.User.ID, s.now().Add(-restoreWindow))
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	type row struct {
		store.WorkspaceDeletion
		RestoreUntil time.Time `json:"restore_until"`
	}
	out := make([]row, len(list))
	for i, d := range list {
		out[i] = row{d, d.DeletedAt.Add(restoreWindow)}
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": out})
}

// restore brings back a workspace the person deleted within the window, with its members, and moves the session into
// it ({csrf_token}). Its subscription stays cancelled.
func (s *Service) restore(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var workspaceID string
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		var err error
		now := s.now()
		workspaceID, err = q.RestoreWorkspace(r.Context(), r.PathValue("id"), sess.User.ID, now.Add(-restoreWindow), now)
		return err
	})
	if errors.Is(err, store.ErrNotFound) {
		err = auth.ErrNotFound
	}
	if err == nil {
		s.log.InfoContext(r.Context(), "workspace restored", "workspace", workspaceID, "by", sess.User.ID)
		err = s.auth.SwitchWorkspace(w, r, sess, workspaceID)
	}
	if err != nil {
		s.auth.WriteError(w, r, err)
	}
}
