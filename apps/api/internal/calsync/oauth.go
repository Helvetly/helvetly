package calsync

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"time"

	"golang.org/x/oauth2"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Connecting a calendar: state, nonce and PKCE travel sealed in an HttpOnly cookie from the start to the callback (as
// Google sign-in does), together with the person, workspace and session that started it, so the callback only
// connects for that same signed-in session. A missing scope is refused, never half-connected.

type oauthState struct {
	State     string `json:"s"`
	Nonce     string `json:"n"`
	Verifier  string `json:"v"`
	Provider  string `json:"p"`
	UserID    string `json:"u"`
	Workspace string `json:"w"`
	SessionID string `json:"i"`
	Expires   int64  `json:"e"`
}

func (s *Service) setStateCookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Value: value, Path: statePath, MaxAge: maxAge, HttpOnly: true,
		Secure: s.cookieSecure, SameSite: http.SameSiteLaxMode})
}

func (s *Service) connect(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	p := s.providers[r.PathValue("provider")]
	if p == nil {
		return errNoProvider
	}
	if err := s.requireFeature(r.Context(), sess.Workspace.ID); err != nil {
		return err
	}
	st := oauthState{State: rand.Text(), Nonce: rand.Text(), Verifier: oauth2.GenerateVerifier(), Provider: p.name(), UserID: sess.User.ID,
		Workspace: sess.Workspace.ID, SessionID: sess.ID, Expires: s.now().Add(stateTTL).Unix()}
	sealed, err := s.seal.cookie(st)
	if err != nil {
		return err
	}
	s.setStateCookie(w, sealed, int(stateTTL.Seconds()))
	opts := append([]oauth2.AuthCodeOption{oauth2.SetAuthURLParam("nonce", st.Nonce), oauth2.S256ChallengeOption(st.Verifier)}, p.authOptions()...)
	http.Redirect(w, r, p.oauth().AuthCodeURL(st.State, opts...), http.StatusFound)
	return nil
}

// Callback outcomes, as /account?calendar_error=<code>.
const (
	errCancelled = "cancelled"
	errScopes    = "scopes_missing"
	errInUse     = "account_in_use"
	errExpired   = "expired"
	errConnected = "already_connected"
	errFailed    = "failed"
)

func (s *Service) callback(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	p := s.providers[r.PathValue("provider")]
	if p == nil {
		return errNoProvider
	}
	var sealed string
	if c, err := r.Cookie(stateCookie); err == nil {
		sealed = c.Value
	}
	s.setStateCookie(w, "", -1) // single use, whatever happens next
	code := s.complete(r.Context(), p, sess, sealed, r.URL.Query())
	target := "/account?calendar=connected"
	if code != "" {
		target = "/account?calendar_error=" + code
	}
	http.Redirect(w, r, target, http.StatusFound)
	return nil
}

// complete stores the connection, or returns why not.
func (s *Service) complete(ctx context.Context, p provider, sess store.Session, sealed string, query url.Values) string {
	if query.Get("error") != "" {
		return errCancelled
	}
	var st oauthState
	if sealed == "" || s.seal.uncookie(sealed, &st) != nil || s.now().Unix() > st.Expires || st.Provider != p.name() ||
		subtle.ConstantTimeCompare([]byte(query.Get("state")), []byte(st.State)) != 1 ||
		st.UserID != sess.User.ID || st.Workspace != sess.Workspace.ID || st.SessionID != sess.ID {
		return errExpired
	}
	if s.requireFeature(ctx, sess.Workspace.ID) != nil {
		return errFailed
	}
	failed := func(msg string, err error) string {
		s.log.WarnContext(ctx, "calendar connect failed: "+msg, "provider", p.name(), "error", err)
		return errFailed
	}
	xctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	tok, err := p.oauth().Exchange(s.httpContext(xctx, p), query.Get("code"), oauth2.VerifierOption(st.Verifier))
	if err != nil {
		return failed("code exchange", err)
	}
	acct, err := p.account(tok, st.Nonce, s.now())
	if err != nil {
		return failed("account", err)
	}
	if !p.scopesOK(acct.Scopes) || tok.RefreshToken == "" {
		return errScopes
	}
	c := store.CalendarConnection{ID: auth.NewID("cal"), WorkspaceID: sess.Workspace.ID, UserID: sess.User.ID, Provider: p.name(),
		AccountEmail: acct.Email, ExternalAccountID: acct.Subject, Scopes: acct.Scopes, CreatedAt: s.now()}
	existing, err := s.db.CalendarConnections(ctx, sess.Workspace.ID, sess.User.ID)
	if err != nil {
		return failed("read", err)
	}
	if i := slices.IndexFunc(existing, func(e store.CalendarConnection) bool { return e.Provider == p.name() }); i >= 0 {
		if existing[i].ExternalAccountID != acct.Subject {
			return errConnected
		}
		c = existing[i] // the same account again (after it was revoked): new tokens, active again
	}
	cals, err := p.calendars(xctx, session{id: c.ID, access: tok.AccessToken})
	if err != nil {
		return failed("calendar list", err)
	}
	access, err1 := s.seal.seal(c.WorkspaceID, c.ID, "access", tok.AccessToken)
	refresh, err2 := s.seal.seal(c.WorkspaceID, c.ID, "refresh", tok.RefreshToken)
	if err := errors.Join(err1, err2); err != nil {
		return failed("seal", err)
	}
	expiry := tok.Expiry.UTC()
	var primary []string
	for _, cal := range cals {
		if cal.Primary {
			primary = append(primary, cal.ID)
			if c.PushCalendarID == nil {
				c.PushCalendarID = &cal.ID
			}
		}
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if c.Status == "" {
			c.RefreshToken, c.AccessToken, c.AccessExpiresAt = refresh, access, &expiry
			if err := q.CreateCalendarConnection(ctx, c); err != nil {
				return err
			}
		} else {
			if err := q.SaveCalendarTokens(ctx, c.ID, access, refresh, &expiry, s.now()); err != nil {
				return err
			}
			if err := q.SetCalendarStatus(ctx, c.ID, "active", nil, s.now()); err != nil {
				return err
			}
		}
		// the primary calendar is imported by default: busy times, and the host's moves of pushed sessions
		if err := q.SaveCalendarSources(ctx, c.ID, sourcesOf(c.ID, cals, primary), s.now()); err != nil {
			return err
		}
		if err := s.enqueueAll(ctx, q, c); err != nil {
			return err
		}
		return s.audit(ctx, q, c.WorkspaceID, &sess.User.ID, c.ID, "scheduling.calendar_connected", map[string]any{"provider": c.Provider})
	})
	switch {
	case errors.Is(err, store.ErrCalendarAccountInUse):
		return errInUse
	case errors.Is(err, store.ErrCalendarConnected):
		return errConnected
	case err != nil:
		return failed("store", err)
	}
	return ""
}
