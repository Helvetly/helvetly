package heidi

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"helvetly.com/api/internal/aimodel"
)

func TestReplyLanguageUsesTheOriginalMessages(t *testing.T) {
	_, mux, p, _ := modelFixture(t)
	var answered ProviderRequest
	p.answer = func(_ context.Context, req ProviderRequest) (ProviderReply, error) {
		answered = req
		return ProviderReply{Text: "An earlier English assistant answer", Tokens: new(int64(1))}, nil
	}
	for _, tc := range []struct{ id, previous, message string }{
		{"spanish", "", "¿Cuál es la última factura?"},
		{"portuguese", "", "Qual é a última fatura?"},
		{"explicit", "", "Explain this quote in Swahili."},
		{"mixed", "", "請查一下 Müller AG 的發票。"},
		{"followup", "請求書について教えてください", "ok"},
		{"german", "Zeig mir die offenen Rechnungen", "INV-2026-002"},
	} {
		t.Run(tc.id, func(t *testing.T) {
			if tc.previous != "" {
				w := chat(t, mux, tc.id, tc.previous)
				if w.Code != 200 {
					t.Fatal(w.Body)
				}
			}
			answered = ProviderRequest{}
			w := chat(t, mux, tc.id, tc.message)
			if w.Code != 200 || answered.Message != tc.message || !strings.HasSuffix(answered.Instructions, replyInstruction("en")) {
				t.Fatalf("message %q, language instructions missing, reply %d", answered.Message, w.Code)
			}
			if tc.previous != "" && !slices.Contains(answered.History, aimodel.Turn{Role: "user", Text: tc.previous}) {
				t.Fatalf("earlier user's words missing: %#v", answered.History)
			}
		})
	}
}

func TestUILanguage(t *testing.T) {
	tests := []struct{ form, header, want string }{
		{"de", "fr-CH,fr;q=0.9", "de"},
		{"", "fr-CH,fr;q=0.9", "fr-CH"},
		{"xx", "es-ES, pl;q=0.8", "es-ES"},
		{"ja", "fr-CH", "ja"},
		{"zh-Hant", "", "zh-Hant"},
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
	if !strings.HasSuffix(answered.Instructions, replyInstruction("en")) || answered.Message != "wytłumacz mi o co tu chodzi" {
		t.Fatalf("lost the original Polish request or language policy: %q", answered.Message)
	}
}

func TestLanguageInstructionDoesNotCopyPrivateExtensions(t *testing.T) {
	for _, tag := range []string{"de-CH-x-freemsg", "x-freemsg", "ru; freemsg"} {
		if strings.Contains(replyInstruction(tag), "freemsg") {
			t.Errorf("untrusted language tag: %q", tag)
		}
	}
}
