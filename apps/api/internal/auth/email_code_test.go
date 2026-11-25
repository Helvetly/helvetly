package auth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func (e *env) sendCode(email string, want int) map[string]int {
	e.t.Helper()
	var out map[string]int
	e.do(nil, "POST", "/api/v1/auth/email/start", map[string]any{"email": email}, want, &out)
	return out
}

func (e *env) devCode(email string) string {
	e.t.Helper()
	var out struct{ Code string }
	e.do(nil, "GET", "/api/v1/auth/email/dev-code?email="+url.QueryEscape(email), nil, 200, &out)
	return out.Code
}

// verifyCode signs a new browser in with a code (want 201), or checks the refusal into out.
func (e *env) verifyCode(email, code string, extra map[string]any, want int, out any) *browser {
	e.t.Helper()
	b := e.newBrowser()
	body := map[string]any{"email": email, "code": code}
	for k, v := range extra {
		body[k] = v
	}
	e.do(b, "POST", "/api/v1/auth/email/verify", body, want, out)
	if want == http.StatusCreated {
		e.session(b)
	}
	return b
}

func (e *env) emailSignIn(email string) *browser {
	e.t.Helper()
	e.sendCode(email, 202)
	return e.verifyCode(email, e.devCode(email), nil, 201, nil)
}

func wrongCode(code string) string {
	if code == "000000" {
		return "111111"
	}
	return "000000"
}

func TestEmailSignIn(t *testing.T) {
	e := newEnv(t)
	if sent := e.sendCode(" Zoe@Example.com ", 202); sent["resend_in"] != 30 || sent["expires_in"] != 600 {
		t.Fatalf("sent: %v", sent)
	}
	code := e.devCode("zoe@example.com")
	if !regexp.MustCompile(`^\d{6}$`).MatchString(code) {
		t.Fatalf("code: %q", code)
	}
	if len(e.mail.sent) != 1 || !slices.Equal(e.mail.sent[0].To, []string{"zoe@example.com"}) || e.mail.sent[0].Subject != code+" is your Helvetly sign-in code" ||
		!strings.Contains(e.mail.sent[0].Text, code) || !strings.Contains(e.mail.sent[0].HTML, code) {
		t.Fatalf("mail: %+v", e.mail.sent)
	}
	if n := e.count(`SELECT count(*) FROM email_codes WHERE code_hash LIKE '%' || $1 || '%'`, code); n != 0 {
		t.Fatal("the code is stored in the clear")
	}

	var bad apiErr
	e.verifyCode("zoe@example.com", wrongCode(code), nil, 400, &bad)
	if bad.Error.Code != "code_invalid" || bad.Error.Details["attempts_left"] != float64(4) {
		t.Fatalf("wrong code: %+v", bad)
	}
	var res struct{ Next, CSRF string }
	b := e.verifyCode("zoe@example.com", code[:3]+" "+code[3:], map[string]any{"next": "/invoices", "timezone": "Europe/Zurich"}, 201, &res)
	if res.Next != "/invoices" {
		t.Fatalf("verify: %+v", res)
	}
	s := e.session(b)
	if s.User.Email != "zoe@example.com" || s.Role != "owner" || s.Workspace.Name != "My workspace" {
		t.Fatalf("session: %+v", s)
	}
	if n := e.count(`SELECT count(*) FROM workspaces WHERE timezone = 'Europe/Zurich'`); n != 1 {
		t.Fatal("the first workspace is not in the browser's zone")
	}

	// Single use.
	var used apiErr
	e.verifyCode("zoe@example.com", code, nil, 410, &used)
	if used.Error.Code != "code_expired" {
		t.Fatalf("reuse: %+v", used)
	}
	// Returning: a new code, a new session, the same person and workspace.
	e.clock.add(31 * time.Second)
	again := e.emailSignIn("zoe@example.com")
	if s2 := e.session(again); s2.User.ID != s.User.ID || s2.Workspace.ID != s.Workspace.ID || e.cookie(again, sessionCookie) == e.cookie(b, sessionCookie) {
		t.Fatalf("second sign-in: %+v", s2)
	}
}

func TestEmailCodeLimits(t *testing.T) {
	e := newEnv(t)
	// The answer never depends on whether the address has an account.
	e.emailSignIn("known@example.com")
	e.clock.add(31 * time.Second)
	if a, b := e.sendCode("known@example.com", 202), e.sendCode("nobody@example.com", 202); a["resend_in"] != b["resend_in"] || a["expires_in"] != b["expires_in"] {
		t.Fatalf("different answers: %v %v", a, b)
	}

	var cool apiErr
	e.do(nil, "POST", "/api/v1/auth/email/start", map[string]any{"email": "nobody@example.com"}, 429, &cool)
	if cool.Error.Code != "code_cooldown" || cool.Error.Details["resend_in"] != float64(30) {
		t.Fatalf("cooldown: %+v", cool)
	}

	// Five wrong tries kill the code: even the right one fails after them.
	code := e.devCode("nobody@example.com")
	for i := 4; i >= 1; i-- {
		var bad apiErr
		e.verifyCode("nobody@example.com", wrongCode(code), nil, 400, &bad)
		if bad.Error.Details["attempts_left"] != float64(i) {
			t.Fatalf("attempts left: %+v, want %d", bad, i)
		}
	}
	e.verifyCode("nobody@example.com", wrongCode(code), nil, 410, nil)
	e.verifyCode("nobody@example.com", code, nil, 410, nil)

	// A malformed code costs no try.
	e.clock.add(31 * time.Second)
	e.sendCode("nobody@example.com", 202)
	code = e.devCode("nobody@example.com")
	var malformed apiErr
	e.verifyCode("nobody@example.com", "12ab", nil, 400, &malformed)
	if malformed.Error.Code != "invalid_request" || e.count(`SELECT attempts FROM email_codes WHERE used_at IS NULL`) != 0 {
		t.Fatalf("malformed: %+v", malformed)
	}
	// Ten minutes.
	e.clock.add(emailCodeTTL + time.Second)
	e.verifyCode("nobody@example.com", code, nil, 410, nil)

	// A new code replaces the open one.
	e.sendCode("nobody@example.com", 202)
	old := e.devCode("nobody@example.com")
	e.clock.add(31 * time.Second)
	e.sendCode("nobody@example.com", 202)
	if fresh := e.devCode("nobody@example.com"); fresh != old {
		e.verifyCode("nobody@example.com", old, nil, 400, nil)
		e.verifyCode("nobody@example.com", fresh, nil, 201, nil)
	}

	// Five codes per address per hour from one asker.
	for i := 0; ; i++ {
		e.clock.add(31 * time.Second)
		var limited apiErr
		if e.do(nil, "POST", "/api/v1/auth/email/start", map[string]any{"email": "busy@example.com"}, 0, &limited).StatusCode == 429 {
			if i != 5 || limited.Error.Code != "rate_limited" {
				t.Fatalf("limited after %d codes: %+v", i, limited)
			}
			break
		}
		if i > 5 {
			t.Fatal("no per-address limit")
		}
	}
	e.clock.add(time.Hour)
	e.sendCode("busy@example.com", 202)
}

func TestEmailCodesPerIPLimit(t *testing.T) {
	e := newEnv(t)
	n := 0
	for ; n < 30; n++ {
		if e.do(nil, "POST", "/api/v1/auth/email/start", map[string]any{"email": "ip" + strconv.Itoa(n) + "@example.com"}, 0, nil).StatusCode == 429 {
			break
		}
	}
	if n != 20 {
		t.Fatalf("per-IP limit after %d codes, want 20", n)
	}
}

func TestEmailCodeMailFailed(t *testing.T) {
	e := newEnv(t)
	e.mail.err = errors.New("connection refused")
	var out apiErr
	e.do(nil, "POST", "/api/v1/auth/email/start", map[string]any{"email": "down@example.com"}, 503, &out)
	if out.Error.Code != "mail_failed" {
		t.Fatalf("mail down: %+v", out)
	}
}

// Concurrent wrong guesses never get more than five tries: the try is counted before the comparison.
func TestEmailCodeConcurrentGuesses(t *testing.T) {
	e := newEnv(t)
	e.sendCode("race@example.com", 202)
	code := e.devCode("race@example.com")
	var wg sync.WaitGroup
	var mu sync.Mutex
	wrong := 0
	for range 12 {
		wg.Go(func() {
			resp := e.do(nil, "POST", "/api/v1/auth/email/verify", map[string]any{"email": "race@example.com", "code": wrongCode(code)}, 0, nil)
			if resp.StatusCode == 400 {
				mu.Lock()
				wrong++
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	if wrong > 4 || e.count(`SELECT attempts FROM email_codes`) != 5 {
		t.Fatalf("%d answered as a wrong try, at most 4 (the fifth kills the code)", wrong)
	}
	e.verifyCode("race@example.com", code, nil, 410, nil)
}

// Google and an email code with the same verified address are one person, whichever comes first.
func TestGoogleAndEmailAreOnePerson(t *testing.T) {
	e := newEnv(t)
	byCode := e.session(e.emailSignIn("jane@example.com"))
	byGoogle := e.session(e.mustGoogleSignIn(fakeIdentity{Sub: "sub-jane", Email: "Jane@Example.com", Name: "Jane Doe"}, ""))
	if byGoogle.User.ID != byCode.User.ID || byGoogle.Workspace.ID != byCode.Workspace.ID || byGoogle.User.Name != "Jane Doe" {
		t.Fatalf("Google after a code: %+v, want %+v", byGoogle, byCode)
	}

	first := e.session(e.mustGoogleSignIn(ana, ""))
	e.clock.add(31 * time.Second)
	then := e.session(e.emailSignIn(ana.Email))
	if then.User.ID != first.User.ID || then.User.Name != ana.Name || then.User.AvatarURL == "" {
		t.Fatalf("a code after Google: %+v, want %+v", then, first)
	}
	if n := e.count(`SELECT count(*) FROM users`); n != 2 {
		t.Fatalf("%d users, want 2", n)
	}
	if n := e.count(`SELECT count(*) FROM user_identities`); n != 4 {
		t.Fatalf("%d identities, want 4", n)
	}
}

// The cooldown answer carries the live code's real remaining life, the same for every address and state of
// the code (used, exhausted): it is what lets the form open code entry without a second observation.
func TestEmailCodeCooldownReportsRemainingExpiry(t *testing.T) {
	e := newEnv(t)
	e.sendCode("zoe@example.com", 202)
	e.clock.add(10 * time.Second)

	var cool apiErr
	e.do(nil, "POST", "/api/v1/auth/email/start", map[string]any{"email": "zoe@example.com"}, 429, &cool)
	if cool.Error.Code != "code_cooldown" || cool.Error.Details["resend_in"] != float64(20) || cool.Error.Details["expires_in"] != float64(590) {
		t.Fatalf("cooldown: %+v", cool)
	}
	if len(cool.Error.Details) != 2 {
		t.Fatalf("cooldown details beyond the two times: %+v", cool.Error.Details)
	}

	// A used code answers exactly the same shape, so a recent sign-in is not observable here.
	e.verifyCode("zoe@example.com", e.devCode("zoe@example.com"), nil, 201, nil)
	var used apiErr
	e.do(nil, "POST", "/api/v1/auth/email/start", map[string]any{"email": "zoe@example.com"}, 429, &used)
	if used.Error.Details["expires_in"] != float64(590) || used.Error.Details["resend_in"] != float64(20) {
		t.Fatalf("used code: %+v", used)
	}
	// The used code still does not work.
	e.verifyCode("zoe@example.com", e.devCode("zoe@example.com"), nil, 410, nil)
}

func TestAdminAlertOnlyOnFirstSignIn(t *testing.T) {
	e := newEnv(t)
	e.svc.db.EnableAdminAlerts()
	ctx := context.Background()

	user := e.session(e.emailSignIn("new@example.com")).User
	e.clock.add(time.Minute)
	e.emailSignIn(user.Email)

	var count int
	var message string
	if err := e.db.QueryRow(ctx, `SELECT count(*), coalesce(max(message), '') FROM admin_alerts`).Scan(&count, &message); err != nil {
		t.Fatal(err)
	}
	if want := "Nowa rejestracja\nUżytkownik: " + user.ID; count != 1 || message != want {
		t.Fatalf("queued %d alerts, last %q, want one %q", count, message, want)
	}
}
