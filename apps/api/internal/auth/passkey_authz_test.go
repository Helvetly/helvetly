package auth

import "testing"

// TestPasskeyAddFailureKeepsSession: a refused passkey registration is not a 401, which the app would read as a
// lost session and sign the person out.
func TestPasskeyAddFailureKeepsSession(t *testing.T) {
	e := newEnv(t)
	b := e.emailSignIn("adder@example.com")
	var ch challengeOut
	e.do(b, "POST", "/api/v1/account/passkeys/start", map[string]any{}, 200, &ch)
	var out apiErr
	e.do(b, "POST", "/api/v1/account/passkeys/finish", map[string]any{"challenge_id": ch.ID, "name": "", "response": map[string]any{"id": "bogus"}}, 422, &out)
	if out.Error.Code != "passkey_failed" {
		t.Fatalf("code %q", out.Error.Code)
	}
	e.session(b)
}
