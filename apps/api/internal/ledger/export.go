// Package ledger serves the journal derived by ledgercalc (docs/ledger-contract.md).
package ledger

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"

	"helvetly.com/api/internal/ledgercalc"
)

// cell keeps a spreadsheet from running a value as a formula (as in internal/expenses): text starting with
// = + - @ tab or CR gets a leading apostrophe, unless it is just a number.
func cell(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		if _, err := strconv.ParseFloat(v, 64); err != nil {
			return "'" + v
		}
	}
	return v
}

// dmy turns YYYY-MM-DD into DD.MM.YYYY; anything else stays as it is.
func dmy(d string) string {
	if len(d) == 10 && d[4] == '-' && d[7] == '-' {
		return d[8:] + "." + d[5:7] + "." + d[:4]
	}
	return d
}

var tabNewline = strings.NewReplacer("\t", " ", "\r", " ", "\n", " ")

// WriteExport writes rows in one accounting package's import format and returns how many rows were left out
// (Banana takes the base currency only).
func WriteExport(w io.Writer, format string, rows []ledgercalc.Row, base string) (int, error) {
	switch format {
	case "banana":
		return writeBanana(w, rows, base)
	case "bexio":
		return 0, writeCSV(w, ',', []string{"Document Number", "Date", "Description", "Amount", "Currency", "Exchange Rate", "Debit", "Credit", "VAT Code"}, rows,
			func(r ledgercalc.Row) []string {
				return []string{cell(r.Ref), dmy(r.Date), cell(r.Description), r.Amount.String(), r.Currency, "", r.Debit, r.Credit, ""}
			})
	case "abacus":
		return 0, writeCSV(w, ';', []string{"Datum", "Beleg", "Text", "Soll", "Haben", "Betrag", "Währung"}, rows,
			func(r ledgercalc.Row) []string {
				return []string{dmy(r.Date), cell(r.Ref), cell(r.Description), r.Debit, r.Credit, r.Amount.String(), r.Currency}
			})
	case "csv":
		return 0, writeCSV(w, ',', []string{"date", "reference", "description", "debit_account", "credit_account", "amount", "currency", "source_type", "source_id"}, rows,
			func(r ledgercalc.Row) []string {
				return []string{r.Date, cell(r.Ref), cell(r.Description), r.Debit, r.Credit, r.Amount.String(), r.Currency, r.SourceType, r.SourceID}
			})
	}
	return 0, fmt.Errorf("unknown export format %q", format)
}

func writeBanana(w io.Writer, rows []ledgercalc.Row, base string) (int, error) {
	var b strings.Builder
	b.WriteString("Date\tDoc\tDescription\tAccountDebit\tAccountCredit\tAmount\n")
	skipped := 0
	for _, r := range rows {
		if r.Currency != base {
			skipped++
			continue
		}
		fmt.Fprintf(&b, "%s\t%s\t%s\t%s\t%s\t%s\n", r.Date, tabNewline.Replace(cell(r.Ref)), tabNewline.Replace(cell(r.Description)), r.Debit, r.Credit, r.Amount.String())
	}
	if _, err := io.WriteString(w, b.String()); err != nil {
		return 0, fmt.Errorf("write banana export: %w", err)
	}
	return skipped, nil
}

func writeCSV(w io.Writer, comma rune, header []string, rows []ledgercalc.Row, line func(ledgercalc.Row) []string) error {
	cw := csv.NewWriter(w)
	cw.Comma = comma
	if err := cw.Write(header); err != nil {
		return fmt.Errorf("write export header: %w", err)
	}
	for _, r := range rows {
		if err := cw.Write(line(r)); err != nil {
			return fmt.Errorf("write export row: %w", err)
		}
	}
	cw.Flush()
	return cw.Error()
}

// ExportFile names the download of a journal export; ok is false for an unknown format.
func ExportFile(format, from, to string) (filename, contentType string, ok bool) {
	ext, ct := "csv", "text/csv; charset=utf-8"
	switch format {
	case "banana":
		ext, ct = "txt", "text/tab-separated-values; charset=utf-8"
	case "bexio", "abacus", "csv":
	default:
		return "", "", false
	}
	return fmt.Sprintf("journal-%s-%s-%s.%s", from, to, format, ext), ct, true
}
