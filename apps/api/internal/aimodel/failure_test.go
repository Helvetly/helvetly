package aimodel

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestOpenAIFailuresSayWhy(t *testing.T) {
	const partial = `{"id":"resp_9","model":"gpt-6-luna","service_tier":"default","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},
		"output":[{"type":"reasoning"},{"type":"message","content":[{"type":"output_text","text":"Refund 16 of 24 lessons:"}]}],
		"usage":{"input_tokens":900,"input_tokens_details":{"cached_tokens":0},"output_tokens":4096,"output_tokens_details":{"reasoning_tokens":4000},"total_tokens":4996}}`
	for _, tc := range []struct {
		name, body         string
		status             int
		kind, reason, code string
		message, text      string
		known              bool
		responseID         string
	}{
		{name: "bad request", status: 400, body: `{"error":{"type":"invalid_request_error","code":"context_length_exceeded","message":"Too long."}}`,
			kind: FailRejected, code: "context_length_exceeded", message: "Too long.", known: true},
		{name: "wrong key", status: 401, body: `{"error":{"type":"invalid_request_error","code":"invalid_api_key","message":"Incorrect API key."}}`,
			kind: FailConfig, code: "invalid_api_key", message: "Incorrect API key.", known: true},
		{name: "unknown model", status: 404, body: `{"error":{"type":"invalid_request_error","code":"model_not_found","message":"No such model."}}`,
			kind: FailConfig, code: "model_not_found", known: true},
		{name: "rate limit", status: 429, body: `{"error":{"type":"requests","code":"rate_limit_exceeded","message":"Slow down."}}`,
			kind: FailRateLimited, code: "rate_limit_exceeded", known: true},
		{name: "account out of credit", status: 429, body: `{"error":{"type":"insufficient_quota","code":"insufficient_quota","message":"Quota."}}`,
			kind: FailConfig, code: "insufficient_quota", known: true},
		{name: "server error", status: 500, body: `{"error":{"type":"server_error","code":null,"message":"Oops."}}`,
			kind: FailServer, message: "Oops."},
		{name: "server error without JSON", status: 502, body: `<html>Bad gateway</html>`, kind: FailServer},
		{name: "cut short by the output budget", status: 200, body: partial, kind: FailIncomplete, reason: "max_output_tokens",
			text: "Refund 16 of 24 lessons:", known: true, responseID: "resp_9"},
		{name: "empty text", status: 200, body: `{"id":"resp_e","status":"completed","output":[],"usage":{"total_tokens":12}}`,
			kind: FailEmpty, known: true, responseID: "resp_e"},
		{name: "not JSON", status: 200, body: `not-json`, kind: FailInvalid},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("x-request-id", "req_123")
				w.WriteHeader(tc.status)
				_, _ = fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			p := NewOpenAI("fake-openai-key", "https://api.openai.com/v1", "gpt-6-luna").(*openAI)
			p.url = server.URL
			reply, err := p.Answer(context.Background(), Request{Message: "hello", MaxOutputTokens: 4096})
			pe, ok := errors.AsType[*ProviderError](err)
			if !ok {
				t.Fatalf("err = %v, want a ProviderError", err)
			}
			if pe.Kind != tc.kind || pe.Reason != tc.reason || pe.Code != tc.code || pe.RequestID != "req_123" || pe.ResponseID != tc.responseID ||
				(tc.message != "" && pe.Message != tc.message) || (tc.status != 200 && pe.HTTPStatus != tc.status) {
				t.Fatalf("error = %+v", pe)
			}
			if (reply.Tokens != nil) != tc.known || reply.Text != tc.text {
				t.Fatalf("known=%v reply=%+v", tc.known, reply)
			}
			if strings.Contains(err.Error(), "fake-openai-key") || strings.Contains(err.Error(), "hello") {
				t.Fatalf("the error carries the key or the prompt: %v", err)
			}
		})
	}
}

func TestOpenAITimeoutIsUnknown(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	defer server.Close()
	p := NewOpenAI("fake-openai-key", "https://api.openai.com/v1", "gpt-6-luna").(*openAI)
	p.url, p.client.Timeout = server.URL, 20*time.Millisecond
	reply, err := p.Answer(context.Background(), Request{Message: "hello"})
	if FailureKind(err) != FailTimeout || reply.Tokens != nil {
		t.Fatalf("reply=%+v err=%v, want a timeout with unknown usage", reply, err)
	}
}

func noRetryDelay(t *testing.T) {
	saved := retryDelays
	retryDelays = []time.Duration{0, 0, 0}
	t.Cleanup(func() { retryDelays = saved })
}

// captureLog collects slog output for the test.
func captureLog(t *testing.T) *bytes.Buffer {
	var buf bytes.Buffer
	saved := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(saved) })
	return &buf
}

func TestARateLimitIsRetriedThreeTimesThenLogged(t *testing.T) {
	noRetryDelay(t)
	log := captureLog(t)
	db, raw, ws := reserveDB(t)
	zero := int64(0)
	var attempts atomic.Int32
	p := &scripted{input: 10, reply: func(Request) (Reply, error) {
		attempts.Add(1)
		return Reply{Tokens: &zero, Usage: &Usage{Model: luna.Model, Tier: luna.Tier}},
			&ProviderError{Kind: FailRateLimited, HTTPStatus: 429, Code: "rate_limit_exceeded", Message: "Slow down.", RequestID: "req_7"}
	}}
	b := Budget{DB: db, Pool: PoolHeidi, Now: func() time.Time { return nov }}
	_, err := b.Generate(context.Background(), p, ws, Request{Message: "secret prompt"}, testCall)
	if FailureKind(err) != FailRateLimited || !errors.Is(err, ErrProvider) || attempts.Load() != 4 {
		t.Fatalf("err=%v after %d attempts, want a rate limit after 1 + 3 retries", err, attempts.Load())
	}
	rows, err := raw.Query(context.Background(), `SELECT step, status, failure FROM ai_calls ORDER BY step`)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		var step, status, failure string
		if err := rows.Scan(&step, &status, &failure); err != nil {
			t.Fatal(err)
		}
		got = append(got, step+" "+status+" "+failure)
	}
	want := "answer settled rate_limited|answer/retry1 settled rate_limited|answer/retry2 settled rate_limited|answer/retry3 settled rate_limited"
	if strings.Join(got, "|") != want {
		t.Fatalf("calls = %q", got)
	}
	if u := usageOf(t, db, ws, "2026-11"); u.Uncertain || u.TokensReserved != 0 || u.TokensUsed != 0 {
		t.Fatalf("usage = %+v, want nothing spent and nothing blocked", u)
	}
	out := log.String()
	if strings.Count(out, "model call failed") != 4 || !strings.Contains(out, "http_status=429") || !strings.Contains(out, "request_id=req_7") ||
		!strings.Contains(out, "error_code=rate_limit_exceeded") || !strings.Contains(out, "workspace="+ws.ID) || strings.Contains(out, "secret prompt") {
		t.Fatalf("log = %s", out)
	}
}

// TestAFailureWithUnknownUsageIsNotRetriedHere: it was charged its reservation; asking again is the caller's choice.
func TestAFailureWithUnknownUsageIsNotRetriedHere(t *testing.T) {
	noRetryDelay(t)
	db, _, ws := reserveDB(t)
	p := &scripted{input: 10, reply: func(Request) (Reply, error) {
		return Reply{}, &ProviderError{Kind: FailServer, HTTPStatus: 503}
	}}
	b := Budget{DB: db, Pool: PoolHeidi, Now: func() time.Time { return nov }}
	if _, err := b.Generate(context.Background(), p, ws, Request{}, testCall); !errors.Is(err, ErrUnaccounted) || p.answers.Load() != 1 {
		t.Fatalf("err=%v after %d answers, want one unaccounted call", err, p.answers.Load())
	}
}

// flakyCount fails to count the input twice, then counts it.
type flakyCount struct {
	scripted
	failures atomic.Int32
}

func (p *flakyCount) InputTokens(ctx context.Context, r Request) (int64, error) {
	if p.failures.Add(1) <= 2 {
		return 0, &ProviderError{Kind: FailServer, HTTPStatus: 500}
	}
	return p.scripted.InputTokens(ctx, r)
}

func TestAFailedInputCountIsRetried(t *testing.T) {
	noRetryDelay(t)
	db, _, ws := reserveDB(t)
	p := &flakyCount{scripted: scripted{input: 10, reply: used(10, 0, 5, 0)}}
	b := Budget{DB: db, Pool: PoolHeidi, Now: func() time.Time { return nov }}
	if reply, err := b.Generate(context.Background(), p, ws, Request{}, testCall); err != nil || reply.Text != "ok" || p.answers.Load() != 1 {
		t.Fatalf("reply=%+v err=%v answers=%d", reply, err, p.answers.Load())
	}
}

func TestAnIncompleteAnswerIsSettledAndKeepsItsText(t *testing.T) {
	noRetryDelay(t)
	db, raw, ws := reserveDB(t)
	p := &scripted{input: 100, reply: func(r Request) (Reply, error) {
		reply, _ := used(100, 0, 50, 40)(r)
		reply.Text = "Partial answer"
		return reply, &ProviderError{Kind: FailIncomplete, Reason: "max_output_tokens", Status: "incomplete"}
	}}
	b := Budget{DB: db, Pool: PoolHeidi, Now: func() time.Time { return nov }}
	reply, err := b.Generate(context.Background(), p, ws, Request{}, testCall)
	if FailureKind(err) != FailIncomplete || errors.Is(err, ErrUnaccounted) || reply.Text != "Partial answer" || p.answers.Load() != 1 {
		t.Fatalf("reply=%+v err=%v answers=%d", reply, err, p.answers.Load())
	}
	if u := usageOf(t, db, ws, "2026-11"); u.Uncertain || u.TokensUsed != 150 || u.TokensReserved != 0 || u.CostReserved != 0 {
		t.Fatalf("usage = %+v, want the known usage settled and the month open", u)
	}
	var failure string
	if err := raw.QueryRow(context.Background(), `SELECT failure FROM ai_calls`).Scan(&failure); err != nil || failure != "incomplete:max_output_tokens" {
		t.Fatalf("failure = %q, %v", failure, err)
	}
}
