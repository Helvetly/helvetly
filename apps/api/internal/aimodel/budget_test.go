package aimodel

import (
	"context"
	"errors"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// cancellingProvider ends the caller's request while generation runs, as a person pressing Stop or closing the tab
// does; a provider transport bound to a cancelled context loses the reply and its usage.
type cancellingProvider struct {
	cancel context.CancelFunc
	tokens int64
}

func (p *cancellingProvider) InputTokens(context.Context, Request) (int64, error) { return 10, nil }
func (p *cancellingProvider) Answer(ctx context.Context, _ Request) (Reply, error) {
	p.cancel()
	if err := ctx.Err(); err != nil {
		return Reply{}, err
	}
	return Reply{Text: "ok", Tokens: &p.tokens}, nil
}

func budgetWorkspace(t *testing.T) (*store.Store, store.Workspace) {
	db, _, ws := budgetDB(t)
	return db, ws
}

// budgetDB also returns the database's connection string, to open it again with a wider pool.
func budgetDB(t *testing.T) (*store.Store, string, store.Workspace) {
	t.Helper()
	db, raw := storetest.New(t)
	ws := store.Workspace{ID: "ws_budget", Name: "Budget", Timezone: "Europe/Zurich"}
	if err := db.CreateWorkspace(context.Background(), ws, ws.Timezone, time.Now()); err != nil {
		t.Fatal(err)
	}
	return db, raw.Config().ConnString(), ws
}

func TestCancelledRequestStillAccountsAStartedGeneration(t *testing.T) {
	db, ws := budgetWorkspace(t)
	now := time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b := Budget{DB: db, Now: func() time.Time { return now }}
	if _, err := b.Generate(ctx, &cancellingProvider{cancel: cancel, tokens: 42}, ws, Request{Message: "hi"}, 100); err != nil {
		t.Fatalf("a generation that completed must not fail because the caller left: %v", err)
	}
	u, err := db.HeidiUsage(context.Background(), ws.ID, "2026-11")
	if err != nil {
		t.Fatal(err)
	}
	if u.Uncertain || u.TokensUsed != 42 {
		t.Fatalf("usage = %+v, want 42 tokens and certain (one Stop must not block the workspace's AI)", u)
	}
}

func TestCancelledRequestStartsNoGeneration(t *testing.T) {
	db, ws := budgetWorkspace(t)
	ctx, cancel := context.WithCancel(context.Background())
	p := &countingProvider{onCount: cancel}
	_, err := Budget{DB: db, Now: time.Now}.Generate(ctx, p, ws, Request{Message: "hi"}, 100)
	if err == nil || p.answers != 0 {
		t.Fatalf("err=%v answers=%d: a request cancelled before generation must not start one", err, p.answers)
	}
	u, _ := db.HeidiUsage(context.Background(), ws.ID, time.Now().In(ws.Location()).Format("2006-01"))
	if u.Uncertain || u.TokensUsed != 0 {
		t.Fatalf("usage = %+v, want zero and certain", u)
	}
}

type countingProvider struct {
	onCount func()
	answers int
}

func (p *countingProvider) InputTokens(context.Context, Request) (int64, error) {
	p.onCount()
	return 10, nil
}
func (p *countingProvider) Answer(context.Context, Request) (Reply, error) {
	p.answers++
	n := int64(1)
	return Reply{Text: "ok", Tokens: &n}, nil
}

type gatedProvider struct {
	release chan struct{}
	answers atomic.Int32
}

func (p *gatedProvider) InputTokens(context.Context, Request) (int64, error) { return 10, nil }
func (p *gatedProvider) Answer(context.Context, Request) (Reply, error) {
	p.answers.Add(1)
	<-p.release
	n := int64(60)
	return Reply{Text: "ok", Tokens: &n}, nil
}

// Ten simultaneous calls on separate connections: one generates while it holds admission, the others are refused
// without reaching the provider, so the month can never spend more than its allowance.
func TestConcurrentCallsCannotOverspendTheAllowance(t *testing.T) {
	_, conn, ws := budgetDB(t)
	u, err := url.Parse(conn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("pool_max_conns", "12")
	u.RawQuery = q.Encode()
	wide, err := store.Open(context.Background(), u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer wide.Close()
	p := &gatedProvider{release: make(chan struct{})}
	b := Budget{DB: wide, Now: time.Now, Allowance: func(context.Context, store.Q, string) (int64, error) { return 100, nil }}
	start := make(chan struct{})
	errs := make(chan error, 10)
	for range 10 {
		go func() {
			<-start
			_, err := b.Generate(context.Background(), p, ws, Request{Message: "hi"}, 100)
			errs <- err
		}()
	}
	close(start)
	refused := 0
	for refused < 9 {
		select {
		case err := <-errs:
			if !errors.Is(err, ErrUncertain) {
				t.Fatalf("a concurrent call: %v, want ErrUncertain", err)
			}
			refused++
		case <-time.After(10 * time.Second):
			t.Fatalf("only %d of 9 concurrent calls were refused; %d reached the provider", refused, p.answers.Load())
		}
	}
	close(p.release)
	if err := <-errs; err != nil {
		t.Fatal(err)
	}
	usage, _ := wide.HeidiUsage(context.Background(), ws.ID, time.Now().In(ws.Location()).Format("2006-01"))
	if p.answers.Load() != 1 || usage.TokensUsed != 60 || usage.Uncertain {
		t.Fatalf("answers=%d usage=%+v", p.answers.Load(), usage)
	}
}
