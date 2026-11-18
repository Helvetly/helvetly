// Package legalform is the list of a business's legal forms per country, as data (forms.json). Modules that depend on
// the form (the annual tax dossier) look at its group, never at the code of one country's form.
package legalform

import (
	_ "embed"
	"encoding/json"
)

// Form is one legal form of a country. Name is its local name, Names the name per interface language when it differs;
// Suffixes are what a company's name ends with in that form, for a suggestion from the name.
type Form struct {
	Code     string            `json:"code"`
	Group    string            `json:"group"` // sole, partnership, company or association
	Name     string            `json:"name"`
	Names    map[string]string `json:"names,omitempty"`
	Suffixes []string          `json:"suffixes,omitempty"`
}

//go:embed forms.json
var raw []byte

var byCountry = func() map[string][]Form {
	var m map[string][]Form
	if err := json.Unmarshal(raw, &m); err != nil {
		panic("legalform: forms.json: " + err.Error())
	}
	return m
}()

// All is every country's forms, keyed by ISO country code; a country without a list has no entry.
func All() map[string][]Form { return byCountry }

// Lookup finds a country's form by its code.
func Lookup(country, code string) (Form, bool) {
	for _, f := range byCountry[country] {
		if f.Code == code {
			return f, true
		}
	}
	return Form{}, false
}

// Listed says whether the country has a list, and so whether a business there must choose its form.
func Listed(country string) bool { return len(byCountry[country]) > 0 }
