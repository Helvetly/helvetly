package ksef

import (
	"bytes"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"errors"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// selfSigned: a test certificate shaped like a qualified personal one (TINPL-<NIP> serial number), which the
// KSeF TEST environment accepts without a trust chain.
func selfSigned(t testing.TB, key crypto.Signer, nip string) *x509.Certificate {
	t.Helper()
	name := pkix.Name{CommonName: "Helvetly Test", Country: []string{"PL"}, SerialNumber: "TINPL-" + nip,
		ExtraNames: []pkix.AttributeTypeAndValue{{Type: asn1.ObjectIdentifier{2, 5, 4, 42}, Value: "Helvetly"},
			{Type: asn1.ObjectIdentifier{2, 5, 4, 4}, Value: "Test"}}}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: name, Issuer: name,
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, key.Public(), key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert
}

// excC14NOf canonicalizes a standalone document with xmllint (an implementation independent of ours).
func excC14NOf(t *testing.T, doc string) string {
	t.Helper()
	if _, err := exec.LookPath("xmllint"); err != nil {
		t.Skip("xmllint not installed: canonical forms not cross-checked")
	}
	path := filepath.Join(t.TempDir(), "doc.xml")
	if err := os.WriteFile(path, []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command("xmllint", "--exc-c14n", path).Output()
	if err != nil {
		t.Fatalf("xmllint: %v", err)
	}
	return string(out)
}

func between(s, start, end string) string {
	i := strings.Index(s, start)
	j := strings.Index(s[i:], end)
	return s[i : i+j+len(end)]
}

func TestXAdESSignatureIsCanonicalAndVerifies(t *testing.T) {
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	ecKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	for name, key := range map[string]crypto.Signer{"RSA": rsaKey, "ECDSA": ecKey} {
		t.Run(name, func(t *testing.T) {
			cred := Credentials{NIP: "5250001233", Certificate: selfSigned(t, key, "5250001233"), Key: key}
			doc := authRequest("20250604-CR-461EA5B000-537A6BA15D-D7 & <x>", cred.NIP)
			raw, err := signAuthRequest(doc, cred, time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC))
			if err != nil {
				t.Fatal(err)
			}
			signed := string(raw)
			digests := regexp.MustCompile(`<ds:DigestValue>([^<]+)</ds:DigestValue>`).FindAllStringSubmatch(signed, -1)
			if len(digests) != 2 {
				t.Fatalf("references: %d", len(digests))
			}

			// reference 1: the document without its signature (enveloped transform), canonicalized
			unsigned := strings.Replace(signed, between(signed, "<ds:Signature ", "</ds:Signature>"), "", 1)
			if c := excC14NOf(t, unsigned); c != doc || hash(c) != digests[0][1] {
				t.Fatalf("document digest over a non-canonical form:\nxmllint %s\nours    %s", c, doc)
			}
			// reference 2: SignedProperties declares every prefix it uses, so standalone C14N equals in-context C14N
			props := between(signed, "<xades:SignedProperties ", "</xades:SignedProperties>")
			if c := excC14NOf(t, props); hash(c) != digests[1][1] {
				t.Fatalf("SignedProperties digest over a non-canonical form:\n%s\n%s", c, props)
			}
			if !strings.Contains(props, base64.StdEncoding.EncodeToString(sum(cred.Certificate.Raw))) {
				t.Fatal("SigningCertificateV2 does not digest the signing certificate")
			}
			// the signature value covers the canonical SignedInfo
			info := excC14NOf(t, between(signed, "<ds:SignedInfo ", "</ds:SignedInfo>"))
			value, err := base64.StdEncoding.DecodeString(regexp.MustCompile(`<ds:SignatureValue>([^<]+)<`).FindStringSubmatch(signed)[1])
			if err != nil {
				t.Fatal(err)
			}
			h := sum([]byte(info))
			switch k := key.Public().(type) {
			case *rsa.PublicKey:
				err = rsa.VerifyPKCS1v15(k, crypto.SHA256, h, value)
			case *ecdsa.PublicKey:
				if len(value) != 64 || !ecdsa.Verify(k, h, new(big.Int).SetBytes(value[:32]), new(big.Int).SetBytes(value[32:])) {
					err = errBadSignature
				}
			}
			if err != nil {
				t.Fatalf("signature does not verify: %v", err)
			}
			if !bytes.HasPrefix(raw, []byte(`<?xml version="1.0" encoding="UTF-8"?><AuthTokenRequest xmlns="`+nsAuth+`">`)) {
				t.Fatalf("document: %s", signed[:120])
			}
		})
	}
}

var errBadSignature = errors.New("ECDSA R||S signature does not verify")

func sum(b []byte) []byte {
	s := sha256.Sum256(b)
	return s[:]
}

func TestWeakKeysAreRefused(t *testing.T) {
	small, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := signatureMethod(small); err == nil {
		t.Fatal("a 1024-bit RSA key was accepted")
	}
}
