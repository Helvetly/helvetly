package invoices

import (
	"cmp"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/store"
)

// A number format is a template: literal text and tokens in braces, filled from the document's issue date, its
// type and its sequence, which counts per series and year, or per series for ever when the format has no year.
const maxFormatLen = 40

var (
	formatToken = regexp.MustCompile(`\{[A-Z]+\}`)
	seqToken    = regexp.MustCompile(`^\{N{1,6}\}$`)
	formatText  = regexp.MustCompile(`^[A-Za-z0-9 ./_#-]*$`)
	digitRun    = regexp.MustCompile(`[0-9]+`)
)

// typeLetters is what {TYPE} prints for each document kind.
var typeLetters = map[string]string{
	"invoice": "INV", "partial": "INV", "prepayment": "PP", "debit_note": "DN", "corrected": "COR",
	"credit_note": "CN", "proforma": "PF", "self_billed": "SB", "quote": "Q", "contract": "C",
}

// parseNumberFormat checks a format; the message says what is wrong with it.
func parseNumberFormat(v string) (string, string) {
	if len(v) > maxFormatLen {
		return "", fmt.Sprintf("Use at most %d characters.", maxFormatLen)
	}
	seqs, years := 0, 0
	for _, t := range formatToken.FindAllString(v, -1) {
		switch {
		case seqToken.MatchString(t):
			seqs++
		case t == "{YYYY}" || t == "{YY}":
			years++
		case t != "{MM}" && t != "{DD}" && t != "{TYPE}":
			return "", "Use only {YYYY}, {YY}, {MM}, {DD}, {TYPE} and {N} to {NNNNNN}; " + t + " is not one of them."
		}
	}
	switch {
	case !formatText.MatchString(formatToken.ReplaceAllString(v, "")):
		return "", "Besides the {…} placeholders, use only letters, digits, spaces and . / _ # -"
	case seqs != 1:
		return "", "Put the running number in exactly once, as {N} or {NNN} (zero-padded to three digits)."
	}
	return v, ""
}

// counterYear is the year whose counter numbers a document issued on date: without a year in the format the
// running number never restarts, so every year shares counter 0.
func counterYear(format, date string) int {
	if !strings.Contains(format, "{YYYY}") && !strings.Contains(format, "{YY}") {
		return 0
	}
	year, _ := strconv.Atoi(date[:4])
	return year
}

// formatNumber fills the format for a document of the kind issued on date (YYYY-MM-DD) with the sequence seq; a
// negative seq prints "-", the place of a number a draft does not have yet.
func formatNumber(format, kind, date string, seq int64) string {
	return formatToken.ReplaceAllStringFunc(format, func(t string) string {
		switch t {
		case "{YYYY}":
			return date[:4]
		case "{YY}":
			return date[2:4]
		case "{MM}":
			return date[5:7]
		case "{DD}":
			return date[8:10]
		case "{TYPE}":
			return typeLetters[kind]
		}
		if seq < 0 {
			return "-"
		}
		return fmt.Sprintf("%0*d", len(t)-2, seq)
	})
}

// documentNumber: the format filled in; prefix (CN-, PF-…) keeps the series apart unless the format prints the type.
func documentNumber(format, prefix, kind, date string, seq int64) string {
	if strings.Contains(format, "{TYPE}") {
		prefix = ""
	}
	return prefix + formatNumber(format, kind, date, seq)
}

// draftNumber: the number a draft will get, with "-" for the running number it gets only when issued.
func draftNumber(format string, inv store.Invoice, credited *store.Invoice, now time.Time) string {
	_, prefix := seriesOf(inv, credited)
	date := inv.IssueDate
	if len(date) < len(time.DateOnly) {
		date = now.Format(time.DateOnly)
	}
	return documentNumber(format, prefix, inv.Kind, date, -1)
}

// NumberSuggestion: the format the imported numbers follow, and the last sequence of its latest year.
type NumberSuggestion struct {
	Format string `json:"format"`
	Year   int    `json:"year"`
	Last   int64  `json:"last"`
}

// suggestFormat reads the format most imported numbers follow: each digit run is a part of its issue date or the
// sequence. False when no format with a year and one sequence explains them.
func suggestFormat(numbers []store.ImportedInvoiceNumber) (NumberSuggestion, bool) {
	type seen struct {
		votes, pad int
		year       int
		last       int64
	}
	shapes := map[string]*seen{}
	for _, n := range numbers {
		shape, seq, ok := shapeOf(n.Number, n.IssueDate)
		if !ok {
			continue
		}
		s := shapes[shape]
		if s == nil {
			s = &seen{}
			shapes[shape] = s
		}
		s.votes++
		if len(seq) > 1 && seq[0] == '0' {
			s.pad = max(s.pad, len(seq))
		}
		year, _ := strconv.Atoi(n.IssueDate[:4])
		value, _ := strconv.ParseInt(seq, 10, 64)
		if year > s.year {
			s.year, s.last = year, 0
		}
		if year == s.year {
			s.last = max(s.last, value)
		}
	}
	keys := make([]string, 0, len(shapes))
	for k := range shapes {
		keys = append(keys, k)
	}
	if len(keys) == 0 {
		return NumberSuggestion{}, false
	}
	slices.SortFunc(keys, func(a, b string) int { return cmp.Or(shapes[b].votes-shapes[a].votes, strings.Compare(a, b)) })
	best := shapes[keys[0]]
	token := "{N}"
	if best.pad > 0 {
		token = "{" + strings.Repeat("N", min(best.pad, 6)) + "}"
	}
	format, msg := parseNumberFormat(strings.Replace(keys[0], "{SEQ}", token, 1))
	// shortcut: a suggestion raises one year's counter, so a yearless format is not suggested; upgrade when
	// imports should continue a continuous series.
	if msg != "" || counterYear(format, "2000-01-01") == 0 {
		return NumberSuggestion{}, false
	}
	return NumberSuggestion{Format: format, Year: best.year, Last: best.last}, true
}

// shapeOf: the number with its date parts as tokens and the sequence as {SEQ}, and the sequence's digits. Of the
// ways to read it, one with the year wins, then the one whose sequence comes last.
func shapeOf(number, date string) (string, string, bool) {
	if len(date) < 10 || formatToken.MatchString(number) {
		return "", "", false
	}
	parts := map[string]string{date[:4]: "{YYYY}"}
	for _, p := range [][2]string{{date[2:4], "{YY}"}, {date[5:7], "{MM}"}, {date[8:10], "{DD}"}} {
		if _, taken := parts[p[0]]; !taken {
			parts[p[0]] = p[1]
		}
	}
	runs := digitRun.FindAllStringIndex(number, -1)
	shape, seq, withYear := "", "", false
	for i := len(runs) - 1; i >= 0; i-- {
		var b strings.Builder
		at, ok, year := 0, true, false
		for j, r := range runs {
			b.WriteString(number[at:r[0]])
			at = r[1]
			if j == i {
				b.WriteString("{SEQ}")
				continue
			}
			token, isDate := parts[number[r[0]:r[1]]]
			if !isDate {
				ok = false
				break
			}
			year = year || token == "{YYYY}" || token == "{YY}"
			b.WriteString(token)
		}
		if !ok || (shape != "" && (withYear || !year)) {
			continue
		}
		b.WriteString(number[at:])
		shape, seq, withYear = b.String(), number[runs[i][0]:runs[i][1]], year
	}
	return shape, seq, shape != ""
}
