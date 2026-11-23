package heidi

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"helvetly.com/api/internal/aimodel"
)

func TestReplyLanguage(t *testing.T) {
	german := []aimodel.Turn{
		{Role: "user", Text: "Zeig mir die offenen Rechnungen"},
		{Role: "assistant", Text: "You have 3 overdue invoices: INV-2026-001, INV-2026-002 and INV-2026-003."},
	}
	tests := []struct {
		name, message string
		history       []aimodel.Turn
		ui, want      string
	}{
		{"Polish message, English interface", "Które faktury są przeterminowane?", nil, "en", "pl"},
		{"English message, German interface", "Which invoices are overdue?", nil, "de", "en"},
		{"ok after German messages", "ok", german, "en", "de"},
		{"an invoice number after German messages", "INV-2026-002", german, "fr", "de"},
		{"English record data in the answers does not count", "42", []aimodel.Turn{{Role: "assistant", Text: "The invoices are overdue."}}, "it", "it"},
		{"empty history: the interface's", "ok", nil, "fr", "fr"},
		{"a language the hints do not know: the model follows the message", "¿Cuántas facturas están vencidas hoy?", german, "en", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := replyLanguage(tc.message, tc.history, tc.ui); got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestUILanguage(t *testing.T) {
	tests := []struct{ form, header, want string }{
		{"de", "fr-CH,fr;q=0.9", "de"},
		{"", "fr-CH,fr;q=0.9", "fr"},
		{"xx", "es-ES, pl;q=0.8", "pl"},
		{"", "", "en"},
	}
	for _, tc := range tests {
		r := httptest.NewRequest("POST", "/", nil)
		r.Header.Set("Accept-Language", tc.header)
		if got := uiLanguage(r, tc.form); got != tc.want {
			t.Errorf("%q %q: got %q, want %q", tc.form, tc.header, got, tc.want)
		}
	}
}

// The answer's instructions end with the reply language: the message's, whatever the interface's.
func TestTheAnswerFollowsTheMessageLanguage(t *testing.T) {
	_, mux, p, _ := modelFixture(t)
	var answered ProviderRequest
	p.scope = func(ProviderRequest) (ProviderReply, error) {
		zero := int64(0)
		return ProviderReply{Text: `{"in_scope":true,"reason":"this screen"}`, Tokens: &zero}, nil
	}
	p.answer = func(_ context.Context, r ProviderRequest) (ProviderReply, error) {
		answered = r
		one := int64(1)
		return ProviderReply{Text: "Ten ekran zamyka miesiące.", Tokens: &one}, nil
	}
	var b bytes.Buffer
	form := multipart.NewWriter(&b)
	for k, v := range map[string]string{"conversation_id": "lang", "message": "wytłumacz mi o co tu chodzi", "path": "/books", "lang": "en"} {
		if err := form.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	if w := call(mux, "POST", "/api/v1/heidi/chat", b.String(), form.FormDataContentType()); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	want := "# Reply language\n\nAlways answer in Polish, the language of the user's last message."
	if i := strings.LastIndex(answered.Instructions, "\n\n# "); i < 0 || !strings.HasPrefix(answered.Instructions[i+2:], want) ||
		!strings.Contains(answered.Instructions, "earlier messages, else in English.") {
		t.Fatalf("instructions end ...%q", answered.Instructions[max(0, len(answered.Instructions)-400):])
	}
}
