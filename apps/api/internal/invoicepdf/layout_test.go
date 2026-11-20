package invoicepdf

import (
	"bytes"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

var placedText = regexp.MustCompile(`BT ([\d.]+) ([\d.]+) Td (\((?:\\.|[^\\)])*\))Tj`)

type placed struct {
	literal []byte
	x, y    float64 // mm from the page's left and top edge (the text's baseline)
}

// texts: every text drawn on one page's content stream, with its position.
func texts(page []byte) []placed {
	var out []placed
	for _, m := range placedText.FindAllSubmatch(page, -1) {
		x, _ := strconv.ParseFloat(string(m[1]), 64)
		y, _ := strconv.ParseFloat(string(m[2]), 64)
		out = append(out, placed{m[3], x * 25.4 / 72, 297 - y*25.4/72})
	}
	return out
}

// at: the position of s on the page; false when it is not printed there.
func at(page []byte, s string) (placed, bool) {
	for _, p := range texts(page) {
		if bytes.Equal(p.literal, unicodePDFLiteral(s)) {
			return p, true
		}
	}
	return placed{}, false
}

// invoicePages: the content streams that print a page number (the QR bill pages have none).
func invoicePages(t *testing.T, d Document) [][]byte {
	t.Helper()
	var pages [][]byte
	for _, s := range streams(t, d) {
		if bytes.Contains(s, unicodePDFLiteral("Page ")[:len(unicodePDFLiteral("Page "))-1]) {
			pages = append(pages, s)
		}
	}
	return pages
}

func TestFooterTextInThePageFooter(t *testing.T) {
	lines := func(n int) []string {
		ls := make([]string, n)
		for i := range ls {
			ls[i] = fmt.Sprintf("Footer line %d", i+1)
		}
		return ls
	}
	capped := lines(footerMax)
	capped[footerMax-1] += " …"
	tests := []struct {
		name    string
		lines   int // invoice lines: 60 run over two pages
		footer  []string
		contact bool // the issuer has an email: a contact line between the footer and the page number
		want    []string
	}{
		{"one line, one page", 1, []string{"Merci vielmal."}, true, []string{"Merci vielmal."}},
		{"three lines on every page", 60, lines(3), true, lines(3)},
		{"no contact line: right above the page number", 60, lines(2), false, lines(2)},
		{"too long: cut to the most lines", 60, lines(20), true, capped},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := sample("en", tt.lines)
			d.Invoice.Footer = ptr(strings.Join(tt.footer, "\n"))
			if !tt.contact {
				d.Seller.Email = nil
			}
			pages := invoicePages(t, d)
			if tt.lines > 1 && len(pages) < 2 {
				t.Fatalf("%d invoice pages, want several", len(pages))
			}
			for i, page := range pages {
				number, ok := at(page, fmt.Sprintf("Page %d of %d", i+1, len(pages)))
				if !ok {
					t.Fatalf("page %d: no page number", i+1)
				}
				above := number.y // each footer line sits above the next, the last above the contact line
				if tt.contact {
					contact, ok := at(page, "rechnung@muster.ch")
					if !ok || contact.y >= number.y {
						t.Fatalf("page %d: contact line missing or not above the page number", i+1)
					}
					above = contact.y
				}
				for j := len(tt.want) - 1; j >= 0; j-- {
					p, ok := at(page, tt.want[j])
					if !ok {
						t.Fatalf("page %d: footer line %q not printed", i+1, tt.want[j])
					}
					// footerH apart; the last one's 3.4 mm cell ends where the 4 mm cell below it starts
					gap, want := above-p.y, footerH
					if j == len(tt.want)-1 {
						want = footerH + (4-footerH)/2
					}
					if math.Abs(gap-want) > 0.05 {
						t.Errorf("page %d: footer line %q %.2f mm above the next line, want %.2f", i+1, tt.want[j], gap, want)
					}
					above = p.y
				}
				// nothing of the body reaches into the footer
				footerTop := above
				for _, p := range texts(page) {
					if p.y <= footerTop {
						continue
					}
					footer := false
					for _, s := range append(append([]string{}, tt.want...), "rechnung@muster.ch", fmt.Sprintf("Page %d of %d", i+1, len(pages))) {
						footer = footer || bytes.Equal(p.literal, unicodePDFLiteral(s))
					}
					if !footer {
						t.Errorf("page %d: body text %s at %.2f mm overlaps the footer from %.2f mm", i+1, p.literal, p.y, footerTop)
					}
				}
			}
			for _, s := range streams(t, d) { // the QR bill page prints none of it
				if bytes.Contains(s, unicodePDFLiteral("Receipt")) && bytes.Contains(s, unicodePDFLiteral(tt.want[0])) {
					t.Error("footer text printed on the QR bill page")
				}
			}
		})
	}
}

func TestDetailBlocksAlignToTheirOwnLabels(t *testing.T) {
	tests := []struct {
		name            string
		doc             func() Document
		contract, money [][2]string // label, value: each block's rows
	}{
		{"short contract labels, long bank labels", func() Document { return sample("en", 1) },
			[][2]string{{"Client number:", "7"}},
			[][2]string{{"Account holder:", "Muster Beratung GmbH"}, {"Bank name:", "Zürcher Kantonalbank"},
				{"IBAN:", "CH44 3199 9123 0008 8901 2"}, {"Payment reference:", "00 00000 00000 00000 02026 00000"}}},
		{"long contract label, IBAN only", func() Document {
			d := sample("en", 1)
			d.Invoice.ContractReference, d.Seller.Name, d.BankName, d.Invoice.Payment.Reference = ptr("C-1"), "", nil, nil
			return d
		}, [][2]string{{"Client number:", "7"}, {"Contract number:", "C-1"}},
			[][2]string{{"IBAN:", "CH44 3199 9123 0008 8901 2"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := tt.doc()
			r, _, err := newRenderer(d, "")
			if err != nil {
				t.Fatal(err)
			}
			page := streams(t, d)[0]
			for _, block := range [][][2]string{tt.contract, tt.money} {
				labels := make([]string, len(block))
				for i, row := range block {
					labels[i] = row[0]
				}
				want := r.widest("", 9, labels...) + pairGap
				for _, row := range block {
					label, ok := at(page, row[0])
					if !ok {
						t.Fatalf("%q not printed", row[0])
					}
					var value *placed
					for _, p := range texts(page) {
						if p.y == label.y && bytes.Equal(p.literal, unicodePDFLiteral(row[1])) {
							value = &p
						}
					}
					if value == nil {
						t.Fatalf("%q: value %q not printed on its row", row[0], row[1])
					}
					if got := value.x - label.x; math.Abs(got-want) > 0.05 {
						t.Errorf("%q: value %.2f mm right of its label, want %.2f (its block's longest label + gap)", row[0], got, want)
					}
				}
			}
		})
	}
}
