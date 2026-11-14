package einvoice

import (
	"context"
	"testing"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// An invoice issued in another system has no XML from Helvetly: the download, the email attachment and every delivery
// channel export through Service.export, which refuses it before anything is rendered or archived.
func TestExportRefusesInvoicesIssuedElsewhere(t *testing.T) {
	rendered := false
	render := func(store.Invoice) ([]byte, error) { rendered = true; return []byte("<Invoice/>"), nil }
	s := &Service{}
	for _, tt := range []struct {
		origin, wantCode string
	}{{"imported", "issued_elsewhere"}, {"helvetly", ""}} {
		t.Run(tt.origin, func(t *testing.T) {
			rendered = false
			_, err := s.export(context.Background(), store.Session{}, store.Invoice{Origin: tt.origin, Status: "open"}, "peppol", render)
			_, code, _, _ := auth.Describe(err)
			if code != tt.wantCode || rendered == (tt.wantCode != "") {
				t.Fatalf("code %q rendered %v, want %q", code, rendered, tt.wantCode)
			}
		})
	}
}
