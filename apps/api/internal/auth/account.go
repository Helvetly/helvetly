package auth

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/store"
)

func (s *Service) registerAccount(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/two-factor/verify", s.factorVerify)
	mux.HandleFunc("POST /api/v1/account/two-factor/setup", s.SignedIn(s.factorSetup))
	mux.HandleFunc("POST /api/v1/account/two-factor/enable", s.SignedIn(s.factorEnable))
	mux.HandleFunc("DELETE /api/v1/account/two-factor", s.SignedIn(s.factorDisable))
	mux.HandleFunc("GET /api/v1/account", s.SignedIn(s.account))
	mux.HandleFunc("PATCH /api/v1/account", s.SignedIn(s.updateAccount))
	mux.HandleFunc("DELETE /api/v1/account", s.SignedIn(s.closeAccount))
	mux.HandleFunc("GET /api/v1/account/sessions", s.SignedIn(s.accountSessions))
	mux.HandleFunc("DELETE /api/v1/account/sessions", s.SignedIn(s.deleteOtherSessions))
	mux.HandleFunc("DELETE /api/v1/account/sessions/{id}", s.SignedIn(s.deleteAccountSession))
	mux.HandleFunc("DELETE /api/v1/account/identities/{provider}", s.SignedIn(s.disconnectIdentity))
	mux.HandleFunc("POST /api/v1/account/identities/google/start", s.SignedIn(s.connectGoogle))
	mux.HandleFunc("GET /api/v1/account/tokens", s.SignedIn(s.listTokens))
	mux.HandleFunc("POST /api/v1/account/tokens", s.SignedIn(s.createToken))
	mux.HandleFunc("DELETE /api/v1/account/tokens/{id}", s.SignedIn(s.deleteToken))
}

func (s *Service) account(w http.ResponseWriter, r *http.Request, sess store.Session) {
	ids, err := s.db.AccountIdentities(r.Context(), sess.User.ID)
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	factor, err := s.db.AccountTwoFactor(r.Context(), sess.User.ID)
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"identities": ids, "two_factor": map[string]any{"enabled": factor.Enabled, "recovery_codes_left": factor.RecoveryCodes}}})
}

// maxPersonNameRunes is the longest name a person can give themselves; longer ones stored earlier stay as they are.
const maxPersonNameRunes = 60

func (s *Service) updateAccount(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var in struct {
		Name string `json:"name"`
	}
	if !s.Decode(w, r, &in) {
		return
	}
	name := strings.TrimSpace(in.Name)
	// Saving the name already stored (a longer one from before the limit) is not a change to refuse.
	if name == "" || !utf8.ValidString(name) || (utf8.RuneCountInString(name) > maxPersonNameRunes && name != sess.User.Name) {
		s.WriteError(w, r, Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.", map[string]any{"fields": map[string]string{"name": fmt.Sprintf("Enter a name of up to %d characters.", maxPersonNameRunes)}}))
		return
	}
	u, err := s.db.UpdateAccountName(r.Context(), sess.User.ID, name, s.now())
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]string{"id": u.ID, "email": u.Email, "name": u.Name, "avatar_url": u.AvatarURL}})
}

func (s *Service) closeAccount(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var in struct {
		Email string `json:"email"`
	}
	if !s.Decode(w, r, &in) {
		return
	}
	if in.Email != sess.User.Email {
		s.WriteError(w, r, Error(http.StatusUnprocessableEntity, "validation_failed", "Enter your email address to delete your account.", map[string]any{"fields": map[string]string{"email": "Enter your account's email address."}}))
		return
	}
	var objects []string
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockAccount(r.Context(), sess.User.ID); err != nil {
			return err
		}
		sole, err := q.AccountSoleOwner(r.Context(), sess.User.ID)
		if err != nil {
			return err
		}
		if sole {
			return Error(http.StatusConflict, "sole_owner", "Transfer ownership or delete each workspace where you are the last owner before deleting your account.", nil)
		}
		objects, err = q.CloseAccount(r.Context(), sess.User.ID, s.now())
		return err
	})
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	for _, key := range objects {
		if s.OnPhotoRemoved != nil {
			s.OnPhotoRemoved(r.Context(), key)
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
}

var browserVersion = regexp.MustCompile(`(Edg|OPR|Chrome|Firefox|Version)/([0-9]+)`)

func sessionDevice(agent string) (browser, os, device string) {
	browser, os, device = "Unknown browser", "Unknown OS", "desktop"
	for _, kind := range []struct{ marker, name string }{{"Edg/", "Edge"}, {"OPR/", "Opera"}, {"Firefox/", "Firefox"}, {"Chrome/", "Chrome"}, {"Version/", "Safari"}} {
		if strings.Contains(agent, kind.marker) {
			browser = kind.name
			for _, match := range browserVersion.FindAllStringSubmatch(agent, -1) {
				if strings.HasPrefix(kind.marker, match[1]+"/") {
					browser += " " + match[2]
					break
				}
			}
			break
		}
	}
	switch {
	case strings.Contains(agent, "iPad"):
		os, device = "iPadOS", "tablet"
	case strings.Contains(agent, "iPhone"):
		os, device = "iOS", "mobile"
	case strings.Contains(agent, "Android"):
		os = "Android"
		if strings.Contains(agent, "Mobile") {
			device = "mobile"
		} else {
			device = "tablet"
		}
	case strings.Contains(agent, "Windows"):
		os = "Windows"
	case strings.Contains(agent, "Macintosh"):
		os = "macOS"
	case strings.Contains(agent, "Linux"):
		os = "Linux"
	}
	return
}

func (s *Service) accountSessions(w http.ResponseWriter, r *http.Request, sess store.Session) {
	rows, err := s.db.AccountSessions(r.Context(), sess.User.ID, s.now())
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		browser, os, device := sessionDevice(row.UserAgent)
		out = append(out, map[string]any{"id": row.ID, "browser": browser, "os": os, "device": device, "ip": row.IP, "location": nil, "workspace_name": row.WorkspaceName, "created_at": row.CreatedAt.UTC(), "last_active_at": row.LastActiveAt.UTC(), "current": row.ID == sess.ID})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": out})
}

func (s *Service) deleteAccountSession(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if r.PathValue("id") == sess.ID {
		s.WriteError(w, r, Error(http.StatusConflict, "current_session", "Sign out to end this session.", nil))
		return
	}
	ok, err := s.db.DeleteAccountSession(r.Context(), sess.User.ID, r.PathValue("id"))
	if err == nil && !ok {
		err = ErrNotFound
	}
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) deleteOtherSessions(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if err := s.db.DeleteOtherAccountSessions(r.Context(), sess.User.ID, sess.ID); err != nil {
		s.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) disconnectIdentity(w http.ResponseWriter, r *http.Request, sess store.Session) {
	provider := r.PathValue("provider")
	if provider == providerEmail {
		s.WriteError(w, r, Error(http.StatusConflict, "invalid_state", "Your verified email address remains a sign-in method.", nil))
		return
	}
	if provider != providerGoogle {
		s.WriteError(w, r, ErrNotFound)
		return
	}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockAccount(r.Context(), sess.User.ID); err != nil {
			return err
		}
		if !s.cfg.EmailSignIn() {
			keys, err := q.ListPasskeys(r.Context(), sess.User.ID)
			if err != nil {
				return err
			}
			if len(keys) == 0 {
				return Error(http.StatusConflict, "invalid_state", "Add a passkey before disconnecting your only enabled sign-in method.", nil)
			}
		}
		return q.DeleteAccountIdentity(r.Context(), sess.User.ID, provider)
	})
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
