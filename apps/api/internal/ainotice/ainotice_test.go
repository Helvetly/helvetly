package ainotice

import (
	"testing"
	"time"
)

// TestTextsChangeOnlyWithANewVersion: approvals count for one version, so a changed text under the same version would
// count approvals given to words nobody read. The stored hash is the texts' as approved under the current version.
func TestTextsChangeOnlyWithANewVersion(t *testing.T) {
	if _, err := time.Parse(time.DateOnly, file.Version); err != nil {
		t.Fatalf("version %q is not a date: %v", file.Version, err)
	}
	if got := textsHash(); got != file.SHA256 {
		t.Fatalf("the notice's texts changed: set a new \"version\" (today's date) in notice.json and \"sha256\" to %s", got)
	}
}

// TestEveryLanguageHasTheWholeNotice: the same sections and points, in the same order, all with text.
func TestEveryLanguageHasTheWholeNotice(t *testing.T) {
	en := file.Texts["en"]
	if len(en.Sections) == 0 {
		t.Fatal("no English notice")
	}
	for _, lang := range []string{"en", "de", "fr", "it"} {
		n, ok := file.Texts[lang]
		if !ok {
			t.Fatalf("%s: missing", lang)
		}
		if n.Title == "" || n.Lead == "" || len(n.Sections) != len(en.Sections) {
			t.Fatalf("%s: title, lead or sections missing", lang)
		}
		for i, s := range n.Sections {
			want := en.Sections[i]
			if s.ID != want.ID || s.Title == "" || len(s.Points) != len(want.Points) {
				t.Fatalf("%s: section %d is %q with %d points, want %q with %d", lang, i, s.ID, len(s.Points), want.ID, len(want.Points))
			}
			for j, p := range s.Points {
				if p.ID != want.Points[j].ID || p.Text == "" {
					t.Fatalf("%s: %s point %d is %q", lang, s.ID, j, p.ID)
				}
			}
		}
	}
}

func TestForFallsBackToEnglish(t *testing.T) {
	for _, c := range []struct{ lang, title string }{
		{"de", file.Texts["de"].Title},
		{"xx", file.Texts["en"].Title},
		{"", file.Texts["en"].Title},
	} {
		if n := For(c.lang); n.Title != c.title || n.Version != Version || Version == "" {
			t.Fatalf("%q: %q version %q", c.lang, n.Title, n.Version)
		}
	}
}
