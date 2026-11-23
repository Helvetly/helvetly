package calsync

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
)

// sealer encrypts calendar tokens and feed tokens with AES-256-GCM, as internal/employees does for protected fields:
// a key derived from SECRET_KEY for this purpose only, and the workspace, the record and the field as authenticated
// data, so a copied row cannot be opened for another workspace, connection or field.
type sealer struct{ aead cipher.AEAD }

var errNoKey = errors.New("calsync: SECRET_KEY is not set, so calendar tokens cannot be stored")

func newSealer(secret []byte) sealer {
	if len(secret) < 32 {
		return sealer{}
	}
	key, err := hkdf.Key(sha256.New, secret, nil, "helvetly calendar tokens", 32)
	if err != nil {
		return sealer{}
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return sealer{}
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return sealer{}
	}
	return sealer{aead}
}

func aad(workspaceID, recordID, field string) []byte {
	return []byte(workspaceID + "\x00" + recordID + "\x00" + field)
}

func (s sealer) seal(workspaceID, recordID, field, plain string) ([]byte, error) {
	if s.aead == nil {
		return nil, errNoKey
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return s.aead.Seal(nonce, nonce, []byte(plain), aad(workspaceID, recordID, field)), nil
}

func (s sealer) open(workspaceID, recordID, field string, sealed []byte) (string, error) {
	if s.aead == nil {
		return "", errNoKey
	}
	n := s.aead.NonceSize()
	if len(sealed) < n {
		return "", errors.New("calsync: sealed value too short")
	}
	plain, err := s.aead.Open(nil, sealed[:n], sealed[n:], aad(workspaceID, recordID, field))
	return string(plain), err
}

// cookie seals v as JSON for the OAuth state cookie (no record to bind it to: the cookie itself is the binding).
func (s sealer) cookie(v any) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	sealed, err := s.seal("", "", "oauth state", string(raw))
	return base64.RawURLEncoding.EncodeToString(sealed), err
}

func (s sealer) uncookie(value string, v any) error {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return err
	}
	plain, err := s.open("", "", "oauth state", raw)
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(plain), v)
}
