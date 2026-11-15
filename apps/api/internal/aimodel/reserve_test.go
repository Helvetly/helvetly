package aimodel

import (
	"context"
	"errors"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

var testCall = Call{Kind: "heidi", Operation: "op", Step: "answer", MaxOutput: 100, Caps: HeidiCaps}

var luna = Cards[DefaultModel]

// scripted counts the input as Input and answers with reply; seen holds each request it was asked.
type scripted struct {
	card    RateCard
	input   int64
	reply   func(Request) (Reply, error)
	during  func()
	counts  atomic.Int32
	answers atomic.Int32
	seen    []Request
}

func (p *scripted) Card() RateCard {
	if p.card.Model == "" {
		return luna
	}
	return p.card
}
func (p *scripted) InputTokens(context.Context, Request) (int64, error) {
	p.counts.Add(1)
	return p.input, nil
}
func (p *scripted) Answer(_ context.Context, r Request) (Reply, error) {
	p.answers.Add(1)
	p.seen = append(p.seen, r)
	if p.during != nil {
		p.during()
	}
	return p.reply(r)
}

// used reports input and output tokens with a full breakdown, as OpenAI does.
func used(input, cached, output, reasoning int64) func(Request) (Reply, error) {
	return func(Request) (Reply, error) {
		total := input + output
		return Reply{Text: "ok", Tokens: &total, Usage: &Usage{Input: input, CachedInput: cached, Output: output, Reasoning: reasoning, Model: luna.Model + "-2026-10-01", Tier: luna.Tier, RequestID: "resp_1"}}, nil
	}
}

func fixed(n int64) Allowance {
	return func(context.Context, store.Q, string) (int64, error) { return n, nil }
}

func reserveDB(t *testing.T) (*store.Store, *pgxpool.Pool, store.Workspace) {
	t.Helper()
	db, raw := storetest.New(t)
	ws := store.Workspace{ID: "ws_reserve", Name: "Reserve", Timezone: "Europe/Zurich"}
	if err := db.CreateWorkspace(context.Background(), ws, ws.Timezone, time.Now()); err != nil {
		t.Fatal(err)
	}
	return db, raw, ws
}

func usageOf(t *testing.T, db *store.Store, ws store.Workspace, period string) store.HeidiUsage {
	t.Helper()
	u, err := db.HeidiUsage(context.Background(), ws.ID, period)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func statuses(t *testing.T, raw *pgxpool.Pool) []string {
	t.Helper()
	rows, err := raw.Query(context.Background(), `SELECT status FROM ai_calls ORDER BY created_at, id`)
	if err != nil {
		t.Fatal(err)
	}
	out := []string{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

var nov = time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC)

func TestRateCardFundsTheSoldPools(t *testing.T) {
	plans := []struct {
		name          string
		tokens, micro int64
	}{{"basic", 250_000, 200_000}, {"pro", 5_000_000, 3_000_000}, {"business", 20_000_000, 12_000_000}}
	for _, p := range plans {
		for _, seats := range []int64{1, 2, 5, 10, 100} {
			if err := luna.Funds(p.tokens*seats, p.micro*seats); err != nil {
				t.Errorf("%s × %d: %v", p.name, seats, err)
			}
		}
	}
	// All output at Luna Standard + 10% regional: USD 0.1375 / 2.75 / 11.
	for tokens, want := range map[int64]int64{250_000: 137_500, 5_000_000: 2_750_000, 20_000_000: 11_000_000} {
		if got := luna.WorstCost(tokens); got != want {
			t.Errorf("WorstCost(%d) = %d, want %d", tokens, got, want)
		}
	}
	for _, model := range []string{"gpt-6.1-sol", "gpt-6-astra"} {
		if err := Cards[model].Funds(5_000_000, 3_000_000); !errors.Is(err, ErrUnfunded) {
			t.Errorf("%s funds Pro's pool: %v, want ErrUnfunded (a dearer model must not silently shrink it)", model, err)
		}
	}
}

func TestPriceCountsCacheAndReasoningOnce(t *testing.T) {
	ok := Usage{Input: 1000, CachedInput: 400, Output: 500, Reasoning: 300, Model: "gpt-6-luna", Tier: "default"}
	// 600 uncached × 0.11 + 400 cached × 0.011 + 500 output (reasoning inside) × 0.55, per million, rounded up.
	if cost, priced := luna.price(&ok, 1500); !priced || cost != 346 {
		t.Fatalf("price = %d %v, want 346 true", cost, priced)
	}
	for name, u := range map[string]Usage{
		"total without reasoning twice": {Input: 1000, Output: 500, Reasoning: 300, Model: "gpt-6-luna", Tier: "default"},
		"cached above input":            {Input: 100, CachedInput: 200, Output: 1400, Model: "gpt-6-luna", Tier: "default"},
		"another model":                 {Input: 1000, Output: 500, Model: "gpt-6-luna-pro", Tier: "default"},
		"another tier":                  {Input: 1000, Output: 500, Model: "gpt-6-luna", Tier: "priority"},
		"no model":                      {Input: 1000, Output: 500, Tier: "default"},
	} {
		total := int64(1500)
		if name == "total without reasoning twice" {
			total = 1800
		}
		if _, priced := luna.price(&u, total); priced {
			t.Errorf("%s: priced, want left to reconcile", name)
		}
	}
	if _, priced := luna.price(nil, 10); priced {
		t.Error("a total without breakdown was priced")
	}
}

func TestReservesBothThenSettlesActualAndReleasesTheRest(t *testing.T) {
	db, raw, ws := reserveDB(t)
	p := &scripted{input: 100, reply: used(100, 40, 20, 5)}
	b := Budget{DB: db, Now: func() time.Time { return nov }, Allowance: fixed(10_000), CostAllowance: fixed(1_000_000)}
	p.during = func() {
		u := usageOf(t, db, ws, "2026-11")
		if u.TokensReserved != 1100 || u.CostReserved != luna.Cost(100, 0, 1000) || u.TokensUsed != 0 {
			t.Errorf("during the call usage = %+v, want 1100 tokens and their worst cost reserved", u)
		}
	}
	call := testCall
	call.MaxOutput = 1000
	if _, err := b.Generate(context.Background(), p, ws, Request{Message: "hi"}, call); err != nil {
		t.Fatal(err)
	}
	if p.seen[0].MaxOutputTokens != 1000 {
		t.Fatalf("max output = %d, want 1000", p.seen[0].MaxOutputTokens)
	}
	u := usageOf(t, db, ws, "2026-11")
	want := store.HeidiUsage{TokensUsed: 120, CostMicros: luna.Cost(60, 40, 20)}
	if u != want {
		t.Fatalf("usage = %+v, want %+v (actual settled, the rest released)", u, want)
	}
	var input, cached, output, reasoning, cost int64
	var model string
	if err := raw.QueryRow(context.Background(), `SELECT input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,cost_micros,reported_model FROM ai_calls`).Scan(&input, &cached, &output, &reasoning, &cost, &model); err != nil {
		t.Fatal(err)
	}
	if input != 100 || cached != 40 || output != 20 || reasoning != 5 || cost != want.CostMicros || model != "gpt-6-luna-2026-10-01" {
		t.Fatalf("breakdown %d %d %d %d %d %s", input, cached, output, reasoning, cost, model)
	}
}

func TestUnknownOutcomeKeepsBothReservationsAndIsNotRetried(t *testing.T) {
	db, raw, ws := reserveDB(t)
	p := &scripted{input: 100, reply: func(Request) (Reply, error) { return Reply{}, context.DeadlineExceeded }}
	b := Budget{DB: db, Now: func() time.Time { return nov }, CostAllowance: fixed(1_000_000)}
	if _, err := b.Generate(context.Background(), p, ws, Request{}, testCall); !errors.Is(err, ErrUnaccounted) {
		t.Fatalf("err = %v, want ErrUnaccounted", err)
	}
	u := usageOf(t, db, ws, "2026-11")
	if !u.Uncertain || u.TokensReserved != 200 || u.CostReserved != luna.Cost(100, 0, 100) || u.TokensUsed != 0 {
		t.Fatalf("usage = %+v, want both reservations kept and the month uncertain", u)
	}
	call := testCall
	call.Operation = "another"
	if _, err := b.Generate(context.Background(), p, ws, Request{}, call); !errors.Is(err, ErrUncertain) || p.answers.Load() != 1 {
		t.Fatalf("next call: %v after %d answers, want ErrUncertain without asking again", err, p.answers.Load())
	}
	if s := statuses(t, raw); len(s) != 1 || s[0] != "uncertain" {
		t.Fatalf("calls = %v", s)
	}
}

func TestTotalWithoutBreakdownSettlesTokensAndKeepsTheCostPending(t *testing.T) {
	db, raw, ws := reserveDB(t)
	total := int64(130)
	p := &scripted{input: 100, reply: func(Request) (Reply, error) { return Reply{Text: "ok", Tokens: &total}, nil }}
	b := Budget{DB: db, Now: func() time.Time { return nov }}
	if _, err := b.Generate(context.Background(), p, ws, Request{}, testCall); err != nil {
		t.Fatal(err)
	}
	u := usageOf(t, db, ws, "2026-11")
	if u.TokensUsed != 130 || u.TokensReserved != 0 || u.CostMicros != 0 || u.CostReserved != luna.Cost(100, 0, 100) || u.Uncertain {
		t.Fatalf("usage = %+v, want tokens settled and the cost kept reserved, never zero", u)
	}
	if s := statuses(t, raw); s[0] != "cost_pending" {
		t.Fatalf("calls = %v", s)
	}
	call := testCall
	call.Step = "again"
	if _, err := b.Generate(context.Background(), p, ws, Request{}, call); err != nil {
		t.Fatalf("a pending cost blocks nothing: %v", err)
	}
}

// Two calls for the last of the cost budget on separate connections: one reserves it, the other is refused before
// reaching the provider, and afterwards nothing is left.
func TestConcurrentCallsForTheLastBudgetOneWins(t *testing.T) {
	_, raw, ws := reserveDB(t)
	u, err := url.Parse(raw.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("pool_max_conns", "6")
	u.RawQuery = q.Encode()
	wide, err := store.Open(context.Background(), u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer wide.Close()
	release := make(chan struct{})
	p := &scripted{input: 100, reply: used(100, 0, 100, 0), during: func() { <-release }}
	last := luna.Cost(100, 0, 100)
	b := Budget{DB: wide, Now: func() time.Time { return nov }, CostAllowance: fixed(last)}
	errs := make(chan error, 2)
	for i := range 2 {
		go func() {
			call := testCall
			call.Operation = string(rune('a' + i))
			_, err := b.Generate(context.Background(), p, ws, Request{}, call)
			errs <- err
		}()
	}
	select {
	case err := <-errs:
		if !errors.Is(err, ErrUncertain) {
			t.Fatalf("the losing call: %v, want ErrUncertain", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("neither call was refused")
	}
	close(release)
	if err := <-errs; err != nil {
		t.Fatal(err)
	}
	if p.answers.Load() != 1 {
		t.Fatalf("%d calls reached the provider", p.answers.Load())
	}
	if _, err := b.Generate(context.Background(), p, ws, Request{}, testCall); !errors.Is(err, ErrQuota) {
		t.Fatalf("after the last unit: %v, want ErrQuota", err)
	}
}

func TestCallSettlesInTheMonthItWasAdmittedIn(t *testing.T) {
	db, _, ws := reserveDB(t)
	now := time.Date(2026, 11, 30, 22, 59, 59, 0, time.UTC) // 23:59:59 in Zurich
	p := &scripted{input: 100, reply: used(100, 0, 50, 0), during: func() { now = now.Add(2 * time.Second) }}
	b := Budget{DB: db, Now: func() time.Time { return now }}
	if _, err := b.Generate(context.Background(), p, ws, Request{}, testCall); err != nil {
		t.Fatal(err)
	}
	if u := usageOf(t, db, ws, "2026-11"); u.TokensUsed != 150 || u.TokensReserved != 0 {
		t.Fatalf("November = %+v, want the call settled there", u)
	}
	if u := usageOf(t, db, ws, "2026-12"); u != (store.HeidiUsage{}) {
		t.Fatalf("December = %+v, want nothing carried over", u)
	}
}

func TestPerCallCaps(t *testing.T) {
	db, _, ws := reserveDB(t)
	b := Budget{DB: db, Now: func() time.Time { return nov }}
	ctx := context.Background()

	big := &scripted{input: MaxInputTokens + 1, reply: used(1, 0, 1, 0)}
	if _, err := b.Generate(ctx, big, ws, Request{}, testCall); !errors.Is(err, ErrCap) || big.answers.Load() != 0 {
		t.Fatalf("input above %d: %v, want ErrCap before any generation", MaxInputTokens, err)
	}

	// An import call on a dear model: 100k input tokens of Astra cost USD 1.10, above the USD 0.05 per call.
	astra := &scripted{card: Cards["gpt-6-astra"], input: 100_000, reply: used(1, 0, 1, 0)}
	importCall := Call{Kind: "import", Operation: "file", Step: "0", Group: "batch", MaxOutput: 16_000, Caps: ImportCaps}
	if _, err := b.Generate(ctx, astra, ws, Request{}, importCall); !errors.Is(err, ErrCap) || astra.answers.Load() != 0 {
		t.Fatalf("astra import call: %v, want ErrCap", err)
	}

	// The output is cut to what the call's cap pays for: 100 µUSD less 11 for the input buys 161 output tokens.
	p := &scripted{input: 100, reply: used(100, 0, 100, 0)}
	call := Call{Kind: "import", Operation: "f1", Step: "0", MaxOutput: 16_000, Caps: Caps{Call: 100}}
	if _, err := b.Generate(ctx, p, ws, Request{}, call); err != nil {
		t.Fatal(err)
	}
	if got := p.seen[0].MaxOutputTokens; got != 161 {
		t.Fatalf("max output = %d, want 161", got)
	}

	// An operation's attempts share its cap: the first used 66 of 100 µUSD, so the next step gets the rest.
	call = Call{Kind: "heidi", Operation: "turn", Step: "classify", MaxOutput: 16_000, Caps: Caps{Operation: 100}}
	if _, err := b.Generate(ctx, p, ws, Request{}, call); err != nil {
		t.Fatal(err)
	}
	call.Step = "answer"
	if _, err := b.Generate(ctx, p, ws, Request{}, call); err != nil {
		t.Fatal(err)
	}
	spent := luna.Cost(100, 0, 100)
	if got, want := p.seen[2].MaxOutputTokens, luna.outputFor(100-spent-luna.Cost(100, 0, 0)); got != want {
		t.Fatalf("second step's max output = %d, want %d", got, want)
	}

	// A batch's files share its cap.
	group := Call{Kind: "import", Operation: "a", Step: "0", Group: "g", MaxOutput: 100, Caps: Caps{Group: spent + 5}}
	if _, err := b.Generate(ctx, p, ws, Request{}, group); err != nil {
		t.Fatal(err)
	}
	group.Operation = "b"
	if _, err := b.Generate(ctx, p, ws, Request{}, group); !errors.Is(err, ErrCap) {
		t.Fatalf("second file over the batch cap: %v, want ErrCap", err)
	}
}

func TestAStepIsTriedAtMostTwice(t *testing.T) {
	db, _, ws := reserveDB(t)
	zero := int64(0)
	p := &scripted{input: 10, reply: func(Request) (Reply, error) {
		return Reply{Tokens: &zero, Usage: &Usage{Model: luna.Model, Tier: luna.Tier}}, errors.New("HTTP 400")
	}}
	b := Budget{DB: db, Now: func() time.Time { return nov }}
	for range 2 {
		if _, err := b.Generate(context.Background(), p, ws, Request{}, testCall); !errors.Is(err, ErrProvider) {
			t.Fatalf("err = %v, want ErrProvider", err)
		}
	}
	if _, err := b.Generate(context.Background(), p, ws, Request{}, testCall); !errors.Is(err, ErrAttempts) || p.answers.Load() != 2 {
		t.Fatalf("third try: %v after %d answers, want ErrAttempts", err, p.answers.Load())
	}
	if u := usageOf(t, db, ws, "2026-11"); u != (store.HeidiUsage{}) {
		t.Fatalf("usage = %+v, want refusals released in full", u)
	}
}

func TestAReservationLeftByADeadProcessBecomesUncertain(t *testing.T) {
	db, raw, ws := reserveDB(t)
	ok, err := db.InsertAICall(context.Background(), store.AICall{ID: "aic_dead", WorkspaceID: ws.ID, Period: "2026-11", Kind: "import",
		Operation: "f", Step: "0", RateCard: luna.Version, Model: luna.Model, Tier: luna.Tier, Region: luna.Region,
		ReservedTokens: 10, ReservedMicros: 5, CreatedAt: nov.Add(-staleAfter - time.Second)})
	if err != nil || !ok {
		t.Fatal(ok, err)
	}
	p := &scripted{input: 10, reply: used(10, 0, 1, 0)}
	b := Budget{DB: db, Now: func() time.Time { return nov }}
	if _, err := b.Generate(context.Background(), p, ws, Request{}, testCall); !errors.Is(err, ErrUncertain) || p.counts.Load() != 0 {
		t.Fatalf("err = %v, want ErrUncertain without contacting the provider", err)
	}
	if s := statuses(t, raw); s[0] != "uncertain" || !usageOf(t, db, ws, "2026-11").Uncertain {
		t.Fatalf("calls = %v, want the dead call uncertain and its month blocked", s)
	}
}

func TestACardThatCannotFundThePoolStopsNewCalls(t *testing.T) {
	db, _, ws := reserveDB(t)
	p := &scripted{card: Cards["gpt-6-astra"], input: 10, reply: used(10, 0, 1, 0)}
	b := Budget{DB: db, Now: func() time.Time { return nov }, Allowance: fixed(5_000_000), CostAllowance: fixed(3_000_000)}
	if _, err := b.Generate(context.Background(), p, ws, Request{}, testCall); !errors.Is(err, ErrUnfunded) || p.counts.Load() != 0 {
		t.Fatalf("err = %v, want ErrUnfunded before anything is sent", err)
	}
	// Without a cost budget (billing off, or none provided yet) the token allowance alone applies, as before.
	b.CostAllowance = nil
	if _, err := b.Generate(context.Background(), p, ws, Request{}, testCall); err != nil {
		t.Fatal(err)
	}
}

func TestFakeIsPricedAndSettled(t *testing.T) {
	db, raw, ws := reserveDB(t)
	b := Budget{DB: db, Now: func() time.Time { return nov }, Allowance: fixed(250_000), CostAllowance: fixed(200_000)}
	if _, err := b.Generate(context.Background(), Fake{}, ws, Request{Message: "hello"}, testCall); err != nil {
		t.Fatal(err)
	}
	if u := usageOf(t, db, ws, "2026-11"); u.CostMicros == 0 || u.CostReserved != 0 || u.TokensReserved != 0 {
		t.Fatalf("usage = %+v, want the fake's cost settled", u)
	}
	if s := statuses(t, raw); s[0] != "settled" {
		t.Fatalf("calls = %v", s)
	}
}
