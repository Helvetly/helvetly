package invoices

import (
	"encoding/json"
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestIntroAndFooterLimit(t *testing.T) {
	cases := []struct {
		name    string
		text    string
		refused bool
	}{
		{"exactly the limit", strings.Repeat("a", MaxDocumentText), false},
		{"one over", strings.Repeat("a", MaxDocumentText+1), true},
		// 800 characters are 1600 bytes: characters are counted, as the editors do.
		{"multi-byte characters at the limit", strings.Repeat("ä", MaxDocumentText), false},
		{"multi-byte characters one over", strings.Repeat("ä", MaxDocumentText+1), true},
		{"emoji at the limit", strings.Repeat("😀", MaxDocumentText), false},
	}
	for _, field := range []string{"intro", "footer"} {
		for _, tt := range cases {
			t.Run(field+"/"+tt.name, func(t *testing.T) {
				raw, _ := json.Marshal(tt.text)
				inv := &store.Invoice{Kind: "invoice"}
				invalid, err := checkInput(inv, map[string]json.RawMessage{field: raw}, Settings{})
				if err != nil {
					t.Fatal(err)
				}
				if got := invalid[field] != ""; got != tt.refused {
					t.Fatalf("refused = %v (%q), want %v", got, invalid[field], tt.refused)
				}
			})
		}
	}
}
