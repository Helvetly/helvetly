package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"math"
	"math/big"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"

	mailer "helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// Sign-in with an email code: a 6-digit code mailed to an address proves it. Only sha256(id:code) is
// stored; a code works once, for emailCodeTTL, and dies after emailCodeMaxAttempts wrong tries. The
// answer to "send a code" is the same whether or not the address has an account.

const (
	emailCodeTTL         = 10 * time.Minute
	emailCodeCooldown    = 30 * time.Second
	emailCodeMaxAttempts = 5
	// Codes one asker (a client address) may have sent to one address per hour and per day: counted per
	// asker, so nobody can use up another person's codes.
	emailCodesPerHour = 5
	emailCodesPerDay  = 15
	// All askers together, so guessing stays bounded whoever asks (60 codes x 5 tries a day out of a million).
	emailCodesPerAddressDay = 60
)

var (
	errCodeExpired = &apiError{status: http.StatusGone, code: "code_expired", message: "This code expired or was already used: send a new one."}
	errCodeTooMany = &apiError{status: http.StatusGone, code: "code_expired", message: "Too many wrong tries for this code: send a new one."}
)

func (s *Service) emailStart(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if !s.Decode(w, r, &in) {
		return
	}
	if err := s.SendEmailCode(r, in.Email, true); err != nil {
		s.WriteError(w, r, err)
		return
	}
	WriteJSON(w, http.StatusAccepted, map[string]int{"resend_in": int(emailCodeCooldown.Seconds()), "expires_in": int(emailCodeTTL.Seconds())})
}

// SendEmailCode mails a sign-in code: the per-network limit, then sendEmailCode. Also for the client portal,
// which passes deliver=false for an address without access: the code is recorded (cooldown and limits count it
// alike) but never mailed, so the answers cannot tell the two addresses apart.
func (s *Service) SendEmailCode(r *http.Request, email string, deliver bool) error {
	if !s.cfg.EmailSignIn() {
		return ErrNotFound
	}
	ip := clientIP(r)
	if !s.codeLimit.allow(ip) {
		return &apiError{status: http.StatusTooManyRequests, code: "rate_limited", retryAfter: "3600",
			message: "Too many codes requested from this network: try again later."}
	}
	return s.sendEmailCode(r.Context(), email, ip, deliver)
}

// ConsumeEmailCode checks the address's code and spends it (single use) and returns the normalized address.
func (s *Service) ConsumeEmailCode(ctx context.Context, email, code string) (string, error) {
	id, email, err := s.checkEmailCode(ctx, email, code)
	if err != nil {
		return "", err
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		ok, err := q.UseEmailCode(ctx, id, s.now())
		if err == nil && !ok {
			err = errCodeExpired
		}
		return err
	})
	if err != nil {
		return "", err
	}
	return email, nil
}

func (s *Service) emailVerify(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Code     string `json:"code"`
		Next     string `json:"next"`
		Timezone string `json:"timezone"`
	}
	if !s.Decode(w, r, &in) {
		return
	}
	if !s.cfg.EmailSignIn() {
		s.WriteError(w, r, ErrNotFound)
		return
	}
	ctx := withSessionClient(r)
	id, email, err := s.checkEmailCode(ctx, in.Email, in.Code)
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	var ns newSession
	err = s.db.Tx(ctx, func(q store.Q) error {
		ok, err := q.UseEmailCode(ctx, id, s.now()) // single use: a concurrent use of the same code finds it used
		if err != nil {
			return err
		}
		if !ok {
			return errCodeExpired
		}
		ns, err = s.signInIdentity(ctx, q, identity{provider: providerEmail, subject: email, email: email}, in.Timezone, in.Next)
		return err
	})
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	s.signedInResponse(w, ns, SafeNext(in.Next))
}

// emailDevCode: the last code sent to an address, for tests and the dev stack (AUTH_DEV_SIGNIN only; a 404
// everywhere else, like a route that does not exist).
func (s *Service) emailDevCode(w http.ResponseWriter, r *http.Request) {
	code, ok := s.devCodes.get(r.URL.Query().Get("email"))
	if !s.cfg.DevSignIn || !ok {
		s.WriteError(w, r, ErrNotFound)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"code": code})
}

func normalizeEmail(v string) (string, error) {
	v = strings.ToLower(strings.TrimSpace(v))
	if a, err := mail.ParseAddress(v); err != nil || a.Address != v || len(v) > 254 {
		return "", &apiError{status: http.StatusBadRequest, code: "invalid_email", message: "Enter an email address such as ana@example.com."}
	}
	return v, nil
}

// clientKey: the asker as stored with a code, a keyed hash of the client address (never the address).
func (s *Service) clientKey(ip string) string {
	mac := hmac.New(sha256.New, s.cfg.SecretKey)
	mac.Write([]byte("email-code-client:" + ip))
	return hex.EncodeToString(mac.Sum(nil)[:12])
}

func emailCodeHash(id, code string) string { return hashSecret(id + ":" + code) }

// sixDigits: a uniformly random code from 000000 to 999999.
func sixDigits() string {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		panic(err) // crypto/rand never fails on supported platforms
	}
	return fmt.Sprintf("%06d", n.Int64())
}

func (s *Service) sendEmailCode(ctx context.Context, email, ip string, deliver bool) error {
	email, err := normalizeEmail(email)
	if err != nil {
		return err
	}
	now := s.now()
	code, id, client := sixDigits(), NewID("emc"), s.clientKey(ip)
	limited := func(msg string) error {
		return &apiError{status: http.StatusTooManyRequests, code: "rate_limited", message: msg}
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockAddress(ctx, email); err != nil { // concurrent requests see each other's codes
			return err
		}
		latest, err := q.LatestEmailCode(ctx, email)
		if err == nil && now.Before(latest.CreatedAt.Add(emailCodeCooldown)) {
			wait := int(math.Ceil(latest.CreatedAt.Add(emailCodeCooldown).Sub(now).Seconds()))
			return &apiError{status: http.StatusTooManyRequests, code: "code_cooldown",
				message: fmt.Sprintf("A code was just sent: wait %d seconds before asking for another.", wait), details: map[string]any{"resend_in": wait}}
		}
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		for _, l := range []struct {
			client string
			since  time.Duration
			max    int
			msg    string
		}{
			{client, time.Hour, emailCodesPerHour, "Too many codes for this address: wait an hour and try again."},
			{client, 24 * time.Hour, emailCodesPerDay, "Too many codes for this address today: try again tomorrow."},
			{"", 24 * time.Hour, emailCodesPerAddressDay, "Too many codes for this address today: try again tomorrow."},
		} {
			n, err := q.CountEmailCodes(ctx, email, l.client, now.Add(-l.since))
			if err != nil {
				return err
			}
			if n >= l.max {
				return limited(l.msg)
			}
		}
		// Purged after a day, so the day's codes above are all still here.
		if err := q.PurgeEmailCodes(ctx, now.Add(-24*time.Hour)); err != nil {
			return err
		}
		return q.CreateEmailCode(ctx, id, email, emailCodeHash(id, code), client, now, now.Add(emailCodeTTL))
	})
	if err != nil || !deliver {
		return err
	}
	// After the commit: no network call inside a transaction.
	if s.cfg.DevSignIn {
		s.devCodes.put(email, code)
	}
	if s.mail != nil {
		if err := s.mail.Send(ctx, signInCodeMessage(email, code, s.cfg.PublicURL)); err != nil {
			s.log.WarnContext(ctx, "sign-in code email not sent", "error", err)
			return &apiError{status: http.StatusServiceUnavailable, code: "mail_failed", message: "The code could not be sent: try again in a minute."}
		}
	}
	return nil
}

// checkEmailCode spends one try on the address's latest code and returns its id and the normalized
// address when the code matches. The try is counted before the comparison, so a wrong code always costs one
// and concurrent guesses never exceed the limit.
func (s *Service) checkEmailCode(ctx context.Context, email, code string) (string, string, error) {
	email, err := normalizeEmail(email)
	if err != nil {
		return "", "", err
	}
	code = strings.Join(strings.Fields(code), "")
	if len(code) != 6 || strings.Trim(code, "0123456789") != "" {
		return "", "", badRequest("Enter the 6-digit code from the email.")
	}
	row, err := s.db.LatestEmailCode(ctx, email)
	if errors.Is(err, store.ErrNotFound) {
		return "", "", errCodeExpired
	}
	if err != nil {
		return "", "", err
	}
	spent, err := s.db.SpendEmailCodeAttempt(ctx, row.ID, emailCodeMaxAttempts, s.now())
	if errors.Is(err, store.ErrNotFound) {
		if row.Attempts >= emailCodeMaxAttempts {
			return "", "", errCodeTooMany
		}
		return "", "", errCodeExpired
	}
	if err != nil {
		return "", "", err
	}
	if subtle.ConstantTimeCompare([]byte(emailCodeHash(row.ID, code)), []byte(row.CodeHash)) != 1 {
		left := emailCodeMaxAttempts - spent
		if left <= 0 {
			return "", "", errCodeTooMany
		}
		return "", "", &apiError{status: http.StatusBadRequest, code: "code_invalid",
			message: fmt.Sprintf("That code is not right: %d tries left.", left), details: map[string]any{"attempts_left": left}}
	}
	return row.ID, email, nil
}

// signInCodeMessage: the code leads the subject, so it shows in the inbox list and mail apps offer to copy it.
func signInCodeMessage(to, code, publicURL string) mailer.Message {
	text := fmt.Sprintf("Here is your code to sign in to Helvetly:\n\n%s\n\n"+
		"Type it on the sign-in page you came from. It works once and expires in 10 minutes.\n\n"+
		"Didn't try to sign in? You can ignore this email: nobody can sign in without this code. Never share it with anyone.\n\n"+
		"Helvetly · %s\n", code, publicURL)
	link := html.EscapeString(publicURL)
	body := `<p style="font-size:16px">Here is your code to sign in to <a href="` + link + `">Helvetly</a>:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,Menlo,Consolas,monospace">` + code + `</p>
<p style="font-size:14px;color:#57534e">Type it on the sign-in page you came from. It works <strong>once</strong> and expires in <strong>10 minutes</strong>.</p>
<p style="font-size:14px;color:#57534e">Didn't try to sign in? You can ignore this email: nobody can sign in without this code. <strong>Never share it</strong> with anyone.</p>`
	return mailer.Message{To: []string{to}, Subject: code + " is your Helvetly sign-in code", Text: text, HTML: body}
}

// devCodeBox keeps the last code per address in memory under AUTH_DEV_SIGNIN, so tests and the dev stack
// can sign in without reading mail. Never filled otherwise.
type devCodeBox struct {
	mu    sync.Mutex
	codes map[string]string
}

func (b *devCodeBox) put(email, code string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.codes == nil || len(b.codes) > 10_000 {
		b.codes = map[string]string{}
	}
	b.codes[email] = code
}

func (b *devCodeBox) get(email string) (string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	c, ok := b.codes[strings.ToLower(strings.TrimSpace(email))]
	return c, ok
}
