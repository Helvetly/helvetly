package members

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth: the session, and its error and JSON conventions.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Seats keeps a per-seat subscription billed for the workspace's members (internal/billing); it logs its own
// failures, so a membership change never waits on Stripe to stand.
type Seats interface {
	SyncSeats(ctx context.Context, workspaceID string)
}

type Service struct {
	db    *store.Store
	auth  Auth
	log   *slog.Logger
	seats Seats
}

func New(db *store.Store, a Auth, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, log: log}
}

// SetSeats is startup wiring: billing is made after the members service.
func (s *Service) SetSeats(seats Seats) { s.seats = seats }

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/members", s.list)
	handle("PATCH /api/v1/members/{user_id}", s.update)
	handle("DELETE /api/v1/members/{user_id}", s.remove)
}

var (
	errForbidden = auth.Error(http.StatusForbidden, "forbidden", "You are not allowed to do that.", nil)
	errLastOwner = auth.Error(http.StatusConflict, "last_owner", "A workspace needs at least one owner.", nil)
)

type member struct {
	UserID       string     `json:"user_id"`
	Name         string     `json:"name"`
	Email        string     `json:"email"`
	AvatarURL    *string    `json:"avatar_url"`
	Role         string     `json:"role"`
	Scopes       []string   `json:"scopes"`
	JoinedAt     time.Time  `json:"joined_at"`
	LastActiveAt *time.Time `json:"last_active_at"`
	IsYou        bool       `json:"is_you"`
}

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	list, err := s.db.ListMembers(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	out := make([]member, 0, len(list))
	for _, m := range list {
		v := member{UserID: m.UserID, Name: m.Name, Email: m.Email, Role: m.Role, Scopes: m.Scopes, JoinedAt: m.JoinedAt,
			LastActiveAt: m.LastActiveAt, IsYou: m.UserID == sess.User.ID}
		if m.AvatarURL != "" {
			v.AvatarURL = &m.AvatarURL
		}
		out = append(out, v)
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": out})
	return nil
}

// change runs fn in a transaction that is serialised per workspace's owners, with the actor's and the target's
// current roles and whether the target is the only owner. The actor's role is read again under the lock: the
// session's may be from before a change that committed while this request waited.
func (s *Service) change(r *http.Request, sess store.Session, fn func(q store.Q, actor, from string, lastOwner bool) error) error {
	ws, id := sess.Workspace.ID, r.PathValue("user_id")
	return s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockAddress(r.Context(), "workspace-owners:"+ws); err != nil {
			return err
		}
		actor, err := q.MemberRole(r.Context(), ws, sess.User.ID)
		if errors.Is(err, store.ErrNotFound) {
			return errForbidden
		}
		if err != nil {
			return err
		}
		from, err := q.MemberRole(r.Context(), ws, id)
		if err != nil {
			return err
		}
		n, err := q.CountOwners(r.Context(), ws)
		if err != nil {
			return err
		}
		return fn(q, actor, from, from == "owner" && n == 1)
	})
}

// errHRScopes: only an owner grants or withdraws access to employee and payroll data.
var errHRScopes = auth.Error(http.StatusForbidden, "forbidden", "Only an owner can change access to employees and payroll.", nil)

func (s *Service) update(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !CanManage(sess.Role) {
		return errForbidden
	}
	var body struct {
		Role   string    `json:"role"`
		Scopes *[]string `json:"scopes"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if (body.Role != "" || body.Scopes == nil) && !ValidRole(body.Role) {
		return auth.Error(http.StatusBadRequest, "invalid_request", "Role must be owner, admin or member.",
			map[string]any{"fields": map[string]string{"role": "invalid"}})
	}
	err := s.change(r, sess, func(q store.Q, actor, from string, lastOwner bool) error {
		to := body.Role
		if to == "" {
			to = from
		}
		if !CanAssign(actor, from, to) {
			return errForbidden
		}
		scopes, err := permissions.ForRole(to, body.Scopes)
		if err != nil {
			return err
		}
		if body.Scopes == nil {
			scopes = nil // the store keeps a member's scopes, or gives a demoted person full access
		} else if actor != "owner" {
			old, err := q.MemberScopes(r.Context(), sess.Workspace.ID, r.PathValue("user_id"))
			if err != nil {
				return err
			}
			if !slices.Equal(permissions.HRScopes(old), permissions.HRScopes(scopes)) {
				return errHRScopes
			}
		}
		if lastOwner && to != "owner" {
			return errLastOwner
		}
		if err := q.SetMemberRole(r.Context(), sess.Workspace.ID, r.PathValue("user_id"), to, scopes); err != nil || to == from {
			return err
		}
		return notifications.Notify(r.Context(), q, sess.Workspace.ID, "member.role_changed",
			map[string]any{"role": to, "actor": notifications.Actor(sess.User)},
			store.NotifyTo{UserIDs: []string{r.PathValue("user_id")}, Except: sess.User.ID}, time.Now())
	})
	if err != nil {
		return err
	}
	return s.one(w, r, sess)
}

func (s *Service) one(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	list, err := s.db.ListMembers(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	for _, m := range list {
		if m.UserID == r.PathValue("user_id") {
			v := member{UserID: m.UserID, Name: m.Name, Email: m.Email, Role: m.Role, Scopes: m.Scopes, JoinedAt: m.JoinedAt,
				LastActiveAt: m.LastActiveAt, IsYou: m.UserID == sess.User.ID}
			if m.AvatarURL != "" {
				v.AvatarURL = &m.AvatarURL
			}
			auth.WriteJSON(w, http.StatusOK, map[string]any{"data": v})
			return nil
		}
	}
	return store.ErrNotFound
}

func (s *Service) remove(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	self := r.PathValue("user_id") == sess.User.ID
	err := s.change(r, sess, func(q store.Q, actor, from string, lastOwner bool) error {
		// Anyone may leave; removing someone else is the same power as demoting them to member.
		if !self && !CanAssign(actor, from, "member") {
			return errForbidden
		}
		if lastOwner {
			return errLastOwner
		}
		gone, err := q.User(r.Context(), r.PathValue("user_id"))
		if err != nil {
			return err
		}
		if err := q.RemoveMember(r.Context(), sess.Workspace.ID, gone.ID); err != nil {
			return err
		}
		return notifications.Notify(r.Context(), q, sess.Workspace.ID, "member.removed", map[string]any{"user_id": gone.ID,
			"name": gone.Name, "email": gone.Email, "actor": notifications.Actor(sess.User)},
			store.NotifyTo{Roles: notifications.Managers, Except: sess.User.ID}, time.Now())
	})
	if err != nil {
		return err
	}
	if s.seats != nil {
		s.seats.SyncSeats(r.Context(), sess.Workspace.ID)
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
