package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"testing"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
)

// softKey is a software authenticator for one passkey: a P-256 key, "none" attestation, and the RP and
// origin of the test platform (testOrigin).
type softKey struct {
	t      *testing.T
	key    *ecdsa.PrivateKey
	id     []byte
	handle []byte
}

func newSoftKey(t *testing.T) *softKey {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	return &softKey{t: t, key: key, id: id}
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func (k *softKey) authData(flags protocol.AuthenticatorFlags, count uint32, attested []byte) []byte {
	h := sha256.Sum256([]byte(testRPID))
	d := append([]byte{}, h[:]...)
	d = append(d, byte(flags))
	d = binary.BigEndian.AppendUint32(d, count)
	return append(d, attested...)
}

func clientData(t *testing.T, typ, challenge string) []byte {
	b, err := json.Marshal(map[string]any{"type": typ, "challenge": challenge, "origin": testOrigin, "crossOrigin": false})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// create answers navigator.credentials.create for the options the server sent.
func (k *softKey) create(options map[string]any) map[string]any {
	k.t.Helper()
	handle, err := base64.RawURLEncoding.DecodeString(options["user"].(map[string]any)["id"].(string))
	if err != nil {
		k.t.Fatal(err)
	}
	k.handle = handle
	pub, err := webauthncbor.Marshal(map[int64]any{
		1: int64(webauthncose.EllipticKey), 3: int64(webauthncose.AlgES256), -1: int64(webauthncose.P256),
		-2: k.key.X.FillBytes(make([]byte, 32)), -3: k.key.Y.FillBytes(make([]byte, 32)),
	})
	if err != nil {
		k.t.Fatal(err)
	}
	attested := make([]byte, 16) // AAGUID
	attested = binary.BigEndian.AppendUint16(attested, uint16(len(k.id)))
	attested = append(append(attested, k.id...), pub...)
	auth := k.authData(protocol.FlagUserPresent|protocol.FlagUserVerified|protocol.FlagAttestedCredentialData, 0, attested)
	att, err := webauthncbor.Marshal(map[string]any{"fmt": "none", "attStmt": map[string]any{}, "authData": auth})
	if err != nil {
		k.t.Fatal(err)
	}
	return map[string]any{"id": b64(k.id), "rawId": b64(k.id), "type": "public-key", "response": map[string]any{
		"attestationObject": b64(att), "clientDataJSON": b64(clientData(k.t, "webauthn.create", options["challenge"].(string))),
	}}
}

// get answers navigator.credentials.get with the sign counter `count`, signed by `signer`.
func (k *softKey) get(options map[string]any, count uint32, signer *ecdsa.PrivateKey) map[string]any {
	k.t.Helper()
	auth := k.authData(protocol.FlagUserPresent|protocol.FlagUserVerified, count, nil)
	cd := clientData(k.t, "webauthn.get", options["challenge"].(string))
	ch := sha256.Sum256(cd)
	digest := sha256.Sum256(append(append([]byte{}, auth...), ch[:]...))
	sig, err := ecdsa.SignASN1(rand.Reader, signer, digest[:])
	if err != nil {
		k.t.Fatal(err)
	}
	return map[string]any{"id": b64(k.id), "rawId": b64(k.id), "type": "public-key", "response": map[string]any{
		"authenticatorData": b64(auth), "clientDataJSON": b64(cd), "signature": b64(sig), "userHandle": b64(k.handle),
	}}
}

type challengeOut struct {
	ID      string         `json:"challenge_id"`
	Options map[string]any `json:"options"`
}

type passkeyList struct {
	Data []struct {
		ID, Name   string
		CreatedAt  string  `json:"created_at"`
		LastUsedAt *string `json:"last_used_at"`
	} `json:"data"`
}

// passkeySignIn signs a new browser in with the authenticator's answer (want 201), or checks the refusal.
func (e *env) passkeySignIn(k *softKey, count uint32, signer *ecdsa.PrivateKey, want int, out any) *browser {
	e.t.Helper()
	var ch challengeOut
	e.do(nil, "POST", "/api/v1/auth/passkey/start", map[string]any{}, 200, &ch)
	b := e.newBrowser()
	e.do(b, "POST", "/api/v1/auth/passkey/finish", map[string]any{"challenge_id": ch.ID, "response": k.get(ch.Options, count, signer), "next": "/x"}, want, out)
	if want == 201 {
		e.session(b)
	}
	return b
}

func TestPasskeys(t *testing.T) {
	e := newEnv(t)
	zoe := e.emailSignIn("zoe@example.com")
	me := e.session(zoe).User.ID
	k := newSoftKey(t)

	var ch challengeOut
	e.do(zoe, "POST", "/api/v1/account/passkeys/start", map[string]any{}, 200, &ch)
	if ch.Options["rp"].(map[string]any)["id"] != testRPID {
		t.Fatalf("options: %+v", ch.Options)
	}
	if sel := ch.Options["authenticatorSelection"].(map[string]any); sel["residentKey"] != "required" {
		t.Fatalf("not discoverable: %+v", sel)
	}
	answer := k.create(ch.Options)
	var list passkeyList
	e.do(zoe, "POST", "/api/v1/account/passkeys/finish", map[string]any{"challenge_id": ch.ID, "name": " MacBook ", "response": answer}, 201, &list)
	if len(list.Data) != 1 || list.Data[0].Name != "MacBook" || list.Data[0].LastUsedAt != nil || list.Data[0].CreatedAt == "" {
		t.Fatalf("after adding: %+v", list)
	}
	pk := list.Data[0].ID

	// The challenge works once.
	var errOut apiErr
	e.do(zoe, "POST", "/api/v1/account/passkeys/finish", map[string]any{"challenge_id": ch.ID, "name": "", "response": answer}, 410, &errOut)
	if errOut.Error.Code != "passkey_expired" {
		t.Fatalf("replay: %+v", errOut)
	}
	// The same device again: excluded in the options, refused if answered anyway.
	e.do(zoe, "POST", "/api/v1/account/passkeys/start", map[string]any{}, 200, &ch)
	if ex, _ := ch.Options["excludeCredentials"].([]any); len(ex) != 1 {
		t.Fatalf("exclusions: %+v", ch.Options["excludeCredentials"])
	}
	e.do(zoe, "POST", "/api/v1/account/passkeys/finish", map[string]any{"challenge_id": ch.ID, "name": "", "response": k.create(ch.Options)}, 409, nil)

	// Sign in with it, no address typed.
	var res struct{ Next string }
	p := e.passkeySignIn(k, 1, k.key, 201, &res)
	if s := e.session(p); s.User.ID != me || res.Next != "/x" {
		t.Fatalf("passkey signed in %+v, next %q", s.User, res.Next)
	}
	e.do(zoe, "GET", "/api/v1/account/passkeys", nil, 200, &list)
	if list.Data[0].LastUsedAt == nil {
		t.Fatalf("last use not recorded: %+v", list)
	}

	// Another key's signature, and a counter that did not go up (a copied authenticator), are refused.
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	e.passkeySignIn(k, 2, other, 401, &errOut)
	if errOut.Error.Code != "passkey_failed" {
		t.Fatalf("wrong key: %+v", errOut)
	}
	e.passkeySignIn(k, 1, k.key, 401, &errOut)
	if errOut.Error.Code != "passkey_cloned" {
		t.Fatalf("clone: %+v", errOut)
	}
	e.passkeySignIn(k, 2, k.key, 201, nil)

	// A refused answer uses its challenge up: a second try with the right key needs a new one.
	var sch challengeOut
	e.do(nil, "POST", "/api/v1/auth/passkey/start", map[string]any{}, 200, &sch)
	e.do(nil, "POST", "/api/v1/auth/passkey/finish", map[string]any{"challenge_id": sch.ID, "response": k.get(sch.Options, 3, other), "next": ""}, 401, nil)
	e.do(nil, "POST", "/api/v1/auth/passkey/finish", map[string]any{"challenge_id": sch.ID, "response": k.get(sch.Options, 3, k.key), "next": ""}, 410, nil)
	// An answer to a registration challenge does not sign in.
	e.do(zoe, "POST", "/api/v1/account/passkeys/start", map[string]any{}, 200, &ch)
	e.do(nil, "POST", "/api/v1/auth/passkey/finish", map[string]any{"challenge_id": ch.ID, "response": k.get(ch.Options, 5, k.key), "next": ""}, 410, nil)
	// Nor does a registration challenge finish for someone else.
	bob := e.emailSignIn("bob@example.com")
	e.do(zoe, "POST", "/api/v1/account/passkeys/start", map[string]any{}, 200, &ch)
	e.do(bob, "POST", "/api/v1/account/passkeys/finish", map[string]any{"challenge_id": ch.ID, "name": "", "response": newSoftKey(t).create(ch.Options)}, 410, nil)

	// Removing: only one's own.
	e.do(bob, "DELETE", "/api/v1/account/passkeys/"+pk, nil, 404, nil)
	e.do(zoe, "DELETE", "/api/v1/account/passkeys/"+pk, nil, 204, nil)
	e.do(zoe, "GET", "/api/v1/account/passkeys", nil, 200, &list)
	if len(list.Data) != 0 {
		t.Fatalf("after removing: %+v", list)
	}
	e.passkeySignIn(k, 6, k.key, 401, nil)
}
