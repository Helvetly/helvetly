package heidi

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// AI Act Art. 50(2): a model's answer is marked machine-readably, in the stream and in the stored conversation, apart
// from Helvetly's own (local command, guide, refusal) answers.
func TestAnswersAreMarkedByWhoGeneratedThem(t *testing.T) {
	s, mux, _, _ := fixture(t)
	tokens := int64(5)
	s.provider = &testProvider{input: 10, answer: func(context.Context, ProviderRequest) (ProviderReply, error) {
		return ProviderReply{Text: "Model explanation.", Tokens: &tokens}, nil
	}}
	grant(t, mux)
	for _, tc := range []struct{ conversation, message, want string }{
		{"model", "Explain this accounting term", "model"},
		{"local", "Which invoices are overdue?", "helvetly"},
	} {
		w := chat(t, mux, tc.conversation, tc.message)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"generated_by":"`+tc.want+`"`) {
			t.Fatalf("%s stream: %d %s", tc.conversation, w.Code, w.Body)
		}
		w = call(mux, "GET", "/api/v1/heidi/conversations/"+tc.conversation, "", "")
		var out struct{ Data []Message }
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || len(out.Data) != 2 {
			t.Fatalf("%s history: %v %s", tc.conversation, err, w.Body)
		}
		if out.Data[0].GeneratedBy != "" || out.Data[1].GeneratedBy != tc.want {
			t.Fatalf("%s: user %q assistant %q, want assistant %q", tc.conversation, out.Data[0].GeneratedBy, out.Data[1].GeneratedBy, tc.want)
		}
	}
}
