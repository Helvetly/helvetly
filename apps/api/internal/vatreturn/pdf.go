package vatreturn

import (
	"bytes"
	"fmt"
	"strings"
	"time"

	"codeberg.org/go-pdf/fpdf"

	"helvetly.com/api/internal/pdffont"
)

const (
	pdfLeft, pdfWidth = 20.0, 170.0
	pdfBottom         = 275.0
)

var methodNames = map[string]string{"effective": "Effektive Methode", "net_tax_rate": "Saldosteuersatzmethode"}
var basisNames = map[string]string{"agreed": "vereinbarte Entgelte", "received": "vereinnahmte Entgelte"}

// renderPDF is a one-page-per-screen summary of the return in German, the form's language, to keep with the books.
func renderPDF(rep Report, workspace, today string) ([]byte, error) {
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetCompression(false) // small; keeps the text greppable in tests
	if t, err := time.Parse(time.DateOnly, today); err == nil {
		pdf.SetCreationDate(t)
	}
	pdf.SetMargins(pdfLeft, 15, 210-pdfLeft-pdfWidth)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetTitle("MWST-Abrechnung "+rep.Period, true)
	txt := pdffont.New(pdf) // the workspace's name and warnings may be in any script
	cell := func(x, y, w float64, s, align string) {
		pdf.SetXY(x, y)
		txt.Cell(w, 5, s, align)
	}
	pdf.AddPage()
	txt.Font("B", 14)
	cell(pdfLeft, 15, pdfWidth, "MWST-Abrechnung "+rep.Period, "L")
	txt.Font("", 9)
	cell(pdfLeft, 22, pdfWidth, workspace, "L")
	cell(pdfLeft, 27, pdfWidth, fmt.Sprintf("Periode %s – %s · %s · %s · Beträge in CHF", swiss(rep.From), swiss(rep.To),
		methodNames[rep.Method], basisNames[rep.Basis]), "L")
	y := 37.0
	txt.Font("B", 8.5)
	cell(pdfLeft, y, 14, "Ziffer", "L")
	cell(pdfLeft+110, y, 26, "Umsatz/Betrag", "R")
	cell(pdfLeft+136, y, 12, "Satz", "R")
	cell(pdfLeft+148, y, 22, "Steuer", "R")
	y += 6
	txt.Font("", 8.5)
	for _, l := range rep.Lines {
		if y > pdfBottom {
			pdf.AddPage()
			y = 15
		}
		if l.Kind == "total" {
			txt.Font("B", 8.5)
		}
		label := l.LabelDE
		if !l.Tracked {
			label += " (nicht erfasst)"
		}
		cell(pdfLeft, y, 14, l.Ziffer, "L")
		cell(pdfLeft+14, y, 96, fit(txt, label, 95), "L")
		if l.Kind == "rate" {
			cell(pdfLeft+110, y, 26, l.Base.Swiss("'"), "R")
			cell(pdfLeft+136, y, 12, l.Rate.String()+"%", "R")
			cell(pdfLeft+148, y, 22, l.Tax.Swiss("'"), "R")
		} else {
			cell(pdfLeft+110, y, 26, l.Amount.Swiss("'"), "R")
		}
		txt.Font("", 8.5)
		y += 5
	}
	if len(rep.Warnings) > 0 {
		y += 4
		txt.Font("B", 9)
		cell(pdfLeft, y, pdfWidth, "Hinweise", "L")
		txt.Font("", 8)
		y += 6
		for _, w := range rep.Warnings {
			text := w.Message
			if len(w.Refs) > 0 {
				text += " (" + strings.Join(w.Refs, ", ") + ")"
			}
			for _, line := range txt.Wrap(text, pdfWidth) {
				if y > pdfBottom {
					pdf.AddPage()
					y = 15
				}
				pdf.SetXY(pdfLeft, y)
				txt.Cell(pdfWidth, 4, line, "L")
				y += 4
			}
			y += 1
		}
	}
	txt.Font("", 7.5)
	pdf.SetTextColor(110, 110, 110)
	cell(pdfLeft, 285, pdfWidth, "Aus den erfassten Belegen erstellt. Einreichung im ePortal der ESTV.", "L")
	var out bytes.Buffer
	if err := pdf.Output(&out); err != nil {
		return nil, fmt.Errorf("vat return pdf: %w", err)
	}
	return out.Bytes(), nil
}

// fit cuts a label to width w.
func fit(txt *pdffont.Text, s string, w float64) string {
	r := []rune(s)
	for len(r) > 1 && txt.Width(string(r)) > w {
		r = r[:len(r)-1]
	}
	return string(r)
}

func swiss(d string) string {
	if t, err := time.Parse(time.DateOnly, d); err == nil {
		return t.Format("02.01.2006")
	}
	return d
}
