package auth

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	mailer "helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

var factorCodePattern = regexp.MustCompile(`^(?:[0-9]{6}|[a-z2-7]{5}-[a-z2-7]{5})$`)
var errFactorCode = Error(http.StatusUnprocessableEntity, "invalid_code", "Enter a current authenticator code or an unused recovery code.", nil)
var errFactorExpired = Error(http.StatusGone, "two_factor_expired", "This sign-in expired or was already completed. Sign in again.", nil)

func (s *Service) factorAllowed(w http.ResponseWriter, r *http.Request, key string) bool {
	if s.factorLimit.allow(key) {
		return true
	}
	w.Header().Set("Retry-After", "600")
	s.WriteError(w, r, Error(http.StatusTooManyRequests, "rate_limited", "Too many verification attempts. Wait a few minutes and try again.", nil))
	return false
}

func (s *Service) factorSetup(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var in struct{}
	if !s.Decode(w, r, &in) || !s.factorAllowed(w, r, "account:"+sess.User.ID) {
		return
	}
	if _, err := s.gcm(); err != nil {
		s.WriteError(w, r, Error(http.StatusServiceUnavailable, "two_factor_unavailable", "Two-factor authentication needs the server's persistent SECRET_KEY to be configured.", nil))
		return
	}
	raw := make([]byte, 20)
	if _, err := rand.Read(raw); err != nil {
		s.WriteError(w, r, err)
		return
	}
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)
	sealed, err := s.seal(secret)
	if err == nil {
		err = s.db.Tx(r.Context(), func(q store.Q) error {
			if err := q.LockAccount(r.Context(), sess.User.ID); err != nil {
				return err
			}
			factor, err := q.AccountTwoFactor(r.Context(), sess.User.ID)
			if err != nil {
				return err
			}
			if factor.Enabled {
				return Error(http.StatusConflict, "invalid_state", "Two-factor authentication is already enabled.", nil)
			}
			return q.SetPendingTwoFactor(r.Context(), sess.User.ID, sealed, s.now().Add(10*time.Minute))
		})
	}
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	query := url.Values{"secret": {secret}, "issuer": {"Helvetly"}, "algorithm": {"SHA1"}, "digits": {"6"}, "period": {"30"}}
	otpauth := "otpauth://totp/" + url.PathEscape("Helvetly:"+sess.User.Email) + "?" + query.Encode()
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"secret": secret, "otpauth_url": otpauth, "qr_svg": nil}})
}

func (s *Service) factorEnable(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var in struct {
		Code string `json:"code"`
	}
	if !s.Decode(w, r, &in) || !s.factorAllowed(w, r, "account:"+sess.User.ID) {
		return
	}
	codes := make([]string, 10)
	hashes := make([]string, 10)
	for i := range codes {
		v := strings.ToLower(rand.Text()[:10])
		codes[i] = v[:5] + "-" + v[5:]
		hashes[i] = recoveryHash(sess.User.ID, codes[i])
	}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockAccount(r.Context(), sess.User.ID); err != nil {
			return err
		}
		factor, err := q.AccountTwoFactor(r.Context(), sess.User.ID)
		if err != nil {
			return err
		}
		if factor.Enabled {
			return Error(http.StatusConflict, "invalid_state", "Two-factor authentication is already enabled.", nil)
		}
		if factor.PendingSecret == nil || factor.PendingExpires == nil || !s.now().Before(*factor.PendingExpires) {
			return errFactorCode
		}
		var secret string
		if err := s.unseal(*factor.PendingSecret, &secret); err != nil {
			return err
		}
		step, ok := totpStep(secret, in.Code, s.now())
		if !ok {
			return errFactorCode
		}
		if err := q.EnableTwoFactor(r.Context(), sess.User.ID, *factor.PendingSecret, step, hashes); err != nil {
			return err
		}
		return q.DeleteOtherAccountSessions(r.Context(), sess.User.ID, sess.ID)
	})
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"recovery_codes": codes}})
}

func recoveryHash(userID, code string) string {
	return hashSecret("account-recovery:" + userID + ":" + strings.ToLower(strings.TrimSpace(code)))
}

// factorLockAfter wrong codes in a row pause verification for factorLockFor; the count survives restarts,
// unlike the per-process rate limit, so a stolen first factor cannot keep guessing.
const factorLockAfter = 10

var errFactorLocked = Error(http.StatusTooManyRequests, "two_factor_locked", "Too many wrong codes: two-factor verification is paused for this account. Try again later.", nil)

// factorLockFor: 15 minutes for the first 10 failures, doubling with each further 10, at most a day.
func factorLockFor(failures int) time.Duration {
	return min(15*time.Minute<<min(failures/factorLockAfter-1, 7), 24*time.Hour)
}

// useFactor runs under LockAccount: a TOTP step or recovery code can win only once. A wrong code returns
// errFactorCode or errFactorLocked as the outcome (not err) because the failure count must commit;
// lockedNow is true when this failure started a lock.
func (s *Service) useFactor(ctx context.Context, q store.Q, userID, code string) (outcome error, lockedNow bool, err error) {
	factor, err := q.AccountTwoFactor(ctx, userID)
	if err != nil {
		return nil, false, err
	}
	if !factor.Enabled {
		return errFactorCode, false, nil
	}
	if factor.LockedUntil != nil && s.now().Before(*factor.LockedUntil) {
		return errFactorLocked, false, nil
	}
	ok, err := s.matchFactor(ctx, q, userID, factor, code)
	if err != nil {
		return nil, false, err
	}
	if ok {
		return nil, false, q.ResetTwoFactorFailures(ctx, userID)
	}
	n, err := q.FailTwoFactor(ctx, userID)
	if err != nil || n%factorLockAfter != 0 {
		return errFactorCode, false, err
	}
	return errFactorLocked, true, q.LockTwoFactor(ctx, userID, s.now().Add(factorLockFor(n)))
}

func (s *Service) matchFactor(ctx context.Context, q store.Q, userID string, factor store.TwoFactor, code string) (bool, error) {
	code = strings.ToLower(strings.TrimSpace(code))
	if len(code) == 11 {
		return q.UseRecoveryCode(ctx, userID, recoveryHash(userID, code))
	}
	var secret string
	if err := s.unseal(factor.Secret, &secret); err != nil {
		return false, err
	}
	step, ok := totpStep(secret, code, s.now())
	if !ok {
		return false, nil
	}
	return q.UseTwoFactorStep(ctx, userID, step)
}

// notifyFactorLocked runs after the commit: no network call inside a transaction.
func (s *Service) notifyFactorLocked(ctx context.Context, userID string) {
	if s.mail == nil {
		return
	}
	u, err := s.db.User(ctx, userID)
	if err == nil {
		err = s.mail.Send(ctx, factorLockedMessage(u.Email, s.cfg.PublicURL))
	}
	if err != nil {
		s.log.WarnContext(ctx, "two-factor lock email not sent", "error", err)
	}
}

func factorLockedMessage(to, publicURL string) mailer.Message {
	l := mailer.NewLetter("en").Lead("Someone entered too many wrong two-factor codes for your Helvetly account, so two-factor verification is paused for a while.").
		Lead("If it was you, wait and try again. If it was not, someone knows your first sign-in step: sign in, end your other sessions and review your sign-in methods.").
		Action("Sign in", publicURL)
	return mailer.Message{To: []string{to}, Subject: "Two-factor verification paused on your Helvetly account", Text: l.Text(), HTML: l.HTML()}
}

func (s *Service) factorDisable(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var in struct {
		Code string `json:"code"`
	}
	if !s.Decode(w, r, &in) || !s.factorAllowed(w, r, "account:"+sess.User.ID) {
		return
	}
	var outcome error
	var lockedNow bool
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockAccount(r.Context(), sess.User.ID); err != nil {
			return err
		}
		var err error
		outcome, lockedNow, err = s.useFactor(r.Context(), q, sess.User.ID, in.Code)
		if err != nil || outcome != nil {
			return err
		}
		return q.DisableTwoFactor(r.Context(), sess.User.ID)
	})
	if lockedNow && err == nil {
		s.notifyFactorLocked(r.Context(), sess.User.ID)
	}
	if err == nil {
		err = outcome
	}
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) factorVerify(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ChallengeID string `json:"challenge_id"`
		Code        string `json:"code"`
	}
	if !s.Decode(w, r, &in) {
		return
	}
	in.Code = strings.ToLower(strings.TrimSpace(in.Code))
	if len(in.ChallengeID) < 20 || len(in.ChallengeID) > 128 || !factorCodePattern.MatchString(in.Code) {
		s.WriteError(w, r, badRequest("Enter the challenge and a six-digit authenticator or recovery code."))
		return
	}
	if !s.factorAllowed(w, r, "ip:"+clientIP(r)) {
		return
	}
	ctx := withSessionClient(r)
	hash := hashSecret(in.ChallengeID)
	userID, err := s.db.FactorChallengeUser(ctx, hash, s.now())
	if errors.Is(err, store.ErrNotFound) {
		err = errFactorExpired
	}
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	if !s.factorAllowed(w, r, "user:"+userID) {
		return
	}
	var ns newSession
	var outcome error
	var lockedNow bool
	next := "/"
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockAccount(ctx, userID); err != nil {
			return err
		}
		challenge, err := q.AttemptFactorChallenge(ctx, hash, s.now())
		if errors.Is(err, store.ErrNotFound) {
			outcome = errFactorExpired
			return nil
		}
		if err != nil {
			return err
		}
		outcome, lockedNow, err = s.useFactor(ctx, q, userID, in.Code)
		if err != nil || outcome != nil {
			return err
		}
		if _, err := q.MemberRole(ctx, challenge.WorkspaceID, userID); err != nil {
			outcome = errFactorExpired
			return q.DeleteFactorChallenge(ctx, hash)
		}
		if err := q.DeleteFactorChallenge(ctx, hash); err != nil {
			return err
		}
		ns, err = s.createSession(ctx, q, userID, challenge.WorkspaceID)
		next = SafeNext(challenge.Next)
		return err
	})
	if lockedNow && err == nil {
		s.notifyFactorLocked(ctx, userID)
	}
	if err == nil {
		err = outcome
	}
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	s.signedInResponse(w, ns, next)
}
