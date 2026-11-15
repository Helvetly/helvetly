package auth

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"helvetly.com/api/internal/store"
)

// Sign-in with Google (OpenID Connect): state, nonce and PKCE travel sealed (AES-GCM, SECRET_KEY) in an
// HttpOnly cookie from the start to the callback, so nothing is stored server-side and a callback in a
// browser that did not start the sign-in fails. The ID token is verified (signature, issuer, audience,
// expiry), then its nonce, and only a verified address signs in.

const (
	loginCookie     = "helvetly_login"
	loginCookiePath = "/api/v1/auth/google"
	loginTTL        = 10 * time.Minute
)

type googleClient struct {
	verifier *oidc.IDTokenVerifier
	oauth    oauth2.Config
}

type loginState struct {
	State         string `json:"s"`
	Nonce         string `json:"n"`
	Verifier      string `json:"v"`
	Next          string `json:"x"`
	Login         string `json:"l,omitempty"`
	Timezone      string `json:"z"`
	Expires       int64  `json:"e"`
	LinkUserID    string `json:"u,omitempty"`
	LinkSessionID string `json:"i,omitempty"`
}

// googleProvider discovers Google once (go-oidc refreshes its keys itself).
func (s *Service) googleProvider(ctx context.Context) (*googleClient, error) {
	s.googleMu.Lock()
	defer s.googleMu.Unlock()
	if s.google != nil {
		return s.google, nil
	}
	dctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	p, err := oidc.NewProvider(dctx, s.googleIssuer)
	if err != nil {
		return nil, fmt.Errorf("google discovery: %w", err)
	}
	s.google = &googleClient{
		verifier: p.Verifier(&oidc.Config{ClientID: s.cfg.GoogleClientID}),
		oauth: oauth2.Config{ClientID: s.cfg.GoogleClientID, ClientSecret: s.cfg.GoogleClientSecret,
			RedirectURL: s.cfg.PublicURL + "/api/v1/auth/google/callback", Endpoint: p.Endpoint(),
			Scopes: []string{oidc.ScopeOpenID, "email", "profile"}},
	}
	return s.google, nil
}

func (s *Service) loginRedirect(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, s.loginPage(r)+"?error="+code, http.StatusFound)
}

// Only a login page on this host may receive OAuth errors and two-factor challenges.
func (s *Service) loginPage(r *http.Request) string {
	login := r.URL.Query().Get("login")
	if login == "" {
		if cookie, err := r.Cookie(loginCookie); err == nil {
			var state loginState
			if s.unseal(cookie.Value, &state) == nil {
				login = state.Login
			}
		}
	}
	if match := loginPathPattern.FindString(login); match != "" && match == login {
		return strings.TrimSuffix(login, "/")
	}
	return "/login"
}

func (s *Service) setLoginCookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: loginCookie, Value: value, Path: loginCookiePath, MaxAge: maxAge, HttpOnly: true,
		Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
}

func (s *Service) googleStart(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.GoogleSignIn() {
		s.loginRedirect(w, r, "login_failed")
		return
	}
	g, err := s.googleProvider(r.Context())
	if err != nil {
		s.log.ErrorContext(r.Context(), "google sign-in unavailable", "error", err)
		s.loginRedirect(w, r, "login_failed")
		return
	}
	q := r.URL.Query()
	st := loginState{State: rand.Text(), Nonce: rand.Text(), Verifier: oauth2.GenerateVerifier(), Next: SafeNext(q.Get("next")),
		Login: s.loginPage(r), Timezone: q.Get("timezone"), Expires: s.now().Add(loginTTL).Unix()}
	sealed, err := s.seal(st)
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	s.setLoginCookie(w, sealed, int(loginTTL.Seconds()))
	http.Redirect(w, r, g.oauth.AuthCodeURL(st.State, oidc.Nonce(st.Nonce), oauth2.S256ChallengeOption(st.Verifier),
		oauth2.SetAuthURLParam("prompt", "select_account")), http.StatusFound)
}

// googleCallback lands on `next` with a new session, or on /login?error=<code>.
func (s *Service) googleCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var sealed string
	if c, err := r.Cookie(loginCookie); err == nil {
		sealed = c.Value
	}
	s.setLoginCookie(w, "", -1) // single use, whatever happens next
	if q.Get("error") != "" {
		s.loginRedirect(w, r, "google_cancelled")
		return
	}
	var st loginState
	if s.unseal(sealed, &st) == nil && st.LinkUserID != "" {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil {
			s.loginRedirect(w, r, "login_expired")
			return
		}
		sess, err := s.db.SessionByToken(r.Context(), hashSecret(cookie.Value), s.now())
		if err != nil || sess.User.ID != st.LinkUserID || sess.ID != st.LinkSessionID {
			s.loginRedirect(w, r, "login_expired")
			return
		}
	}
	ns, next, code := s.completeGoogle(withSessionClient(r), sealed, q.Get("state"), q.Get("code"))
	if code != "" {
		s.loginRedirect(w, r, code)
		return
	}
	if ns.challenge != "" {
		http.Redirect(w, r, s.loginPage(r)+"?two_factor=1#challenge="+ns.challenge, http.StatusFound)
		return
	}
	if ns.linked {
		http.Redirect(w, r, next, http.StatusFound)
		return
	}
	s.setSessionCookie(w, ns)
	http.Redirect(w, r, next, http.StatusFound)
}

// completeGoogle returns the new session and where to go, or the /login error code.
func (s *Service) completeGoogle(ctx context.Context, sealed, state, code string) (newSession, string, string) {
	if !s.cfg.GoogleSignIn() {
		return newSession{}, "", "login_failed"
	}
	var st loginState
	if sealed == "" || s.unseal(sealed, &st) != nil || s.now().Unix() > st.Expires ||
		state == "" || subtle.ConstantTimeCompare([]byte(state), []byte(st.State)) != 1 {
		return newSession{}, "", "login_expired" // too slow, or started in another browser
	}
	failed := func(msg string, err error) (newSession, string, string) {
		s.log.WarnContext(ctx, "google sign-in failed: "+msg, "error", err)
		return newSession{}, "", "login_failed"
	}
	g, err := s.googleProvider(ctx)
	if err != nil {
		return failed("unavailable", err)
	}
	xctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	tok, err := g.oauth.Exchange(xctx, code, oauth2.VerifierOption(st.Verifier))
	if err != nil {
		return failed("code exchange", err)
	}
	raw, _ := tok.Extra("id_token").(string)
	idt, err := g.verifier.Verify(xctx, raw)
	if err != nil {
		return failed("id token", err)
	}
	var claims struct {
		Subject       string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
		Nonce         string `json:"nonce"`
	}
	if err := idt.Claims(&claims); err != nil || claims.Subject == "" {
		return failed("claims", err)
	}
	if subtle.ConstantTimeCompare([]byte(claims.Nonce), []byte(st.Nonce)) != 1 {
		return failed("nonce", errors.New("the ID token belongs to another sign-in"))
	}
	if !claims.EmailVerified || claims.Email == "" {
		return newSession{}, "", "email_unverified"
	}
	var ns newSession
	err = s.db.Tx(ctx, func(q store.Q) error {
		if st.LinkUserID != "" {
			if err := s.linkGoogle(ctx, q, st, identity{provider: providerGoogle, subject: claims.Subject, email: claims.Email}); err != nil {
				return err
			}
			ns.linked = true
			return nil
		}
		var err error
		ns, err = s.signInIdentity(ctx, q, identity{provider: providerGoogle, subject: claims.Subject, email: claims.Email,
			name: claims.Name, picture: claims.Picture}, st.Timezone, st.Next)
		return err
	})
	if err != nil {
		s.log.ErrorContext(ctx, "google sign-in failed", "error", err)
		var ae *apiError
		if errors.As(err, &ae) && ae.code == "identity_taken" {
			return newSession{}, "", "identity_taken"
		}
		return newSession{}, "", "login_failed"
	}
	return ns, SafeNext(st.Next), ""
}

// seal encrypts v as JSON with SECRET_KEY (AES-256-GCM), for a cookie.
func (s *Service) seal(v any) (string, error) {
	plain, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	gcm, err := s.gcm()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(gcm.Seal(nonce, nonce, plain, nil)), nil
}

func (s *Service) unseal(sealed string, v any) error {
	raw, err := base64.RawURLEncoding.DecodeString(sealed)
	if err != nil {
		return err
	}
	gcm, err := s.gcm()
	if err != nil {
		return err
	}
	if len(raw) < gcm.NonceSize() {
		return errors.New("sealed value too short")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return err
	}
	return json.Unmarshal(plain, v)
}

func (s *Service) gcm() (cipher.AEAD, error) {
	block, err := aes.NewCipher(s.cfg.SecretKey)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
