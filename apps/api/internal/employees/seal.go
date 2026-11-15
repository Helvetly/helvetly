package employees

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"errors"
)

// sealer encrypts an employee's protected fields (bank account, tax id) with AES-256-GCM, as internal/delivery does
// for channel credentials: a key derived from SECRET_KEY for this purpose only, and the workspace, employee and field
// as authenticated data, so sealed bytes cannot be moved to another employee or field.
type sealer struct{ aead cipher.AEAD }

var errNoKey = errors.New("employees: SECRET_KEY is not set, so protected fields cannot be stored")

func newSealer(secret []byte) sealer {
	if len(secret) < 32 {
		return sealer{}
	}
	key, err := hkdf.Key(sha256.New, secret, nil, "helvetly employee protected fields", 32)
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

func aad(workspaceID, employeeID, field string) []byte {
	return []byte(workspaceID + "\x00" + employeeID + "\x00" + field)
}

func (s sealer) seal(workspaceID, employeeID, field, plain string) ([]byte, error) {
	if s.aead == nil {
		return nil, errNoKey
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return s.aead.Seal(nonce, nonce, []byte(plain), aad(workspaceID, employeeID, field)), nil
}

func (s sealer) open(workspaceID, employeeID, field string, sealed []byte) (string, error) {
	if s.aead == nil {
		return "", errNoKey
	}
	n := s.aead.NonceSize()
	if len(sealed) < n {
		return "", errors.New("employees: sealed field too short")
	}
	plain, err := s.aead.Open(nil, sealed[:n], sealed[n:], aad(workspaceID, employeeID, field))
	return string(plain), err
}

// hint keeps the last four characters for recognising a value without revealing it.
func hint(v string) string {
	r := []rune(v)
	if len(r) <= 4 {
		return "••••"
	}
	return "•••• " + string(r[len(r)-4:])
}
