// Package tags holds the one shape of a tag everywhere (clients, documents): ASCII letters, digits and inner
// hyphens, at most MaxLen characters, such as "invoice", "q4-2026" or "office-supplies".
package tags

import (
	"regexp"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// MaxLen is a tag's longest length.
const MaxLen = 32

var valid = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$`)

// Problem is the rule a typed tag breaks, "" when it is fine.
const Problem = "A tag uses letters a–z, digits and hyphens, not at its start or end, up to 32 characters."

// Valid reports whether a typed tag has the shape.
func Valid(t string) bool { return len(t) <= MaxLen && valid.MatchString(t) }

var umlauts = strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "Ä", "Ae", "Ö", "Oe", "Ü", "Ue", "ß", "ss")

// Slug turns a name the app or the model made (a category, a model's tag) into a tag: lower case, umlauts spelled
// out, accents dropped, every other run of characters one hyphen, trimmed to MaxLen; "" when nothing is left.
func Slug(name string) string {
	var b strings.Builder
	hyphen := false
	for _, r := range norm.NFD.String(umlauts.Replace(strings.ToLower(name))) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			if hyphen && b.Len() > 0 {
				b.WriteByte('-')
			}
			hyphen = false
			b.WriteRune(r)
		case r >= 0x300 && r <= 0x36f: // a combining accent: é → e
		default:
			hyphen = true
		}
	}
	s := b.String()
	if len(s) > MaxLen {
		s = strings.TrimRight(s[:MaxLen], "-")
	}
	return s
}
