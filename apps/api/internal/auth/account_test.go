package auth

import (
	"context"
	"helvetly.com/api/internal/store"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestTwoFactorEmailCannotCreateSessionBeforeSecondFactor(t *testing.T) {
	e := newEnv(t)
	e.clock.mu.Lock()
	e.clock.t = time.Unix(20000000000, 0).UTC()
	e.clock.mu.Unlock()
	b := e.emailSignIn("factor@example.com")
	e.session(b)
	var setup struct{ Data struct{ Secret string } }
	e.do(b, "POST", "/api/v1/account/two-factor/setup", map[string]any{}, 200, &setup)
	if setup.Data.Secret == "" {
		t.Fatal("missing setup secret")
	}
	sealed, err := e.svc.seal("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Exec(e.t.Context(), `UPDATE account_two_factor SET pending_secret=$1,pending_expires_at=$2`, sealed, e.clock.now().Add(10*time.Minute)); err != nil {
		t.Fatal(err)
	}
	// RFC 6238 SHA-1 fixture: 65353130, reduced to six digits.
	var enabled struct {
		Data struct {
			RecoveryCodes []string `json:"recovery_codes"`
		}
	}
	e.do(b, "POST", "/api/v1/account/two-factor/enable", map[string]string{"code": "353130"}, 200, &enabled)
	if len(enabled.Data.RecoveryCodes) != 10 {
		t.Fatalf("recovery codes: %+v", enabled)
	}
	e.clock.add(31 * time.Second)
	e.sendCode("factor@example.com", 202)
	var challenge struct {
		Required bool   `json:"two_factor_required"`
		ID       string `json:"challenge_id"`
	}
	newBrowser := e.verifyCode("factor@example.com", e.devCode("factor@example.com"), map[string]any{"next": "/clients"}, 200, &challenge)
	if !challenge.Required || challenge.ID == "" || e.cookie(newBrowser, sessionCookie) != "" {
		t.Fatal("first factor created session")
	}
	e.do(newBrowser, "GET", "/api/v1/session", nil, 401, nil)
	e.do(newBrowser, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": challenge.ID, "code": "353130"}, 422, nil)
	e.do(newBrowser, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": challenge.ID, "code": enabled.Data.RecoveryCodes[0]}, 201, nil)
	e.session(newBrowser)
	e.do(newBrowser, "POST", "/api/v1/auth/two-factor/verify", map[string]string{"challenge_id": challenge.ID, "code": enabled.Data.RecoveryCodes[1]}, 410, nil)
	if got := e.count(`SELECT count(*) FROM account_recovery_codes`); got != 9 {
		t.Fatalf("remaining codes %d", got)
	}
}

func TestAccountProfileAndSessionIsolation(t *testing.T) {
	e := newEnv(t)
	b := e.emailSignIn("account@example.com")
	sess := e.session(b)
	var account struct {
		Data struct {
			Identities []struct{ Provider, Email string }
			TwoFactor  struct{ Enabled bool } `json:"two_factor"`
		}
	}
	e.do(b, "GET", "/api/v1/account", nil, 200, &account)
	if len(account.Data.Identities) != 1 || account.Data.Identities[0].Email != "account@example.com" || account.Data.TwoFactor.Enabled {
		t.Fatalf("account: %+v", account)
	}
	e.do(b, "PATCH", "/api/v1/account", map[string]string{"name": "   "}, 422, nil)
	e.do(b, "PATCH", "/api/v1/account", map[string]string{"name": strings.Repeat("x", maxPersonNameRunes+1)}, 422, nil)
	e.do(b, "PATCH", "/api/v1/account", map[string]string{"name": strings.Repeat("ä", maxPersonNameRunes)}, 200, nil)
	e.do(b, "PATCH", "/api/v1/account", map[string]string{"name": "  Alice  "}, 200, nil)
	if got := e.session(b); got.User.Name != "Alice" || got.User.ID != sess.User.ID {
		t.Fatalf("profile: %+v", got)
	}
	other := e.emailSignIn("other@example.com")
	var sessions struct {
		Data []struct {
			ID      string
			Current bool
		}
	}
	e.do(b, "GET", "/api/v1/account/sessions", nil, 200, &sessions)
	if len(sessions.Data) != 1 || !sessions.Data[0].Current {
		t.Fatalf("sessions: %+v", sessions)
	}
	e.do(other, "DELETE", "/api/v1/account/sessions/"+sessions.Data[0].ID, nil, 404, nil)
	e.do(b, "DELETE", "/api/v1/account/sessions/"+sessions.Data[0].ID, nil, 409, nil)
	b.csrf = "wrong"
	e.do(b, "PATCH", "/api/v1/account", map[string]string{"name": "Forged"}, 403, nil)
}

func TestAccountDeleteKeepsSoleOwnerAndRecords(t *testing.T) {
	e := newEnv(t)
	b := e.emailSignIn("owner@example.com")
	sess := e.session(b)
	if _, err := e.db.Exec(context.Background(), `INSERT INTO workspace_billing(workspace_id,stripe_subscription_id,status,updated_at)VALUES($1,'sub_fixture','active',now())`, sess.Workspace.ID); err != nil {
		t.Fatal(err)
	}
	e.do(b, "DELETE", "/api/v1/account", map[string]string{"email": "owner@example.com"}, 409, nil)
	if e.count(`SELECT count(*) FROM users WHERE id=$1`, sess.User.ID) != 1 || e.count(`SELECT count(*) FROM workspace_members WHERE user_id=$1 AND role='owner'`, sess.User.ID) != 1 {
		t.Fatal("sole owner was removed")
	}
	e.session(b)
	if e.count(`SELECT count(*) FROM workspace_billing WHERE workspace_id=$1 AND stripe_subscription_id='sub_fixture'`, sess.Workspace.ID) != 1 {
		t.Fatal("subscription lost its owner")
	}
}

func TestAccountDeleteRequiresOwnershipTransferInEveryWorkspace(t *testing.T) {
	e := newEnv(t)
	owner := e.emailSignIn("many@example.com")
	current := e.session(owner)
	other := e.emailSignIn("co-owner@example.com")
	otherID := e.session(other).User.ID
	if err := e.svc.db.AddMember(context.Background(), current.Workspace.ID, otherID, "owner", e.clock.now()); err != nil {
		t.Fatal(err)
	}
	second := e.otherWorkspace("Other company", current.User.ID, "owner")
	e.do(owner, "DELETE", "/api/v1/account", map[string]string{"email": "many@example.com"}, 409, nil)
	if err := e.svc.db.AddMember(context.Background(), second, otherID, "owner", e.clock.now()); err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Exec(context.Background(), `INSERT INTO clients(id,workspace_id,number,name,created_at,updated_at)VALUES('cli_history',$1,1,'Historical client',now(),now())`, current.Workspace.ID); err != nil {
		t.Fatal(err)
	}
	e.do(owner, "DELETE", "/api/v1/account", map[string]string{"email": "many@example.com"}, 204, nil)
	e.do(owner, "GET", "/api/v1/session", nil, 401, nil)
	if e.count(`SELECT count(*) FROM users WHERE id=$1 AND deleted_at IS NOT NULL AND name='' AND avatar_url=''`, current.User.ID) != 1 {
		t.Fatal("profile was not anonymized")
	}
	if e.count(`SELECT count(*) FROM clients WHERE id='cli_history' AND name='Historical client'`) != 1 {
		t.Fatal("workspace records changed")
	}
	if e.count(`SELECT count(*) FROM workspace_members WHERE user_id=$1`, current.User.ID) != 0 {
		t.Fatal("closed account retained membership")
	}
	e.clock.add(31 * time.Second)
	fresh := e.emailSignIn("many@example.com")
	if got := e.session(fresh); got.User.ID == current.User.ID || got.Workspace.ID == current.Workspace.ID {
		t.Fatal("closed account was resurrected")
	}
}

func TestAccountSessionRevocationAndActivity(t *testing.T) {
	e := newEnv(t)
	first := e.emailSignIn("sessions@example.com")
	sess := e.session(first)
	e.clock.add(31 * time.Second)
	second := e.emailSignIn("sessions@example.com")
	e.session(second)
	var before, after time.Time
	if err := e.db.QueryRow(context.Background(), `SELECT last_active_at FROM sessions WHERE token_hash=$1`, hashSecret(e.cookie(first, sessionCookie))).Scan(&before); err != nil {
		t.Fatal(err)
	}
	e.clock.add(6 * time.Minute)
	e.session(first)
	if err := e.db.QueryRow(context.Background(), `SELECT last_active_at FROM sessions WHERE token_hash=$1`, hashSecret(e.cookie(first, sessionCookie))).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if !after.After(before) {
		t.Fatal("last activity was not refreshed")
	}
	e.do(first, "DELETE", "/api/v1/account/sessions", nil, 204, nil)
	e.do(second, "GET", "/api/v1/session", nil, 401, nil)
	if e.session(first).User.ID != sess.User.ID {
		t.Fatal("current session revoked")
	}
}

func TestAccountGoogleLinkBoundToSessionAndOwnedIdentity(t *testing.T) {
	e := newEnv(t)
	b := e.emailSignIn("link@example.com")
	me := e.session(b)
	other := e.mustGoogleSignIn(fakeIdentity{Sub: "taken", Email: "taken@example.com"}, "")
	otherID := e.session(other).User.ID
	var start struct {
		URL string `json:"url"`
	}
	e.do(b, "POST", "/api/v1/account/identities/google/start", map[string]string{"next": "//evil.example"}, 200, &start)
	state, code := e.google.authorize(start.URL, fakeIdentity{Sub: "taken", Email: "taken@example.com"}, nil)
	resp := e.do(b, "GET", "/api/v1/auth/google/callback?state="+url.QueryEscape(state)+"&code="+url.QueryEscape(code), nil, 302, nil)
	if resp.Header.Get("Location") != "/login?error=identity_taken" {
		t.Fatalf("foreign identity accepted: %s", resp.Header.Get("Location"))
	}
	if e.count(`SELECT count(*) FROM user_identities WHERE subject='taken' AND user_id=$1`, otherID) != 1 {
		t.Fatal("foreign identity moved")
	}
	e.do(b, "POST", "/api/v1/account/identities/google/start", map[string]string{"next": "/account"}, 200, &start)
	state, code = e.google.authorize(start.URL, fakeIdentity{Sub: "linked", Email: "alias@example.com"}, nil)
	resp = e.do(b, "GET", "/api/v1/auth/google/callback?state="+url.QueryEscape(state)+"&code="+url.QueryEscape(code), nil, 302, nil)
	if resp.Header.Get("Location") != "/account" || e.session(b).User.ID != me.User.ID {
		t.Fatal("link replaced the signed-in user")
	}
	if e.count(`SELECT count(*) FROM user_identities WHERE subject='linked' AND user_id=$1`, me.User.ID) != 1 {
		t.Fatal("identity not linked")
	}
	e.do(b, "DELETE", "/api/v1/account/identities/email", nil, 409, nil)
	e.do(b, "DELETE", "/api/v1/account/identities/google", nil, 204, nil)
	if e.count(`SELECT count(*) FROM user_identities WHERE user_id=$1 AND provider='google'`, me.User.ID) != 0 {
		t.Fatal("identity not disconnected")
	}
}

func TestAccountGoogleLinkStopsAfterSessionEnds(t *testing.T) {
	e := newEnv(t)
	b := e.emailSignIn("logged-out@example.com")
	e.session(b)
	var start struct {
		URL string `json:"url"`
	}
	e.do(b, "POST", "/api/v1/account/identities/google/start", map[string]string{"next": "/account"}, 200, &start)
	state, code := e.google.authorize(start.URL, fakeIdentity{Sub: "must-not-link", Email: "alias@example.com"}, nil)
	e.do(b, "DELETE", "/api/v1/session", nil, 204, nil)
	resp := e.do(b, "GET", "/api/v1/auth/google/callback?state="+url.QueryEscape(state)+"&code="+url.QueryEscape(code), nil, 302, nil)
	if resp.Header.Get("Location") != "/login?error=login_expired" || e.count(`SELECT count(*) FROM user_identities WHERE subject='must-not-link'`) != 0 {
		t.Fatal("logged-out browser linked identity")
	}
}

func TestAccountCannotRemoveLastEnabledSignInMethod(t *testing.T) {
	e := newEnv(t)
	b := e.emailSignIn("last-method@example.com")
	me := e.session(b)
	k := newSoftKey(t)
	var ch challengeOut
	var list passkeyList
	e.do(b, "POST", "/api/v1/account/passkeys/start", map[string]any{}, 200, &ch)
	e.do(b, "POST", "/api/v1/account/passkeys/finish", map[string]any{"challenge_id": ch.ID, "response": k.create(ch.Options), "name": "Only device"}, 201, &list)
	e.svc.cfg.DevSignIn = false
	e.svc.cfg.SMTP.Host = ""
	e.do(b, "DELETE", "/api/v1/account/passkeys/"+list.Data[0].ID, nil, 409, nil)
	if e.count(`SELECT count(*) FROM passkeys WHERE user_id=$1`, me.User.ID) != 1 {
		t.Fatal("last method removed")
	}
}

func TestClosedAccountCannotRejoinDuringDeletion(t *testing.T) {
	e := newEnv(t)
	b := e.emailSignIn("closing@example.com")
	person := e.session(b)
	other := e.emailSignIn("keeper@example.com")
	keeper := e.session(other)
	if err := e.svc.db.AddMember(context.Background(), person.Workspace.ID, keeper.User.ID, "owner", e.clock.now()); err != nil {
		t.Fatal(err)
	}
	locked, release := make(chan struct{}), make(chan struct{})
	closed := make(chan error, 1)
	go func() {
		closed <- e.svc.db.Tx(context.Background(), func(q store.Q) error {
			if err := q.LockAccount(context.Background(), person.User.ID); err != nil {
				return err
			}
			if _, err := q.CloseAccount(context.Background(), person.User.ID, e.clock.now()); err != nil {
				return err
			}
			close(locked)
			<-release
			return nil
		})
	}()
	<-locked
	started := make(chan struct{}, 2)
	outcomes := make(chan error, 2)
	var wg sync.WaitGroup
	wg.Go(func() {
		started <- struct{}{}
		outcomes <- e.svc.db.AddMember(context.Background(), keeper.Workspace.ID, person.User.ID, "owner", e.clock.now())
	})
	wg.Go(func() {
		started <- struct{}{}
		outcomes <- e.svc.db.JoinMember(context.Background(), keeper.Workspace.ID, person.User.ID, "member", []string{"read:clients"}, e.clock.now())
	})
	<-started
	<-started
	close(release)
	if err := <-closed; err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	close(outcomes)
	for err := range outcomes {
		if err == nil {
			t.Fatal("closed account regained membership")
		}
	}
	if e.count(`SELECT count(*) FROM workspace_members WHERE user_id=$1`, person.User.ID) != 0 {
		t.Fatal("deleted member remains")
	}
	if err := e.svc.db.CreateIdentity(context.Background(), "google", "late-identity", person.User.ID, "closing@example.com", e.clock.now()); err == nil {
		t.Fatal("closed account regained sign-in identity")
	}
}
