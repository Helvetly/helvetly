package members

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type authzEnv struct {
	t    *testing.T
	st   *store.Store
	pool *pgxpool.Pool
	srv  *httptest.Server
}

type person struct{ id, token, csrf string }

func newAuthzEnv(t *testing.T) *authzEnv {
	t.Helper()
	t.Parallel()
	st, pool := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	New(st, a, discard).Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &authzEnv{t: t, st: st, pool: pool, srv: srv}
}

func (e *authzEnv) add(ws, role string) person {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Tester " + role}
	p := person{id: u.ID, token: rand.Text(), csrf: rand.Text()}
	sum := sha256.Sum256([]byte(p.token))
	for _, err := range []error{
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, role, now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), p.csrf, u.ID, ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	return p
}

func (e *authzEnv) workspace() string {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, "UTC", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return ws
}

func (e *authzEnv) send(p person, method, path, body string) int {
	e.t.Helper()
	req, err := http.NewRequest(method, e.srv.URL+path, strings.NewReader(body))
	if err != nil {
		e.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", p.csrf)
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: p.token})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	_ = res.Body.Close()
	return res.StatusCode
}

// TestRemovedMemberTokensDoNotReturn: removing someone ends their API tokens for that workspace for good; inviting
// them back later must not revive a token they made before.
func TestRemovedMemberTokensDoNotReturn(t *testing.T) {
	e := newAuthzEnv(t)
	ws := e.workspace()
	owner, m := e.add(ws, "owner"), e.add(ws, "member")
	ctx, now := context.Background(), time.Now()
	secret := "hvt_" + rand.Text()
	sum := sha256.Sum256([]byte(secret))
	hash := hex.EncodeToString(sum[:])
	if _, err := e.st.CreateAPIToken(ctx, store.APIToken{ID: auth.NewID("tok"), Name: "ci", Scopes: []string{"read:*"},
		Prefix: secret[:8], Workspace: store.TokenSpace{ID: ws}, CreatedAt: now}, m.id, hash); err != nil {
		t.Fatal(err)
	}
	if code := e.send(owner, "DELETE", "/api/v1/members/"+m.id, ""); code != http.StatusNoContent {
		t.Fatalf("remove: %d", code)
	}
	if err := e.st.AddMember(ctx, ws, m.id, "member", now); err != nil { // invited back
		t.Fatal(err)
	}
	if _, err := e.st.SessionByAPIToken(ctx, hash, now); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("the removed member's old token works again after rejoining: %v", err)
	}
}

// TestDemotedOwnerInFlightRequest: an owner demoted while their own request waits for the owners' lock acts with
// the role they have when it runs, not the one their session was read with.
func TestDemotedOwnerInFlightRequest(t *testing.T) {
	e := newAuthzEnv(t)
	ws := e.workspace()
	_, second, m := e.add(ws, "owner"), e.add(ws, "owner"), e.add(ws, "member")
	ctx := context.Background()

	demoted, release := make(chan error, 1), make(chan struct{})
	go func() {
		demoted <- e.st.Tx(ctx, func(q store.Q) error {
			if err := q.LockAddress(ctx, "workspace-owners:"+ws); err != nil {
				return err
			}
			<-release
			return q.SetMemberRole(ctx, ws, second.id, "admin", nil) // what first's PATCH does, committed after second's request read its session
		})
	}()
	codes := make(chan int, 1)
	go func() {
		// Wait until the demotion holds the lock, then send second's promotion of m: it reads the session (owner)
		// and queues behind the lock.
		e.waitFor(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`, 1)
		codes <- e.send(second, "PATCH", "/api/v1/members/"+m.id, `{"role":"owner"}`)
	}()
	e.waitFor(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`, 1)
	close(release)
	if err := <-demoted; err != nil {
		t.Fatal(err)
	}
	if code := <-codes; code != http.StatusForbidden {
		t.Errorf("a demoted owner's queued request made someone owner: %d", code)
	}
	if role, _ := e.st.MemberRole(ctx, ws, m.id); role != "member" {
		t.Errorf("member is now %q", role)
	}
}

func (e *authzEnv) waitFor(query string, want int) {
	e.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		var n int
		if err := e.pool.QueryRow(context.Background(), query).Scan(&n); err != nil {
			e.t.Error(err)
			return
		}
		if n >= want {
			return
		}
		if time.Now().After(deadline) {
			e.t.Errorf("timed out waiting for %s >= %d", query, want)
			return
		}
		time.Sleep(10 * time.Millisecond) // polling Postgres for a lock state: there is no event to wait on
	}
}

// TestOwnersDemoteEachOtherAtOnce: two owners demoting (or removing) each other in parallel on the real database
// always leave the workspace an owner.
func TestOwnersDemoteEachOtherAtOnce(t *testing.T) {
	e := newAuthzEnv(t)
	for round := range 10 {
		ws := e.workspace()
		x, y := e.add(ws, "owner"), e.add(ws, "owner")
		method, body := "PATCH", `{"role":"admin"}`
		if round%2 == 1 {
			method, body = "DELETE", ""
		}
		var wg sync.WaitGroup
		start := make(chan struct{})
		for _, pair := range [][2]person{{x, y}, {y, x}} {
			wg.Go(func() { <-start; e.send(pair[0], method, "/api/v1/members/"+pair[1].id, body) })
		}
		close(start)
		wg.Wait()
		var owners int
		if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'`, ws).Scan(&owners); err != nil {
			t.Fatal(err)
		}
		if owners != 1 {
			t.Fatalf("round %d (%s): %d owners left", round, method, owners)
		}
	}
}
