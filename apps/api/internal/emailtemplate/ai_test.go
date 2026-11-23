package emailtemplate

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
)

type fakeModel struct {
	mu     sync.Mutex
	reqs   []aimodel.Request
	answer string
}

func (f *fakeModel) Card() aimodel.RateCard                                      { return aimodel.Cards[aimodel.DefaultModel] }
func (f *fakeModel) InputTokens(context.Context, aimodel.Request) (int64, error) { return 100, nil }
func (f *fakeModel) Answer(_ context.Context, r aimodel.Request) (aimodel.Reply, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reqs = append(f.reqs, r)
	tokens := int64(400)
	return aimodel.Reply{Text: f.answer, Tokens: &tokens, Usage: &aimodel.Usage{Input: 100, Output: 300, Model: aimodel.DefaultModel, Tier: "default"}}, nil
}

func answer(subject, body string) string {
	out := map[string]Template{}
	for _, l := range Languages {
		out[l] = Template{Subject: l + " " + subject, Body: body}
	}
	raw, _ := json.Marshal(out)
	return string(raw)
}

func (e *env) withAI(answer string) *fakeModel {
	f := &fakeModel{answer: answer}
	e.svc.SetAI(f, aimodel.Budget{DB: e.st, Pool: aimodel.PoolAutomation, Now: func() time.Time { return time.Now().UTC() }})
	return f
}

func (e *env) consent(b *browser) {
	e.t.Helper()
	var user string
	if err := e.raw.QueryRow(context.Background(), `SELECT user_id FROM workspace_members WHERE workspace_id = $1 LIMIT 1`, b.workspace).Scan(&user); err != nil {
		e.t.Fatal(err)
	}
	if err := e.st.SetAIConsent(context.Background(), b.workspace, user, true, time.Now().UTC()); err != nil {
		e.t.Fatal(err)
	}
}

func TestAIWriteAllLanguages(t *testing.T) {
	e := newEnv(t)
	f := e.withAI(answer("Offerte {number} von {company}", "Guten Tag\n\nIm Anhang: {number}, gültig bis {valid_until}.\n\n{company}"))
	b := e.owner()
	e.consent(b)
	status, raw := e.send(b, http.MethodPost, "/api/v1/email-templates/quote/ai-write", map[string]any{"instruction": "more formal"}, true)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, raw)
	}
	var out struct{ Data map[string]Template }
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	for _, l := range Languages {
		if !strings.HasPrefix(out.Data[l].Subject, l+" ") || !strings.Contains(out.Data[l].Body, "{valid_until}") {
			t.Fatalf("%s: %+v", l, out.Data[l])
		}
	}
	if len(f.reqs) != 1 || !strings.Contains(f.reqs[0].Instructions, "{valid_until}") || strings.Contains(f.reqs[0].Instructions, "{due_date}") ||
		!strings.Contains(f.reqs[0].Message, "more formal") {
		t.Fatalf("request: %+v", f.reqs)
	}
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'email_template.ai_written'`, b.workspace).Scan(&n); err != nil || n != 1 {
		t.Fatalf("audit %d %v", n, err)
	}
}

func TestAIWriteRefusesBadTexts(t *testing.T) {
	cases := map[string]string{
		"invented variable": answer("Offerte {number}", "Hallo {client_name}, {number}"),
		"required missing":  answer("Offerte", "Hallo {client}"),
		"too long":          answer("Offerte {number}", strings.Repeat("a", MaxTemplate+1)),
		"one language":      `{"de": {"subject": "Offerte {number}", "body": "Hallo"}}`,
		"not json":          "Hallo",
	}
	for name, a := range cases {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t)
			e.withAI(a)
			b := e.owner()
			e.consent(b)
			if status, raw := e.send(b, http.MethodPost, "/api/v1/email-templates/quote/ai-write", map[string]any{}, true); status != http.StatusBadGateway ||
				!strings.Contains(string(raw), "ai_unreadable") {
				t.Fatalf("status %d: %s", status, raw)
			}
		})
	}
}

func TestAIWriteGates(t *testing.T) {
	e := newEnv(t)
	b := e.owner()
	if status, raw := e.send(b, http.MethodPost, "/api/v1/email-templates/quote/ai-write", map[string]any{}, true); status != http.StatusServiceUnavailable ||
		!strings.Contains(string(raw), "ai_unavailable") {
		t.Fatalf("no model: %d %s", status, raw)
	}
	f := e.withAI(answer("Offerte {number}", "Hallo {number}"))
	if status, _ := e.send(b, http.MethodPost, "/api/v1/email-templates/nope/ai-write", map[string]any{}, true); status != http.StatusNotFound {
		t.Fatalf("unknown kind: %d", status)
	}
	if status, _ := e.send(b, http.MethodPost, "/api/v1/email-templates/quote/ai-write", map[string]any{"instruction": strings.Repeat("a", 301)}, true); status != http.StatusBadRequest {
		t.Fatalf("long instruction: %d", status)
	}
	if status, raw := e.send(b, http.MethodPost, "/api/v1/email-templates/quote/ai-write", map[string]any{}, true); status < 400 || len(f.reqs) != 0 {
		t.Fatalf("without consent: %d %s", status, raw)
	}
}
