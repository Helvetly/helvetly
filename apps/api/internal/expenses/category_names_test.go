package expenses

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"helvetly.com/api/internal/store"
)

type presetCategory struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	AccountCode  string  `json:"account_code"`
	Preset       *string `json:"preset"`
	VATTreatment *string `json:"vat_treatment"`
	IsArchived   bool    `json:"is_archived"`
}

func TestLanguage(t *testing.T) {
	for _, tc := range []struct{ query, header, want string }{
		{"", "", "en"},
		{"de", "fr-CH", "de"},
		{"", "fr-CH,fr;q=0.9,en;q=0.8", "fr"},
		{"", "nl-NL, it;q=0.5", "it"},
		{"pl", "", "en"},
		{"", "EN-gb", "en"},
	} {
		r := httptest.NewRequest("GET", "/api/v1/expense-categories?lang="+tc.query, nil)
		r.Header.Set("Accept-Language", tc.header)
		if got := language(r); got != tc.want {
			t.Errorf("lang=%q Accept-Language=%q: %q, want %q", tc.query, tc.header, got, tc.want)
		}
	}
}

func TestLocalize(t *testing.T) {
	travel, unknown := "travel", "gone"
	for _, tc := range []struct {
		name, lang string
		in         *store.CategoryRef
		want       string
	}{
		{"preset in German", "de", &store.CategoryRef{Name: "Travel", Preset: &travel}, "Reisen"},
		{"preset in Italian", "it", &store.CategoryRef{Name: "Travel", Preset: &travel}, "Viaggi"},
		{"English keeps the stored name", "en", &store.CategoryRef{Name: "Travel", Preset: &travel}, "Travel"},
		{"a named category is never translated", "de", &store.CategoryRef{Name: "Coworking"}, "Coworking"},
		{"an unknown key keeps the name", "fr", &store.CategoryRef{Name: "Old", Preset: &unknown}, "Old"},
	} {
		localize(tc.lang, tc.in)
		if tc.in.Name != tc.want {
			t.Errorf("%s: %q, want %q", tc.name, tc.in.Name, tc.want)
		}
	}
	localize("de", nil) // an expense without a category
}

// TestPresetNamesMatchPlatform: every catalogue entry has its name in every language, and the platform's messages
// (expenseCategory<Key>) say the same words, so the API and the platform never name a category differently.
func TestPresetNamesMatchPlatform(t *testing.T) {
	for _, lang := range []string{"en", "de", "fr", "it"} {
		raw, err := os.ReadFile("../../../platform/src/messages/" + lang + ".json")
		if err != nil {
			t.Fatal(err)
		}
		var messages map[string]string
		if err := json.Unmarshal(raw, &messages); err != nil {
			t.Fatal(err)
		}
		for _, p := range store.CategoryPresets {
			want := p.Name
			if lang != "en" {
				want = presetNames[lang][p.Key]
			}
			if want == "" {
				t.Errorf("%s has no %s name", p.Key, lang)
			}
			if got := messages["expenseCategory"+pascal(p.Key)]; got != want {
				t.Errorf("%s %s: platform says %q, API %q", lang, p.Key, got, want)
			}
		}
		if lang != "en" && len(presetNames[lang]) != len(store.CategoryPresets) {
			t.Errorf("%s names %d presets, the catalogue has %d", lang, len(presetNames[lang]), len(store.CategoryPresets))
		}
	}
}

func pascal(key string) string {
	parts := strings.Split(key, "_")
	for i, p := range parts {
		parts[i] = strings.ToUpper(p[:1]) + p[1:]
	}
	return strings.Join(parts, "")
}

// TestCategoryCatalogue: a new workspace gets the whole catalogue once, even when its first lists race; names follow
// the asker's language; a rename ends the preset (and its translation); another workspace reaches none of it.
func TestCategoryCatalogue(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()

	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() { e.categoryList(owner, "", "") })
	}
	wg.Wait()
	list := e.categoryList(owner, "", "")
	if len(list) != len(store.CategoryPresets) {
		t.Fatalf("racing first lists seeded %d categories, want %d", len(list), len(store.CategoryPresets))
	}
	byPreset := map[string]presetCategory{}
	for _, c := range list {
		if c.Preset == nil || c.VATTreatment == nil || c.IsArchived {
			t.Fatalf("seeded category %+v", c)
		}
		byPreset[*c.Preset] = c
	}
	if c := byPreset["lodging"]; c.AccountCode != "6640" || *c.VATTreatment != "lodging" || c.Name != "Lodging" {
		t.Errorf("lodging: %+v", c)
	}

	for _, tc := range []struct{ lang, header, want string }{
		{"", "de-CH,de;q=0.9", "Reisen"},
		{"fr", "de", "Voyages"},
		{"it", "", "Viaggi"},
		{"en", "de", "Travel"},
	} {
		got := ""
		for _, c := range e.categoryList(owner, tc.lang, tc.header) {
			if c.Preset != nil && *c.Preset == "travel" {
				got = c.Name
			}
		}
		if got != tc.want {
			t.Errorf("lang=%q Accept-Language=%q: travel is %q, want %q", tc.lang, tc.header, got, tc.want)
		}
	}

	// An expense names its category in the asker's language too.
	travel := byPreset["travel"]
	x := e.create(owner, map[string]any{"category_id": travel.ID})
	var got struct {
		Data struct {
			Category presetCategory `json:"category"`
		}
	}
	e.do(owner, "GET", "/api/v1/expenses/"+x.ID+"?lang=de", nil, 200, &got)
	if got.Data.Category.Name != "Reisen" || got.Data.Category.Preset == nil {
		t.Errorf("expense category: %+v", got.Data.Category)
	}

	// Archiving or a new account keeps the preset; the same name keeps it; a new name ends it.
	var saved struct{ Data presetCategory }
	e.do(owner, "PATCH", "/api/v1/expense-categories/"+travel.ID, map[string]any{"account_code": "6641", "name": "Travel"}, 200, &saved)
	if saved.Data.Preset == nil || *saved.Data.Preset != "travel" {
		t.Errorf("account change cleared the preset: %+v", saved.Data)
	}
	e.do(owner, "PATCH", "/api/v1/expense-categories/"+travel.ID+"?lang=de", map[string]any{"name": "Business trips"}, 200, &saved)
	if saved.Data.Preset != nil || saved.Data.Name != "Business trips" || saved.Data.VATTreatment == nil {
		t.Errorf("renamed: %+v", saved.Data)
	}

	// Workspace isolation: another workspace neither sees nor changes these categories.
	other := e.workspace()
	for _, c := range e.categoryList(other, "", "") {
		if c.ID == travel.ID {
			t.Fatal("another workspace lists this category")
		}
	}
	e.fails(other, "PATCH", "/api/v1/expense-categories/"+travel.ID, map[string]any{"name": "Mine"}, http.StatusNotFound, "not_found")
}
