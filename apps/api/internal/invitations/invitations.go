package invitations

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	hmail "helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/members"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

const (
	ttl       = 7 * 24 * time.Hour
	rateLimit = 30 // invitations per workspace per hour

	resendCooldown = time.Minute // between resends of one invitation
)

// Auth is what the handlers use of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
	SwitchWorkspace(w http.ResponseWriter, r *http.Request, sess store.Session, workspaceID string) error
}

// Mailer sends the invitation; a nil Mailer means no SMTP and the link is only returned.
type Mailer interface {
	Send(context.Context, hmail.Message) error
}

// Seats keeps a per-seat subscription billed for the workspace's members (internal/billing); it logs its own
// failures, so an accepted invitation never waits on Stripe to stand.
type Seats interface {
	SyncSeats(ctx context.Context, workspaceID string)
}

type Service struct {
	db        *store.Store
	auth      Auth
	mailer    Mailer
	publicURL string
	log       *slog.Logger
	seats     Seats
}

func New(db *store.Store, a Auth, mailer Mailer, publicURL string, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, mailer: mailer, publicURL: publicURL, log: log}
}

// SetSeats is startup wiring: billing is made after the invitations service.
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
	handle("GET /api/v1/members/invitations", s.list)
	handle("POST /api/v1/members/invitations", s.create)
	handle("POST /api/v1/members/invitations/{id}/resend", s.resend)
	handle("DELETE /api/v1/members/invitations/{id}", s.revoke)
	handle("GET /api/v1/invitations/preview", s.preview)
	handle("POST /api/v1/invitations/accept", s.accept)
}

var (
	errForbidden = auth.Error(http.StatusForbidden, "forbidden", "You are not allowed to do that.", nil)
	errRate      = auth.Error(http.StatusTooManyRequests, "rate_limited", "Too many invitations. Try again later.", nil)
	errInvalid   = auth.Error(http.StatusNotFound, "invitation_invalid", "This invitation is not valid.", nil)
	errExpired   = auth.Error(http.StatusGone, "invitation_expired", "This invitation has expired.", nil)
	// neutral on purpose: the invitee is told neither the plan nor its limits
	errNoSeat = auth.Error(http.StatusConflict, "workspace_full",
		"This workspace has no free seat right now. Ask whoever invited you to make room, then open the invitation again.", nil)
)

type invitation struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	Scopes    []string  `json:"scopes"`
	InvitedBy string    `json:"invited_by"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

type created struct {
	invitation
	URL       string `json:"url"`
	EmailSent bool   `json:"email_sent"`
}

func view(i store.Invitation) invitation {
	return invitation{ID: i.ID, Email: i.Email, Role: i.Role, Scopes: i.Scopes, InvitedBy: i.InvitedBy, CreatedAt: i.CreatedAt, ExpiresAt: i.ExpiresAt}
}

func hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	list, err := s.db.OpenInvitations(r.Context(), sess.Workspace.ID, time.Now())
	if err != nil {
		return err
	}
	out := make([]invitation, 0, len(list))
	for _, i := range list {
		out = append(out, view(i))
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": out})
	return nil
}

func inviterName(sess store.Session) string {
	if sess.User.Name != "" {
		return sess.User.Name
	}
	return sess.User.Email
}

// checkRate must run inside the tx that creates, so concurrent invites cannot slip past the limit.
func checkRate(ctx context.Context, q store.Q, ws string, now time.Time) error {
	if err := q.LockAddress(ctx, "invitations:"+ws); err != nil {
		return err
	}
	n, err := q.CountInvitationsSince(ctx, ws, now.Add(-time.Hour))
	if err != nil {
		return err
	}
	if n >= rateLimit {
		return errRate
	}
	return nil
}

func (s *Service) create(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !members.CanManage(sess.Role) {
		return errForbidden
	}
	var body struct {
		Email  string    `json:"email"`
		Role   string    `json:"role"`
		Scopes *[]string `json:"scopes"`
		// false when the inviter shares the link themselves.
		SendEmail *bool `json:"send_email"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	// A display name ("Bob <b@x.ch>") would parse but never match a user's address.
	if addr, err := mail.ParseAddress(email); err != nil || addr.Address != email || len(email) > 254 {
		return auth.Error(http.StatusBadRequest, "invalid_request", "Enter a valid email address.",
			map[string]any{"fields": map[string]string{"email": "invalid"}})
	}
	if !members.ValidRole(body.Role) {
		return auth.Error(http.StatusBadRequest, "invalid_request", "Role must be owner, admin or member.",
			map[string]any{"fields": map[string]string{"role": "invalid"}})
	}
	if !members.CanAssign(sess.Role, "member", body.Role) {
		return errForbidden
	}
	scopes, err := permissions.ForRole(body.Role, body.Scopes)
	if err != nil {
		return err
	}
	if sess.Role != "owner" && len(permissions.HRScopes(scopes)) > 0 {
		return auth.Error(http.StatusForbidden, "forbidden", "Only an owner can give access to employees and payroll.", nil)
	}
	ctx, now, token := r.Context(), time.Now(), rand.Text()
	inv := store.Invitation{ID: auth.NewID("inv"), WorkspaceID: sess.Workspace.ID, Email: email, Role: body.Role,
		Scopes: scopes, InvitedBy: sess.User.ID, CreatedAt: now, ExpiresAt: now.Add(ttl)}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := checkRate(ctx, q, inv.WorkspaceID, now); err != nil {
			return err
		}
		u, err := q.UserByEmail(ctx, email)
		if err == nil {
			if _, err := q.MemberRole(ctx, inv.WorkspaceID, u.ID); err == nil {
				return auth.Error(http.StatusConflict, "already_member", "This person is already a member.", nil)
			} else if !errors.Is(err, store.ErrNotFound) {
				return err
			}
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		if err := q.RevokeOpenInvitations(ctx, inv.WorkspaceID, email, now); err != nil {
			return err
		}
		if err := q.CreateInvitation(ctx, inv, hash(token)); err != nil {
			return err
		}
		return notifications.Notify(ctx, q, inv.WorkspaceID, "member.invited", map[string]any{"email": email, "role": body.Role,
			"actor": notifications.Actor(sess.User), "actor_id": sess.User.ID}, store.NotifyTo{Roles: notifications.Managers, Except: sess.User.ID}, now)
	})
	if err != nil {
		return err
	}
	inv.InvitedBy = inviterName(sess)
	s.respond(ctx, w, http.StatusCreated, sess, inv, token, body.SendEmail == nil || *body.SendEmail)
	return nil
}

func (s *Service) resend(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !members.CanManage(sess.Role) {
		return errForbidden
	}
	ctx, now, token := r.Context(), time.Now(), rand.Text()
	var inv store.Invitation
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := checkRate(ctx, q, sess.Workspace.ID, now); err != nil {
			return err
		}
		var err error
		if inv, err = q.Invitation(ctx, sess.Workspace.ID, r.PathValue("id")); err != nil {
			return err
		}
		if inv.AcceptedAt != nil || inv.RevokedAt != nil {
			return store.ErrNotFound
		}
		if !members.CanAssign(sess.Role, "member", inv.Role) {
			return errForbidden
		}
		if now.Sub(inv.CreatedAt) < resendCooldown {
			return errRate
		}
		inv.CreatedAt, inv.ExpiresAt = now, now.Add(ttl)
		return q.RetokenInvitation(ctx, inv.WorkspaceID, inv.ID, hash(token), inv.ExpiresAt, now)
	})
	if err != nil {
		return err
	}
	s.respond(ctx, w, http.StatusOK, sess, inv, token, true)
	return nil
}

// respond mails the link after the commit when asked; a failed or impossible send only turns email_sent off.
func (s *Service) respond(ctx context.Context, w http.ResponseWriter, status int, sess store.Session, inv store.Invitation, token string, email bool) {
	link := s.publicURL + "/invite?token=" + url.QueryEscape(token)
	sent := false
	if email && s.mailer != nil {
		name, err := s.db.WorkspaceName(ctx, inv.WorkspaceID)
		if err == nil {
			err = s.mailer.Send(ctx, inviteMessage(inv.Email, inviterName(sess), name, inv.Role, link, inv.ExpiresAt.In(sess.Workspace.Location())))
		}
		if err != nil {
			s.log.Error("send invitation", "invitation", inv.ID, "err", err)
		}
		sent = err == nil
	}
	auth.WriteJSON(w, status, map[string]any{"data": created{invitation: view(inv), URL: link, EmailSent: sent}})
}

func (s *Service) revoke(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !members.CanManage(sess.Role) {
		return errForbidden
	}
	ok, err := s.db.RevokeInvitation(r.Context(), sess.Workspace.ID, r.PathValue("id"), time.Now())
	if err != nil {
		return err
	}
	if !ok {
		return store.ErrNotFound
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Service) preview(w http.ResponseWriter, r *http.Request, _ store.Session) error {
	inv, err := s.db.InvitationByToken(r.Context(), hash(r.URL.Query().Get("token")))
	if err != nil {
		return err
	}
	name, err := s.db.WorkspaceName(r.Context(), inv.WorkspaceID)
	if err != nil {
		return err
	}
	status := "open"
	if inv.AcceptedAt != nil || inv.RevokedAt != nil {
		status = "used"
	} else if !inv.ExpiresAt.After(time.Now()) {
		status = "expired"
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"workspace_name": name,
		"invited_by": inv.InvitedBy, "email": inv.Email, "role": inv.Role, "status": status}})
	return nil
}

func (s *Service) accept(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Token string `json:"token"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx, now := r.Context(), time.Now()
	var inv store.Invitation
	err := s.db.Tx(ctx, func(q store.Q) error {
		var err error
		if inv, err = q.InvitationByToken(ctx, hash(body.Token)); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return errInvalid
			}
			return err
		}
		if inv.RevokedAt != nil {
			return errInvalid
		}
		if inv.AcceptedAt != nil {
			if inv.AcceptedBy != sess.User.ID {
				return errInvalid
			}
			if _, err := q.MemberRole(ctx, inv.WorkspaceID, sess.User.ID); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					return errInvalid
				}
				return err
			}
			return nil
		}
		if !inv.ExpiresAt.After(now) {
			return errExpired
		}
		if inv.Email != strings.ToLower(sess.User.Email) {
			return auth.Error(http.StatusForbidden, "invitation_email_mismatch",
				"This invitation was sent to another email address.", map[string]any{"email": inv.Email})
		}
		if ok, err := q.ClaimInvitation(ctx, inv.ID, sess.User.ID, now); err != nil {
			return err
		} else if !ok {
			return errInvalid
		}
		if err := q.JoinInvitedMember(ctx, inv.WorkspaceID, sess.User.ID, inv.Role, inv.Scopes, now); err != nil {
			return err
		}
		return notifications.MemberJoined(ctx, q, inv.WorkspaceID, sess.User, inv.Role, now)
	})
	if errors.Is(err, store.ErrAdmissionDenied) {
		return errNoSeat
	}
	if err != nil {
		return err
	}
	if s.seats != nil {
		s.seats.SyncSeats(ctx, inv.WorkspaceID)
	}
	return s.auth.SwitchWorkspace(w, r, sess, inv.WorkspaceID)
}
