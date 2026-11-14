package delivery

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"errors"
)

// sealer encrypts a workspace's channel credentials with AES-256-GCM. The key is derived from SECRET_KEY for this
// purpose only, and the workspace and channel are authenticated data, so sealed bytes cannot be moved between them.
type sealer struct{ aead cipher.AEAD }

func newSealer(secret []byte) (sealer, error) {
	if len(secret) < 32 {
		return sealer{}, errors.New("delivery: SECRET_KEY must be at least 32 bytes")
	}
	key, err := hkdf.Key(sha256.New, secret, nil, "helvetly transmission credentials", 32)
	if err != nil {
		return sealer{}, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return sealer{}, err
	}
	aead, err := cipher.NewGCM(block)
	return sealer{aead}, err
}

func aad(workspaceID, channel string) []byte { return []byte(workspaceID + "\x00" + channel) }

func (s sealer) seal(workspaceID, channel string, plain []byte) ([]byte, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return s.aead.Seal(nonce, nonce, plain, aad(workspaceID, channel)), nil
}

func (s sealer) open(workspaceID, channel string, sealed []byte) ([]byte, error) {
	n := s.aead.NonceSize()
	if len(sealed) < n {
		return nil, errors.New("delivery: sealed credentials too short")
	}
	return s.aead.Open(nil, sealed[:n], sealed[n:], aad(workspaceID, channel))
}
