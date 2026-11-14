// Package engagementpdf renders the service report (Leistungsnachweis) of one engagement period as an A4 PDF.
package engagementpdf

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg" // logo sizes
	_ "image/png"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"codeberg.org/go-pdf/fpdf"

	"helvetly.com/api/internal/pdffont"
	"helvetly.com/api/internal/store"
)

type Row struct{ Date, Note, PerformedBy, Quantity string }

// Document holds display-ready strings except dates (ISO yyyy-mm-dd) and decimals ("1234.5").
type Document struct {
	Language                                       string
	Seller                                         store.Party
	Logo                                           []byte // PNG or JPEG, nil for none
	Client                                         store.Party
	Title, Reference                               string
	Number                                         int
	Unit                                           string
	StartsOn, EndsOn                               string
	Entries                                        []Row
	Committed, CarriedIn, Used, Remaining, Overage string
	Invoices                                       []string
	Created                                        string // ISO date
}

const (
	left, right, contentW = 20.0, 190.0, 170.0
	bottom                = 272.0
	logoMaxW, logoMaxH    = 45.0, 18.0
	mmPerPixel            = 25.4 / 96
)

type renderer struct {
	pdf *fpdf.Fpdf
	txt *pdffont.Text
	l   labels
	d   Document
}

// Render returns the PDF; an error means it must not be shipped.
func Render(d Document) ([]byte, error) {
	l, ok := languages[d.Language]
	if !ok {
		return nil, fmt.Errorf("engagement pdf: no labels for language %q", d.Language)
	}
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetCompression(false) // small documents; keeps the text greppable in tests
	if t, err := time.Parse(time.DateOnly, d.Created); err == nil {
		pdf.SetCreationDate(t)
	}
	pdf.SetMargins(left, 15, 210-right)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetTitle(l.Title+" "+d.Title, true)
	pdf.SetAuthor(d.Seller.Name, true)
	r := &renderer{pdf: pdf, txt: pdffont.New(pdf), l: l, d: d}
	pdf.SetFooterFunc(func() {
		r.set("", 8)
		pdf.SetTextColor(110, 110, 110)
		r.cell(left, 284, contentW/2, 4, fmt.Sprintf(l.Created, swissDate(d.Created)), "L")
		r.cell(left+contentW/2, 284, contentW/2, 4, fmt.Sprintf(l.Page, pdf.PageNo()), "R")
		pdf.SetTextColor(0, 0, 0)
	})
	pdf.AddPage()
	y := r.header()
	r.table(y)
	pdf.RegisterAlias("{nb}", strconv.Itoa(pdf.PageNo()))
	var out bytes.Buffer
	if err := pdf.Output(&out); err != nil {
		return nil, fmt.Errorf("engagement pdf: %w", err)
	}
	return out.Bytes(), nil
}

func (r *renderer) set(style string, size float64) { r.txt.Font(style, size) }

func (r *renderer) cell(x, y, w, h float64, s, align string) {
	r.pdf.SetXY(x, y)
	r.txt.Cell(w, h, s, align)
}

// lines wraps s to width w in the current font.
func (r *renderer) lines(s string, w float64) []string { return r.txt.Wrap(s, w) }

func swissDate(d string) string {
	if t, err := time.Parse(time.DateOnly, d); err == nil {
		return t.Format("2.1.2006")
	}
	return d
}

// qty groups the integer part of a decimal string with apostrophes: "12345.5" -> "12'345.5".
func qty(s string) string {
	s = strings.TrimSpace(s)
	sign := ""
	if strings.HasPrefix(s, "-") {
		sign, s = "-", s[1:]
	}
	whole, frac, hasFrac := strings.Cut(s, ".")
	var b strings.Builder
	for i, c := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			b.WriteByte('\'')
		}
		b.WriteRune(c)
	}
	if hasFrac {
		return sign + b.String() + "." + frac
	}
	return sign + b.String()
}

func (r *renderer) withUnit(q string) string {
	if u := r.l.Units[r.d.Unit]; u != "" {
		return qty(q) + " " + u
	}
	return qty(q)
}

func logoType(b []byte) string {
	switch http.DetectContentType(b) {
	case "image/png":
		return "PNG"
	case "image/jpeg":
		return "JPG"
	}
	return ""
}

func address(p store.Party, sellerCountry string) []string {
	out := []string{p.Name}
	if p.Apt != nil {
		out = append(out, *p.Apt)
	}
	out = append(out, strings.TrimSpace(p.Street+" "+p.StreetNumber))
	city := strings.TrimSpace(p.Zip + " " + p.City)
	if p.Country != "" && p.Country != sellerCountry {
		city = p.Country + "-" + city
	}
	return append(out, city)
}

// header draws seller, client, title and details, and returns the y below them.
func (r *renderer) header() float64 {
	p, d := r.pdf, r.d
	sellerX, align := left, "L"
	if d.Logo != nil && logoType(d.Logo) != "" {
		if cfg, _, err := image.DecodeConfig(bytes.NewReader(d.Logo)); err == nil {
			opts := fpdf.ImageOptions{ImageType: logoType(d.Logo)}
			p.RegisterImageOptionsReader("logo", opts, bytes.NewReader(d.Logo))
			w, h := float64(cfg.Width)*mmPerPixel, float64(cfg.Height)*mmPerPixel
			scale := min(logoMaxW/w, logoMaxH/h, 1)
			p.ImageOptions("logo", left, 15, w*scale, h*scale, false, opts, 0, "")
			sellerX, align = 90, "R"
		}
	}
	r.set("B", 11)
	r.cell(sellerX, 15, right-sellerX, 5, d.Seller.Name, align)
	r.set("", 8.5)
	y := 20.5
	info := address(d.Seller, "")[1:]
	info[len(info)-1] = strings.TrimSpace(d.Seller.Zip + " " + d.Seller.City)
	info = slices.DeleteFunc(info, func(s string) bool { return s == "" })
	if d.Seller.Email != nil {
		info = append(info, *d.Seller.Email)
	}
	for _, s := range info {
		r.cell(sellerX, y, right-sellerX, 3.8, s, align)
		y += 3.8
	}

	// return line above the recipient window, as in invoicepdf (C5/6 envelope)
	r.set("", 7)
	p.SetTextColor(110, 110, 110)
	r.cell(left, 47, 85, 3, strings.Join(slices.DeleteFunc([]string{d.Seller.Name, strings.TrimSpace(d.Seller.Street + " " + d.Seller.StreetNumber),
		strings.TrimSpace(d.Seller.Zip + " " + d.Seller.City)}, func(s string) bool { return s == "" }), ", "), "L")
	p.SetTextColor(0, 0, 0)
	y = 52
	for i, s := range address(d.Client, d.Seller.Country) {
		r.set(map[bool]string{true: "B", false: ""}[i == 0], 10)
		r.cell(left, y, 85, 4.6, s, "L")
		y += 4.6
	}

	meta := [][2]string{{r.l.Number, strconv.Itoa(d.Number)}}
	if d.Reference != "" {
		meta = append(meta, [2]string{r.l.Reference, d.Reference})
	}
	meta = append(meta, [2]string{r.l.Period, swissDate(d.StartsOn) + " – " + swissDate(d.EndsOn)})
	y = 52
	for _, m := range meta {
		r.set("", 9)
		r.cell(110, y, 32, 4.6, m[0], "L")
		r.set("B", 9)
		r.cell(142, y, 48, 4.6, m[1], "R")
		y += 4.6
	}

	r.set("B", 16)
	r.cell(left, 95, contentW, 8, r.l.Title, "L")
	r.set("", 11)
	r.cell(left, 104, contentW, 6, d.Title, "L")
	return 116
}

const (
	dateW, perfW, qtyW = 24.0, 34.0, 26.0
	noteW              = contentW - dateW - perfW - qtyW
	rowH               = 4.6
)

func (r *renderer) tableHead(y float64) float64 {
	r.set("B", 9)
	r.pdf.SetDrawColor(120, 120, 120)
	r.cell(left, y, dateW, 6, r.l.Date, "L")
	r.cell(left+dateW, y, noteW, 6, r.l.Description, "L")
	r.cell(left+dateW+noteW, y, perfW, 6, r.l.PerformedBy, "L")
	r.cell(left+dateW+noteW+perfW, y, qtyW, 6, r.l.Quantity, "R")
	r.pdf.Line(left, y+6, right, y+6)
	return y + 7.5
}

// table draws the entries (head repeated on every page), then the summary.
func (r *renderer) table(y float64) {
	y = r.tableHead(y)
	if len(r.d.Entries) == 0 {
		r.set("", 9)
		r.cell(left, y, contentW, rowH, r.l.NoEntries, "L")
		y += rowH
	}
	for _, e := range r.d.Entries {
		r.set("", 9)
		note := r.lines(e.Note, noteW-2)
		perf := r.lines(e.PerformedBy, perfW-2)
		n := max(len(note), len(perf), 1)
		if y+float64(n)*rowH > bottom {
			r.pdf.AddPage()
			y = r.tableHead(15)
			r.set("", 9)
		}
		r.cell(left, y, dateW, rowH, swissDate(e.Date), "L")
		for i, s := range note {
			r.cell(left+dateW, y+float64(i)*rowH, noteW, rowH, s, "L")
		}
		for i, s := range perf {
			r.cell(left+dateW+noteW, y+float64(i)*rowH, perfW, rowH, s, "L")
		}
		r.cell(left+dateW+noteW+perfW, y, qtyW, rowH, r.withUnit(e.Quantity), "R")
		y += float64(n)*rowH + 1
	}
	r.summary(y + 4)
}

func (r *renderer) summary(y float64) {
	d, l := r.d, r.l
	rows := [][2]string{{l.Committed, d.Committed}}
	if v := strings.TrimSpace(d.CarriedIn); v != "" && strings.Trim(v, "0.") != "" {
		rows = append(rows, [2]string{l.CarriedIn, d.CarriedIn})
	}
	rows = append(rows, [2]string{l.Used, d.Used})
	if strings.Trim(d.Overage, "0. ") != "" {
		rows = append(rows, [2]string{l.Overage, d.Overage})
	} else {
		rows = append(rows, [2]string{l.Remaining, d.Remaining})
	}
	need := float64(len(rows))*5.5 + 12
	if len(d.Invoices) > 0 {
		need += 6
	}
	if y+need > bottom {
		r.pdf.AddPage()
		y = 15
	}
	r.pdf.Line(left+contentW-80, y-2, right, y-2)
	for i, row := range rows {
		bold := i == len(rows)-1
		r.set(map[bool]string{true: "B", false: ""}[bold], 10)
		r.cell(left+contentW-80, y, 50, 5.5, row[0], "L")
		r.cell(left+contentW-30, y, 30, 5.5, r.withUnit(row[1]), "R")
		y += 5.5
	}
	if len(d.Invoices) > 0 {
		invoices := slices.Clone(d.Invoices)
		for i, n := range invoices {
			if n == "" {
				invoices[i] = l.Draft
			}
		}
		r.set("", 9)
		r.cell(left, y+4, contentW, 5, l.Invoices+": "+strings.Join(invoices, ", "), "L")
	}
}
