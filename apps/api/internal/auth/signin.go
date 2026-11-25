package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"net/url"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/store"
)

const (
	providerGoogle = "google"
	providerEmail  = "email"
)

// identity is a verified sign-in: Google (subject: its `sub`) or an email code (subject: the address).
type identity struct {
	provider, subject, email, name, picture string
}

// signInIdentity finds or creates the person and opens a fresh session, in the caller's transaction.
func (s *Service) signInIdentity(ctx context.Context, q store.Q, id identity, timezone, next string) (newSession, error) {
	user, err := s.upsertUser(ctx, q, id)
	if err != nil {
		return newSession{}, err
	}
	return s.signInUser(ctx, q, user, timezone, next)
}

// signInUser opens a session in the person's first workspace. Someone without one joins the workspaces
// that invited their address (the session goes to the newest), else gets "My workspace".
func (s *Service) signInUser(ctx context.Context, q store.Q, user store.User, timezone, next string) (newSession, error) {
	if err := q.LockAccount(ctx, user.ID); err != nil {
		return newSession{}, err
	}
	wsID, err := q.HomeWorkspace(ctx, user.ID)
	if errors.Is(err, store.ErrNotFound) {
		now := s.now()
		wsID, err = s.joinInvited(ctx, q, user, now)
		if err == nil && wsID == "" {
			wsID = NewID("wsp")
			if err = q.CreateWorkspace(ctx, store.Workspace{ID: wsID, Name: "My workspace"}, signInZone(timezone), now); err == nil {
				err = q.AddMember(ctx, wsID, user.ID, "owner", now)
			}
		}
	}
	if err != nil {
		return newSession{}, err
	}
	factor, err := q.AccountTwoFactor(ctx, user.ID)
	if err != nil {
		return newSession{}, err
	}
	if factor.Enabled {
		challenge := rand.Text()
		err := q.CreateFactorChallenge(ctx, hashSecret(challenge), user.ID, wsID, SafeNext(next), s.now())
		return newSession{challenge: challenge}, err
	}
	return s.createSession(ctx, q, user.ID, wsID)
}

// joinInvited accepts the address's open invitations, newest first; it returns the newest joined workspace, "" if none.
func (s *Service) joinInvited(ctx context.Context, q store.Q, user store.User, now time.Time) (string, error) {
	invs, err := q.OpenInvitationsForEmail(ctx, user.Email, now)
	if err != nil {
		return "", err
	}
	newest := ""
	for _, inv := range slices.Backward(invs) { // the query is oldest first
		claimed, err := q.ClaimInvitation(ctx, inv.ID, user.ID, now)
		if err != nil {
			return "", err
		}
		if !claimed {
			continue
		}
		if err := q.JoinMember(ctx, inv.WorkspaceID, user.ID, inv.Role, inv.Scopes, now); err != nil {
			return "", err
		}
		if s.OnJoin != nil {
			if err := s.OnJoin(ctx, q, inv.WorkspaceID, user, inv.Role, now); err != nil {
				return "", err
			}
		}
		if newest == "" {
			newest = inv.WorkspaceID
		}
	}
	return newest, nil
}

// upsertUser finds the person by the identity, else by its verified address (the address is the person:
// a Google account and an email code for one address are one user, and the new identity is added), else
// creates them. The profile is refreshed: a provider's name only fills an empty one; Google's picture is kept
// (shown unless the person uploaded their own photo).
func (s *Service) upsertUser(ctx context.Context, q store.Q, id identity) (store.User, error) {
	now := s.now()
	email := strings.ToLower(strings.TrimSpace(id.email))
	name, picture := truncateRunes(strings.TrimSpace(id.name), 200), id.picture
	if len(picture) > 1000 || !strings.HasPrefix(picture, "https://") {
		picture = ""
	}
	if err := q.LockAddress(ctx, email); err != nil { // two first sign-ins for one address make one person
		return store.User{}, err
	}
	u, err := q.UserByIdentity(ctx, id.provider, id.subject)
	if errors.Is(err, store.ErrNotFound) {
		u, err = q.UserByEmail(ctx, email)
		if errors.Is(err, store.ErrNotFound) {
			u = store.User{ID: NewID("usr"), Email: email, Name: name, AvatarURL: picture}
			if err := q.CreateUser(ctx, u, now); err != nil {
				return store.User{}, err
			}
			if err := q.QueueAdminAlert(ctx, "Nowa rejestracja\nUżytkownik: "+u.ID); err != nil {
				return store.User{}, err
			}
		} else if err != nil {
			return store.User{}, err
		}
		if err := q.CreateIdentity(ctx, id.provider, id.subject, u.ID, email, now); err != nil {
			return store.User{}, err
		}
	} else if err != nil {
		return store.User{}, err
	}
	if u.Name == "" {
		u.Name = name
	}
	var google *string // other sign-in methods keep the picture as it is
	if id.provider == providerGoogle {
		google = &picture
	}
	if err := q.UpdateUserProfile(ctx, u.ID, u.Name, google, now); err != nil {
		return store.User{}, err
	}
	return q.User(ctx, u.ID)
}

// SafeNext keeps a redirect on the platform: a same-origin path, never another host and never /login.
func SafeNext(next string) string {
	if next == "" || len(next) > 512 || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") ||
		strings.ContainsAny(next, "\\\r\n\t") {
		return "/"
	}
	u, err := url.Parse(next)
	if err != nil || u.Scheme != "" || u.Host != "" || u.Path == "/login" || strings.HasPrefix(u.Path, "/login/") {
		return "/"
	}
	return next
}

// signInZone: the browser's IANA zone for a new person's first workspace, UTC when it isn't one.
func signInZone(tz string) string {
	tz = strings.TrimSpace(tz)
	if tz == "" || tz == "Local" || len(tz) > 64 {
		return "UTC"
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return "UTC"
	}
	return tz
}
