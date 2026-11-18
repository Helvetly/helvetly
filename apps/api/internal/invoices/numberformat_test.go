package invoices

import (
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// imported: number, issue date, number, issue date…
func imported(pairs ...string) []store.ImportedInvoiceNumber {
	var out []store.ImportedInvoiceNumber
	for i := 0; i < len(pairs); i += 2 {
		out = append(out, store.ImportedInvoiceNumber{Number: pairs[i], IssueDate: pairs[i+1]})
	}
	return out
}

func TestParseNumberFormat(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		format string
		ok     bool
	}{
		{"{YYYY}-{NNN}", true},
		{"FV/{N}/{MM}/{YYYY}", true},
		{"{TYPE}-{YY}{MM}{DD}-{NNNN}", true},
		{"RE #{YYYY}.{NNNNNN}", true},
		{"INV-{NNNN}", true},                                 // no year: one running number for ever
		{"{YYYY}", false},                                    // no sequence
		{"{YYYY}-{N}-{NN}", false},                           // two sequences
		{"{YYYY}-{NNNNNNN}", false},                          // padded past six digits
		{"{YYYY}-{X}", false},                                // unknown token
		{"{yyyy}-{NNN}", false},                              // tokens are upper case
		{"{YYYY}-{NNN}{", false},                             // a stray brace
		{"{YYYY}:{NNN}", false},                              // a colon
		{"ÄÖ-{YYYY}-{NNN}", false},                           // letters outside ASCII
		{"VERY-LONG-PREFIX-{YYYY}-{NNN}-ABCDEFGHIJK", false}, // 41 characters
	} {
		if _, msg := parseNumberFormat(tc.format); (msg == "") != tc.ok {
			t.Errorf("%q: message %q, want ok = %v", tc.format, msg, tc.ok)
		}
	}
}

func TestCounterYear(t *testing.T) {
	t.Parallel()
	for format, want := range map[string]int{"{YYYY}-{NNN}": 2026, "{YY}{NNNN}": 2026, "INV-{NNNN}": 0, "{MM}/{NNN}": 0} {
		if got := counterYear(format, "2026-03-05"); got != want {
			t.Errorf("%q = %d, want %d", format, got, want)
		}
	}
}

func TestDocumentNumber(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		format, prefix, kind string
		seq                  int64
		want                 string
	}{
		{"{YYYY}-{NNN}", "", "invoice", 7, "2026-007"},
		{"{YYYY}-{NNN}", "CN-", "credit_note", 7, "CN-2026-007"},
		{"{NNN}/{YYYY}", "", "invoice", 1234, "1234/2026"},
		{"FV/{N}/{MM}/{YY}", "", "invoice", 17, "FV/17/03/26"},
		{"{TYPE}-{YYYY}{MM}{DD}-{NN}", "CN-", "credit_note", 3, "CN-20260305-03"}, // the type replaces the prefix
		{"{TYPE}-{YYYY}-{NNN}", "", "debit_note", 12, "DN-2026-012"},
		{"{TYPE}-{YYYY}-{NNN}", "", "quote", 1, "Q-2026-001"},
	} {
		if got := documentNumber(tc.format, tc.prefix, tc.kind, "2026-03-05", tc.seq); got != tc.want {
			t.Errorf("%q %s %d = %q, want %q", tc.format, tc.kind, tc.seq, got, tc.want)
		}
	}
}

func TestDraftNumber(t *testing.T) {
	t.Parallel()
	now := time.Date(2027, 1, 2, 0, 0, 0, 0, time.UTC)
	selfBilled := store.Invoice{Kind: "self_billed"}
	for _, tc := range []struct {
		format   string
		inv      store.Invoice
		credited *store.Invoice
		want     string
	}{
		{"{YYYY}/IN/{NNN}", store.Invoice{Kind: "invoice", IssueDate: "2026-01-13"}, nil, "2026/IN/-"},
		{"{YYYY}-{NNN}", store.Invoice{Kind: "credit_note", IssueDate: "2026-01-13"}, nil, "CN-2026--"},
		{"{TYPE}-{YY}{MM}-{N}", store.Invoice{Kind: "quote", IssueDate: "2026-01-13"}, nil, "Q-2601--"},
		{"{YYYY}/{NNN}", store.Invoice{Kind: "invoice"}, nil, "2027/-"}, // no issue date yet: today's
		{"{YYYY}-{NNN}", store.Invoice{Kind: "credit_note", IssueDate: "2026-01-13"}, &selfBilled, "SB-2026--"},
	} {
		if got := draftNumber(tc.format, tc.inv, tc.credited, now); got != tc.want {
			t.Errorf("%q %s = %q, want %q", tc.format, tc.inv.Kind, got, tc.want)
		}
	}
}

func TestSuggestFormat(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name    string
		numbers []store.ImportedInvoiceNumber
		want    NumberSuggestion
		ok      bool
	}{
		{"padded with year", imported("RE-2026-017", "2026-11-05", "RE-2026-018", "2026-11-20"),
			NumberSuggestion{"RE-{YYYY}-{NNN}", 2026, 18}, true},
		{"polish month series", imported("FV/17/11/2026", "2026-11-05", "FV/3/10/2026", "2026-10-02"),
			NumberSuggestion{"FV/{N}/{MM}/{YYYY}", 2026, 17}, true},
		{"sequence equal to the month", imported("2026-11", "2026-11-30"),
			NumberSuggestion{"{YYYY}-{N}", 2026, 11}, true},
		{"latest year's last", imported("2025/090", "2025-12-30", "2026/004", "2026-01-15", "2026/002", "2026-01-03"),
			NumberSuggestion{"{YYYY}/{NNN}", 2026, 4}, true},
		{"the most common shape wins", imported("A-2026-1", "2026-01-01", "B-2026-2", "2026-02-01", "B-2026-3", "2026-03-01"),
			NumberSuggestion{"B-{YYYY}-{N}", 2026, 3}, true},
		{"one run of date and number", imported("261105-04", "2026-11-05"), NumberSuggestion{}, false},
		{"no year", imported("INV-0042", "2026-11-05"), NumberSuggestion{}, false},
		{"unknown digits", imported("7-2026-42", "2026-11-05"), NumberSuggestion{}, false},
		{"characters a format cannot hold", imported("RÉ:2026:1", "2026-11-05"), NumberSuggestion{}, false},
		{"none", nil, NumberSuggestion{}, false},
	} {
		got, ok := suggestFormat(tc.numbers)
		if ok != tc.ok || ok && got != tc.want {
			t.Errorf("%s: %+v %v, want %+v %v", tc.name, got, ok, tc.want, tc.ok)
		}
	}
}
