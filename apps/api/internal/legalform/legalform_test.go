package legalform

import (
	"regexp"
	"slices"
	"testing"
)

func TestFormsAreWellFormed(t *testing.T) {
	groups := []string{"sole", "partnership", "company", "association"}
	code := regexp.MustCompile(`^[a-z0-9_]{1,40}$`)
	for country, forms := range All() {
		if len(country) != 2 || len(forms) == 0 {
			t.Errorf("%q: country code or empty list", country)
		}
		seen := map[string]bool{}
		for _, f := range forms {
			if !code.MatchString(f.Code) || seen[f.Code] {
				t.Errorf("%s: code %q malformed or repeated", country, f.Code)
			}
			seen[f.Code] = true
			if !slices.Contains(groups, f.Group) || f.Name == "" {
				t.Errorf("%s/%s: group %q, name %q", country, f.Code, f.Group, f.Name)
			}
			for lang := range f.Names {
				if !slices.Contains([]string{"de", "fr", "it", "en"}, lang) {
					t.Errorf("%s/%s: name in unknown language %q", country, f.Code, lang)
				}
			}
		}
	}
}

func TestLookup(t *testing.T) {
	for _, c := range []struct {
		country, code string
		group         string
		ok            bool
	}{
		{"CH", "gmbh", "company", true},
		{"CH", "sole", "sole", true},
		{"PL", "spzoo", "company", true},
		{"CH", "spzoo", "", false},
		{"US", "llc", "", false},
		{"CH", "", "", false},
	} {
		f, ok := Lookup(c.country, c.code)
		if ok != c.ok || f.Group != c.group {
			t.Errorf("Lookup(%s, %s) = %+v, %v", c.country, c.code, f, ok)
		}
	}
	if !Listed("CH") || Listed("US") {
		t.Error("Listed: CH has a list, US has none")
	}
}
