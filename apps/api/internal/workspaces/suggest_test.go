package workspaces

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// fakeNamer is the naming model: no network. reply answers each call; gate, when set, holds the call until closed.
type fakeNamer struct {
	mu    sync.Mutex
	reqs  []aimodel.Request
	reply func(aimodel.Request) (aimodel.Reply, error)
	gate  chan struct{}
}

func (f *fakeNamer) Card() aimodel.RateCard                                      { return aimodel.Cards[aimodel.DefaultModel] }
func (f *fakeNamer) InputTokens(context.Context, aimodel.Request) (int64, error) { return 10, nil }
func (f *fakeNamer) Answer(_ context.Context, r aimodel.Request) (aimodel.Reply, error) {
	f.mu.Lock()
	f.reqs = append(f.reqs, r)
	f.mu.Unlock()
	if f.gate != nil {
		<-f.gate
	}
	return f.reply(r)
}
func (f *fakeNamer) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.reqs)
}

func good(name string) func(aimodel.Request) (aimodel.Reply, error) {
	return func(aimodel.Request) (aimodel.Reply, error) {
		tokens := int64(30)
		b, _ := json.Marshal(map[string]string{"name": name})
		return aimodel.Reply{Text: string(b), Tokens: &tokens, Usage: &aimodel.Usage{Input: 20, Output: 10, Model: aimodel.DefaultModel, Tier: "default"}}, nil
	}
}

const path = "/api/v1/workspace/name-suggestion"

func ask(company string) map[string]any {
	return map[string]any{"company_name": company, "consent": true}
}

func errCode(body map[string]any) string {
	e, _ := body["error"].(map[string]any)
	c, _ := e["code"].(string)
	return c
}

func (e *env) suggestionRow(ws string) (status, suggestion string, found bool) {
	e.t.Helper()
	err := e.raw.QueryRow(context.Background(), `SELECT status, suggestion FROM workspace_name_suggestions WHERE workspace_id = $1`, ws).Scan(&status, &suggestion)
	return status, suggestion, err == nil
}

func TestSuggestIsOneTimeAndIdempotent(t *testing.T) {
	e := newEnv(t)
	n := &fakeNamer{reply: good("  “Muster Treuhand”  ")}
	e.svc.SetNamer(n)
	owner, ws := e.person("My workspace", "owner")
	code, body := e.do(owner, http.MethodPost, path, ask("Muster Treuhand GmbH"))
	data, _ := body["data"].(map[string]any)
	if code != http.StatusOK || data["name"] != "Muster Treuhand" || data["company_name"] != "Muster Treuhand GmbH" {
		t.Fatalf("suggest: %d %v", code, body)
	}
	// The same request again reads the stored result: no second call.
	if code, body = e.do(owner, http.MethodPost, path, ask("Muster Treuhand GmbH")); code != http.StatusOK || body["data"].(map[string]any)["name"] != "Muster Treuhand" {
		t.Fatalf("repeat: %d %v", code, body)
	}
	// Another company name after the use is spent is refused, not answered with a second call.
	if code, body = e.do(owner, http.MethodPost, path, ask("Other AG")); code != http.StatusConflict || errCode(body) != "suggestion_used" {
		t.Fatalf("other company: %d %v", code, body)
	}
	if n.calls() != 1 {
		t.Fatalf("model called %d times", n.calls())
	}
	// Only the company name is sent, with the fixed instruction, the cheapest model's card and the bounded output.
	r := n.reqs[0]
	if r.Message != "Muster Treuhand GmbH" || strings.Contains(r.Instructions, "Muster") || r.MaxOutputTokens != 512 || r.Schema == nil || len(r.History) != 0 || len(r.Files) != 0 {
		t.Fatalf("request %+v", r)
	}
	var cost int64
	if err := e.raw.QueryRow(context.Background(), `SELECT cost_micros FROM workspace_name_suggestions WHERE workspace_id = $1`, ws).Scan(&cost); err != nil || cost != 8 {
		t.Fatalf("cost %d %v", cost, err) // 20 x 110000 + 10 x 550000 per million = 7.7 micro-USD, rounded up
	}
}

func TestSuggestNeverTouchesThePlanPoolOrHeidiConsent(t *testing.T) {
	e := newEnv(t)
	e.svc.SetNamer(&fakeNamer{reply: good("Muster")})
	owner, ws := e.person("My workspace", "owner")
	if code, body := e.do(owner, http.MethodPost, path, ask("Muster GmbH")); code != http.StatusOK {
		t.Fatalf("suggest: %d %v", code, body)
	}
	for _, table := range []string{"heidi_usage", "ai_calls", "workspace_ai_consents"} {
		var n int
		if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM `+table+` WHERE workspace_id = $1`, ws).Scan(&n); err != nil || n != 0 {
			t.Fatalf("%s rows %d %v", table, n, err)
		}
	}
}

func TestSuggestRefusesBeforeTheProviderAndSpendsNothing(t *testing.T) {
	e := newEnv(t)
	n := &fakeNamer{reply: good("Muster")}
	e.svc.SetNamer(n)
	owner, ws := e.person("My workspace", "owner")
	admin := e.join(ws, "admin")
	for name, tc := range map[string]struct {
		b    *browser
		body any
		want int
	}{
		"no consent":        {owner, map[string]any{"company_name": "Muster"}, http.StatusBadRequest},
		"consent false":     {owner, map[string]any{"company_name": "Muster", "consent": false}, http.StatusBadRequest},
		"empty company":     {owner, ask("  "), http.StatusBadRequest},
		"long company":      {owner, ask(strings.Repeat("x", 71)), http.StatusBadRequest},
		"control chars":     {owner, ask("Muster\tAG"), http.StatusBadRequest},
		"admin is no owner": {admin, ask("Muster"), http.StatusForbidden},
	} {
		if code, body := e.do(tc.b, http.MethodPost, path, tc.body); code != tc.want {
			t.Fatalf("%s: %d %v", name, code, body)
		}
	}
	if n.calls() != 0 {
		t.Fatal("the model was called")
	}
	if _, _, found := e.suggestionRow(ws); found {
		t.Fatal("a refused request took the use")
	}
	// Still available afterwards.
	if code, _ := e.do(owner, http.MethodPost, path, ask("Muster")); code != http.StatusOK {
		t.Fatalf("after refusals: %d", code)
	}
}

func TestSuggestProviderOffConsumesNothing(t *testing.T) {
	e := newEnv(t) // no namer
	owner, ws := e.person("My workspace", "owner")
	if code, body := e.do(owner, http.MethodPost, path, ask("Muster")); code != http.StatusConflict || errCode(body) != "ai_not_configured" {
		t.Fatalf("provider off: %d %v", code, body)
	}
	if _, _, found := e.suggestionRow(ws); found {
		t.Fatal("provider off took the use")
	}
}

func TestSuggestRefusesASetUpWorkspace(t *testing.T) {
	e := newEnv(t)
	n := &fakeNamer{reply: good("Muster")}
	e.svc.SetNamer(n)
	owner, ws := e.person("Acme", "owner")
	if _, err := e.raw.Exec(context.Background(), `UPDATE workspaces SET onboarded_at = now() WHERE id = $1`, ws); err != nil {
		t.Fatal(err)
	}
	if code, body := e.do(owner, http.MethodPost, path, ask("Acme")); code != http.StatusConflict || errCode(body) != "already_set_up" || n.calls() != 0 {
		t.Fatalf("onboarded: %d %v", code, body)
	}
}

func TestSuggestFailuresStaySpent(t *testing.T) {
	long := strings.Repeat("x", 41)
	for name, tc := range map[string]struct {
		reply  func(aimodel.Request) (aimodel.Reply, error)
		status string
	}{
		"unknown outcome (timeout)": {func(aimodel.Request) (aimodel.Reply, error) { return aimodel.Reply{}, errors.New("timeout") }, "unaccounted"},
		"known provider failure": {func(aimodel.Request) (aimodel.Reply, error) {
			tokens := int64(20)
			return aimodel.Reply{Tokens: &tokens}, errors.New("provider 500")
		}, "failed"},
		"not JSON": {func(aimodel.Request) (aimodel.Reply, error) {
			tokens := int64(20)
			return aimodel.Reply{Text: "Muster", Tokens: &tokens}, nil
		}, "failed"},
		"over 40 characters": {func(r aimodel.Request) (aimodel.Reply, error) { return good(long)(r) }, "failed"},
		"empty name":         {func(r aimodel.Request) (aimodel.Reply, error) { return good("  ")(r) }, "failed"},
	} {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t)
			n := &fakeNamer{reply: tc.reply}
			e.svc.SetNamer(n)
			owner, ws := e.person("My workspace", "owner")
			if code, body := e.do(owner, http.MethodPost, path, ask("Muster")); code != http.StatusBadGateway || errCode(body) != "ai_unavailable" {
				t.Fatalf("first: %d %v", code, body)
			}
			if status, _, _ := e.suggestionRow(ws); status != tc.status {
				t.Fatalf("status %q, want %q", status, tc.status)
			}
			// A retry is refused: it could be billed twice. The manual name stays available.
			if code, body := e.do(owner, http.MethodPost, path, ask("Muster")); code != http.StatusConflict || errCode(body) != "suggestion_used" || n.calls() != 1 {
				t.Fatalf("retry: %d %v (calls %d)", code, body, n.calls())
			}
			if code, _ := e.do(owner, http.MethodPatch, "/api/v1/workspace", map[string]string{"name": "Muster"}); code != http.StatusOK {
				t.Fatalf("manual rename: %d", code)
			}
		})
	}
}

func TestSuggestConcurrentRequestsAskTheModelOnce(t *testing.T) {
	e := newEnv(t)
	n := &fakeNamer{reply: good("Muster"), gate: make(chan struct{})}
	e.svc.SetNamer(n)
	owner, _ := e.person("My workspace", "owner")
	var wg sync.WaitGroup
	codes := make(chan int, 5)
	for range 5 { // within the 6 per minute of the rate limit
		wg.Go(func() {
			code, _ := e.do(owner, http.MethodPost, path, ask("Muster"))
			codes <- code
		})
	}
	// Four of them find the use taken while the first still waits for the model.
	time.Sleep(300 * time.Millisecond)
	close(n.gate)
	wg.Wait()
	close(codes)
	ok, conflict := 0, 0
	for c := range codes {
		switch c {
		case http.StatusOK:
			ok++
		case http.StatusConflict:
			conflict++
		default:
			t.Fatalf("unexpected status %d", c)
		}
	}
	if n.calls() != 1 || ok != 1 || conflict != 4 {
		t.Fatalf("calls %d ok %d conflict %d", n.calls(), ok, conflict)
	}
}

func TestSuggestSurvivesAClientThatLeaves(t *testing.T) {
	e := newEnv(t)
	n := &fakeNamer{reply: good("Muster"), gate: make(chan struct{})}
	e.svc.SetNamer(n)
	owner, ws := e.person("My workspace", "owner")
	owner.c.Timeout = 300 * time.Millisecond // the client gives up while the model still works
	if _, err := func() (int, error) {
		defer func() { owner.c.Timeout = 0 }()
		req, _ := http.NewRequest(http.MethodPost, e.srv.URL+path, strings.NewReader(`{"company_name":"Muster","consent":true}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", owner.csrf)
		res, err := owner.c.Do(req)
		if err == nil {
			res.Body.Close()
		}
		return 0, err
	}(); err == nil {
		t.Fatal("the client should have timed out")
	}
	close(n.gate)
	deadline := time.Now().Add(5 * time.Second)
	for {
		if status, _, _ := e.suggestionRow(ws); status == "done" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the result of the started call was lost")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if code, body := e.do(owner, http.MethodPost, path, ask("Muster")); code != http.StatusOK || body["data"].(map[string]any)["name"] != "Muster" || n.calls() != 1 {
		t.Fatalf("read back: %d %v (calls %d)", code, body, n.calls())
	}
}

func TestSuggestRateLimit(t *testing.T) {
	e := newEnv(t)
	e.svc.SetNamer(&fakeNamer{reply: good("Muster")})
	owner, _ := e.person("My workspace", "owner")
	for i := range 6 {
		if code, _ := e.do(owner, http.MethodPost, path, ask("Muster")); code != http.StatusOK {
			t.Fatalf("request %d: %d", i, code)
		}
	}
	if code, body := e.do(owner, http.MethodPost, path, ask("Muster")); code != http.StatusTooManyRequests || errCode(body) != "rate_limited" {
		t.Fatalf("7th: %d %v", code, body)
	}
}

// One person making many workspaces cannot harvest more than five uses a day, even all at once.
func TestSuggestPerPersonDailyCapHoldsUnderConcurrency(t *testing.T) {
	e := newEnv(t)
	_, first := e.person("One", "owner")
	owner := e.join(first, "owner")
	var wsIDs []string
	for range 8 {
		id := auth.NewID("wsp")
		if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: id, Name: "W"}, "UTC", time.Now()); err != nil {
			t.Fatal(err)
		}
		wsIDs = append(wsIDs, id)
	}
	var wg sync.WaitGroup
	outcomes := make(chan store.NameSuggestionOutcome, len(wsIDs))
	for _, id := range wsIDs {
		wg.Go(func() {
			var out store.NameSuggestionOutcome
			err := e.st.Tx(context.Background(), func(q store.Q) (err error) {
				_, out, err = q.ReserveNameSuggestion(context.Background(), store.NameSuggestion{WorkspaceID: id, RequestedBy: owner.userID, CompanyName: "X", RateCard: "r", Model: "m"}, suggestionsPerDay, time.Now())
				return err
			})
			if err != nil {
				t.Error(err)
			}
			outcomes <- out
		})
	}
	wg.Wait()
	close(outcomes)
	reserved, limited := 0, 0
	for o := range outcomes {
		switch o {
		case store.NameReserved:
			reserved++
		case store.NameLimited:
			limited++
		}
	}
	if reserved != suggestionsPerDay || limited != len(wsIDs)-suggestionsPerDay {
		t.Fatalf("reserved %d limited %d", reserved, limited)
	}
}

func TestSuggestDeletingTheWorkspaceRemovesTheRecord(t *testing.T) {
	e := newEnv(t)
	e.svc.SetNamer(&fakeNamer{reply: good("Muster")})
	owner, ws := e.person("My workspace", "owner")
	if code, _ := e.do(owner, http.MethodPost, path, ask("Muster")); code != http.StatusOK {
		t.Fatal("suggest")
	}
	if _, err := e.raw.Exec(context.Background(), `DELETE FROM workspaces WHERE id = $1`, ws); err != nil {
		t.Fatal(err)
	}
	if _, _, found := e.suggestionRow(ws); found {
		t.Fatal("the record outlived its workspace")
	}
}

// The cap survives deleting the workspaces: request, delete, create again must not give a new use.
func TestSuggestCapSurvivesWorkspaceDeletion(t *testing.T) {
	e := newEnv(t)
	e.svc.SetNamer(&fakeNamer{reply: good("Muster")})
	_, first := e.person("One", "owner")
	owner := e.join(first, "owner")
	take := func(id string) store.NameSuggestionOutcome {
		var out store.NameSuggestionOutcome
		err := e.st.Tx(context.Background(), func(q store.Q) (err error) {
			_, out, err = q.ReserveNameSuggestion(context.Background(), store.NameSuggestion{WorkspaceID: id, RequestedBy: owner.userID, CompanyName: "Secret AG", RateCard: "r", Model: "m"}, suggestionsPerDay, time.Now())
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	for i := range suggestionsPerDay {
		id := auth.NewID("wsp")
		if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: id, Name: "W"}, "UTC", time.Now()); err != nil {
			t.Fatal(err)
		}
		if out := take(id); out != store.NameReserved {
			t.Fatalf("use %d: %v", i, out)
		}
		if _, err := e.raw.Exec(context.Background(), `DELETE FROM workspaces WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
	}
	fresh := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: fresh, Name: "Fresh"}, "UTC", time.Now()); err != nil {
		t.Fatal(err)
	}
	if out := take(fresh); out != store.NameLimited {
		t.Fatalf("after deleting the workspaces: %v", out)
	}
	// No company data stays behind with the ledger.
	var cols int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM information_schema.columns WHERE table_name = 'name_suggestion_uses' AND column_name IN ('company_name','workspace_id','suggestion')`).Scan(&cols); err != nil || cols != 0 {
		t.Fatalf("ledger holds workspace data: %d %v", cols, err)
	}
}

// The input bound is by bytes, an upper bound on tokens, with the longest company name the endpoint accepts.
func TestSuggestInputStaysUnderItsBound(t *testing.T) {
	schema, _ := json.Marshal(suggestionSchema.JSON)
	if n := len(suggestionInstructions) + len(schema) + maxCompanyRunes*4; n > suggestionMaxInput {
		t.Fatalf("worst-case input %d bytes over %d", n, suggestionMaxInput)
	}
}

func TestCleanSuggestion(t *testing.T) {
	for in, want := range map[string]string{
		`{"name":"Muster"}`:               "Muster",
		`{"name":" «Muster  Treuhand» "}`: "Muster Treuhand",
		`{"name":"Müller & Söhne"}`:       "Müller & Söhne",
		`{"name":""}`:                     "",
		`{"name":"a\tb"}`:                 "a b",
		`{"name":"a\u0007b"}`:             "",
		`nope`:                            "",
		`{"other":"x"}`:                   "",
	} {
		got, ok := cleanSuggestion(in)
		if got != want || ok != (want != "") {
			t.Errorf("%q: %q %v", in, got, ok)
		}
	}
}
