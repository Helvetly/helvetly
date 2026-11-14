package heidi

import (
	"strings"
	"testing"
)

func TestGuideParses(t *testing.T) {
	if len(guide) < 15 {
		t.Fatalf("only %d guide sections", len(guide))
	}
	for _, s := range guide {
		if !strings.HasPrefix(s.text, "**") || strings.Contains(s.text, "Keywords:") || len(s.heading) == 0 {
			t.Fatalf("section %q", s.text[:min(len(s.text), 60)])
		}
	}
}

func TestGuideAnswer(t *testing.T) {
	tests := []struct {
		question string
		want     string // a word of the matching section's title; "" = no answer
	}{
		{"How do I invite a colleague to my workspace?", "invite"},
		{"How can I set up the Swiss QR bill with my QR-IBAN?", "qr bill"},
		{"how do I record a payment for an invoice", "payment"},
		{"Where do I turn on two-factor authentication?", "account"},
		{"How do I close a month?", "period"},
		{"hello", ""},
		{"What is the weather like today?", ""},
	}
	for _, tc := range tests {
		t.Run(tc.question, func(t *testing.T) {
			text, ok := guideAnswer(tc.question)
			title, _, _ := strings.Cut(text, "\n")
			if ok != (tc.want != "") || ok && !strings.Contains(strings.ToLower(title), tc.want) {
				t.Fatalf("ok=%v title=%q", ok, title)
			}
		})
	}
}

func TestHowToWithoutModelAnswersFromGuide(t *testing.T) {
	_, mux, _, _ := fixture(t)
	w := chat(t, mux, "help", "How do I invite a colleague to my workspace?")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "From the Helvetly guide") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	w = call(mux, "GET", "/api/v1/heidi/suggestions?page=help", "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "How do I invite a colleague?") {
		t.Fatalf("suggestions: %d %s", w.Code, w.Body)
	}
}
