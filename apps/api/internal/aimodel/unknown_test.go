package aimodel

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// TestUnknownUsageIsChargedItsReservation: an answer whose usage is never reported costs its whole reservation, never
// less, leaves the month usable and lets the step be asked once more.
func TestUnknownUsageIsChargedItsReservation(t *testing.T) {
	for _, tc := range []struct {
		name    string
		answer  http.HandlerFunc
		failure string
	}{
		{"timeout", func(_ http.ResponseWriter, r *http.Request) {
			select {
			case <-r.Context().Done():
			case <-time.After(2 * time.Second):
			}
		}, "unknown_usage:timeout"},
		{"dropped body", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Length", "1000")
			_, _ = fmt.Fprint(w, `{"status":"compl`)
		}, "unknown_usage:invalid"},
		{"missing usage", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = fmt.Fprint(w, `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}`)
		}, "unknown_usage:no_usage"},
		{"server error", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) }, "unknown_usage:server"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, raw, ws := reserveDB(t)
			answers := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/input_tokens") {
					_, _ = fmt.Fprint(w, `{"object":"response.input_tokens","input_tokens":100}`)
					return
				}
				answers++
				if answers == 1 {
					tc.answer(w, r)
					return
				}
				_, _ = fmt.Fprint(w, `{"model":"gpt-6-luna","service_tier":"default","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],
					"usage":{"input_tokens":100,"output_tokens":20,"total_tokens":120,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}}}`)
			}))
			defer server.Close()
			p := NewOpenAI("fake-openai-key", "https://api.openai.com/v1", DefaultModel).(*openAI)
			p.url, p.client.Timeout = server.URL, 50*time.Millisecond
			log := captureLog(t)
			b := Budget{DB: db, Pool: PoolAutomation, Now: func() time.Time { return nov }, Allowance: fixed(1_000_000), CostAllowance: fixed(1_000_000)}
			call := Call{Kind: "import", Operation: "file", Step: "0", MaxOutput: 100, Caps: ImportCaps}

			_, err := b.Generate(context.Background(), p, ws, Request{Message: "read"}, call)
			if !errors.Is(err, ErrUnaccounted) || !errors.Is(err, ErrProvider) || answers != 1 {
				t.Fatalf("err = %v after %d answers, want one unaccounted provider failure", err, answers)
			}
			reserved := automationUsage(t, db, ws)
			want := store.HeidiUsage{TokensUsed: 200, CostMicros: luna.Cost(100, 0, 100)}
			if reserved != want {
				t.Fatalf("usage = %+v, want the whole reservation charged %+v", reserved, want)
			}
			var status, failure string
			var total, cost int64
			if err := raw.QueryRow(context.Background(), `SELECT status,failure,total_tokens,cost_micros FROM ai_calls`).Scan(&status, &failure, &total, &cost); err != nil {
				t.Fatal(err)
			}
			if status != "settled" || failure != tc.failure || total != 200 || cost != want.CostMicros {
				t.Fatalf("call = %s %s %d %d", status, failure, total, cost)
			}
			if !strings.Contains(log.String(), "charged its reservation") {
				t.Fatalf("log = %s", log)
			}

			// The step is asked once more and settles at its actual usage on top.
			if _, err := b.Generate(context.Background(), p, ws, Request{Message: "read"}, call); err != nil {
				t.Fatalf("the retry: %v", err)
			}
			got := automationUsage(t, db, ws)
			if got.TokensUsed != 320 || got.CostMicros != want.CostMicros+luna.Cost(100, 0, 20) || got.TokensReserved != 0 || got.CostReserved != 0 {
				t.Fatalf("usage after the retry = %+v", got)
			}
			if _, err := b.Generate(context.Background(), p, ws, Request{Message: "read"}, call); !errors.Is(err, ErrAttempts) || answers != 2 {
				t.Fatalf("third try: %v after %d answers, want ErrAttempts", err, answers)
			}
		})
	}
}

func automationUsage(t *testing.T, db *store.Store, ws store.Workspace) store.HeidiUsage {
	t.Helper()
	u, err := db.HeidiUsage(context.Background(), ws.ID, PoolAutomation, "2026-11")
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// deadline records the deadline each answer is given.
type deadline struct {
	scripted
	got time.Duration
}

func (p *deadline) Answer(ctx context.Context, r Request) (Reply, error) {
	d, _ := ctx.Deadline()
	p.got = time.Until(d).Round(time.Second)
	return p.scripted.Answer(ctx, r)
}

func TestAnAnswerHasItsCallsDeadline(t *testing.T) {
	db, _, ws := reserveDB(t)
	b := Budget{DB: db, Pool: PoolHeidi, Now: func() time.Time { return nov }}
	for i, tc := range []struct{ timeout, want time.Duration }{
		{0, answerTimeout}, {MaxAnswerTimeout, MaxAnswerTimeout}, {time.Hour, MaxAnswerTimeout},
	} {
		p := &deadline{scripted: scripted{input: 10, reply: used(10, 0, 1, 0)}}
		call := testCall
		call.Operation, call.Timeout = fmt.Sprint("op", i), tc.timeout
		if _, err := b.Generate(context.Background(), p, ws, Request{}, call); err != nil || p.got != tc.want {
			t.Fatalf("timeout %v: deadline %v (err %v), want %v", tc.timeout, p.got, err, tc.want)
		}
	}
}

// TestUncertainCallsOfEarlierReleasesAreSettled: a month an earlier release blocked is charged its calls' reservations
// and unblocked once, at startup.
func TestUncertainCallsOfEarlierReleasesAreSettled(t *testing.T) {
	db, raw, ws := reserveDB(t)
	ctx := context.Background()
	for _, id := range []string{"aic_a", "aic_b"} {
		if ok, err := db.InsertAICall(ctx, store.AICall{ID: id, WorkspaceID: ws.ID, Period: "2026-11", Pool: PoolAutomation, Kind: "import",
			Operation: id, Step: "0", RateCard: luna.Version, Model: luna.Model, Tier: luna.Tier, Region: luna.Region,
			ReservedTokens: 100, ReservedMicros: 7, CreatedAt: nov}); err != nil || !ok {
			t.Fatal(ok, err)
		}
		if _, err := raw.Exec(ctx, `UPDATE ai_calls SET status='uncertain', failure=CASE WHEN id='aic_a' THEN 'timeout' ELSE '' END WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Tx(ctx, func(q store.Q) error {
		if _, err := q.LockHeidiUsage(ctx, ws.ID, PoolAutomation, "2026-11", nov); err != nil {
			return err
		}
		return q.SaveHeidiUsage(ctx, ws.ID, PoolAutomation, "2026-11", store.HeidiUsage{TokensUsed: 50, CostMicros: 3, TokensReserved: 200, CostReserved: 14, Uncertain: true}, nov)
	}); err != nil {
		t.Fatal(err)
	}
	log := captureLog(t)
	for range 2 { // idempotent
		if err := SettleUncertain(ctx, db, nov); err != nil {
			t.Fatal(err)
		}
	}
	if got, want := automationUsage(t, db, ws), (store.HeidiUsage{TokensUsed: 250, CostMicros: 17}); got != want {
		t.Fatalf("usage = %+v, want %+v", got, want)
	}
	rows, err := raw.Query(ctx, `SELECT status||' '||failure||' '||total_tokens||' '||cost_micros FROM ai_calls ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		got = append(got, s)
	}
	if strings.Join(got, "|") != "settled unknown_usage:timeout 100 7|settled unknown_usage:unknown 100 7" {
		t.Fatalf("calls = %q", got)
	}
	if strings.Count(log.String(), "uncertain model call charged its reservation") != 2 {
		t.Fatalf("log = %s", log)
	}
}
