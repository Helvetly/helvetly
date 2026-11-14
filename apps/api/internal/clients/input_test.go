package clients

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestNormalisers(t *testing.T) {
	for _, tc := range []struct {
		name, in, want string
		fn             func(string) (string, string)
	}{
		{"uid plain", "CHE123456788", "CHE-123.456.788", vatNumber},
		{"uid formatted", "CHE-123.456.788", "CHE-123.456.788", vatNumber},
		{"uid spaced lowercase with MWST", "che 123 456 788 mwst", "CHE-123.456.788 MWST", vatNumber},
		{"uid with TVA", "CHE-123.456.788 TVA", "CHE-123.456.788 TVA", vatNumber},
		{"uid with IVA", "CHE-123.456.788IVA", "CHE-123.456.788 IVA", vatNumber},
		{"uid check 11 means 0", "CHE-100.001.000", "CHE-100.001.000", vatNumber},
		{"uid wrong check digit", "CHE-123.456.789", "", vatNumber},
		{"uid check 10 is never issued", "CHE-100.010.000", "", vatNumber},
		{"uid too short", "CHE-123.456.78", "", vatNumber},
		{"uid unknown suffix", "CHE-123.456.788 VAT", "", vatNumber},
		{"swiss without CHE", "CH123456788", "", vatNumber},
		{"german vat", "de 123 456 789", "DE123456789", vatNumber},
		{"austrian vat", "ATU12345678", "ATU12345678", vatNumber},
		{"vat without prefix", "123456789", "", vatNumber},
		{"vat too long", "DE1234567890123456789", "", vatNumber},

		{"region county", "ro-cj", "RO-CJ", region},
		{"region bucharest", "RO-B", "RO-B", region},
		{"region name", "Cluj", "", region},
		{"region without country", "CJ", "", region},

		{"phone spaced", "+41 44 123 45 67", "+41441234567", phone},
		{"phone 00 prefix", "0041 (44) 123-45-67", "+41441234567", phone},
		{"phone national", "044 123 45 67", "", phone},
		{"phone letters", "+41 44 CALL ME", "", phone},
		{"phone too long", "+4144123456789012", "", phone},

		{"website without scheme", "example.ch", "https://example.ch", website},
		{"website http kept", "http://example.ch/about", "http://example.ch/about", website},
		{"website no dot", "localhost", "", website},
		{"website other scheme", "ftp://example.ch", "", website},
		{"website with user", "https://me@example.ch", "", website},
		{"website with space", "exa mple.ch", "", website},

		{"email lowercased", "Anna@Example.CH", "anna@example.ch", email},
		{"email with name", "Anna <anna@example.ch>", "", email},
		{"email invalid", "anna@", "", email},

		{"country lowercase", "ch", "CH", country},
		{"country unknown", "XX", "", country},
		{"country alpha-3", "CHE", "", country},
		{"currency", "chf", "CHF", currency},
		{"currency unknown", "ABC", "", currency},
		{"currency with space", "F C", "", currency},
		{"language", "FR", "fr", language},
		{"language unsupported", "es", "", language},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, msg := tc.fn(tc.in)
			if tc.want == "" && msg == "" {
				t.Fatalf("%q accepted as %q", tc.in, got)
			}
			if tc.want != "" && (got != tc.want || msg != "") {
				t.Fatalf("%q = %q, %q; want %q", tc.in, got, msg, tc.want)
			}
		})
	}
}

func TestTags(t *testing.T) {
	for _, tc := range []struct {
		name, in string
		want     []string // nil: invalid
	}{
		{"trimmed and kept as typed", `[" VIP ", "Zürich"]`, []string{"VIP", "Zürich"}},
		{"null clears", `null`, []string{}},
		{"empty list", `[]`, []string{}},
		{"duplicate ignoring case", `["VIP", "vip"]`, nil},
		{"blank tag", `["VIP", "  "]`, nil},
		{"31 characters", `["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]`, nil},
		{"30 characters", `["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]`, []string{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}},
		{"eleven tags", `["1","2","3","4","5","6","7","8","9","10","11"]`, nil},
		{"not a list", `"VIP"`, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, msg := tags(json.RawMessage(tc.in))
			if tc.want == nil {
				if msg == "" {
					t.Fatalf("accepted as %v", got)
				}
				return
			}
			if msg != "" || !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("= %v, %q; want %v", got, msg, tc.want)
			}
		})
	}
}

func TestFileType(t *testing.T) {
	pdf, png := []byte("%PDF-1.7\n"), []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	ole := append([]byte{}, oleMagic...)
	for _, tc := range []struct {
		name string
		head []byte
		want string
	}{
		{"report.pdf", pdf, "application/pdf"},
		{"REPORT.PDF", pdf, "application/pdf"},
		{"logo.png", png, "image/png"},
		{"logo.pdf", png, ""}, // the bytes decide, not the name
		{"report.exe", pdf, ""},
		{"notes.txt", []byte("hello"), "text/plain"},
		{"list.csv", []byte("a,b\n1,2\n"), "text/csv"},
		{"list.csv", pdf, ""},
		{"old.xls", ole, "application/vnd.ms-excel"},
		{"old.doc", ole, "application/msword"},
		{"old.doc", []byte("plain text"), ""},
		{"sheet.xlsx", []byte("PK\x03\x04rest"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		{"no-extension", pdf, ""},
	} {
		if got := fileType(tc.name, tc.head); got != tc.want {
			t.Errorf("fileType(%q) = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestNames(t *testing.T) {
	for _, tc := range []struct{ in, display, key string }{
		{"Offerte 2026.pdf", "Offerte 2026.pdf", "Offerte_2026.pdf"},
		{`C:\Users\anna\Vertrag.pdf`, "Vertrag.pdf", "Vertrag.pdf"},
		{"../../etc/passwd.txt", "passwd.txt", "passwd.txt"},
		{"Grüezi\x00.txt", "Grüezi.txt", "Gr_ezi.txt"},
		{"", "file", "file"},
	} {
		if d := displayName(tc.in); d != tc.display || keyName(d) != tc.key {
			t.Errorf("%q: display %q key %q, want %q %q", tc.in, d, keyName(d), tc.display, tc.key)
		}
	}
}

func TestCell(t *testing.T) {
	for in, want := range map[string]string{"=SUM(A1)": "'=SUM(A1)", "@cmd": "'@cmd", "+41441234567": "+41441234567",
		"-12": "-12", "-x": "'-x", "Anna": "Anna", "": ""} {
		if got := cell(in); got != want {
			t.Errorf("cell(%q) = %q, want %q", in, got, want)
		}
	}
}
