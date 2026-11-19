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
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/store"
)

// The fault-injection suite: one workspace's pool against a fake OpenAI that fails in every way the real one can,
// on the real database. After every scenario the same invariants hold (assertInvariants, assertAdmitted): no pool
// stays blocked once the fault is gone, what is recorded is never less than what the provider billed, at most one
// call is in flight per workspace and pool, and the month's counters agree with its calls.

// clock is the budget's Now, moved by the test and by the fake provider while it answers.
type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *clock) add(d time.Duration) { c.mu.Lock(); defer c.mu.Unlock(); c.now = c.now.Add(d) }
func (c *clock) set(t time.Time)     { c.mu.Lock(); defer c.mu.Unlock(); c.now = t }
func newClock(t time.Time) *clock    { return &clock{now: t} }

// nextOperation names each admission check's call apart.
var nextOperation atomic.Int32

// Modes of one answer of the fake provider.
const (
	modeOK          = "ok"           // completed, full usage breakdown
	modeNoUsage     = "no_usage"     // completed, no usage block
	modeTotalOnly   = "total_only"   // completed, total without a breakdown
	modeOtherTier   = "other_tier"   // completed, priced at a tier the card does not price
	modeIncomplete  = "incomplete"   // status incomplete at max_output_tokens, usage known
	modeRejected    = "rejected"     // 400 with an error object
	modeConfig      = "config"       // 401
	modeQuota       = "quota"        // 429 insufficient_quota: the provider account, not busy
	modeRateLimited = "rate_limited" // 429
	modeOverloaded  = "overloaded"   // 503 model overloaded
	modeServer      = "server"       // 500 with an error object
	modeBadGateway  = "bad_gateway"  // 502 without a body
	modeHang        = "hang"         // never answers within the call's deadline
	modeDropBody    = "drop_body"    // 200, then the connection drops mid-body
	modeDropConn    = "drop_conn"    // the connection drops before any response
	modeSlow        = "slow"         // completes after a pause
)

const (
	faultInput  = 100 // what the fake counts every input as
	faultOutput = 20  // what a completed answer generates
)

// fakeOpenAI answers the Responses API in the given modes (the last repeats) and keeps what it would bill: a call that
// reached generation is billed its input and output, one whose outcome the client cannot know as much as it allowed
// (max_output_tokens), a refusal nothing.
type fakeOpenAI struct {
	t      *testing.T
	server *httptest.Server
	mu     sync.Mutex
	modes  []string
	n      int
	billed map[string][2]int64 // model -> input, output tokens billed
	during func()              // runs while an answer is being generated
	active atomic.Int32
	most   atomic.Int32
}

func newFakeOpenAI(t *testing.T, modes ...string) *fakeOpenAI {
	f := &fakeOpenAI{t: t, modes: modes, billed: map[string][2]int64{}}
	f.server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeOpenAI) bill(model string, input, output int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b := f.billed[model]
	f.billed[model] = [2]int64{b[0] + input, b[1] + output}
}

func (f *fakeOpenAI) serve(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/input_tokens") {
		_, _ = fmt.Fprintf(w, `{"object":"response.input_tokens","input_tokens":%d}`, faultInput)
		return
	}
	if n := f.active.Add(1); n > f.most.Load() {
		f.most.Store(n)
	}
	defer f.active.Add(-1)
	var in struct {
		Model           string `json:"model"`
		MaxOutputTokens int64  `json:"max_output_tokens"`
	}
	b, _ := io.ReadAll(r.Body)
	_ = json.Unmarshal(b, &in)
	f.mu.Lock()
	mode := f.modes[min(f.n, len(f.modes)-1)]
	f.n++
	during := f.during
	f.mu.Unlock()
	if during != nil {
		during()
	}
	completed := func(status, tier, usage string, output int64) {
		f.bill(in.Model, faultInput, output)
		_, _ = fmt.Fprintf(w, `{"id":"resp_f","model":%q,"service_tier":%q,"status":%q,"incomplete_details":{"reason":"max_output_tokens"},
			"output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]%s}`, in.Model, tier, status, usage)
	}
	breakdown := func(output int64) string {
		return fmt.Sprintf(`,"usage":{"input_tokens":%d,"output_tokens":%d,"total_tokens":%d,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}}`,
			faultInput, output, faultInput+output)
	}
	refuse := func(status int, body string) {
		w.WriteHeader(status)
		_, _ = fmt.Fprint(w, body)
	}
	switch mode {
	case modeOK:
		completed("completed", "default", breakdown(faultOutput), faultOutput)
	case modeSlow:
		time.Sleep(30 * time.Millisecond)
		completed("completed", "default", breakdown(faultOutput), faultOutput)
	case modeNoUsage:
		completed("completed", "default", "", faultOutput)
	case modeTotalOnly:
		completed("completed", "default", fmt.Sprintf(`,"usage":{"total_tokens":%d}`, faultInput+faultOutput), faultOutput)
	case modeOtherTier:
		completed("completed", "priority", breakdown(faultOutput), faultOutput)
	case modeIncomplete:
		completed("incomplete", "default", breakdown(in.MaxOutputTokens), in.MaxOutputTokens)
	case modeRejected:
		refuse(http.StatusBadRequest, `{"error":{"type":"invalid_request_error","code":"invalid_value","message":"bad input"}}`)
	case modeConfig:
		refuse(http.StatusUnauthorized, `{"error":{"type":"invalid_request_error","code":"invalid_api_key","message":"wrong key"}}`)
	case modeQuota:
		refuse(http.StatusTooManyRequests, `{"error":{"type":"insufficient_quota","code":"insufficient_quota","message":"no credit"}}`)
	case modeRateLimited:
		refuse(http.StatusTooManyRequests, `{"error":{"type":"requests","code":"rate_limit_exceeded","message":"slow down"}}`)
	case modeOverloaded:
		refuse(http.StatusServiceUnavailable, overloaded)
	case modeServer:
		f.bill(in.Model, faultInput, in.MaxOutputTokens) // it may have generated before failing
		refuse(http.StatusInternalServerError, `{"error":{"type":"server_error","code":"server_error","message":"oops"}}`)
	case modeBadGateway:
		f.bill(in.Model, faultInput, in.MaxOutputTokens)
		w.WriteHeader(http.StatusBadGateway)
	case modeHang:
		f.bill(in.Model, faultInput, in.MaxOutputTokens)
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	case modeDropBody:
		f.bill(in.Model, faultInput, in.MaxOutputTokens)
		w.Header().Set("Content-Length", "1000")
		_, _ = fmt.Fprint(w, `{"status":"compl`)
	case modeDropConn:
		f.bill(in.Model, faultInput, in.MaxOutputTokens)
		conn, _, err := http.NewResponseController(w).Hijack()
		if err != nil {
			f.t.Error(err)
			return
		}
		_ = conn.Close()
	default:
		f.t.Errorf("unknown mode %q", mode)
	}
}

func (f *fakeOpenAI) provider(fallback string) *openAI {
	return overloadProvider(f.server.URL, fallback)
}

// faultDB is a workspace on its own database, with a budget on a moving clock and allowances far above the scenarios.
func faultDB(t *testing.T, start time.Time) (*store.Store, *pgxpool.Pool, store.Workspace, *clock, Budget) {
	noRetryDelay(t)
	db, raw, ws := reserveDB(t)
	c := newClock(start)
	return db, raw, ws, c, Budget{DB: db, Pool: PoolAutomation, Now: c.Now, Allowance: fixed(1_000_000), CostAllowance: fixed(1_000_000)}
}

var faultCall = Call{Kind: "import", Operation: "file", Step: "0", MaxOutput: 100, Caps: ImportCaps, Timeout: 2 * time.Second}

// assertInvariants checks what must hold after any scenario.
func assertInvariants(t *testing.T, raw *pgxpool.Pool, ws store.Workspace, f *fakeOpenAI) {
	t.Helper()
	ctx := context.Background()
	// At most one call in flight per workspace and pool.
	var most int
	if err := raw.QueryRow(ctx, `SELECT coalesce(max(n),0) FROM (SELECT count(*) n FROM ai_calls WHERE workspace_id=$1 AND status='reserved' GROUP BY pool) x`, ws.ID).Scan(&most); err != nil {
		t.Fatal(err)
	}
	if most > 1 {
		t.Fatalf("%d calls reserved at once; want at most one per pool", most)
	}
	if f != nil && f.most.Load() > 1 {
		t.Fatalf("%d calls answered at once; want at most one per pool", f.most.Load())
	}
	// Each month's counters are the sum of its calls: settled ones used, reserved ones held, nothing else.
	rows, err := raw.Query(ctx, `SELECT h.pool, h.period, h.tokens_used, h.tokens_reserved, h.cost_micros, h.cost_reserved_micros,
			coalesce(sum(c.total_tokens) FILTER (WHERE c.status IN ('settled','cost_pending')),0)::bigint,
			coalesce(sum(c.reserved_tokens) FILTER (WHERE c.status='reserved'),0)::bigint,
			coalesce(sum(c.cost_micros) FILTER (WHERE c.status IN ('settled','cost_pending')),0)::bigint,
			coalesce(sum(c.reserved_micros) FILTER (WHERE c.status='reserved'),0)::bigint,
			bool_or(h.uncertain), count(c.id) FILTER (WHERE c.status NOT IN ('reserved','settled','cost_pending'))
		FROM heidi_usage h LEFT JOIN ai_calls c ON c.workspace_id=h.workspace_id AND c.pool=h.pool AND c.period=h.period
		WHERE h.workspace_id=$1 GROUP BY 1,2,3,4,5,6`, ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var pool, period string
		var used, reserved, cost, costReserved, sumUsed, sumReserved, sumCost, sumCostReserved, other int64
		var uncertain bool
		if err := rows.Scan(&pool, &period, &used, &reserved, &cost, &costReserved, &sumUsed, &sumReserved, &sumCost, &sumCostReserved, &uncertain, &other); err != nil {
			t.Fatal(err)
		}
		if used != sumUsed || reserved != sumReserved || cost != sumCost || costReserved != sumCostReserved || uncertain || other != 0 {
			t.Fatalf("%s %s: month %d/%d tokens %d/%d micros uncertain=%v, its calls %d/%d tokens %d/%d micros, %d of another status",
				pool, period, used, reserved, cost, costReserved, uncertain, sumUsed, sumReserved, sumCost, sumCostReserved, other)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	// AI usage is counted in heidi_usage only, never also as a plan resource.
	var events int
	if err := raw.QueryRow(ctx, `SELECT count(*) FROM usage_events WHERE workspace_id=$1`, ws.ID).Scan(&events); err != nil || events != 0 {
		t.Fatalf("usage_events = %d, %v; want none for model calls", events, err)
	}
	if f == nil {
		return
	}
	// Never under: what the calls recorded, settled or still held, covers what the provider billed, per model.
	f.mu.Lock()
	billed := f.billed
	f.mu.Unlock()
	for model, b := range billed {
		var tokens, micros int64
		if err := raw.QueryRow(ctx, `SELECT coalesce(sum(coalesce(total_tokens,reserved_tokens)),0)::bigint, coalesce(sum(coalesce(cost_micros,reserved_micros)),0)::bigint
			FROM ai_calls WHERE workspace_id=$1 AND model=$2`, ws.ID, model).Scan(&tokens, &micros); err != nil {
			t.Fatal(err)
		}
		if want := Cards[model].Cost(b[0], 0, b[1]); tokens < b[0]+b[1] || micros < want {
			t.Fatalf("%s: recorded %d tokens %d micros, the provider billed %d tokens %d micros", model, tokens, micros, b[0]+b[1], want)
		}
	}
}

// assertAdmitted: once the fault is gone, the pool's next call is admitted at once, or (after a call a dead process
// left reserved) within the stale window.
func assertAdmitted(t *testing.T, b Budget, c *clock, ws store.Workspace, f *fakeOpenAI, afterStale bool) {
	t.Helper()
	f.mu.Lock()
	f.modes, f.n, f.during = []string{modeOK}, 0, nil
	f.mu.Unlock()
	call := faultCall
	call.Operation = fmt.Sprintf("next-%d", nextOperation.Add(1))
	_, err := b.Generate(context.Background(), f.provider(""), ws, Request{Message: "next"}, call)
	if afterStale && errors.Is(err, ErrUncertain) {
		c.add(staleAfter)
		call.Operation += "-later"
		_, err = b.Generate(context.Background(), f.provider(""), ws, Request{Message: "next"}, call)
	}
	if err != nil {
		t.Fatalf("the next call was refused once the fault was gone: %v", err)
	}
}

func TestFaultsNeverBlockThePool(t *testing.T) {
	for _, tc := range []struct {
		name  string
		modes []string
		want  []error // what the first call's error must wrap; nil = none
	}{
		{"completed", []string{modeOK}, nil},
		{"no usage", []string{modeNoUsage}, []error{ErrProvider, ErrUnaccounted}},
		{"total without breakdown", []string{modeTotalOnly}, nil},
		{"another tier", []string{modeOtherTier}, nil},
		{"incomplete", []string{modeIncomplete}, []error{ErrProvider}},
		{"rejected 400", []string{modeRejected}, []error{ErrProvider}},
		{"wrong key 401", []string{modeConfig}, []error{ErrProvider}},
		{"no credit 429", []string{modeQuota}, []error{ErrProvider}},
		{"rate limited, then answered", []string{modeRateLimited, modeOK}, nil},
		{"rate limited throughout", []string{modeRateLimited}, []error{ErrProvider}},
		{"overloaded, then answered", []string{modeOverloaded, modeOverloaded, modeOK}, nil},
		{"server error 500", []string{modeServer}, []error{ErrProvider, ErrUnaccounted}},
		{"bad gateway 502", []string{modeBadGateway}, []error{ErrProvider, ErrUnaccounted}},
		{"hangs past the deadline", []string{modeHang}, []error{ErrProvider, ErrUnaccounted}},
		{"drops mid-body", []string{modeDropBody}, []error{ErrProvider, ErrUnaccounted}},
		{"drops the connection", []string{modeDropConn}, []error{ErrProvider, ErrUnaccounted}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, raw, ws, c, b := faultDB(t, nov)
			f := newFakeOpenAI(t, tc.modes...)
			call := faultCall
			if tc.modes[0] == modeHang {
				call.Timeout = 300 * time.Millisecond
			}
			_, err := b.Generate(context.Background(), f.provider(""), ws, Request{Message: "read"}, call)
			for _, want := range tc.want {
				if !errors.Is(err, want) {
					t.Fatalf("err = %v, want %v", err, want)
				}
			}
			if tc.want == nil && err != nil {
				t.Fatalf("err = %v", err)
			}
			assertInvariants(t, raw, ws, f)
			assertAdmitted(t, b, c, ws, f, false)
			assertInvariants(t, raw, ws, f)
		})
	}
}

// The caller leaves while its answer is generated: the answer is still settled at its real usage.
func TestFaultCallerLeavesMidAnswer(t *testing.T) {
	_, raw, ws, c, b := faultDB(t, nov)
	f := newFakeOpenAI(t, modeOK)
	ctx, cancel := context.WithCancel(context.Background())
	f.during = func() { cancel(); time.Sleep(20 * time.Millisecond) }
	_, err := b.Generate(ctx, f.provider(""), ws, Request{Message: "read"}, faultCall)
	if err != nil {
		t.Fatalf("a started answer is kept: %v", err)
	}
	if rows := callRows(t, raw, ws); len(rows) != 1 || rows[0].Status != "settled" || rows[0].Total != faultInput+faultOutput {
		t.Fatalf("calls = %+v, want the real usage settled", rows)
	}
	assertInvariants(t, raw, ws, f)
	assertAdmitted(t, b, c, ws, f, false)
}

// Concurrent callers of one workspace and pool: one asks the provider at a time, the others are told to wait; none
// is left reserved and the month adds up.
func TestFaultConcurrentCallers(t *testing.T) {
	_, raw, ws, c, b := faultDB(t, nov)
	f := newFakeOpenAI(t, modeSlow)
	var wg sync.WaitGroup
	var answered, busy atomic.Int32
	for i := range 8 {
		wg.Go(func() {
			call := faultCall
			call.Operation = fmt.Sprintf("op-%d", i)
			_, err := b.Generate(context.Background(), f.provider(""), ws, Request{Message: "read"}, call)
			switch {
			case err == nil:
				answered.Add(1)
			case errors.Is(err, ErrUncertain):
				busy.Add(1)
			default:
				t.Errorf("call %d: %v", i, err)
			}
		})
	}
	wg.Wait()
	if answered.Load() == 0 || answered.Load()+busy.Load() != 8 {
		t.Fatalf("answered %d, busy %d", answered.Load(), busy.Load())
	}
	assertInvariants(t, raw, ws, f)
	assertAdmitted(t, b, c, ws, f, false)
}

// abandon leaves a reserved call as a process that died after admission would: the month holds its reservation.
func abandon(t *testing.T, db *store.Store, ws store.Workspace, at time.Time) {
	t.Helper()
	ctx := context.Background()
	err := db.Tx(ctx, func(q store.Q) error {
		u, err := q.LockHeidiUsage(ctx, ws.ID, PoolAutomation, store.UsagePeriod(at), at)
		if err != nil {
			return err
		}
		c := store.AICall{ID: "aic_dead_" + ws.ID, WorkspaceID: ws.ID, Period: store.UsagePeriod(at), Pool: PoolAutomation, Kind: "import",
			Operation: "dead", Step: "0", RateCard: luna.Version, Model: luna.Model, Tier: luna.Tier, Region: luna.Region,
			ReservedTokens: faultInput + 100, ReservedMicros: luna.Cost(faultInput, 0, 100), CreatedAt: at}
		if ok, err := q.InsertAICall(ctx, c); err != nil || !ok {
			return errors.Join(err, errors.New("not inserted"))
		}
		u.TokensReserved += c.ReservedTokens
		u.CostReserved += c.ReservedMicros
		return q.SaveHeidiUsage(ctx, ws.ID, PoolAutomation, store.UsagePeriod(at), u, at)
	})
	if err != nil {
		t.Fatal(err)
	}
}

// A process that died mid-call (crash, deploy, panic) leaves its call reserved: the pool waits at most the stale
// window, by the next call or by the sweep alone, and the call is charged its whole reservation.
func TestFaultDeadProcess(t *testing.T) {
	for _, tc := range []struct {
		name  string
		sweep bool
	}{{"next call expires it", false}, {"sweep expires it", true}} {
		t.Run(tc.name, func(t *testing.T) {
			db, raw, ws, c, b := faultDB(t, nov)
			f := newFakeOpenAI(t, modeOK)
			abandon(t, db, ws, c.Now())
			if _, err := b.Generate(context.Background(), f.provider(""), ws, Request{}, faultCall); !errors.Is(err, ErrUncertain) {
				t.Fatalf("err = %v, want the pool busy while the call may still run", err)
			}
			assertInvariants(t, raw, ws, f)
			c.add(staleAfter)
			if tc.sweep {
				if err := ExpireStale(context.Background(), db, c.Now()); err != nil {
					t.Fatal(err)
				}
				if rows := callRows(t, raw, ws); rows[0].Status != "settled" || rows[0].Failure != "unknown_usage:stale" {
					t.Fatalf("calls = %+v", rows)
				}
			}
			assertAdmitted(t, b, c, ws, f, false)
			assertInvariants(t, raw, ws, f)
			if u := automationUsage(t, db, ws); u.TokensUsed != faultInput+100+faultInput+faultOutput || u.TokensReserved != 0 {
				t.Fatalf("usage = %+v, want the dead call's whole reservation and the next call's use", u)
			}
		})
	}
}

// panicking stands for a provider (or anything between admission and settlement) that panics.
type panicking struct{ scripted }

func (*panicking) Answer(context.Context, Request) (Reply, error) { panic("provider bug") }

func TestFaultPanicMidCall(t *testing.T) {
	_, raw, ws, c, b := faultDB(t, nov)
	func() {
		defer func() { _ = recover() }()
		_, _ = b.Generate(context.Background(), &panicking{scripted{input: faultInput}}, ws, Request{}, faultCall)
	}()
	assertInvariants(t, raw, ws, nil)
	assertAdmitted(t, b, c, ws, newFakeOpenAI(t, modeOK), true)
	assertInvariants(t, raw, ws, nil)
}

// A sweep (on another instance, with its clock ahead) takes a slow live call for stale and charges its reservation:
// the call's own settlement then keeps that charge and still returns the answer.
func TestFaultSweepTakesALiveCallForStale(t *testing.T) {
	db, raw, ws, c, b := faultDB(t, nov)
	f := newFakeOpenAI(t, modeOK)
	f.during = func() {
		if err := ExpireStale(context.Background(), db, c.Now().Add(staleAfter+time.Second)); err != nil {
			t.Error(err)
		}
	}
	reply, err := b.Generate(context.Background(), f.provider(""), ws, Request{}, faultCall)
	if err != nil || reply.Text != "ok" {
		t.Fatalf("reply = %+v, %v; want the answer kept", reply, err)
	}
	if rows := callRows(t, raw, ws); rows[0].Failure != "unknown_usage:stale" || rows[0].Total < faultInput+faultOutput {
		t.Fatalf("calls = %+v", rows)
	}
	assertInvariants(t, raw, ws, f)
	assertAdmitted(t, b, c, ws, f, false)
}

// A call admitted on the last second of a month and settled in the next is counted in the month it was admitted in;
// the new month starts from its own calls. A dead call of the old month frees the new month's pool too.
func TestFaultMonthRollover(t *testing.T) {
	last := time.Date(2026, 11, 30, 23, 59, 59, 0, time.UTC)
	t.Run("settled after midnight", func(t *testing.T) {
		db, raw, ws, c, b := faultDB(t, last)
		f := newFakeOpenAI(t, modeOK)
		f.during = func() { c.add(2 * time.Second) }
		if _, err := b.Generate(context.Background(), f.provider(""), ws, Request{}, faultCall); err != nil {
			t.Fatal(err)
		}
		assertAdmitted(t, b, c, ws, f, false)
		assertInvariants(t, raw, ws, f)
		dec, err := db.HeidiUsage(context.Background(), ws.ID, PoolAutomation, "2026-12")
		if err != nil {
			t.Fatal(err)
		}
		if u := automationUsage(t, db, ws); u.TokensUsed != faultInput+faultOutput || dec.TokensUsed != faultInput+faultOutput {
			t.Fatalf("november %+v, december %+v; want one call in each", u, dec)
		}
	})
	t.Run("dead in the old month", func(t *testing.T) {
		db, raw, ws, c, b := faultDB(t, last)
		abandon(t, db, ws, c.Now())
		c.set(last.Add(time.Minute))
		f := newFakeOpenAI(t, modeOK)
		assertAdmitted(t, b, c, ws, f, true)
		assertInvariants(t, raw, ws, f)
		if u := automationUsage(t, db, ws); u.TokensUsed != faultInput+100 || u.TokensReserved != 0 {
			t.Fatalf("november = %+v, want the dead call charged there", u)
		}
	})
}

// An overloaded model handed to the fallback: each call is reserved and priced at its own model's card.
func TestFaultFallbackPricedAtItsCard(t *testing.T) {
	_, raw, ws, c, b := faultDB(t, nov)
	f := newFakeOpenAI(t, modeOverloaded, modeOverloaded, modeOverloaded, modeOverloaded, modeOK)
	if _, err := b.Generate(context.Background(), f.provider("gpt-6.1-sol"), ws, Request{}, faultCall); err != nil {
		t.Fatal(err)
	}
	var got callRow
	for _, r := range callRows(t, raw, ws) {
		if r.Model != luna.Model {
			got = r
		}
	}
	if got.Model != "gpt-6.1-sol" || got.Cost != Cards["gpt-6.1-sol"].Cost(faultInput, 0, faultOutput) {
		t.Fatalf("fallback call = %+v, want priced at its own card", got)
	}
	assertInvariants(t, raw, ws, f)
	assertAdmitted(t, b, c, ws, f, false)
}

// A batch that spent its group cap is told so (ErrGroupCap), not that the file is too large; a new batch is not.
func TestGroupCapIsTold(t *testing.T) {
	db, _, ws := reserveDB(t)
	p := &scripted{input: 100, reply: used(100, 0, 20, 0)}
	b := Budget{DB: db, Pool: PoolAutomation, Now: func() time.Time { return nov }}
	call := Call{Kind: "import", Operation: "f1", Step: "0", Group: "batch", MaxOutput: 100, Caps: Caps{Group: 30}}
	if _, err := b.Generate(context.Background(), p, ws, Request{}, call); err != nil {
		t.Fatal(err)
	}
	call.Operation = "f2"
	if _, err := b.Generate(context.Background(), p, ws, Request{}, call); !errors.Is(err, ErrGroupCap) || !errors.Is(err, ErrCap) {
		t.Fatalf("err = %v, want ErrGroupCap", err)
	}
	call.Group = "next batch"
	if _, err := b.Generate(context.Background(), p, ws, Request{}, call); err != nil {
		t.Fatalf("a new batch: %v", err)
	}
}

// The stale window outlasts every live call, so a live call is never taken for a dead one on a sound clock.
func TestStaleWindowOutlastsALiveCall(t *testing.T) {
	if staleAfter <= MaxAnswerTimeout+settleTimeout {
		t.Fatalf("staleAfter %v must exceed the longest call %v", staleAfter, MaxAnswerTimeout+settleTimeout)
	}
}

// forgetRefusals starts a test with no pool watched: the watch outlives a test, and every test's clock starts at nov.
func forgetRefusals(t *testing.T) {
	blockedMu.Lock()
	defer blockedMu.Unlock()
	clear(blocked)
}

// watchBudget watches a workspace's Heidi pool on a clock the test sets.
func watchBudget(t *testing.T) (Budget, *clock, store.Workspace, *store.Store) {
	forgetRefusals(t)
	db, _, ws := reserveDB(t)
	c := newClock(nov)
	return Budget{DB: db, Pool: PoolHeidi, Now: c.Now}, c, ws, db
}

func (b Budget) watchAt(c *clock, ws store.Workspace, at time.Duration, err error) {
	c.set(nov.Add(at))
	b.watch(context.Background(), ws.ID, err)
}

// A pool refused for a non-quota reason for blockedAlert with nothing admitted is logged as an error, once per period;
// any other outcome clears it.
func TestABlockedPoolIsReported(t *testing.T) {
	b, c, ws, _ := watchBudget(t)
	log := captureLog(t)
	b.watchAt(c, ws, 0, ErrUncertain)
	b.watchAt(c, ws, time.Minute, ErrQuota) // clears
	b.watchAt(c, ws, 2*time.Minute, ErrUncertain)
	b.watchAt(c, ws, 16*time.Minute, ErrUncertain)
	if strings.Contains(log.String(), "AI pool refusing calls") {
		t.Fatalf("reported before it lasted %v: %s", blockedAlert, log)
	}
	b.watchAt(c, ws, 17*time.Minute, ErrUncertain)
	b.watchAt(c, ws, 20*time.Minute, ErrUncertain)
	if n := strings.Count(log.String(), "AI pool refusing calls"); n != 1 || !strings.Contains(log.String(), "reason=in_flight") {
		t.Fatalf("reported %d times: %s", n, log)
	}
	b.watchAt(c, ws, 21*time.Minute, nil)
	b.watchAt(c, ws, 40*time.Minute, ErrUncertain)
	if n := strings.Count(log.String(), "AI pool refusing calls"); n != 1 {
		t.Fatalf("an answer must clear the watch: %s", log)
	}
}

// With several instances, one may only ever see the pool busy with another's calls: those admissions in ai_calls
// mean the pool works, so nothing is reported and the wait starts again.
func TestAPoolBusyWithAnotherInstanceIsNotReported(t *testing.T) {
	b, c, ws, db := watchBudget(t)
	log := captureLog(t)
	b.watchAt(c, ws, 0, ErrUncertain)
	err := db.Tx(context.Background(), func(q store.Q) error { // the other instance's call, admitted meanwhile
		_, err := q.InsertAICall(context.Background(), store.AICall{ID: "aic_other", WorkspaceID: ws.ID, Period: "2026-11",
			Pool: PoolHeidi, Kind: "heidi", Operation: "o", Step: "answer", RateCard: luna.Version, Model: luna.Model,
			Tier: luna.Tier, Region: luna.Region, CreatedAt: nov.Add(10 * time.Minute)})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	b.watchAt(c, ws, 16*time.Minute, ErrUncertain)
	b.watchAt(c, ws, 20*time.Minute, ErrUncertain) // the new wait starts here
	b.watchAt(c, ws, 34*time.Minute, ErrUncertain)
	if strings.Contains(log.String(), "AI pool refusing calls") {
		t.Fatalf("reported a pool another instance uses: %s", log)
	}
	b.watchAt(c, ws, 35*time.Minute, ErrUncertain)
	if !strings.Contains(log.String(), "AI pool refusing calls") {
		t.Fatalf("a pool stuck since the other instance's call is reported: %s", log)
	}
}

// Pools not refused for watchIdle are forgotten, so the watch never grows with workspaces that stop asking.
func TestIdleWatchesAreForgotten(t *testing.T) {
	b, c, ws, _ := watchBudget(t)
	for i := range 3 {
		c.set(nov)
		b.watch(context.Background(), fmt.Sprintf("%s_%d", ws.ID, i), ErrUncertain)
	}
	b.watchAt(c, ws, watchIdle, ErrUncertain)
	blockedMu.Lock()
	defer blockedMu.Unlock()
	if len(blocked) != 1 || blocked[ws.ID+" "+PoolHeidi] == nil {
		t.Fatalf("watched = %v, want only the pool refused now", blocked)
	}
}

// An unfunded budget refuses every call until an operator acts: Generate reports it once it lasts.
func TestAnUnfundedPoolIsReported(t *testing.T) {
	forgetRefusals(t)
	log := captureLog(t)
	db, _, ws := reserveDB(t)
	c := newClock(nov)
	b := Budget{DB: db, Pool: PoolHeidi, Now: c.Now, Allowance: fixed(1_000_000), CostAllowance: fixed(1)}
	p := &scripted{input: 10, reply: used(10, 0, 1, 0)}
	for range 2 {
		if _, err := b.Generate(context.Background(), p, ws, Request{}, testCall); !errors.Is(err, ErrUnfunded) {
			t.Fatalf("err = %v", err)
		}
		c.add(blockedAlert)
	}
	if !strings.Contains(log.String(), "AI pool refusing calls") || !strings.Contains(log.String(), "reason=unfunded") {
		t.Fatalf("log = %s", log)
	}
}

// failOn makes the database refuse every statement of kind (INSERT, UPDATE) on ai_calls for rows matching when.
func failOn(t *testing.T, raw *pgxpool.Pool, kind, when string) {
	t.Helper()
	_, err := raw.Exec(context.Background(), `CREATE FUNCTION refuse_ai_calls() RETURNS trigger LANGUAGE plpgsql AS
		$$ BEGIN RAISE EXCEPTION 'injected database failure'; END $$;
		CREATE TRIGGER refuse_ai_calls BEFORE `+kind+` ON ai_calls FOR EACH ROW WHEN (`+when+`) EXECUTE FUNCTION refuse_ai_calls()`)
	if err != nil {
		t.Fatal(err)
	}
}

// A database error while reserving is an error, never ErrUncertain: callers wait on ErrUncertain without spending a
// try, so a lasting database failure would keep them waiting forever.
func TestADatabaseErrorIsNotABusyPool(t *testing.T) {
	_, raw, ws, _, b := faultDB(t, nov)
	failOn(t, raw, "INSERT", "true")
	_, err := b.Generate(context.Background(), newFakeOpenAI(t, modeOK).provider(""), ws, Request{}, faultCall)
	if err == nil || errors.Is(err, ErrUncertain) || !strings.Contains(err.Error(), "injected database failure") {
		t.Fatalf("err = %v, want the database error and not ErrUncertain", err)
	}
}

// A stale call the sweep cannot settle is logged and skipped: every other workspace's pool is still freed.
func TestExpireStaleSkipsACallItCannotSettle(t *testing.T) {
	db, raw, ws, c, b := faultDB(t, nov)
	other := store.Workspace{ID: "ws_other", Name: "Other", Timezone: "Europe/Zurich"}
	if err := db.CreateWorkspace(context.Background(), other, other.Timezone, time.Now()); err != nil {
		t.Fatal(err)
	}
	abandon(t, db, ws, nov)
	abandon(t, db, other, nov.Add(time.Second))
	failOn(t, raw, "UPDATE", "OLD.id = 'aic_dead_ws_reserve'")
	c.add(staleAfter + time.Second)
	if err := ExpireStale(context.Background(), db, c.Now()); err == nil || !strings.Contains(err.Error(), "aic_dead_ws_reserve") {
		t.Fatalf("err = %v, want the poisoned call named", err)
	}
	if rows := callRows(t, raw, other); len(rows) != 1 || rows[0].Status != "settled" || rows[0].Failure != "unknown_usage:stale" {
		t.Fatalf("the other workspace's call = %+v, want it settled by the sweep", rows)
	}
	f := newFakeOpenAI(t, modeOK)
	assertAdmitted(t, b, c, other, f, false)
	assertInvariants(t, raw, other, f)
}

// A breakdown the card cannot price is charged by its larger count, the total or input + output, at the highest rate.
func TestAnInconsistentBreakdownIsChargedItsLargerCount(t *testing.T) {
	db, _, ws := reserveDB(t)
	total := int64(50)
	p := &scripted{input: 100, reply: func(Request) (Reply, error) {
		return Reply{Text: "ok", Tokens: &total, Usage: &Usage{Input: 100, Output: 30, Model: luna.Model, Tier: "priority"}}, nil
	}}
	b := Budget{DB: db, Pool: PoolHeidi, Now: func() time.Time { return nov }}
	call := testCall
	call.MaxOutput = 1000
	if _, err := b.Generate(context.Background(), p, ws, Request{}, call); err != nil {
		t.Fatal(err)
	}
	if u := usageOf(t, db, ws, "2026-11"); u.CostMicros != luna.WorstCost(130) || u.CostReserved != 0 {
		t.Fatalf("usage = %+v, want %d micro-USD for 130 tokens", u, luna.WorstCost(130))
	}
}
