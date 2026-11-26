package tags

import (
	"os"
	"regexp"
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
			[]string{"invoice", "year-2026-02", "mueller-soehne-ag", "2026-in-005"}},
		{"credit note", Record{Kind: "credit-note", Period: "2025", Client: "Beta", Number: "CN-2"},
			[]string{"credit-note", "year-2025", "beta", "cn-2"}},
		{"quote", Record{Kind: "quote", Period: "2026", Client: "Acme", Number: "2026/Q/001"},
			[]string{"quote", "year-2026", "acme", "2026-q-001"}},
		{"contract from a quote", Record{Kind: "contract", Period: "2026", Client: "Acme", Number: "2026/C/001", FromQuote: "2026/Q/001"},
			[]string{"contract", "year-2026", "acme", "2026-c-001", "from-quote-2026-q-001"}},
		{"signed contract", Record{Kind: "contract", Signed: true, Period: "2026", Client: "Acme"},
			[]string{"contract", "signed", "year-2026", "acme"}},
		{"receipt", Record{Kind: "receipt", Period: "2024", Category: "Büro Material"},
			[]string{"receipt", "year-2024", "expense-buero-material"}},
		{"client upload", Record{Period: "2026", Client: "Acme"}, []string{"year-2026", "acme"}},
		{"payment confirmation", Record{Kind: "payment-confirmation", Period: "2026-03", Client: "Acme"},
			[]string{"payment-confirmation", "year-2026-03", "acme"}},
		{"a client named like a kind keeps its prefix", Record{Kind: "receipt", Client: "Invoice"}, []string{"receipt", "client-invoice"}},
		{"nothing known", Record{}, []string{}},
		{"names without letters make no tag", Record{Kind: "quote", Client: "株式会社", Number: "—", FromQuote: "/"}, []string{"quote"}},
		{"long names are cut", Record{Client: strings.Repeat("Very Long Name ", 5)},
			[]string{"very-long-name-very-long-name-ve"}},
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
		{"locked tags come back and matching legacy tags become automatic", []string{"invoice", "signed"}, []string{"invoice"}, []string{"year-2026", "2026-in-1"}, []string{"invoice", "signed", "year-2026", "2026-in-1"},
			[]string{"invoice", "signed", "year-2026", "2026-in-1"}, []string{"invoice", "signed", "year-2026", "2026-in-1"}},
		{"a removed client tag stays removed", []string{"invoice"}, []string{"invoice"}, []string{"acme"}, []string{"invoice", "acme"},
			[]string{"invoice"}, []string{"invoice"}},
		{"a client-<name> removed before the prefix went still counts", nil, nil, []string{"client-acme"}, []string{"invoice", "acme"},
			[]string{"invoice"}, []string{"invoice"}},
		{"the old automatic client-<name> leaves for <name>", []string{"invoice", "client-acme"}, []string{"invoice", "client-acme"}, nil,
			[]string{"invoice", "acme"}, []string{"invoice", "acme"}, []string{"invoice", "acme"}},
		{"a client tag the person already has stays one tag, theirs", []string{"acme"}, nil, nil, []string{"invoice", "acme"},
			[]string{"acme", "invoice"}, []string{"invoice"}},
		{"one no longer computed leaves", []string{"receipt", "expense-old", "mine"}, []string{"receipt", "expense-old"}, nil,
			[]string{"receipt", "expense-new"}, []string{"mine", "receipt", "expense-new"}, []string{"receipt", "expense-new"}},
		{"automatic ones follow Auto's order", []string{"year-2026", "mine"}, []string{"year-2026"}, nil, []string{"invoice", "year-2026"},
			[]string{"mine", "invoice", "year-2026"}, []string{"invoice", "year-2026"}},
		{"a manual record number stays the person's", []string{"abc-123"}, nil, nil, []string{"abc-123"}, []string{"abc-123"}, []string{}},
		{"the person's are never removed", []string{"client-acme"}, nil, nil, nil, []string{"client-acme"}, []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, gotAuto := Merge(tc.have, tc.auto, tc.removed, tc.compute, slices.DeleteFunc(slices.Clone(tc.compute), func(t string) bool {
				return !Protected(t) && !strings.HasPrefix(t, "2026-in-")
			}))
			if !slices.Equal(got, tc.want) || !slices.Equal(gotAuto, tc.wantAuto) {
				t.Fatalf("Merge = %v, %v; want %v, %v", got, gotAuto, tc.want, tc.wantAuto)
			}
		})
	}
}

func TestClientTag(t *testing.T) {
	for name, want := range map[string]string{
		"Altaf Sumara":         "altaf-sumara",
		"Müller & Söhne":       "mueller-soehne",
		"Invoice":              "client-invoice", // a kind
		"Payment Confirmation": "client-payment-confirmation",
		"Signed":               "client-signed",
		"Year 2026":            "client-year-2026", // a date
		"2026":                 "client-2026",      // could be a record number
		"3M":                   "client-3m",
		"Expense Partners":     "client-expense-partners", // reads as another automatic tag
		"Client One":           "client-client-one",
		"Year End Ltd":         "year-end-ltd", // not a date
		"株式会社":                 "",
	} {
		if got := ClientTag(name); got != want {
			t.Errorf("ClientTag(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestLocked(t *testing.T) {
	r := Record{Kind: "invoice", Signed: true, Period: "2026-02", Client: "Acme", Number: "2026/IN/005", Category: "Travel", FromQuote: "Q-1"}
	if got := Locked(r); !slices.Equal(got, []string{"invoice", "signed", "year-2026-02", "2026-in-005"}) {
		t.Fatalf("Locked = %v", got)
	}
}

// Every kind is one tag, protected, and every invoice kind has one of them.
func TestKinds(t *testing.T) {
	for _, k := range Kinds {
		if !Valid(k) || !Protected(k) || Slug(k) != k {
			t.Errorf("kind %q is not a protected tag", k)
		}
	}
	for kind, tag := range InvoiceKinds {
		if !Kind(tag) {
			t.Errorf("invoice kind %q has tag %q, not one of Kinds", kind, tag)
		}
	}
	for _, tag := range []string{"signed", "year-2026", "year-2026-12"} {
		if !Protected(tag) {
			t.Errorf("%q is not protected", tag)
		}
	}
	for _, tag := range []string{"acme", "year-2026-13", "2026-in-005", "expense-travel", "client-acme", "invoices"} {
		if Protected(tag) {
			t.Errorf("%q is protected", tag)
		}
	}
}

// The platform labels the kinds and refuses them as typed tags from its own list: it must name the same kinds.
func TestPlatformKnowsEveryKind(t *testing.T) {
	src, err := os.ReadFile("../../../platform/src/lib/document-tags.ts")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	start := strings.Index(body, "const kinds = new Map")
	end := strings.Index(body[start:], "] as const)")
	if start < 0 || end < 0 {
		t.Fatal("the platform's kinds list is gone")
	}
	var platform []string
	for _, m := range regexp.MustCompile(`\['([a-z-]+)', '`).FindAllStringSubmatch(body[start:start+end], -1) {
		platform = append(platform, m[1])
	}
	if !slices.Equal(platform, Kinds) {
		t.Fatalf("platform kinds %v, API kinds %v", platform, Kinds)
	}
}
