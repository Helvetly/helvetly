// Package eaddress validates explicit electronic invoice addresses. It never infers a
// participant identifier from an email or tax number, nor claims network registration.
package eaddress

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Address struct {
	Scheme string `json:"scheme"`
	ID     string `json:"id"`
}

// The official Peppol EAS list, checked 2026-11-07, used by BIS 3.0.21:
// https://docs.peppol.eu/poacc/billing/3.0/codelist/eas/
const schemes = " 0002 0007 0009 0060 0088 0096 0097 0106 0130 0135 0142 0151 0158 0183 0184 0188 0190 0191 0192 0195 0196 0198 0199 0200 0201 0204 0208 0209 0210 0211 0216 0218 0221 0225 0230 0235 0240 0242 0244 0245 0246 0248 9910 9913 9914 9915 9918 9919 9920 9922 9923 9924 9925 9926 9927 9928 9929 9930 9931 9932 9933 9934 9935 9936 9937 9938 9939 9940 9941 9942 9943 9944 9945 9946 9947 9948 9949 9950 9951 9952 9953 9957 "

func Normalise(a Address) (Address, error) {
	a.Scheme, a.ID = strings.TrimSpace(a.Scheme), strings.TrimSpace(a.ID)
	if len(a.Scheme) != 4 || !strings.Contains(schemes, " "+a.Scheme+" ") {
		return Address{}, errors.New("Use an electronic address scheme from the Peppol EAS list.")
	}
	if a.ID == "" || utf8.RuneCountInString(a.ID) > 200 || strings.ContainsFunc(a.ID, unicode.IsControl) {
		return Address{}, errors.New("Enter an electronic address of 1–200 characters without control characters.")
	}
	if a.Scheme == "0088" && !gln(a.ID) {
		return Address{}, errors.New("A GLN must contain 13 digits with a valid check digit.")
	}
	return a, nil
}

func gln(id string) bool {
	if len(id) != 13 {
		return false
	}
	total := 0
	for i, c := range id {
		if c < '0' || c > '9' {
			return false
		}
		weight := 1
		if i%2 == 1 {
			weight = 3
		}
		total += int(c-'0') * weight
	}
	return total%10 == 0
}
