package ksef

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/asn1"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
)

const (
	nsAuth  = "http://ksef.mf.gov.pl/auth/token/2.0"
	nsDS    = "http://www.w3.org/2000/09/xmldsig#"
	nsXAdES = "http://uri.etsi.org/01903/v1.3.2#"
	excC14N = "http://www.w3.org/2001/10/xml-exc-c14n#"
	sha256A = "http://www.w3.org/2001/04/xmlenc#sha256"
)

// authRequest is the AuthTokenRequest in exclusive canonical form (no declaration, no whitespace between
// elements), so the enveloped reference digests exactly these bytes.
func authRequest(challenge, nip string) string {
	return `<AuthTokenRequest xmlns="` + nsAuth + `"><Challenge>` + text(challenge) + `</Challenge><ContextIdentifier><Nip>` +
		text(nip) + `</Nip></ContextIdentifier><SubjectIdentifierType>certificateSubject</SubjectIdentifierType></AuthTokenRequest>`
}

// signAuthRequest adds an enveloped XAdES-BES signature (SigningCertificateV2, SHA-256, exclusive C14N).
// Each signed part is written already in its exclusive canonical form, so its digest needs no XML canonicalizer:
// prefixed elements carry their own prefix declarations, attributes are sorted, empty elements are written open
// and closed, and text is escaped as C14N does. signature_test.go checks the forms against xmllint --exc-c14n.
func signAuthRequest(doc string, cred Credentials, now time.Time) ([]byte, error) {
	method, err := signatureMethod(cred.Key)
	if err != nil {
		return nil, err
	}
	certDigest := sha256.Sum256(cred.Certificate.Raw)
	props := signedProperties(now, base64.StdEncoding.EncodeToString(certDigest[:]))
	info := `<ds:SignedInfo xmlns:ds="` + nsDS + `">` +
		`<ds:CanonicalizationMethod Algorithm="` + excC14N + `"></ds:CanonicalizationMethod>` +
		`<ds:SignatureMethod Algorithm="` + method + `"></ds:SignatureMethod>` +
		`<ds:Reference URI=""><ds:Transforms>` +
		`<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>` +
		`<ds:Transform Algorithm="` + excC14N + `"></ds:Transform></ds:Transforms>` +
		`<ds:DigestMethod Algorithm="` + sha256A + `"></ds:DigestMethod><ds:DigestValue>` + hash(doc) + `</ds:DigestValue></ds:Reference>` +
		`<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#SignedProperties"><ds:Transforms>` +
		`<ds:Transform Algorithm="` + excC14N + `"></ds:Transform></ds:Transforms>` +
		`<ds:DigestMethod Algorithm="` + sha256A + `"></ds:DigestMethod><ds:DigestValue>` + hash(props) + `</ds:DigestValue></ds:Reference>` +
		`</ds:SignedInfo>`
	value, err := sign(cred.Key, info)
	if err != nil {
		return nil, err
	}
	signature := `<ds:Signature xmlns:ds="` + nsDS + `" Id="Signature">` + info +
		`<ds:SignatureValue>` + value + `</ds:SignatureValue>` +
		`<ds:KeyInfo><ds:X509Data><ds:X509Certificate>` + base64.StdEncoding.EncodeToString(cred.Certificate.Raw) +
		`</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
		`<ds:Object><xades:QualifyingProperties xmlns:xades="` + nsXAdES + `" Target="#Signature">` + props +
		`</xades:QualifyingProperties></ds:Object></ds:Signature>`
	end := strings.LastIndex(doc, "</")
	return []byte(`<?xml version="1.0" encoding="UTF-8"?>` + doc[:end] + signature + doc[end:]), nil
}

func signedProperties(now time.Time, certDigest string) string {
	return `<xades:SignedProperties xmlns:xades="` + nsXAdES + `" Id="SignedProperties">` +
		`<xades:SignedSignatureProperties><xades:SigningTime>` + now.UTC().Format(time.RFC3339) + `</xades:SigningTime>` +
		`<xades:SigningCertificateV2><xades:Cert><xades:CertDigest>` +
		`<ds:DigestMethod xmlns:ds="` + nsDS + `" Algorithm="` + sha256A + `"></ds:DigestMethod>` +
		`<ds:DigestValue xmlns:ds="` + nsDS + `">` + certDigest + `</ds:DigestValue>` +
		`</xades:CertDigest></xades:Cert></xades:SigningCertificateV2>` +
		`</xades:SignedSignatureProperties></xades:SignedProperties>`
}

func signatureMethod(key crypto.Signer) (string, error) {
	switch k := key.Public().(type) {
	case *rsa.PublicKey:
		if k.N.BitLen() < 2048 {
			return "", errors.New("ksef: an RSA key needs at least 2048 bits")
		}
		return "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", nil
	case *ecdsa.PublicKey:
		if k.Curve.Params().BitSize < 256 {
			return "", errors.New("ksef: an ECDSA key needs a curve of at least 256 bits")
		}
		return "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256", nil
	}
	return "", fmt.Errorf("ksef: unsupported key type %T", key.Public())
}

// sign: RSA PKCS#1 v1.5, or ECDSA as the fixed-size R||S concatenation XML Signature requires (not ASN.1).
func sign(key crypto.Signer, signedInfo string) (string, error) {
	sum := sha256.Sum256([]byte(signedInfo))
	sig, err := key.Sign(rand.Reader, sum[:], crypto.SHA256)
	if err != nil {
		return "", fmt.Errorf("ksef: sign: %w", err)
	}
	if pub, ok := key.Public().(*ecdsa.PublicKey); ok {
		var rs struct{ R, S *big.Int }
		if _, err := asn1.Unmarshal(sig, &rs); err != nil {
			return "", fmt.Errorf("ksef: ECDSA signature: %w", err)
		}
		size := (pub.Curve.Params().BitSize + 7) / 8
		sig = append(rs.R.FillBytes(make([]byte, size)), rs.S.FillBytes(make([]byte, size))...)
	}
	return base64.StdEncoding.EncodeToString(sig), nil
}

func hash(canonical string) string {
	sum := sha256.Sum256([]byte(canonical))
	return base64.StdEncoding.EncodeToString(sum[:])
}

// text escapes character data the way C14N does: &, < and > (quotes stay), carriage returns as &#xD;.
func text(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\r", "&#xD;").Replace(s)
}
