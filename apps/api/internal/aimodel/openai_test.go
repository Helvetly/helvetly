package aimodel

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestOpenAIRequestUsesResponsesAndExplicitAttachmentsOnly(t *testing.T) {
	var observed struct {
		Model           string         `json:"model"`
		Store           bool           `json:"store"`
		Input           []inputMessage `json:"input"`
		Instructions    string         `json:"instructions"`
		MaxOutputTokens int64          `json:"max_output_tokens"`
		ServiceTier     string         `json:"service_tier"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer fake-openai-key" {
			t.Errorf("incorrect method or server credential header")
		}
		if err := json.NewDecoder(r.Body).Decode(&observed); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Check the source receipt."}]}],"usage":{"total_tokens":43}}`)
	}))
	defer server.Close()
	p := NewOpenAI("fake-openai-key", "https://api.openai.com/v1", "gpt-6-luna").(*openAI)
	p.url = server.URL
	result, err := p.Answer(context.Background(), Request{Instructions: "You cannot read the workspace.", History: []Turn{{Role: "user", Text: "Earlier"}, {Role: "assistant", Text: "Previous answer"}}, Message: "Read my files", MaxOutputTokens: 256, Files: []File{{Name: "receipt.pdf", ContentType: "application/pdf", Bytes: []byte("%PDF-current")}, {Name: "photo.png", ContentType: "image/png", Bytes: []byte("current-image")}}})
	if err != nil || result.Text != "Check the source receipt." || result.Tokens == nil || *result.Tokens != 43 {
		t.Fatalf("reply=%+v err=%v", result, err)
	}
	if observed.Model != "gpt-6-luna" || observed.ServiceTier != "default" || observed.Store || observed.MaxOutputTokens != 256 || len(observed.Input) != 3 {
		t.Fatalf("request shape: %+v", observed)
	}
	parts := observed.Input[2].Content
	if len(parts) != 3 || parts[1].Type != "input_file" || parts[1].Filename != "receipt.pdf" || parts[1].FileData != "data:application/pdf;base64,"+base64.StdEncoding.EncodeToString([]byte("%PDF-current")) || parts[2].Type != "input_image" {
		t.Fatalf("current attachments: %+v", parts)
	}
	b, _ := json.Marshal(observed)
	if strings.Contains(string(b), "old-private.pdf") || !strings.Contains(observed.Instructions, "cannot read the workspace") {
		t.Fatal("history attachments leaked or model tools not constrained")
	}
}

func TestOpenAIFailuresPreserveKnownAndUnknownUsage(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		known  bool
		tokens int64
	}{
		{"bad credentials", 401, `{}`, true, 0},
		{"rate limit", 429, `{}`, true, 0},
		{"provider failure", 503, `{}`, false, 0},
		{"missing accounting", 200, `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Answer"}]}]}`, false, 0},
		{"invalid JSON", 200, `not-json`, false, 0},
		{"incomplete with usage", 200, `{"status":"incomplete","usage":{"total_tokens":17}}`, true, 17},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(tc.status); _, _ = fmt.Fprint(w, tc.body) }))
			defer server.Close()
			p := NewOpenAI("fake-openai-key", "https://api.openai.com/v1", "gpt-6-luna").(*openAI)
			p.url = server.URL
			reply, err := p.Answer(context.Background(), Request{Message: "hello", MaxOutputTokens: 32})
			if tc.name != "missing accounting" && err == nil {
				t.Fatal("expected failure")
			}
			if (reply.Tokens != nil) != tc.known {
				t.Fatalf("known=%v reply=%+v err=%v", tc.known, reply, err)
			}
			if tc.known && *reply.Tokens != tc.tokens {
				t.Fatalf("tokens=%d", *reply.Tokens)
			}
		})
	}
}

func TestOpenAICancellationIsUnknownAndRedirectsAreNotFollowed(t *testing.T) {
	var outside atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { outside.Add(1) }))
	defer other.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Has("redirect") {
			http.Redirect(w, r, other.URL, 302)
			return
		}
		select {
		case <-r.Context().Done():
		case <-time.After(200 * time.Millisecond):
		}
	}))
	defer server.Close()
	p := NewOpenAI("fake-openai-key", "https://api.openai.com/v1", "gpt-6-luna").(*openAI)
	p.url = server.URL + "?redirect"
	if _, err := p.Answer(context.Background(), Request{Message: "hello"}); err == nil || outside.Load() != 0 {
		t.Fatalf("redirect followed: calls=%d err=%v", outside.Load(), err)
	}
	p.url = server.URL
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	reply, err := p.Answer(ctx, Request{Message: "hello"})
	if !errors.Is(err, context.Canceled) || reply.Tokens != nil {
		t.Fatalf("cancel reply=%+v err=%v", reply, err)
	}
}

func TestOpenAIInputCountUsesSamePromptAndRejectsMissingCount(t *testing.T) {
	for _, tc := range []struct {
		body string
		ok   bool
	}{{`{"object":"response.input_tokens","input_tokens":31}`, true}, {`{"object":"response.input_tokens"}`, false}, {`{"object":"response.input_tokens","input_tokens":-1}`, false}} {
		t.Run(tc.body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/input_tokens" || r.Header.Get("Authorization") != "Bearer fake-openai-key" {
					t.Errorf("count endpoint/header mismatch")
				}
				var body map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if _, found := body["max_output_tokens"]; found {
					t.Error("generation parameters sent to count endpoint")
				}
				if len(body["input"]) == 0 || len(body["instructions"]) == 0 {
					t.Error("prompt not counted")
				}
				_, _ = fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			p := NewOpenAI("fake-openai-key", "https://api.openai.com/v1", "gpt-6-luna").(*openAI)
			p.url = server.URL
			n, err := p.InputTokens(context.Background(), Request{Message: "Count this input"})
			if (err == nil) != tc.ok || tc.ok && n != 31 {
				t.Fatalf("count=%d err=%v", n, err)
			}
		})
	}
}

func TestOpenAIStructuredOutputAsksForStrictSchema(t *testing.T) {
	var observed map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&observed); err != nil {
			t.Error(err)
		}
		_, _ = fmt.Fprint(w, `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"{\"records\":[]}"}]}],"usage":{"total_tokens":9}}`)
	}))
	defer server.Close()
	p := NewOpenAI("fake-openai-key", "https://api.openai.com/v1", "gpt-6-luna").(*openAI)
	p.url = server.URL
	reply, err := p.Answer(context.Background(), Request{Instructions: "Extract.", Message: "rows", Schema: &Schema{Name: "import_clients", JSON: map[string]any{"type": "object"}}})
	if err != nil || reply.Text != `{"records":[]}` {
		t.Fatalf("reply=%+v err=%v", reply, err)
	}
	if string(observed["text"]) != `{"format":{"type":"json_schema","name":"import_clients","schema":{"type":"object"},"strict":true}}` {
		t.Fatalf("text format: %s", observed["text"])
	}
}

func TestOpenAIReportsTheUsageBreakdownItIsPricedBy(t *testing.T) {
	full := `{"id":"resp_7","model":"gpt-6-luna-2026-10-01","service_tier":"default","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],
		"usage":{"input_tokens":120,"input_tokens_details":{"cached_tokens":20},"output_tokens":30,"output_tokens_details":{"reasoning_tokens":10},"total_tokens":150}}`
	partial := `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":120,"output_tokens":30,"total_tokens":150}}`
	for _, tc := range []struct {
		body string
		want *Usage
	}{
		{full, &Usage{Input: 120, CachedInput: 20, Output: 30, Reasoning: 10, Model: "gpt-6-luna-2026-10-01", Tier: "default", RequestID: "resp_7"}},
		{partial, nil}, // a total alone settles tokens; the cost is reconciled, not guessed
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = fmt.Fprint(w, tc.body) }))
		p := NewOpenAI("fake-openai-key", "https://api.openai.com/v1", "gpt-6-luna").(*openAI)
		p.url = server.URL
		reply, err := p.Answer(context.Background(), Request{Message: "hello"})
		server.Close()
		if err != nil || reply.Tokens == nil || *reply.Tokens != 150 {
			t.Fatalf("reply=%+v err=%v", reply, err)
		}
		if (reply.Usage == nil) != (tc.want == nil) || (tc.want != nil && *reply.Usage != *tc.want) {
			t.Fatalf("usage = %+v, want %+v", reply.Usage, tc.want)
		}
		if tc.want != nil {
			if cost, ok := p.Card().price(reply.Usage, 150); !ok || cost != luna.Cost(100, 20, 30) {
				t.Fatalf("price = %d %v", cost, ok)
			}
		}
	}
}
