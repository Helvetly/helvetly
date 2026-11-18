package tags

import "testing"

func TestValid(t *testing.T) {
	for tag, want := range map[string]bool{
		"invoice": true, "Q4-2026": true, "a": true, "office-supplies": true, "a--b": true,
		"": false, "-a": false, "a-": false, "-": false, "dobry-=====": false, "two words": false,
		"büro": false, "a_b": false, "x.y": false, "abcdefghijklmnopqrstuvwxyz0123456": false,
		"abcdefghijklmnopqrstuvwxyz012345": true,
	} {
		if got := Valid(tag); got != want {
			t.Errorf("Valid(%q) = %v, want %v", tag, got, want)
		}
	}
}

func TestSlug(t *testing.T) {
	for name, want := range map[string]string{
		"Büromaterial":              "bueromaterial",
		"Spesen / Bücher":           "spesen-buecher",
		"Café & Restaurant":         "cafe-restaurant",
		"  Other operating costs  ": "other-operating-costs",
		"dobry-=====":               "dobry",
		"---":                       "",
		"Straße 2026":               "strasse-2026",
		"Very long category name that goes on and on": "very-long-category-name-that-goe",
		"abcdefghijklmnopqrstuvwxyz01234-x":           "abcdefghijklmnopqrstuvwxyz01234",
	} {
		got := Slug(name)
		if got != want {
			t.Errorf("Slug(%q) = %q, want %q", name, got, want)
		}
		if got != "" && !Valid(got) {
			t.Errorf("Slug(%q) = %q is not a valid tag", name, got)
		}
	}
}
