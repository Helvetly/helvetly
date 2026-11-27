package documents

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestNumberMatching(t *testing.T) {
	for _, tc := range []struct {
		number, name string
		inText, want bool
	}{
		{"2026/IN/005", "2026-IN-005.pdf", false, true},
		{"2026-IN-005", "2026_in_005.pdf", false, true},
		{"2026_IN_005", "Invoice 2026/IN/005 Acme.pdf", false, true},
		{"2026/IN/005", "2026-IN-0051.pdf", false, false},
		{"2026/IN/005", "2026-IN-006.pdf", false, false},
		{"RE2026005", "re2026005.pdf", false, true},
		{"1042", "Rechnung 1042.pdf", false, true},
		{"1042", "Rechnung 1042.pdf", true, false}, // a lone number in text may be an amount
		{"2026/IN/005", "Rechnung Nr. 2026 / IN / 005 vom 3.1.", true, true},
		{"2026", "2026-IN-005.pdf", false, false}, // a year alone is no number
		{"12", "12.pdf", false, false},
		{"", "x.pdf", false, false},
	} {
		got := false
		if w := numberWords(tc.number, tc.inText); w != nil {
			hay := tc.name
			if !tc.inText {
				hay = strings.TrimSuffix(tc.name, ".pdf")
			}
			got = containsRun(words(hay), w)
		}
		if got != tc.want {
			t.Errorf("%q in %q (text %v) = %v, want %v", tc.number, tc.name, tc.inText, got, tc.want)
		}
	}
}

func TestRecordMatch(t *testing.T) {
	clients := []store.ClientName{{ID: "acme", Name: "Acme  AG", UID: "CHE-123.456.789 MWST"}, {ID: "baker", Name: "Baker GmbH"},
		{ID: "gone", Name: "Gone"}}
	inv := func(kind, number, client string, year int) store.RecordRef {
		return store.RecordRef{Kind: "invoices", Type: kind, Number: number, ClientID: client, Year: year}
	}
	quote := store.RecordRef{Kind: "quotes", Type: "quote", Number: "Q-2025-007", ClientID: "baker", Year: 2025, ObjectKey: "q/r2.pdf"}
	quoteR1 := quote
	quoteR1.ObjectKey = "q/r1.pdf"
	refs := []store.RecordRef{
		inv("invoice", "2026/IN/005", "acme", 2026),
		inv("credit_note", "2026/IN/011", "baker", 2026),
		inv("invoice", "IN/005", "baker", 2024), // shorter: loses to 2026/IN/005
		inv("invoice", "2026/IN/007", "acme", 2026),
		inv("credit_note", "2026/IN/007", "baker", 2026), // same number, two clients
		inv("invoice", "2026/IN/008", "acme", 2026),
		inv("credit_note", "2026/IN/008", "acme", 2026), // same number and client, two records
		{Kind: "invoices", Type: "invoice", Number: "EXT-9", ClientID: "acme", Year: 2019, DocumentID: "doc_orig"},
		{Kind: "invoices", Type: "proforma", Number: "", ClientID: "acme", Year: 2023, ObjectKey: "inv/draft.pdf"},
		inv("invoice", "2026/IN/099", "nobody", 2026), // a client not known
		quote, quoteR1,
	}
	ix := recordIndex{refs: refs, clients: clients}
	for _, tc := range []struct {
		name, file, object, text, id string
		want                         *recordMatch
	}{
		{name: "number in the name", file: "2026-IN-005.pdf", want: &recordMatch{place: recordPlace{clientID: "acme", kind: "invoices", year: 2026},
			client: "Acme AG", tag: "invoice", reason: "Matches invoice 2026/IN/005 for Acme AG."}},
		{name: "credit note, other separators", file: "2026_IN_011.pdf", want: &recordMatch{place: recordPlace{clientID: "baker", kind: "invoices", year: 2026},
			client: "Baker GmbH", tag: "credit-note", reason: "Matches credit note 2026/IN/011 for Baker GmbH."}},
		{name: "number in the text", file: "scan.pdf", text: "Rechnung 2026-IN-005", want: &recordMatch{place: recordPlace{clientID: "acme", kind: "invoices", year: 2026},
			client: "Acme AG", tag: "invoice", reason: "Matches invoice 2026/IN/005 for Acme AG."}},
		{name: "the name wins over the text", file: "2026-IN-011.pdf", text: "credits invoice 2026/IN/005",
			want: &recordMatch{place: recordPlace{clientID: "baker", kind: "invoices", year: 2026}, client: "Baker GmbH", tag: "credit-note",
				reason: "Matches credit note 2026/IN/011 for Baker GmbH."}},
		{name: "the stored PDF of each quote revision", file: "whatever.pdf", object: "q/r1.pdf",
			want: &recordMatch{place: recordPlace{clientID: "baker", kind: "quotes", year: 2025}, client: "Baker GmbH", tag: "quote",
				reason: "Matches quote Q-2025-007 for Baker GmbH."}},
		{name: "quote by number, revisions are one record", file: "Quote-Q-2025-007-r2.pdf",
			want: &recordMatch{place: recordPlace{clientID: "baker", kind: "quotes", year: 2025}, client: "Baker GmbH", tag: "quote",
				reason: "Matches quote Q-2025-007 for Baker GmbH."}},
		{name: "an imported invoice's original", file: "scan.pdf", id: "doc_orig",
			want: &recordMatch{place: recordPlace{clientID: "acme", kind: "invoices", year: 2019}, client: "Acme AG", tag: "invoice",
				reason: "Matches invoice EXT-9 for Acme AG."}},
		{name: "a PDF without number", file: "x.pdf", object: "inv/draft.pdf",
			want: &recordMatch{place: recordPlace{clientID: "acme", kind: "invoices", year: 2023}, client: "Acme AG", tag: "proforma-invoice",
				reason: "Matches pro forma invoice for Acme AG."}},
		{name: "two clients' records: the model decides", file: "2026-IN-007.pdf"},
		{name: "two records of one client: the model decides", file: "2026-IN-008.pdf"},
		{name: "an unknown client", file: "2026-IN-099.pdf"},
		{name: "no number", file: "invoice.pdf", text: "Invoice to Acme AG"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id := tc.id
			if id == "" {
				id = "doc_x"
			}
			got := ix.match(store.Document{ID: id, Name: tc.file, ObjectKey: tc.object}, tc.text)
			if (got == nil) != (tc.want == nil) || got != nil && (got.place != tc.want.place || got.client != tc.want.client ||
				got.tag != tc.want.tag || got.reason != tc.want.reason) {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
			// only the stored PDF and the imported original are the record itself; a number only names it
			if identity := tc.object != "" || tc.id != ""; got != nil && got.identity != identity {
				t.Fatalf("identity = %v, want %v", got.identity, identity)
			}
		})
	}
}

func TestRecordClient(t *testing.T) {
	ix := recordIndex{clients: []store.ClientName{{ID: "acme", Name: "Acme AG", UID: "CHE-123.456.789 MWST"},
		{ID: "baker", Name: "Baker GmbH"}, {ID: "ab", Name: "AB"}}}
	for _, tc := range []struct{ name, text, want string }{
		{"invoice.pdf", "Bill to: Acme AG, Bahnhofstrasse 1", "acme"},
		{"invoice.pdf", "UID CHE123456789", "acme"},
		{"baker-gmbh-invoice.pdf", "", "baker"},
		{"invoice.pdf", "Acme AG and Baker GmbH", ""}, // two clients: none
		{"invoice.pdf", "AB", ""},                     // too short to tell
		{"invoice.pdf", "Acme", ""},                   // not the whole name
	} {
		got := ""
		if c := ix.client(store.Document{Name: tc.name}, tc.text); c != nil {
			got = c.ID
		}
		if got != tc.want {
			t.Errorf("%q %q = %q, want %q", tc.name, tc.text, got, tc.want)
		}
	}
}

func TestRecordKind(t *testing.T) {
	for _, tc := range []struct {
		path, tags []string
		want       string
	}{
		{[]string{"Invoices", "2026"}, nil, "invoices"},
		{[]string{"Finance", "Rechnungen"}, nil, "invoices"},
		{[]string{"Credit Notes"}, nil, "invoices"},
		{[]string{"Offerten", "2025"}, nil, "quotes"},
		{nil, []string{"invoice", "acme"}, "invoices"},
		{[]string{"Contracts"}, []string{"contract", "invoice"}, ""}, // only the first tag says the kind
		{[]string{"Receipts"}, []string{"receipt"}, ""},
	} {
		if got := recordKind(tc.path, tc.tags); got != tc.want {
			t.Errorf("%v %v = %q, want %q", tc.path, tc.tags, got, tc.want)
		}
	}
}

// A record the model files outside Clients goes to the client's folder when the file names one known client; without
// one it stays, saying so.
func TestReadOrganizeKeepsClientRecordsInClients(t *testing.T) {
	inv := "fld_inv"
	folders := []store.Folder{{ID: inv, Name: "Invoices"}, {ID: "fld_26", Name: "2026", ParentID: &inv}}
	at := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	docs := []store.Document{
		{ID: "doc_a", Name: "invoice-acme.pdf", Tags: []string{}, CreatedAt: at},
		{ID: "doc_in", Name: "2025 invoice.pdf", FolderID: ptr("fld_26"), Tags: []string{"invoice"}, CreatedAt: at},
		{ID: "doc_none", Name: "invoice-x.pdf", Tags: []string{}, CreatedAt: at},
		{ID: "doc_twin", Name: "invoice-twin.pdf", Tags: []string{}, CreatedAt: at},
		{ID: "doc_contract", Name: "contract.pdf", Tags: []string{}, CreatedAt: at},
		{ID: "doc_system", Name: "invoice-b.pdf", Tags: []string{}, CreatedAt: at},
	}
	names := recordNames{clients: []store.ClientName{{ID: "acme", Name: "Acme AG"}, {ID: "baker", Name: "Baker GmbH"},
		{ID: "t1", Name: "Twin"}, {ID: "t2", Name: "twin"}}}
	clients := map[string]store.ClientName{"doc_a": names.clients[0], "doc_in": names.clients[1], "doc_twin": names.clients[2],
		"doc_contract": names.clients[0], "doc_system": names.clients[0]}
	row := func(id, folder string, change bool, tags ...string) map[string]any {
		return map[string]any{"document_id": id, "folder": folder, "tags": tags, "reason": "Looks like it.", "change": change}
	}
	b, _ := json.Marshal(map[string]any{"proposals": []any{
		row("doc_a", "Invoices/2026", true, "invoice"),
		row("doc_in", "Invoices/2026", false, "invoice"), // sits in the plain folder: still moved to its client
		row("doc_none", "Invoices/2026", true, "invoice"),
		row("doc_twin", "Invoices", true, "invoice"), // a client no path can name: stays
		row("doc_contract", "Contracts", true, "contract"),
		row("doc_system", "Clients/Baker GmbH/Invoices/2026", true, "invoice"), // the model's own client path stands
	}})
	got, err := readOrganize(string(b), docs, folders, names, clients, "en")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]struct {
		folder string
		change bool
		reason string
	}{
		"doc_a":        {"Clients/Acme AG/Invoices/2026", true, "An invoice for Acme AG, so it goes in the client's folder."},
		"doc_in":       {"Clients/Baker GmbH/Invoices/2026", true, "An invoice for Baker GmbH, so it goes in the client's folder."},
		"doc_none":     {"Invoices/2026", true, "Looks like it. No known client could be found in it, so it stays outside Clients."},
		"doc_twin":     {"Invoices", true, "Looks like it. No known client could be found in it, so it stays outside Clients."},
		"doc_contract": {"Clients/Acme AG/Documents/2026/Contracts", true, "A contract with Acme AG, so it goes in the client's folder."},
		"doc_system":   {"Clients/Baker GmbH/Invoices/2026", true, "Looks like it."},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d proposals", len(got))
	}
	for _, p := range got {
		w := want[p.DocumentID]
		if p.Folder != w.folder || p.Change != w.change || p.Reason != w.reason {
			t.Errorf("%s = %q %v %q, want %q %v %q", p.DocumentID, p.Folder, p.Change, p.Reason, w.folder, w.change, w.reason)
		}
	}
	if i := slices.IndexFunc(got, func(p proposal) bool { return p.DocumentID == "doc_in" }); got[i].FromFolder == nil || *got[i].FromFolder != "Invoices/2026" {
		t.Fatalf("doc_in from = %v", got[i].FromFolder)
	}
}

func TestRecordMatchPaid(t *testing.T) {
	m := recordMatch{label: "invoice 2026/IN/031", words: words("2026/IN/031")}
	for _, tc := range []struct {
		name, file    string
		tags          []string
		kind, ordinal string
		wantPaid      bool
	}{
		{name: "an instalment suffix", file: "2026_IN_031_Sumara_1st.pdf", kind: "payment-confirmation", ordinal: "1st", wantPaid: true},
		{name: "a client name only", file: "2026_IN_031_Daza.pdf"},
		{name: "a space before the suffix", file: "2026-IN-031_Schumer 3rd.pdf", kind: "payment-confirmation", ordinal: "3rd", wantPaid: true},
		{name: "a lone digit after the number", file: "2026_IN_031_1.pdf", kind: "payment-confirmation", ordinal: "1st", wantPaid: true},
		{name: "a German instalment", file: "2026_IN_031_Wang 2.Rate.pdf", kind: "payment-confirmation", ordinal: "2nd", wantPaid: true},
		{name: "paid in the name", file: "Raiffeisen RE 2026-IN-031 bezahlt.pdf", kind: "payment-confirmation", wantPaid: true},
		{name: "an earlier kind tag", file: "2026_IN_031_Cregan.pdf", tags: []string{"payment-confirmation", "2026-in-031"},
			kind: "payment-confirmation", wantPaid: true},
		{name: "a bank statement tag", file: "2026_IN_031.pdf", tags: []string{"bank-statement"}, kind: "bank-statement", wantPaid: true},
		{name: "the invoice itself", file: "Invoice 2026-IN-031.pdf"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			kind, ordinal, paid := m.paid(store.Document{Name: tc.file, Tags: tc.tags})
			if kind != tc.kind || ordinal != tc.ordinal || paid != tc.wantPaid {
				t.Fatalf("paid = %q %q %v, want %q %q %v", kind, ordinal, paid, tc.kind, tc.ordinal, tc.wantPaid)
			}
		})
	}
	if got := m.paidReason("payment-confirmation", "1st"); got != "Payment confirmation for invoice 2026/IN/031 (1st instalment)." {
		t.Fatalf("reason = %q", got)
	}
}
