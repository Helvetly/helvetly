package admintelegram

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

const adminChat = 100

// fakeTelegram serves getUpdates from updates (once) or with status, and records what the bot sent.
type fakeTelegram struct {
	mu      sync.Mutex
	updates string
	status  int
	polls   int
	offsets []float64
	sent    []map[string]any
}

func (f *fakeTelegram) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	switch {
	case strings.HasSuffix(r.URL.Path, "/getUpdates"):
		f.polls++
		f.offsets = append(f.offsets, body["offset"].(float64))
		if f.status != 0 {
			w.WriteHeader(f.status)
			_, _ = w.Write([]byte(`{"ok":false,"error_code":409}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"result":[` + f.updates + `]}`))
		f.updates = ""
	case strings.HasSuffix(r.URL.Path, "/sendMessage"):
		f.sent = append(f.sent, body)
		_, _ = w.Write([]byte(`{"ok":true,"result":{}}`))
	default:
		_, _ = w.Write([]byte(`{"ok":true,"result":true}`))
	}
}

func testBot(t *testing.T, db *store.Store, tg *fakeTelegram, log *bytes.Buffer) *Bot {
	t.Helper()
	server := httptest.NewServer(tg)
	t.Cleanup(server.Close)
	b := NewBot("1:test", adminChat, db, slog.New(slog.NewTextHandler(log, nil)))
	b.api = server.URL + "/bot/"
	return b
}

func TestBotAnswersOnlyTheAdminChat(t *testing.T) {
	db, _ := storetest.New(t)
	ctx := context.Background()
	tg := &fakeTelegram{updates: `{"update_id":7,"message":{"chat":{"id":999},"text":"/stats secret question"}},
		{"update_id":8,"message":{"chat":{"id":100},"text":"/help"}},
		{"update_id":9,"edited_message":{"chat":{"id":100},"text":"/stats"}}`}
	var log bytes.Buffer
	b := testBot(t, db, tg, &log)

	if wait := b.tick(ctx); wait != 0 {
		t.Fatalf("wait = %v", wait)
	}
	if len(tg.sent) != 1 || tg.sent[0]["chat_id"].(float64) != adminChat || !strings.Contains(tg.sent[0]["text"].(string), "/workspace") {
		t.Fatalf("sent = %v", tg.sent)
	}
	if !strings.Contains(log.String(), "chat_id=999") || strings.Contains(log.String(), "secret") {
		t.Errorf("log = %s", log.String())
	}
	b.tick(ctx)
	if tg.offsets[1] != 10 {
		t.Errorf("next offset = %v, want 10", tg.offsets[1])
	}
}

func TestBotPollsOnlyWithTheLeaseAndWaitsOnConflict(t *testing.T) {
	db, _ := storetest.New(t)
	ctx := context.Background()
	tg := &fakeTelegram{status: http.StatusConflict}
	var log bytes.Buffer
	blue, green := testBot(t, db, tg, &log), testBot(t, db, tg, &log)

	if wait := blue.tick(ctx); wait != standbyDelay {
		t.Fatalf("409: wait = %v", wait)
	}
	if wait := green.tick(ctx); wait != standbyDelay || tg.polls != 1 {
		t.Fatalf("green polled while blue holds the lease: wait = %v, polls = %d", wait, tg.polls)
	}
	if err := db.ReleaseAdminBot(ctx, blue.holder); err != nil {
		t.Fatal(err)
	}
	tg.status = 0
	if wait := green.tick(ctx); wait != 0 || tg.polls != 2 {
		t.Fatalf("green after release: wait = %v, polls = %d", wait, tg.polls)
	}
}

func TestParse(t *testing.T) {
	for _, tc := range []struct {
		line, name, arg string
		ok              bool
	}{
		{"/stats", "stats", "", true},
		{"/Stats@HelvetlyBot", "stats", "", true},
		{"/signups", "signups", "", true},
		{"/signups 5", "signups", "5", true},
		{"/signups@bot  99", "signups", "99", true},
		{"/signups 0", "", "", false},
		{"/signups five", "", "", false},
		{"/workspace ann@example.com", "workspace", "ann@example.com", true},
		{"/workspace", "", "", false},
		{"/workspace a b", "", "", false},
		{"/drop", "", "", false},
	} {
		cmd, err := parse(tc.line)
		if (err == nil) != tc.ok || (tc.ok && (cmd.name != tc.name || cmd.arg != tc.arg)) {
			t.Errorf("%q: %+v, %v", tc.line, cmd, err)
		}
	}
	for arg, want := range map[string]int{"": 10, "3": 3, "25": 25, "99": 25} {
		if n, err := signupCount(arg); err != nil || n != want {
			t.Errorf("signupCount(%q) = %d, %v", arg, n, err)
		}
	}
}

// fakeModel answers text, priced as the default model.
type fakeModel struct {
	text  string
	asked []aimodel.Request
}

func (f *fakeModel) Card() aimodel.RateCard { return aimodel.Cards[aimodel.DefaultModel] }
func (f *fakeModel) InputTokens(context.Context, aimodel.Request) (int64, error) {
	return 400, nil
}
func (f *fakeModel) Answer(_ context.Context, r aimodel.Request) (aimodel.Reply, error) {
	f.asked = append(f.asked, r)
	tokens := int64(420)
	return aimodel.Reply{Text: f.text, Tokens: &tokens, Usage: &aimodel.Usage{Input: 400, Output: 20}}, nil
}

func TestFreeTextRoutesToACommand(t *testing.T) {
	db, raw := storetest.New(t)
	ctx := context.Background()
	if err := db.CreateUser(ctx, store.User{ID: "u1", Email: "ann@example.com"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	var log bytes.Buffer
	b := testBot(t, db, &fakeTelegram{}, &log)
	if got := b.freeText(ctx, "who signed up?"); got != helpText {
		t.Errorf("without a model: %q", got)
	}
	for _, tc := range []struct{ reply, want string }{
		{`{"command":"signups","argument":"2"}`, "<b>Latest 1 sign-ups</b>\n"},
		{`{"command":"workspace","argument":"nobody@example.com"}`, "No workspace matches nobody@example.com."},
		{`{"command":"drop_tables","argument":""}`, "<b>Helvetly operator bot</b>"},
		{`not json`, "<b>Helvetly operator bot</b>"},
	} {
		model := &fakeModel{text: tc.reply}
		b.Model = model
		if got := b.freeText(ctx, "a question"); !strings.HasPrefix(got, tc.want) {
			t.Errorf("%s: %q", tc.reply, got)
		}
		if s := model.asked[0].Schema; s == nil || model.asked[0].Message != "a question" {
			t.Errorf("request = %+v", model.asked[0])
		}
	}
	var tokens int64
	if err := raw.QueryRow(ctx, `SELECT tokens FROM operator_ai_usage`).Scan(&tokens); err != nil || tokens != 4*420 {
		t.Fatalf("operator tokens = %d, %v", tokens, err)
	}
	if _, err := raw.Exec(ctx, `UPDATE operator_ai_usage SET tokens = $1`, operatorDailyTokens-100); err != nil {
		t.Fatal(err)
	}
	model := &fakeModel{text: `{"command":"stats","argument":""}`}
	b.Model = model
	if got := b.freeText(ctx, "stats?"); !strings.HasPrefix(got, "Today's AI allowance") || len(model.asked) != 0 {
		t.Errorf("over the cap: %q, asked %d", got, len(model.asked))
	}
}

func TestEveryCommandAnswers(t *testing.T) {
	db, _ := storetest.New(t)
	var log bytes.Buffer
	b := testBot(t, db, &fakeTelegram{}, &log)
	b.Limits = func(context.Context, string) (int64, int64, int64, error) { return 10_000_000_000, -1, 1000, nil }
	ctx := context.Background()
	if err := db.CreateWorkspace(ctx, store.Workspace{ID: "w1", Name: "A & B"}, "UTC", time.Now()); err != nil {
		t.Fatal(err)
	}
	for line, want := range map[string]string{
		"/stats":         "<b>Health</b>",
		"/users":         "Sign-ups: 0 today",
		"/workspaces":    "Total: 1",
		"/paid":          "MRR: none",
		"/signups":       "Latest 0 sign-ups",
		"/workspace w1":  "<b>A &amp; B</b> (w1)\nCreated",
		"/usage":         "Storage: 0 B",
		"/health":        "DB connections:",
		"/help":          "/signups [n]",
		"/workspace nop": "No workspace matches nop.",
	} {
		if got := b.answer(ctx, line); !strings.Contains(got, want) {
			t.Errorf("%s: %q lacks %q", line, got, want)
		}
	}
	if got := b.answer(ctx, "/workspace w1"); !strings.Contains(got, "Storage: 0 B of 10.0 GB") || !strings.Contains(got, "Heidi 0 of unlimited · automation 0 of 1,000 tokens") {
		t.Errorf("limits: %q", got)
	}
}

func TestSummarisePaid(t *testing.T) {
	now := time.Now()
	later, soon, past := now.Add(20*24*time.Hour), now.Add(3*24*time.Hour), now.Add(-time.Hour)
	seats := func(n int64) *int64 { return &n }
	sub := func(status, plan, interval string, perSeat bool, n int64, expires time.Time, currency string) store.OperatorSubscription {
		return store.OperatorSubscription{Billing: store.Billing{Status: status, Plan: plan, Interval: interval, PerSeat: perSeat,
			PaidSeats: seats(n), PlanExpiresAt: &expires, TrialEnd: &soon}, Currency: currency}
	}
	s := summarisePaid([]store.OperatorSubscription{
		sub("active", billing.Pro, "month", true, 3, later, "chf"),
		sub("past_due", billing.Business, "year", true, 6, later, "chf"),
		sub("active", billing.Basic, "month", false, 1, later, "eur"),
		sub("trialing", billing.Pro, "month", true, 2, later, "chf"),
		sub("active", billing.Pro, "month", true, 2, past, "chf"), // lapsed past the grace
		sub("canceled", billing.Pro, "month", true, 2, past, "chf"),
	}, now)
	wantCHF := billing.PlanTotal(billing.Pro, "month", 3) + billing.PlanTotal(billing.Business, "year", 6)/12
	if s.paying != 3 || s.seats != 9 || s.trials != 1 || s.trialsEnding != 1 || s.pastDue != 1 || s.lapsed != 1 ||
		s.mrr["chf"] != wantCHF || s.mrr["eur"] != billing.PlanAmount(billing.Basic, "month") || s.byPlan[billing.Business]["year"] != 1 {
		t.Errorf("summary = %+v, want CHF %d", s, wantCHF)
	}
}

func TestFormatting(t *testing.T) {
	for got, want := range map[string]string{
		num(0): "0", num(999): "999", num(1000): "1,000", num(-1234567): "-1,234,567",
		money(123456, "chf"): "CHF 1,234.56", money(5, "usd"): "USD 0.05",
		bytesText(999): "999 B", bytesText(1_500_000): "1.5 MB", bytesText(10_000_000_000): "10.0 GB",
	} {
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	}
	r := rateLimit{max: 2, window: time.Minute}
	now := time.Now()
	for i, want := range []rateResult{rateAllowed, rateAllowed, rateNotify, rateRefused} {
		if got := r.take(now); got != want {
			t.Errorf("message %d: %v, want %v", i, got, want)
		}
	}
	if r.take(now.Add(time.Minute)) != rateAllowed {
		t.Error("a new window is not allowed")
	}
}
