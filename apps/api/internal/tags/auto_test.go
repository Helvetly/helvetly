package tags

import (
	"slices"
	"strings"
	"testing"
)

func TestAuto(t *testing.T) {
	for _, tc := range []struct {
		name string
		r    Record
		want []string
	}{
		{"invoice", Record{Kind: "invoice", Period: "2026-02", Client: "Müller & Söhne AG", Number: "2026/IN/005"},
			[]string{"invoice", "year-2026-02", "client-mueller-soehne-ag", "2026-in-005"}},
		{"credit note", Record{Kind: "credit-note", Period: "2025", Client: "Beta", Number: "CN-2"},
			[]string{"credit-note", "year-2025", "client-beta", "cn-2"}},
		{"quote", Record{Kind: "quote", Period: "2026", Client: "Acme", Number: "2026/Q/001"},
			[]string{"quote", "year-2026", "client-acme", "2026-q-001"}},
		{"contract from a quote", Record{Kind: "contract", Period: "2026", Client: "Acme", Number: "2026/C/001", FromQuote: "2026/Q/001"},
			[]string{"contract", "year-2026", "client-acme", "2026-c-001", "from-quote-2026-q-001"}},
		{"signed contract", Record{Kind: "contract", Signed: true, Period: "2026", Client: "Acme"},
			[]string{"contract", "signed", "year-2026", "client-acme"}},
		{"receipt", Record{Kind: "receipt", Period: "2024", Category: "Büro Material"},
			[]string{"receipt", "year-2024", "expense-buero-material"}},
		{"client upload", Record{Period: "2026", Client: "Acme"}, []string{"year-2026", "client-acme"}},
		{"nothing known", Record{}, []string{}},
		{"names without letters make no tag", Record{Kind: "quote", Client: "株式会社", Number: "—", FromQuote: "/"}, []string{"quote"}},
		{"long names are cut", Record{Client: strings.Repeat("Very Long Name ", 5)},
			[]string{"client-very-long-name-very-long"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := Auto(tc.r)
			if !slices.Equal(got, tc.want) {
				t.Fatalf("Auto = %v, want %v", got, tc.want)
			}
			for _, tag := range got {
				if !Valid(tag) {
					t.Fatalf("%q is not a valid tag", tag)
				}
			}
		})
	}
}

func TestMerge(t *testing.T) {
	for _, tc := range []struct {
		name                         string
		have, auto, removed, compute []string
		want, wantAuto               []string
	}{
		{"first tagging keeps the person's", []string{"urgent"}, nil, nil, []string{"invoice", "year-2026"},
			[]string{"urgent", "invoice", "year-2026"}, []string{"invoice", "year-2026"}},
		{"again changes nothing", []string{"urgent", "invoice"}, []string{"invoice"}, nil, []string{"invoice"},
			[]string{"urgent", "invoice"}, []string{"invoice"}},
		{"protected tags come back and matching legacy tags become automatic", []string{"invoice", "signed"}, []string{"invoice"}, []string{"year-2026", "client-acme"}, []string{"invoice", "signed", "year-2026", "client-acme"},
			[]string{"invoice", "signed", "year-2026", "client-acme"}, []string{"invoice", "signed", "year-2026", "client-acme"}},
		{"one no longer computed leaves", []string{"receipt", "expense-old", "mine"}, []string{"receipt", "expense-old"}, nil,
			[]string{"receipt", "expense-new"}, []string{"mine", "receipt", "expense-new"}, []string{"receipt", "expense-new"}},
		{"automatic ones follow Auto's order", []string{"year-2026", "mine"}, []string{"year-2026"}, nil, []string{"invoice", "year-2026"},
			[]string{"mine", "invoice", "year-2026"}, []string{"invoice", "year-2026"}},
		{"a manual record number stays the person's", []string{"abc-123"}, nil, nil, []string{"abc-123"}, []string{"abc-123"}, []string{}},
		{"the person's are never removed", []string{"client-acme"}, nil, nil, nil, []string{"client-acme"}, []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, gotAuto := Merge(tc.have, tc.auto, tc.removed, tc.compute)
			if !slices.Equal(got, tc.want) || !slices.Equal(gotAuto, tc.wantAuto) {
				t.Fatalf("Merge = %v, %v; want %v, %v", got, gotAuto, tc.want, tc.wantAuto)
			}
		})
	}
}
