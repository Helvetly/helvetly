package ksef

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// specRoutes: every "METHOD path" of the pinned official OpenAPI file, as patterns over request paths.
func specRoutes(t *testing.T) map[string]*regexp.Regexp {
	t.Helper()
	raw, err := os.ReadFile("testdata/openapi/open-api.json")
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Paths map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	routes := map[string]*regexp.Regexp{}
	for path, ops := range spec.Paths {
		pattern := "^/v2" + regexp.MustCompile(`\\\{[^}]+\\\}`).ReplaceAllString(regexp.QuoteMeta(path), `[^/]+`) + "$"
		for method := range ops {
			routes[strings.ToUpper(method)+" "+path] = regexp.MustCompile(pattern)
		}
	}
	return routes
}

// fakeKSeF serves the online-session flow. It refuses any route the official API does not have, decrypts the
// invoice with the Ministry key it published and checks the hashes and sizes as KSeF does.
type fakeKSeF struct {
	t        *testing.T
	routes   map[string]*regexp.Regexp
	mfKey    *rsa.PrivateKey
	mfCert   string
	mu       sync.Mutex
	pending  int // auth status polls answering "in progress" before success
	authCode int
	got      []byte
	signed   string
	logins   int
	key, iv  []byte // the session key KSeF unwrapped
}

func newFake(t *testing.T) (*fakeKSeF, *httptest.Server) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "KSeF test MF"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeKSeF{t: t, routes: specRoutes(t), mfKey: key, mfCert: base64.StdEncoding.EncodeToString(der), pending: 1, authCode: 200}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return f, srv
}

func (f *fakeKSeF) known(r *http.Request) bool {
	for route, re := range f.routes {
		if strings.HasPrefix(route, r.Method+" ") && re.MatchString(r.URL.Path) {
			return true
		}
	}
	return false
}

func (f *fakeKSeF) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.known(r) {
		f.t.Errorf("%s %s is not in the official OpenAPI", r.Method, r.URL.Path)
		http.NotFound(w, r)
		return
	}
	reply := func(v any) { _ = json.NewEncoder(w).Encode(v) }
	bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	switch p := strings.TrimPrefix(r.URL.Path, "/v2"); {
	case p == "/auth/challenge":
		reply(map[string]any{"challenge": "20261109-CR-0000000000-0000000000-01", "timestamp": "2026-11-09T10:00:00Z", "timestampMs": 1, "clientIp": "127.0.0.1"})
	case p == "/auth/xades-signature":
		body, _ := io.ReadAll(r.Body)
		f.signed, f.logins = string(body), f.logins+1
		if r.Header.Get("Content-Type") != "application/xml" || !strings.Contains(f.signed, "<ds:SignatureValue>") {
			http.Error(w, `{"exception":"unsigned"}`, http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusAccepted)
		reply(map[string]any{"referenceNumber": "AUTH-1", "authenticationToken": map[string]any{"token": "temp", "validUntil": time.Now().Add(time.Hour)}})
	case p == "/auth/AUTH-1":
		if bearer != "temp" {
			http.Error(w, "", http.StatusUnauthorized)
			return
		}
		code := f.authCode
		if f.pending > 0 {
			f.pending, code = f.pending-1, 100
		}
		reply(map[string]any{"status": map[string]any{"code": code, "description": "status"}})
	case p == "/auth/token/redeem":
		reply(map[string]any{"accessToken": map[string]any{"token": "access", "validUntil": time.Now().Add(15 * time.Minute)},
			"refreshToken": map[string]any{"token": "refresh", "validUntil": time.Now().Add(24 * time.Hour)}})
	case p == "/security/public-key-certificates":
		reply([]map[string]any{{"certificate": f.mfCert, "publicKeyId": "mf-1", "usage": []string{"SymmetricKeyEncryption"},
			"validFrom": time.Now().Add(-time.Hour), "validTo": time.Now().Add(time.Hour)}})
	case bearer != "access":
		http.Error(w, "", http.StatusUnauthorized)
	case p == "/sessions/online":
		var in struct {
			FormCode   map[string]string `json:"formCode"`
			Encryption map[string]string `json:"encryption"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		wrapped, _ := base64.StdEncoding.DecodeString(in.Encryption["encryptedSymmetricKey"])
		key, err := rsa.DecryptOAEP(sha256.New(), nil, f.mfKey, wrapped, nil)
		iv, _ := base64.StdEncoding.DecodeString(in.Encryption["initializationVector"])
		if err != nil || len(key) != 32 || len(iv) != 16 || in.FormCode["systemCode"] != "FA (3)" || in.Encryption["publicKeyId"] != "mf-1" {
			http.Error(w, `{"exception":"bad session"}`, http.StatusBadRequest)
			return
		}
		f.key, f.iv = key, iv
		w.WriteHeader(http.StatusCreated)
		reply(map[string]any{"referenceNumber": "SES-1", "validUntil": time.Now().Add(12 * time.Hour)})
	case p == "/sessions/online/SES-1/invoices":
		var in struct {
			InvoiceHash, EncryptedInvoiceHash, EncryptedInvoiceContent string
			InvoiceSize, EncryptedInvoiceSize                          int
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		enc, _ := base64.StdEncoding.DecodeString(in.EncryptedInvoiceContent)
		block, _ := aes.NewCipher(f.key)
		plain := make([]byte, len(enc))
		cipher.NewCBCDecrypter(block, f.iv).CryptBlocks(plain, enc)
		plain = plain[:len(plain)-int(plain[len(plain)-1])]
		if digest(enc) != in.EncryptedInvoiceHash || len(enc) != in.EncryptedInvoiceSize || digest(plain) != in.InvoiceHash || len(plain) != in.InvoiceSize {
			http.Error(w, `{"exception":"hash"}`, http.StatusBadRequest)
			return
		}
		f.got = plain
		w.WriteHeader(http.StatusAccepted)
		reply(map[string]any{"referenceNumber": "INV-1"})
	case p == "/sessions/online/SES-1/close":
		w.WriteHeader(http.StatusNoContent)
	case p == "/sessions/SES-1/invoices/INV-1":
		reply(map[string]any{"ordinalNumber": 1, "referenceNumber": "INV-1", "invoiceHash": digest(f.got), "invoicingDate": time.Now(),
			"ksefNumber": "5250001233-20261109-0123456789AB-CD", "status": map[string]any{"code": 200, "description": "Sukces"}})
	case p == "/sessions/SES-1/invoices/INV-1/upo":
		w.Header().Set("Content-Type", "application/xml")
		_, _ = io.WriteString(w, "<UPO/>")
	default:
		http.NotFound(w, r)
	}
}

func testCredentials(t *testing.T) Credentials {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return Credentials{NIP: "5250001233", Certificate: selfSigned(t, key, "5250001233"), Key: key}
}

func TestSubmitStatusAndUPO(t *testing.T) {
	f, srv := newFake(t)
	c := New(srv.URL+"/v2", srv.Client())
	c.poll = time.Millisecond
	tp := c.For(testCredentials(t))
	invoice := []byte(`<?xml version="1.0" encoding="UTF-8"?><Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"/>`)

	r, err := tp.Submit(context.Background(), invoice)
	if err != nil {
		t.Fatal(err)
	}
	if r != (Receipt{Session: "SES-1", Invoice: "INV-1"}) || string(f.got) != string(invoice) {
		t.Fatalf("receipt %+v, KSeF received %q", r, f.got)
	}
	if !strings.Contains(f.signed, "<Nip>5250001233</Nip>") {
		t.Fatalf("login context: %s", f.signed)
	}
	st, err := tp.Status(context.Background(), r)
	if err != nil || !st.Done || !st.Accepted || st.KSeFNumber == "" {
		t.Fatalf("status %+v, %v", st, err)
	}
	upo, err := tp.UPO(context.Background(), r)
	if err != nil || string(upo) != "<UPO/>" {
		t.Fatalf("UPO %q, %v", upo, err)
	}
	if f.logins != 1 {
		t.Fatalf("logged in %d times; the access token is reused while valid", f.logins)
	}
}

func TestRefusedLoginAndRateLimit(t *testing.T) {
	f, srv := newFake(t)
	f.authCode = 450 // e.g. a certificate without the rights for this NIP
	c := New(srv.URL+"/v2", srv.Client())
	c.poll = time.Millisecond
	if _, err := c.For(testCredentials(t)).Submit(context.Background(), []byte("<x/>")); !errors.Is(err, errAuthFailed) {
		t.Fatalf("refused login: %v", err)
	}
	limited := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"status":{"code":429}}`, http.StatusTooManyRequests)
	}))
	defer limited.Close()
	_, err := New(limited.URL+"/v2", limited.Client()).For(testCredentials(t)).Submit(context.Background(), nil)
	var kerr *Error
	if !errors.As(err, &kerr) || !kerr.Retryable() {
		t.Fatalf("rate limit: %v, want a retryable error", err)
	}
}

func TestPinnedSpecHasTheRoutesUsed(t *testing.T) {
	routes := specRoutes(t)
	for _, r := range []string{"POST /auth/challenge", "POST /auth/xades-signature", "GET /auth/{referenceNumber}",
		"POST /auth/token/redeem", "GET /security/public-key-certificates", "POST /sessions/online",
		"POST /sessions/online/{referenceNumber}/invoices", "POST /sessions/online/{referenceNumber}/close",
		"GET /sessions/{referenceNumber}/invoices/{invoiceReferenceNumber}",
		"GET /sessions/{referenceNumber}/invoices/{invoiceReferenceNumber}/upo"} {
		if routes[r] == nil {
			t.Errorf("%s is not in the pinned OpenAPI", r)
		}
	}
}
