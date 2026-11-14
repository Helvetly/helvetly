package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"helvetly.com/api/internal/store"
)

// Passkeys (WebAuthn): a signed-in person adds one, then signs in with it without typing an address (a
// discoverable credential names the person). The relying party is the platform (PUBLIC_URL): its host is
// the RP ID, its origin the only one allowed. Each ceremony's challenge is kept server-side, single use,
// for passkeyChallengeTTL.

const (
	passkeyChallengeTTL = 5 * time.Minute
	challengeRegister   = "register"
	challengeSignIn     = "sign_in"
)

var (
	errPasskeyFailed  = &apiError{status: http.StatusUnauthorized, code: "passkey_failed", message: "This passkey could not be checked: try again or sign in another way."}
	errPasskeyExpired = &apiError{status: http.StatusGone, code: "passkey_expired", message: "This passkey prompt expired: try again."}
	// Adding a passkey happens signed in: a 401 there would sign the person out of the app (the client treats any
	// 401 on a signed-in call as a lost session).
	errPasskeyRejected = &apiError{status: http.StatusUnprocessableEntity, code: "passkey_failed", message: "This passkey could not be added: try again."}
)

func newWebAuthn(publicURL string) (*webauthn.WebAuthn, error) {
	u, err := url.Parse(publicURL)
	if err != nil {
		return nil, fmt.Errorf("passkeys: %w", err)
	}
	wa, err := webauthn.New(&webauthn.Config{RPID: u.Hostname(), RPDisplayName: "Helvetly", RPOrigins: []string{publicURL}})
	if err != nil {
		return nil, fmt.Errorf("passkeys: %w", err)
	}
	return wa, nil
}

// passkeyUser adapts a person to the library. The user handle is the person's id: random, never an address.
type passkeyUser struct {
	user  store.User
	creds []webauthn.Credential
}

func (u passkeyUser) WebAuthnID() []byte   { return []byte(u.user.ID) }
func (u passkeyUser) WebAuthnName() string { return u.user.Email }
func (u passkeyUser) WebAuthnDisplayName() string {
	if u.user.Name != "" {
		return u.user.Name
	}
	return u.user.Email
}
func (u passkeyUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

func loadPasskeyUser(ctx context.Context, q store.Q, userID string) (passkeyUser, error) {
	user, err := q.User(ctx, userID)
	if err != nil {
		return passkeyUser{}, err
	}
	rows, err := q.ListPasskeys(ctx, userID)
	if err != nil {
		return passkeyUser{}, err
	}
	u := passkeyUser{user: user}
	for _, r := range rows {
		var c webauthn.Credential
		if err := json.Unmarshal(r.Credential, &c); err != nil {
			return passkeyUser{}, err
		}
		u.creds = append(u.creds, c)
	}
	return u, nil
}

// saveChallenge stores the ceremony and answers {challenge_id, options} (options: the WebAuthn publicKey
// JSON for navigator.credentials).
func (s *Service) saveChallenge(w http.ResponseWriter, r *http.Request, purpose, userID string, session *webauthn.SessionData, options any) {
	data, err := json.Marshal(session)
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	id, now := NewID("pkc"), s.now()
	if err := s.db.CreatePasskeyChallenge(r.Context(), id, purpose, userID, data, now, now.Add(passkeyChallengeTTL), now.Add(-time.Hour)); err != nil {
		s.WriteError(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"challenge_id": id, "options": options})
}

// takeChallenge: the ceremony's session, deleted as it is read (a replayed answer finds nothing). Taken
// outside the caller's transaction, so a refused answer uses the challenge up too.
func (s *Service) takeChallenge(ctx context.Context, id, purpose, userID string) (webauthn.SessionData, error) {
	data, err := s.db.TakePasskeyChallenge(ctx, id, purpose, userID, s.now())
	if errors.Is(err, store.ErrNotFound) {
		return webauthn.SessionData{}, errPasskeyExpired
	}
	if err != nil {
		return webauthn.SessionData{}, err
	}
	var sd webauthn.SessionData
	return sd, json.Unmarshal(data, &sd)
}

// passkeyAllowed: sign-in ceremonies are limited per client address.
func (s *Service) passkeyAllowed(w http.ResponseWriter, r *http.Request) bool {
	if s.passkeyLimit.allow(clientIP(r)) {
		return true
	}
	w.Header().Set("Retry-After", "600")
	s.WriteError(w, r, &apiError{status: http.StatusTooManyRequests, code: "rate_limited", message: "Too many passkey sign-ins from this network: try again later."})
	return false
}

func (s *Service) passkeySignInStart(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if !s.Decode(w, r, &in) || !s.passkeyAllowed(w, r) {
		return
	}
	assertion, session, err := s.webauthn.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationPreferred))
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	s.saveChallenge(w, r, challengeSignIn, "", session, assertion.Response)
}

// passkeySignInFinish checks the answer and signs the passkey's person in with a fresh session. A sign
// counter that did not go up (a cloned authenticator) is refused.
func (s *Service) passkeySignInFinish(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ChallengeID string          `json:"challenge_id"`
		Response    json.RawMessage `json:"response"`
		Next        string          `json:"next"`
	}
	if !s.Decode(w, r, &in) || !s.passkeyAllowed(w, r) {
		return
	}
	ctx := withSessionClient(r)
	parsed, err := protocol.ParseCredentialRequestResponseBytes(in.Response)
	if err != nil {
		s.WriteError(w, r, errPasskeyFailed)
		return
	}
	session, err := s.takeChallenge(ctx, in.ChallengeID, challengeSignIn, "")
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	var ns newSession
	err = s.db.Tx(ctx, func(q store.Q) error {
		var row store.Passkey
		handler := func(rawID, userHandle []byte) (webauthn.User, error) {
			var err error
			if row, err = q.PasskeyByCredentialID(ctx, base64.RawURLEncoding.EncodeToString(rawID)); err != nil {
				return nil, err
			}
			if row.UserID != string(userHandle) {
				return nil, errors.New("user handle does not match the passkey")
			}
			return loadPasskeyUser(ctx, q, row.UserID)
		}
		u, cred, err := s.webauthn.ValidatePasskeyLogin(handler, session, parsed)
		if err != nil {
			s.log.InfoContext(ctx, "passkey sign-in refused", "error", err)
			return errPasskeyFailed
		}
		if cred.Authenticator.CloneWarning {
			return &apiError{status: http.StatusUnauthorized, code: "passkey_cloned",
				message: "This passkey looks copied to another device: sign in another way and remove it from your account."}
		}
		data, err := json.Marshal(cred)
		if err != nil {
			return err
		}
		if err := q.UsePasskey(ctx, row.ID, data, s.now()); err != nil {
			return err
		}
		ns, err = s.signInUser(ctx, q, u.(passkeyUser).user, "", in.Next)
		return err
	})
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	s.signedInResponse(w, ns, SafeNext(in.Next))
}

// passkeyAddStart: options for navigator.credentials.create. The passkey must be discoverable; the
// person's passkeys are excluded so a device is not added twice.
func (s *Service) passkeyAddStart(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var in struct{}
	if !s.Decode(w, r, &in) {
		return
	}
	u, err := loadPasskeyUser(r.Context(), s.db.Q, sess.User.ID)
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	exclude := make([]protocol.CredentialDescriptor, 0, len(u.creds))
	for _, c := range u.creds {
		exclude = append(exclude, c.Descriptor())
	}
	creation, session, err := s.webauthn.BeginRegistration(u,
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey: protocol.ResidentKeyRequirementRequired, RequireResidentKey: protocol.ResidentKeyRequired(),
			UserVerification: protocol.VerificationPreferred,
		}),
		webauthn.WithExclusions(exclude))
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	s.saveChallenge(w, r, challengeRegister, sess.User.ID, session, creation.Response)
}

func (s *Service) passkeyAddFinish(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var in struct {
		ChallengeID string          `json:"challenge_id"`
		Name        string          `json:"name"`
		Response    json.RawMessage `json:"response"`
	}
	if !s.Decode(w, r, &in) {
		return
	}
	ctx := r.Context()
	name := truncateRunes(strings.TrimSpace(in.Name), 100)
	if name == "" {
		name = "Passkey"
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(in.Response)
	if err != nil {
		s.WriteError(w, r, errPasskeyRejected)
		return
	}
	session, err := s.takeChallenge(ctx, in.ChallengeID, challengeRegister, sess.User.ID)
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		u, err := loadPasskeyUser(ctx, q, sess.User.ID)
		if err != nil {
			return err
		}
		cred, err := s.webauthn.CreateCredential(u, session, parsed)
		if err != nil {
			s.log.InfoContext(ctx, "passkey registration refused", "error", err)
			return errPasskeyRejected
		}
		credID := base64.RawURLEncoding.EncodeToString(cred.ID)
		if _, err := q.PasskeyByCredentialID(ctx, credID); err == nil {
			return &apiError{status: http.StatusConflict, code: "passkey_exists", message: "This passkey is already added."}
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		data, err := json.Marshal(cred)
		if err != nil {
			return err
		}
		return q.CreatePasskey(ctx, NewID("pk"), sess.User.ID, credID, name, data, s.now())
	})
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	s.writePasskeys(w, r, http.StatusCreated, sess.User.ID)
}

func (s *Service) listPasskeys(w http.ResponseWriter, r *http.Request, sess store.Session) {
	s.writePasskeys(w, r, http.StatusOK, sess.User.ID)
}

// Keep one enabled sign-in method even when email sign-in is disabled by the operator.
func (s *Service) deletePasskey(w http.ResponseWriter, r *http.Request, sess store.Session) {
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockAccount(r.Context(), sess.User.ID); err != nil {
			return err
		}
		keys, err := q.ListPasskeys(r.Context(), sess.User.ID)
		if err != nil {
			return err
		}
		found := false
		for _, key := range keys {
			if key.ID == r.PathValue("id") {
				found = true
			}
		}
		if !found {
			return ErrNotFound
		}
		if len(keys) == 1 && !s.cfg.EmailSignIn() {
			ids, err := q.AccountIdentities(r.Context(), sess.User.ID)
			if err != nil {
				return err
			}
			google := false
			for _, id := range ids {
				google = google || (id.Provider == providerGoogle && s.cfg.GoogleSignIn())
			}
			if !google {
				return Error(http.StatusConflict, "invalid_state", "Keep at least one enabled sign-in method.", nil)
			}
		}
		_, err = q.DeletePasskey(r.Context(), r.PathValue("id"), sess.User.ID)
		return err
	})
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) writePasskeys(w http.ResponseWriter, r *http.Request, status int, userID string) {
	rows, err := s.db.ListPasskeys(r.Context(), userID)
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	type passkey struct {
		ID         string     `json:"id"`
		Name       string     `json:"name"`
		CreatedAt  time.Time  `json:"created_at"`
		LastUsedAt *time.Time `json:"last_used_at"`
	}
	out := make([]passkey, 0, len(rows))
	for _, p := range rows {
		item := passkey{ID: p.ID, Name: p.Name, CreatedAt: p.CreatedAt.UTC()}
		if p.LastUsedAt != nil {
			t := p.LastUsedAt.UTC()
			item.LastUsedAt = &t
		}
		out = append(out, item)
	}
	WriteJSON(w, status, map[string]any{"data": out})
}
