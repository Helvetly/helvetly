package engagementpdf

import (
	"bytes"
	"regexp"
	"strings"
	"testing"
	"unicode/utf16"

	"helvetly.com/api/internal/pdffont/pdffonttest"
	"helvetly.com/api/internal/store"
)

var pageObject = regexp.MustCompile(`/Type /Page\b`)

func sample(language string, rows int) Document {
	d := Document{Language: language,
		Seller: store.Party{Name: "Muster Beratung GmbH", Street: "Bahnhofstrasse", StreetNumber: "1", Zip: "8001", City: "Zürich", Country: "CH"},
		Client: store.Party{Name: "Société Romande SA", Street: "Rue du Lac", StreetNumber: "12", Zip: "1003", City: "Lausanne", Country: "CH"},
		Title:  "Support", Reference: "PO-1", Number: 7, Unit: "hour", StartsOn: "2026-11-01", EndsOn: "2026-11-30",
		Committed: "10", CarriedIn: "0", Used: "4", Remaining: "6", Overage: "0", Invoices: []string{"2026-014"}, Created: "2026-11-07"}
	for range rows {
		d.Entries = append(d.Entries, Row{Date: "2026-11-03", Note: "Beratung", PerformedBy: "Anna", Quantity: "1.5"})
	}
	return d
}

func render(t *testing.T, d Document) []byte {
	t.Helper()
	out, err := Render(d)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(out, []byte("%PDF-")) {
		t.Fatal("not a PDF")
	}
	return out
}

func TestRenderLanguages(t *testing.T) {
	for lang, want := range map[string]string{"de": "Leistungsnachweis", "fr": "Rapport de prestations", "it": "Rapporto delle prestazioni", "en": "Service report"} {
		out := render(t, sample(lang, 2))
		if !bytes.Contains(out, text(want)) {
			t.Errorf("%s: title %q missing", lang, want)
		}
	}
	if !bytes.Contains(render(t, sample("de", 2)), text("Seite 1 von 1")) {
		t.Error("page footer")
	}
	if _, err := Render(sample("xx", 1)); err == nil {
		t.Fatal("rendered without labels")
	}
}

func TestRenderManyRowsPaginates(t *testing.T) {
	out := render(t, sample("en", 120))
	pages := len(pageObject.FindAll(out, -1))
	if pages < 3 {
		t.Fatalf("%d pages", pages)
	}
	if got := bytes.Count(out, cell("Performed by")); got != pages {
		t.Fatalf("header on %d of %d pages", got, pages)
	}
	if !bytes.Contains(out, text("Page 3 of "+string(rune('0'+pages)))) {
		t.Error("page x of y")
	}
}

func TestRenderUmlautsAndEuro(t *testing.T) {
	d := sample("de", 1)
	d.Entries[0].Note = "Prüfung für 5 € Müller"
	out := render(t, d)
	if !bytes.Contains(out, cell("Prüfung für 5 € Müller")) {
		t.Fatal("note missing")
	}
}

func TestRenderNoCarryRowWhenZero(t *testing.T) {
	d := sample("en", 1)
	if bytes.Contains(render(t, d), cell("Carried in")) {
		t.Fatal("carry row at 0")
	}
	d.CarriedIn = "2.5"
	if !bytes.Contains(render(t, d), cell("Carried in")) {
		t.Fatal("carry row missing")
	}
}

func TestRenderOverageAndFormatting(t *testing.T) {
	d := sample("en", 1)
	d.Overage, d.Used, d.Entries[0].Quantity = "2", "12", "1234.5"
	out := render(t, d)
	if !bytes.Contains(out, cell("Overage")) || bytes.Contains(out, cell("Remaining")) {
		t.Fatal("overage replaces remaining")
	}
	if !bytes.Contains(out, cell("1'234.5 h")) || !bytes.Contains(out, cell("3.11.2026")) {
		t.Fatal("swiss formatting")
	}
}

func TestRowQuantityHasUnit(t *testing.T) {
	d := sample("de", 1)
	d.Entries[0].Quantity = "1234.5"
	if !bytes.Contains(render(t, d), cell("1'234.5 Std.")) {
		t.Fatal("row quantity without unit")
	}
}

func TestDraftInvoiceLocalized(t *testing.T) {
	for lang, want := range map[string]string{"de": "Entwurf", "fr": "Brouillon", "it": "Bozza", "en": "Draft"} {
		d := sample(lang, 1)
		d.Invoices = []string{"2026-014", ""}
		if !bytes.Contains(render(t, d), text("2026-014, "+want)) {
			t.Errorf("%s: %q missing", lang, want)
		}
	}
}

func TestEnvelopeReturnLineAndNoSellerGap(t *testing.T) {
	d := sample("en", 1)
	d.Seller = store.Party{Name: "Acme"}
	out := render(t, d)
	if !bytes.Contains(out, cell("Acme")) || bytes.Contains(out, cell(", ")) {
		t.Fatal("return line / seller fallback")
	}
	d = sample("en", 1)
	if !bytes.Contains(render(t, d), text("Muster Beratung GmbH, Bahnhofstrasse 1, 8001 Z")) {
		t.Fatal("return line above the window")
	}
}

func TestRenderNonCP1252Text(t *testing.T) {
	d := sample("de", 1)
	d.Title = "Łódź 🎉 日本語"
	d.Entries[0].Note = "Zażółć gęślą jaźń 😀 ‍\U0001F468"
	d.Entries[0].PerformedBy = "Łukasz 🎉"
	d.Client.Name = "Łódź 🎉 sp. z o.o."
	d.Title = pdffonttest.All()
	out := render(t, d)
	pdffonttest.Fonts(t, out)
	if !bytes.Contains(out, text("Zażółć gęślą jaźń")) {
		t.Fatal("Polish note missing")
	}
}

// text: s as fpdf writes it into a content stream in a UTF-8 font (UTF-16BE, escaped); cell: a whole cell's text.
func text(s string) []byte {
	var b []byte
	for _, u := range utf16.Encode([]rune(s)) {
		b = append(b, byte(u>>8), byte(u))
	}
	return []byte(strings.NewReplacer(`\`, `\\`, "(", `\(`, ")", `\)`, "\r", `\r`).Replace(string(b)))
}

func cell(s string) []byte { return append(append([]byte("("), text(s)...), ')') }
