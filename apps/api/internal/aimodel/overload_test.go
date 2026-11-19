package aimodel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/store"
)

const overloaded = `{"error":{"type":"server_error","code":"model_overloaded","message":"The requested model was temporarily overloaded. Follow Retry-After when present before retrying."}}`

// overloadServer answers like OpenAI: busy(model, attempt) says how the nth answer asked of a model fails (status,
// Retry-After, body), status 0 is a completed answer with 100 input and 20 output tokens of that model.
func overloadServer(t *testing.T, busy func(model string, n int) (int, string, string)) (*httptest.Server, func() []string) {
	var mu sync.Mutex
	var asked []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/input_tokens") {
			_, _ = fmt.Fprint(w, `{"object":"response.input_tokens","input_tokens":100}`)
			return
		}
		var in struct{ Model string }
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &in)
		mu.Lock()
		asked = append(asked, in.Model)
		n := 0
		for _, m := range asked {
			if m == in.Model {
				n++
			}
		}
		mu.Unlock()
		if status, retryAfter, body := busy(in.Model, n); status != 0 {
			if retryAfter != "" {
				w.Header().Set("Retry-After", retryAfter)
			}
			w.WriteHeader(status)
			_, _ = fmt.Fprint(w, body)
			return
		}
		_, _ = fmt.Fprintf(w, `{"id":"resp_1","model":%q,"service_tier":"default","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],
			"usage":{"input_tokens":100,"output_tokens":20,"total_tokens":120,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}}}`, in.Model)
	}))
	t.Cleanup(server.Close)
	return server, func() []string { mu.Lock(); defer mu.Unlock(); return append([]string(nil), asked...) }
}

func overloadProvider(url, fallback string) *openAI {
	p := NewOpenAI("fake-openai-key", "https://api.openai.com/v1", DefaultModel, fallback).(*openAI)
	p.url = url
	if p.fallback != nil {
		p.fallback.url = url
	}
	return p
}

type callRow struct {
	Step, Status, Failure, Model string
	Total, Cost                  int64
}

func callRows(t *testing.T, raw *pgxpool.Pool, ws store.Workspace) []callRow {
	t.Helper()
	rows, err := raw.Query(context.Background(), `SELECT step, status, failure, model, COALESCE(total_tokens, -1), COALESCE(cost_micros, -1)
		FROM ai_calls WHERE workspace_id = $1 ORDER BY step`, ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []callRow
	for rows.Next() {
		var r callRow
		if err := rows.Scan(&r.Step, &r.Status, &r.Failure, &r.Model, &r.Total, &r.Cost); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

// An automation budget funded for Luna only: the fallback's dearer card must still be asked.
func overloadBudget(db *store.Store) Budget {
	return Budget{DB: db, Pool: PoolAutomation, Now: func() time.Time { return nov }, Allowance: fixed(1_000_000), CostAllowance: fixed(1_000_000)}
}

var overloadCall = Call{Kind: "import", Operation: "file", Step: "0", MaxOutput: 100, Caps: ImportCaps}

// TestAnOverloadIsRetriedFreeOfCharge: a 503 "overloaded" (or a 429) refused the call before generating: it costs
// nothing, is retried after Retry-After or a backoff, and the answer that follows settles its real usage.
func TestAnOverloadIsRetriedFreeOfCharge(t *testing.T) {
	for _, tc := range []struct {
		name, retryAfter, failure string
		status                    int
		body                      string
		wait                      time.Duration
	}{
		{"overloaded, Retry-After", "1", FailOverloaded, 503, overloaded, time.Second},
		{"overloaded, no Retry-After", "", FailOverloaded, 503, overloaded, 0},
		{"rate limited, Retry-After", "1", FailRateLimited, 429, `{"error":{"type":"requests","code":"rate_limit_exceeded","message":"Slow down."}}`, time.Second},
	} {
		t.Run(tc.name, func(t *testing.T) {
			noRetryDelay(t)
			db, raw, ws := reserveDB(t)
			server, asked := overloadServer(t, func(_ string, n int) (int, string, string) {
				if n == 1 {
					return tc.status, tc.retryAfter, tc.body
				}
				return 0, "", ""
			})
			started := time.Now()
			reply, err := overloadBudget(db).Generate(context.Background(), overloadProvider(server.URL, ""), ws, Request{Message: "read"}, overloadCall)
			if err != nil || reply.Text != "ok" || len(asked()) != 2 {
				t.Fatalf("reply=%+v err=%v asked=%v", reply, err, asked())
			}
			if took := time.Since(started); took < tc.wait {
				t.Fatalf("retried after %s, want Retry-After's %s", took, tc.wait)
			}
			want := []callRow{{"0", "settled", tc.failure, luna.Model, 0, 0}, {"0/retry1", "settled", "", luna.Model, 120, luna.Cost(100, 0, 20)}}
			if got := callRows(t, raw, ws); fmt.Sprint(got) != fmt.Sprint(want) {
				t.Fatalf("calls = %+v, want %+v", got, want)
			}
			if u := automationUsage(t, db, ws); u != (store.HeidiUsage{TokensUsed: 120, CostMicros: luna.Cost(100, 0, 20)}) {
				t.Fatalf("usage = %+v, want only the answer's real usage", u)
			}
		})
	}
}

// TestAPersistingOverloadAsksTheFallbackModel: the fallback is reserved, priced and recorded at its own card, though
// the pool is funded for the configured model only.
func TestAPersistingOverloadAsksTheFallbackModel(t *testing.T) {
	noRetryDelay(t)
	log := captureLog(t)
	db, raw, ws := reserveDB(t)
	sol := Cards["gpt-6.1-sol"]
	server, asked := overloadServer(t, func(model string, _ int) (int, string, string) {
		if model == luna.Model {
			return 503, "", overloaded
		}
		return 0, "", ""
	})
	reply, err := overloadBudget(db).Generate(context.Background(), overloadProvider(server.URL, sol.Model), ws, Request{Message: "read"}, overloadCall)
	if err != nil || reply.Text != "ok" || strings.Join(asked(), ",") != "gpt-6-luna,gpt-6-luna,gpt-6-luna,gpt-6-luna,gpt-6.1-sol" {
		t.Fatalf("reply=%+v err=%v asked=%v", reply, err, asked())
	}
	want := []callRow{{"0", "settled", "overloaded", luna.Model, 0, 0}, {"0/fallback", "settled", "", sol.Model, 120, sol.Cost(100, 0, 20)},
		{"0/retry1", "settled", "overloaded", luna.Model, 0, 0}, {"0/retry2", "settled", "overloaded", luna.Model, 0, 0},
		{"0/retry3", "settled", "overloaded", luna.Model, 0, 0}}
	if got := callRows(t, raw, ws); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("calls = %+v, want %+v", got, want)
	}
	if u := automationUsage(t, db, ws); u != (store.HeidiUsage{TokensUsed: 120, CostMicros: sol.Cost(100, 0, 20)}) {
		t.Fatalf("usage = %+v", u)
	}
	if out := log.String(); !strings.Contains(out, "asking the fallback model") || !strings.Contains(out, "fallback_model=gpt-6.1-sol") {
		t.Fatalf("log = %s", out)
	}
}

// TestAnOverloadWithoutAFallbackIsBusy: the person hears the model is busy; nothing is charged and the month stays open.
func TestAnOverloadWithoutAFallbackIsBusy(t *testing.T) {
	for _, fallback := range []string{"", "gpt-6.1-sol"} {
		t.Run("fallback "+fallback, func(t *testing.T) {
			noRetryDelay(t)
			db, _, ws := reserveDB(t)
			server, asked := overloadServer(t, func(string, int) (int, string, string) { return 503, "", overloaded })
			_, err := overloadBudget(db).Generate(context.Background(), overloadProvider(server.URL, fallback), ws, Request{Message: "read"}, overloadCall)
			want := 4
			if fallback != "" {
				want = 5
			}
			if !Busy(err) || !errors.Is(err, ErrProvider) || errors.Is(err, ErrUnaccounted) || len(asked()) != want {
				t.Fatalf("err=%v asked=%v, want a busy model after %d answers", err, asked(), want)
			}
			if u := automationUsage(t, db, ws); u != (store.HeidiUsage{}) {
				t.Fatalf("usage = %+v, want nothing charged or reserved", u)
			}
		})
	}
}

// TestAnotherServerErrorIsStillUnknown: a 5xx that is not an overload may have generated: it is charged its
// reservation, never retried here and never sent to the fallback model.
func TestAnotherServerErrorIsStillUnknown(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"503 without overload", `{"error":{"type":"server_error","code":null,"message":"Service unavailable."}}`},
		{"503 without JSON", `<html>Service unavailable</html>`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			noRetryDelay(t)
			db, _, ws := reserveDB(t)
			server, asked := overloadServer(t, func(string, int) (int, string, string) { return 503, "1", tc.body })
			_, err := overloadBudget(db).Generate(context.Background(), overloadProvider(server.URL, "gpt-6.1-sol"), ws, Request{Message: "read"}, overloadCall)
			if !errors.Is(err, ErrUnaccounted) || Busy(err) || len(asked()) != 1 {
				t.Fatalf("err=%v asked=%v, want one unaccounted call", err, asked())
			}
			if u := automationUsage(t, db, ws); u != (store.HeidiUsage{TokensUsed: 200, CostMicros: luna.Cost(100, 0, 100)}) {
				t.Fatalf("usage = %+v, want the reservation charged", u)
			}
		})
	}
}

func TestRetryAfter(t *testing.T) {
	now := time.Date(2026, 11, 19, 15, 39, 0, 0, time.UTC)
	for _, tc := range []struct {
		header string
		want   time.Duration
	}{
		{"", 0},
		{"3", 3 * time.Second},
		{" 3 ", 3 * time.Second},
		{"-5", 0},
		{"soon", 0},
		{"3600", maxRetryWait},
		{"99999999999999999999", 0},
		{now.Add(5 * time.Second).Format(http.TimeFormat), 5 * time.Second},
		{now.Add(-time.Minute).Format(http.TimeFormat), 0},
		{now.Add(time.Hour).Format(http.TimeFormat), maxRetryWait},
	} {
		if got := retryAfter(tc.header, now); got != tc.want {
			t.Errorf("retryAfter(%q) = %s, want %s", tc.header, got, tc.want)
		}
	}
}
