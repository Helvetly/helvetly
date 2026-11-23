package contractpdf

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"regexp"
	"strings"
	"testing"
	"unicode/utf16"

	"helvetly.com/api/internal/store"
)

var pageObject = regexp.MustCompile(`/Type /Page\b`)

func sample(language string, clauses int) Document {
	uid, email := "CHE-123.456.789 MWST", "info@muster.ch"
	d := Document{Language: language, Number: "2026/C/001", Quote: "2026/Q/001", Date: "2026-11-23", Title: "Dienstleistungsvertrag",
		Seller:   store.Party{Name: "Muster Beratung GmbH", Street: "Bahnhofstrasse", StreetNumber: "1", Zip: "8001", City: "Zürich", Country: "CH", Email: &email},
		Client:   store.Party{Name: "Müller AG", Street: "Seestrasse", StreetNumber: "1", Zip: "8000", City: "Zürich", Country: "CH", VATNumber: &uid},
		Rows:     []Row{{Description: "Website", Quantity: "1", UnitPrice: "CHF 5'000.00", Amount: "CHF 5'000.00"}},
		Subtotal: "CHF 5'000.00", VAT: "CHF 405.00", Total: "CHF 5'405.00",
		Schedule: []Payment{{Due: "2026-12-01", Amount: "CHF 2'702.50"}, {Due: "2027-01-01", Amount: "CHF 2'702.50"}}}
	for i := range clauses {
		d.Clauses = append(d.Clauses, Clause{Heading: "Gegenstand " + string(rune('A'+i%26)),
			Body: strings.Repeat("Der Auftragnehmer erbringt die Leistungen sorgfältig und termingerecht. ", 8)})
	}
	return d
}

func render(t *testing.T, d Document) Result {
	t.Helper()
	out, err := Render(d)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(out.PDF, []byte("%PDF-")) {
		t.Fatal("not a PDF")
	}
	if got := len(pageObject.FindAll(out.PDF, -1)); got != out.Pages {
		t.Fatalf("pages: %d drawn, %d reported", got, out.Pages)
	}
	return out
}

func text(s string) []byte {
	var b []byte
	for _, u := range utf16.Encode([]rune(s)) {
		b = append(b, byte(u>>8), byte(u))
	}
	return []byte(strings.NewReplacer(`\`, `\\`, "(", `\(`, ")", `\)`, "\r", `\r`).Replace(string(b)))
}

func TestRender(t *testing.T) {
	cases := []struct {
		name, lang string
		clauses    int
		number     string
		minPages   int
		want       []string
	}{
		{"short German contract", "de", 3, "2026/C/001", 1, []string{"Dienstleistungsvertrag", "Vertrag 2026/C/001",
			"Datum: 23.11.2026", "Angebot: 2026/Q/001", "CHF 5'405.00", "CHF 2'702.50", "01.12.2026", "1.", "Gegenstand A",
			"Auftraggeber", "Unterschriften", "CHE-123.456.789 MWST", "Seite 1 von", "info@muster.ch", "Ort, Datum: "}},
		{"preview without a number", "en", 1, "", 1, []string{"Contract Draft", "Payment schedule"}},
		{"long contract paginates", "fr", 40, "2026/C/002", 3, []string{"40.", "Gegenstand N", "Page 3 sur", "Échéancier"}},
		{"Italian labels", "it", 2, "2026/C/003", 1, []string{"Prestazioni e prezzi", "Firme", "Totale"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := sample(tc.lang, tc.clauses)
			d.Number = tc.number
			out := render(t, d)
			if out.Pages < tc.minPages {
				t.Fatalf("%d pages, want at least %d", out.Pages, tc.minPages)
			}
			for _, want := range tc.want {
				if !bytes.Contains(out.PDF, text(want)) {
					t.Errorf("%q missing", want)
				}
			}
			// both parties sign on the last page, side by side, inside it
			for _, b := range []Box{out.Seller, out.Client, out.ClientDate} {
				if b.Page != out.Pages || b.X < 0 || b.Y < 0 || b.X+b.W > 1 || b.Y+b.H > 1 || b.W < 0.01 || b.H < 0.01 {
					t.Fatalf("box %+v of %d pages", b, out.Pages)
				}
			}
			if out.Seller.X >= out.Client.X || out.Seller.Y != out.Client.Y {
				t.Fatalf("seller %+v, client %+v", out.Seller, out.Client)
			}
		})
	}
	if _, err := Render(sample("xx", 1)); err == nil {
		t.Fatal("rendered without labels")
	}
}

func TestRenderIsDeterministic(t *testing.T) {
	a, b := render(t, sample("de", 5)), render(t, sample("de", 5))
	if !bytes.Equal(a.PDF, b.PDF) {
		t.Fatal("the same sections print differently")
	}
}

func signatureImage(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 240, 80))
	for x := range 240 {
		img.Set(x, 40+x%20, color.NRGBA{A: 255})
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// The contract wears the quotes' and invoices' frame: the logo and seller top left, the parties under their headings,
// the footer's contact line and page number.
func TestRenderUsesTheSharedFrame(t *testing.T) {
	d := sample("de", 2)
	d.Logo = signatureImage(t)
	out := render(t, d)
	for _, want := range []string{"Auftragnehmer:", "Auftraggeber:", "info@muster.ch", "Seite 1 von"} {
		if !bytes.Contains(out.PDF, text(want)) {
			t.Errorf("%q missing", want)
		}
	}
	if !bytes.Contains(out.PDF, []byte("/Subtype /Image")) {
		t.Error("no logo")
	}
	if !bytes.Contains(out.PDF, []byte("/MediaBox [0 0 595.28 841.89]")) {
		t.Error("not A4")
	}
}

func TestRenderPageSizeFollowsTheLaw(t *testing.T) {
	d := sample("en", 30)
	d.Law = "US-CA"
	out := render(t, d)
	if !bytes.Contains(out.PDF, []byte("/MediaBox [0 0 612.00 792.00]")) {
		t.Error("not US Letter")
	}
	for _, b := range []Box{out.Seller, out.Client, out.ClientDate} {
		if b.Y+b.H > 1 {
			t.Errorf("box %+v below the page", b)
		}
	}
	if !bytes.Contains(out.PDF, text("12/01/2026")) {
		t.Error("US dates")
	}
}

// The signature block: two columns; the contractor's stored signature, place and date printed; the client's two
// fields in the client's column, the date on its "Place, date" line below the signature.
func TestSignatureBlock(t *testing.T) {
	for clauses := range 25 { // wherever the block falls, it is never split
		d := sample("de", clauses)
		d.SellerSigner = Signer{Name: "Anna Muster", Company: "Muster Beratung GmbH"}
		d.ClientSigner = Signer{Name: "Peter Müller", Company: "Müller AG"}
		d.SellerSigned = &Signed{Image: signatureImage(t), Place: "Zürich", Date: "2026-11-23"}
		out := render(t, d)
		s, c, dt := out.Seller, out.Client, out.ClientDate
		if s.Page != out.Pages || c.Page != s.Page || dt.Page != s.Page {
			t.Fatalf("%d clauses: block split %+v %+v %+v of %d", clauses, s, c, dt, out.Pages)
		}
		if c.X < 0.5 || s.X > 0.15 || c.Y != s.Y {
			t.Fatalf("columns: seller %+v client %+v", s, c)
		}
		if dt.X < c.X || dt.X+dt.W > c.X+0.45 || dt.Y < c.Y+c.H {
			t.Fatalf("client date %+v not on the client's place, date line under %+v", dt, c)
		}
		if clauses == 0 {
			for _, want := range []string{"Anna Muster", "Peter Müller", "Müller AG", "Zürich, 23.11.2026"} {
				if !bytes.Contains(out.PDF, text(want)) {
					t.Errorf("%q missing", want)
				}
			}
			if !bytes.Contains(out.PDF, []byte("/Subtype /Image")) {
				t.Error("no signature image")
			}
		}
	}
}
