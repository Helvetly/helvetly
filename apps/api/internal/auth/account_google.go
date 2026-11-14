package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"net/http"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/oauth2"
	"helvetly.com/api/internal/store"
)

func (s *Service) connectGoogle(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var in struct {
		Next string `json:"next"`
	}
	if !s.Decode(w, r, &in) {
		return
	}
	if !s.cfg.GoogleSignIn() {
		s.WriteError(w, r, Error(http.StatusServiceUnavailable, "google_unavailable", "Google sign-in is not configured on this server.", nil))
		return
	}
	g, err := s.googleProvider(r.Context())
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	st := loginState{State: rand.Text(), Nonce: rand.Text(), Verifier: oauth2.GenerateVerifier(), Next: SafeNext(in.Next), Expires: s.now().Add(loginTTL).Unix(), LinkUserID: sess.User.ID, LinkSessionID: sess.ID}
	sealed, err := s.seal(st)
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	s.setLoginCookie(w, sealed, int(loginTTL.Seconds()))
	u := g.oauth.AuthCodeURL(st.State, oidc.Nonce(st.Nonce), oauth2.S256ChallengeOption(st.Verifier), oauth2.SetAuthURLParam("prompt", "select_account"))
	WriteJSON(w, http.StatusOK, map[string]string{"url": u})
}

func (s *Service) linkGoogle(ctx context.Context, q store.Q, st loginState, id identity) error {
	taken := Error(http.StatusConflict, "identity_taken", "That Google account is already linked to another person.", nil)
	email := strings.ToLower(strings.TrimSpace(id.email))
	if err := q.LockAddress(ctx, email); err != nil {
		return err
	}
	if err := q.LockAccount(ctx, st.LinkUserID); err != nil {
		return err
	}
	if ok, err := q.AccountSessionLive(ctx, st.LinkUserID, st.LinkSessionID, s.now()); err != nil {
		return err
	} else if !ok {
		return errUnauthenticated
	}
	user, err := q.UserByIdentity(ctx, providerGoogle, id.subject)
	if err == nil {
		if user.ID != st.LinkUserID {
			return taken
		}
		return nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return err
	}
	if user, err = q.UserByEmail(ctx, email); err == nil && user.ID != st.LinkUserID {
		return taken
	} else if err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	ids, err := q.AccountIdentities(ctx, st.LinkUserID)
	if err != nil {
		return err
	}
	for _, existing := range ids {
		if existing.Provider == providerGoogle {
			return Error(http.StatusConflict, "invalid_state", "Disconnect the current Google account before linking another.", nil)
		}
	}
	err = q.CreateIdentity(ctx, providerGoogle, id.subject, st.LinkUserID, email, s.now())
	var duplicate *pgconn.PgError
	if errors.As(err, &duplicate) && duplicate.Code == "23505" {
		return taken
	}
	return err
}
