package auth

import (
	"context"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestTOTPMatchesRFC6238(t *testing.T) {
	for _, tc := range []struct {
		at   int64
		code string
	}{{59, "287082"}, {1111111109, "081804"}, {1111111111, "050471"}, {1234567890, "005924"}, {2000000000, "279037"}, {20000000000, "353130"}} {
		if got := totpAt([]byte("12345678901234567890"), tc.at/30); got != tc.code {
			t.Fatalf("RFC fixture at %d: %s != %s", tc.at, got, tc.code)
		}
	}
	if _, ok := totpStep("not-base32", "123456", time.Now()); ok {
		t.Fatal("invalid secret accepted")
	}
}

func (e *env) enableTestFactor(b *browser) []string {
	e.t.Helper()
	var setup struct{ Data struct{ Secret string } }
	e.do(b, "POST", "/api/v1/account/two-factor/setup", map[string]any{}, 200, &setup)
	sealed, err := e.svc.seal("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.db.Exec(context.Background(), `UPDATE account_two_factor SET pending_secret=$1,pending_expires_at=$2`, sealed, e.clock.now().Add(10*time.Minute)); err != nil {
		e.t.Fatal(err)
	}
	var enabled struct {
		Data struct {
			RecoveryCodes []string `json:"recovery_codes"`
		}
	}
	e.do(b, "POST", "/api/v1/account/two-factor/enable", map[string]string{"code": "353130"}, 200, &enabled)
	if len(enabled.Data.RecoveryCodes) != 10 {
		e.t.Fatal("recovery code count")
	}
	return enabled.Data.RecoveryCodes
}

func factorClock(e *env) {
	e.clock.mu.Lock()
	e.clock.t = time.Unix(20000000000, 0).UTC()
	e.clock.mu.Unlock()
}

func googleFactor(e *env, email string) (*browser, string) {
	e.t.Helper()
	b, loc := e.googleSignIn(fakeIdentity{Sub: "subject-" + email, Email: email}, "next=%2Fexpenses", nil)
	u, err := url.Parse(loc)
	if err != nil {
		e.t.Fatal(err)
	}
	id, err := url.ParseQuery(u.Fragment)
	if err != nil {
		e.t.Fatal(err)
	}
	challenge := id.Get("challenge")
	if u.Path != "/login" || challenge == "" || e.cookie(b, sessionCookie) != "" {
		e.t.Fatalf("Google bypassed factor: %s", loc)
	}
	return b, challenge
}

func TestTwoFactorGoogleAndPasskeyRequireSecondStep(t *testing.T) {
	e := newEnv(t)
	factorClock(e)
	b := e.emailSignIn("all-methods@example.com")
	k := newSoftKey(t)
	var registration challengeOut
	e.do(b, "POST", "/api/v1/account/passkeys/start", map[string]any{}, 200, &registration)
	e.do(b, "POST", "/api/v1/account/passkeys/finish", map[string]any{"challenge_id": registration.ID, "name": "Device", "response": k.create(registration.Options)}, 201, nil)
	codes := e.enableTestFactor(b)
	google, challenge := googleFactor(e, "all-methods@example.com")
	e.do(google, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": challenge, "code": codes[0]}, 201, nil)
	e.session(google)
	var ch struct {
		ID       string `json:"challenge_id"`
		Required bool   `json:"two_factor_required"`
	}
	passkey := e.passkeySignIn(k, 1, k.key, 200, &ch)
	if !ch.Required || ch.ID == "" || e.cookie(passkey, sessionCookie) != "" {
		t.Fatal("passkey bypassed factor")
	}
	e.do(passkey, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": ch.ID, "code": codes[1]}, 201, nil)
	e.session(passkey)
	e.do(b, "DELETE", "/api/v1/account/two-factor", map[string]string{"code": codes[2]}, 204, nil)
	e.passkeySignIn(k, 2, k.key, 201, nil)
}

func TestTwoFactorAttemptLimitExpiryAndRecoveryReplay(t *testing.T) {
	e := newEnv(t)
	factorClock(e)
	b := e.emailSignIn("attempts@example.com")
	codes := e.enableTestFactor(b)
	first, challenge := googleFactor(e, "attempts@example.com")
	for range 5 {
		e.do(first, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": challenge, "code": "000000"}, 422, nil)
	}
	e.do(first, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": challenge, "code": codes[0]}, 410, nil)
	second, challenge := googleFactor(e, "attempts@example.com")
	e.do(second, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": challenge, "code": codes[0]}, 201, nil)
	third, challenge := googleFactor(e, "attempts@example.com")
	e.do(third, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": challenge, "code": codes[0]}, 422, nil)
	e.clock.add(6 * time.Minute)
	e.do(third, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": challenge, "code": codes[1]}, 410, nil)
	if got := e.count(`SELECT count(*) FROM account_recovery_codes`); got != 9 {
		t.Fatalf("unused recovery codes %d", got)
	}
}

func TestTwoFactorConcurrentRecoveryHasOneWinner(t *testing.T) {
	e := newEnv(t)
	factorClock(e)
	b := e.emailSignIn("race@example.com")
	codes := e.enableTestFactor(b)
	first, c1 := googleFactor(e, "race@example.com")
	second, c2 := googleFactor(e, "race@example.com")
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for _, v := range []struct {
		b  *browser
		id string
	}{{first, c1}, {second, c2}} {
		wg.Go(func() {
			resp := e.do(v.b, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": v.id, "code": codes[0]}, 0, nil)
			statuses <- resp.StatusCode
		})
	}
	wg.Wait()
	close(statuses)
	ok, invalid := 0, 0
	for status := range statuses {
		switch status {
		case 201:
			ok++
		case 422:
			invalid++
		default:
			t.Fatalf("unexpected status %d", status)
		}
	}
	if ok != 1 || invalid != 1 {
		t.Fatalf("race winners %d, rejected %d", ok, invalid)
	}
	var secret string
	if err := e.db.QueryRow(context.Background(), `SELECT secret FROM account_two_factor`).Scan(&secret); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(secret, "GEZDGNBV") {
		t.Fatal("plaintext factor secret stored")
	}
	if e.count(`SELECT count(*) FROM account_recovery_codes WHERE code_hash=$1`, codes[0]) != 0 {
		t.Fatal("plaintext recovery code stored")
	}
}

func TestTwoFactorLockSurvivesRestart(t *testing.T) {
	e := newEnv(t)
	factorClock(e)
	b := e.emailSignIn("locked@example.com")
	codes := e.enableTestFactor(b)
	for i := range 2 {
		g, challenge := googleFactor(e, "locked@example.com")
		for j := range 5 {
			want := 422
			if i == 1 && j == 4 {
				want = 429 // the tenth wrong code starts the lock
			}
			e.do(g, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": challenge, "code": "000000"}, want, nil)
		}
	}
	e.svc.factorLimit = newRateLimiter(10, 10*time.Minute) // a restart forgets the in-memory limit
	sent := len(e.mail.sent)
	g, challenge := googleFactor(e, "locked@example.com")
	e.do(g, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": challenge, "code": codes[0]}, 429, nil)
	e.do(b, "DELETE", "/api/v1/account/two-factor", map[string]string{"code": codes[0]}, 429, nil)
	if got := len(e.mail.sent) - sent; got != 0 {
		t.Fatalf("lock emails after the lock: %d", got)
	}
	if e.count(`SELECT count(*) FROM account_recovery_codes`) != 10 {
		t.Fatal("a locked attempt spent a recovery code")
	}
	e.clock.add(16 * time.Minute)
	g, challenge = googleFactor(e, "locked@example.com")
	e.do(g, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": challenge, "code": codes[0]}, 201, nil)
	if e.count(`SELECT failed_attempts FROM account_two_factor`) != 0 {
		t.Fatal("success did not reset the failures")
	}
}

func TestTwoFactorLockEmailsOnceAndGrows(t *testing.T) {
	e := newEnv(t)
	factorClock(e)
	b := e.emailSignIn("grows@example.com")
	e.enableTestFactor(b)
	e.svc.factorLimit = newRateLimiter(10, 10*time.Minute)
	sent := len(e.mail.sent)
	for range 10 {
		e.do(b, "DELETE", "/api/v1/account/two-factor", map[string]string{"code": "000000"}, 0, nil)
	}
	if got := e.mail.sent[sent:]; len(got) != 1 || got[0].To[0] != "grows@example.com" {
		t.Fatalf("lock emails %+v", got)
	}
	if e.count(`SELECT count(*) FROM account_two_factor WHERE locked_until IS NOT NULL`) != 1 {
		t.Fatal("not locked")
	}
	for _, tc := range []struct {
		failures int
		want     time.Duration
	}{{10, 15 * time.Minute}, {20, 30 * time.Minute}, {30, time.Hour}, {80, 24 * time.Hour}, {1000, 24 * time.Hour}} {
		if got := factorLockFor(tc.failures); got != tc.want {
			t.Fatalf("lock for %d failures: %s, want %s", tc.failures, got, tc.want)
		}
	}
}
