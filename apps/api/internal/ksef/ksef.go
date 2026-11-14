// Package ksef is a client of the Polish KSeF 2.0 API: it authenticates a taxpayer with its KSeF (or qualified)
// certificate and a XAdES signature, sends one FA(3) invoice in an online session and reads back its status, KSeF
// number and UPO (official receipt). It keeps no state of its own: a delivery queue stores the Receipt.
// API: https://github.com/CIRFMF/ksef-docs (pinned in testdata/openapi). Hosts: TEST https://api-test.ksef.mf.gov.pl/v2,
// DEMO https://api-demo.ksef.mf.gov.pl/v2, PROD https://api.ksef.mf.gov.pl/v2.
package ksef

import (
	"bytes"
	"context"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"
)

// Sender is what a delivery queue needs: send one invoice, then ask for its outcome with the returned receipt.
type Sender interface {
	Submit(ctx context.Context, invoice []byte) (Receipt, error)
	Status(ctx context.Context, r Receipt) (Status, error)
}

// Receipt identifies a sent invoice in KSeF: its online session and the invoice's reference in it.
type Receipt struct {
	Session string `json:"session"`
	Invoice string `json:"invoice"`
}

// Status of a sent invoice. Done is false while KSeF processes it; then Accepted tells success (with the
// KSeF number) from refusal (Code and Description say why).
type Status struct {
	Done, Accepted bool
	Code           int
	Description    string
	Details        []string
	KSeFNumber     string
}

// Credentials: the taxpayer's NIP (the login context) and the certificate whose key signs the login.
// The key is RSA (2048 bits or more) or ECDSA (P-256 or larger), as KSeF accepts.
type Credentials struct {
	NIP         string
	Certificate *x509.Certificate
	Key         crypto.Signer
}

// Client talks to one KSeF environment; base is the API root ending in /v2.
type Client struct {
	base string
	http *http.Client
	now  func() time.Time
	poll time.Duration
}

func New(base string, hc *http.Client) *Client {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{base: strings.TrimSuffix(base, "/"), http: hc, now: time.Now, poll: time.Second}
}

// For binds a taxpayer's credentials; the result is a Sender that logs in on first use.
func (c *Client) For(cred Credentials) *Taxpayer { return &Taxpayer{c: c, cred: cred} }

// Taxpayer is one taxpayer's connection. It is not safe for concurrent use: KSeF limits sessions per taxpayer,
// so a queue sends one invoice at a time per taxpayer anyway.
type Taxpayer struct {
	c      *Client
	cred   Credentials
	access string
	expiry time.Time
}

var _ Sender = (*Taxpayer)(nil)

// Error is a KSeF HTTP error with its status and body (which names the rule an invoice or login broke).
type Error struct {
	Status int
	Body   string
}

func (e *Error) Error() string { return fmt.Sprintf("ksef: HTTP %d: %s", e.Status, e.Body) }

// Retryable: rate limits and server errors; anything else will fail again unchanged.
func (e *Error) Retryable() bool { return e.Status == http.StatusTooManyRequests || e.Status >= 500 }

var errAuthFailed = errors.New("ksef: authentication refused")

// Submit opens an online session for FA(3), sends the invoice encrypted with a fresh AES key, and closes the
// session; KSeF then validates the invoice asynchronously (see Status).
func (t *Taxpayer) Submit(ctx context.Context, invoice []byte) (Receipt, error) {
	if err := t.login(ctx); err != nil {
		return Receipt{}, err
	}
	pub, keyID, err := t.c.publicKey(ctx, "SymmetricKeyEncryption")
	if err != nil {
		return Receipt{}, err
	}
	key, iv := make([]byte, 32), make([]byte, aes.BlockSize)
	if _, err := rand.Read(key); err != nil {
		return Receipt{}, err
	}
	if _, err := rand.Read(iv); err != nil {
		return Receipt{}, err
	}
	wrapped, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, pub, key, nil)
	if err != nil {
		return Receipt{}, fmt.Errorf("ksef: wrap session key: %w", err)
	}
	var session struct {
		ReferenceNumber string `json:"referenceNumber"`
	}
	open := map[string]any{
		"formCode": map[string]string{"systemCode": "FA (3)", "schemaVersion": "1-0E", "value": "FA"},
		"encryption": map[string]string{"encryptedSymmetricKey": base64.StdEncoding.EncodeToString(wrapped),
			"initializationVector": base64.StdEncoding.EncodeToString(iv), "publicKeyId": keyID},
	}
	if err := t.c.call(ctx, http.MethodPost, "/sessions/online", t.access, open, &session); err != nil {
		return Receipt{}, err
	}
	encrypted := encrypt(key, iv, invoice)
	var sent struct {
		ReferenceNumber string `json:"referenceNumber"`
	}
	body := map[string]any{"invoiceHash": digest(invoice), "invoiceSize": len(invoice),
		"encryptedInvoiceHash": digest(encrypted), "encryptedInvoiceSize": len(encrypted),
		"encryptedInvoiceContent": base64.StdEncoding.EncodeToString(encrypted)}
	if err := t.c.call(ctx, http.MethodPost, "/sessions/online/"+session.ReferenceNumber+"/invoices", t.access, body, &sent); err != nil {
		return Receipt{}, err
	}
	r := Receipt{Session: session.ReferenceNumber, Invoice: sent.ReferenceNumber}
	// the invoice is accepted for processing; a failed close only delays the session's own UPO, so it is not an error
	_ = t.c.call(ctx, http.MethodPost, "/sessions/online/"+r.Session+"/close", t.access, nil, nil)
	return r, nil
}

// Status reads a sent invoice's processing status: codes below 200 are in progress, 200 is accepted.
func (t *Taxpayer) Status(ctx context.Context, r Receipt) (Status, error) {
	if err := t.login(ctx); err != nil {
		return Status{}, err
	}
	var out struct {
		KsefNumber string `json:"ksefNumber"`
		Status     struct {
			Code        int      `json:"code"`
			Description string   `json:"description"`
			Details     []string `json:"details"`
		} `json:"status"`
	}
	if err := t.c.call(ctx, http.MethodGet, "/sessions/"+r.Session+"/invoices/"+r.Invoice, t.access, nil, &out); err != nil {
		return Status{}, err
	}
	s := out.Status
	return Status{Done: s.Code >= 200, Accepted: s.Code == 200, Code: s.Code, Description: s.Description,
		Details: s.Details, KSeFNumber: out.KsefNumber}, nil
}

// UPO is the official receipt (XML) of an accepted invoice, the proof of its delivery to KSeF.
func (t *Taxpayer) UPO(ctx context.Context, r Receipt) ([]byte, error) {
	if err := t.login(ctx); err != nil {
		return nil, err
	}
	return t.c.raw(ctx, http.MethodGet, "/sessions/"+r.Session+"/invoices/"+r.Invoice+"/upo", t.access)
}

// login: challenge → XAdES-signed AuthTokenRequest → wait for the verification → redeem the access token.
func (t *Taxpayer) login(ctx context.Context) error {
	if t.access != "" && t.c.now().Before(t.expiry.Add(-time.Minute)) {
		return nil
	}
	var challenge struct {
		Challenge string `json:"challenge"`
	}
	if err := t.c.call(ctx, http.MethodPost, "/auth/challenge", "", nil, &challenge); err != nil {
		return err
	}
	signed, err := signAuthRequest(authRequest(challenge.Challenge, t.cred.NIP), t.cred, t.c.now())
	if err != nil {
		return err
	}
	var init struct {
		ReferenceNumber     string `json:"referenceNumber"`
		AuthenticationToken struct {
			Token string `json:"token"`
		} `json:"authenticationToken"`
	}
	if err := t.c.send(ctx, http.MethodPost, "/auth/xades-signature", "", "application/xml", signed, &init); err != nil {
		return err
	}
	temp := init.AuthenticationToken.Token
	for {
		var st struct {
			Status struct {
				Code        int      `json:"code"`
				Description string   `json:"description"`
				Details     []string `json:"details"`
			} `json:"status"`
		}
		if err := t.c.call(ctx, http.MethodGet, "/auth/"+init.ReferenceNumber, temp, nil, &st); err != nil {
			return err
		}
		if st.Status.Code == 200 {
			break
		}
		if st.Status.Code >= 300 {
			return fmt.Errorf("%w: %d %s %v", errAuthFailed, st.Status.Code, st.Status.Description, st.Status.Details)
		}
		select { // the certificate is being verified (OCSP/CRL for qualified ones, at once for KSeF certificates)
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(t.c.poll):
		}
	}
	var tokens struct {
		AccessToken struct {
			Token      string    `json:"token"`
			ValidUntil time.Time `json:"validUntil"`
		} `json:"accessToken"`
	}
	if err := t.c.call(ctx, http.MethodPost, "/auth/token/redeem", temp, nil, &tokens); err != nil {
		return err
	}
	t.access, t.expiry = tokens.AccessToken.Token, tokens.AccessToken.ValidUntil
	return nil
}

// publicKey: the Ministry of Finance's current RSA key for the given usage, and its id.
func (c *Client) publicKey(ctx context.Context, usage string) (*rsa.PublicKey, string, error) {
	var certs []struct {
		Certificate string    `json:"certificate"`
		PublicKeyID string    `json:"publicKeyId"`
		Usage       []string  `json:"usage"`
		ValidFrom   time.Time `json:"validFrom"`
		ValidTo     time.Time `json:"validTo"`
	}
	if err := c.call(ctx, http.MethodGet, "/security/public-key-certificates", "", nil, &certs); err != nil {
		return nil, "", err
	}
	now := c.now()
	for _, k := range certs {
		if !slices.Contains(k.Usage, usage) || now.Before(k.ValidFrom) || now.After(k.ValidTo) {
			continue
		}
		der, err := base64.StdEncoding.DecodeString(k.Certificate)
		if err != nil {
			return nil, "", fmt.Errorf("ksef: public key certificate: %w", err)
		}
		cert, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, "", fmt.Errorf("ksef: public key certificate: %w", err)
		}
		if pub, ok := cert.PublicKey.(*rsa.PublicKey); ok {
			return pub, k.PublicKeyID, nil
		}
	}
	return nil, "", fmt.Errorf("ksef: no valid public key for %s", usage)
}

// encrypt: AES-256-CBC with PKCS#7 padding, as KSeF requires for invoice content.
func encrypt(key, iv, plain []byte) []byte {
	block, _ := aes.NewCipher(key) // a 32-byte key cannot fail
	pad := aes.BlockSize - len(plain)%aes.BlockSize
	data := append(bytes.Clone(plain), bytes.Repeat([]byte{byte(pad)}, pad)...)
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(data, data)
	return data
}

func digest(b []byte) string {
	sum := sha256.Sum256(b)
	return base64.StdEncoding.EncodeToString(sum[:])
}

func (c *Client) call(ctx context.Context, method, path, token string, in, out any) error {
	var body []byte
	if in != nil {
		var err error
		if body, err = json.Marshal(in); err != nil {
			return err
		}
	}
	return c.send(ctx, method, path, token, "application/json", body, out)
}

func (c *Client) send(ctx context.Context, method, path, token, contentType string, body []byte, out any) error {
	raw, err := c.do(ctx, method, path, token, contentType, body)
	if err != nil || out == nil {
		return err
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("ksef: %s %s: decode: %w", method, path, err)
	}
	return nil
}

func (c *Client) raw(ctx context.Context, method, path, token string) ([]byte, error) {
	return c.do(ctx, method, path, token, "", nil)
}

const maxResponse = 16 << 20

func (c *Client) do(ctx context.Context, method, path, token, contentType string, body []byte) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ksef: %s %s: %w", method, path, err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxResponse))
	if err != nil {
		return nil, fmt.Errorf("ksef: %s %s: %w", method, path, err)
	}
	if res.StatusCode >= 300 {
		return nil, &Error{Status: res.StatusCode, Body: strings.TrimSpace(string(raw))}
	}
	return raw, nil
}
