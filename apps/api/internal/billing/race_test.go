package billing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// wideStore opens the test database again with room for ten transactions at once (the test store keeps two).
func wideStore(t *testing.T, e *env) *store.Store {
	t.Helper()
	u, err := url.Parse(e.raw.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("pool_max_conns", "12")
	u.RawQuery = q.Encode()
	s, err := store.Open(context.Background(), u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	s.SetAdmission(e.svc.AllowResource)
	return s
}

func TestTenConcurrentCreatesAtLimitMinusOneCreateExactlyOne(t *testing.T) {
	e := newEnv(t, true)
	ws := e.workspace().workspace
	e.subscribe(ws, "price_bm")
	setAdmissionLimit(t, e, Clients, 3)
	wide := wideStore(t, e)
	ctx := context.Background()
	for i := range 2 {
		if err := wide.CreateClient(ctx, ws, fmt.Sprintf("cli_seed%d", i), map[string]any{"name": fmt.Sprint("Seed ", i)}, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	start := make(chan struct{})
	errs := make(chan error, 10)
	for i := range 10 {
		go func() {
			<-start
			errs <- wide.CreateClient(ctx, ws, fmt.Sprintf("cli_race%d", i), map[string]any{"name": fmt.Sprint("Race ", i)}, time.Now())
		}()
	}
	close(start)
	created, denied := 0, 0
	for range 10 {
		switch err := <-errs; {
		case err == nil:
			created++
		case errors.Is(err, store.ErrAdmissionDenied):
			denied++
		default:
			t.Errorf("unexpected: %v", err)
		}
	}
	var n int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM clients WHERE workspace_id=$1`, ws).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if created != 1 || denied != 9 || n != 3 {
		t.Fatalf("created=%d denied=%d stored=%d, want 1, 9 and 3", created, denied, n)
	}
}

func TestConcurrentDeliveriesOfOneEventApplyItOnce(t *testing.T) {
	e := newEnv(t, true)
	ws := e.workspace().workspace
	e.subscribe(ws, "price_bm")
	e.stripe.put("sub_"+ws, ws, "cus_"+ws, "active", "price_pm") // the duplicated event is a plan change, which notifies
	payload, _ := json.Marshal(map[string]any{"id": "evt_dup", "type": "customer.subscription.updated",
		"data": map[string]any{"object": map[string]any{"id": "sub_" + ws}}})
	start := make(chan struct{})
	codes := make(chan int, 10)
	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() {
			<-start
			req, _ := http.NewRequest(http.MethodPost, e.srv.URL+"/api/webhooks/stripe", bytes.NewReader(payload))
			req.Header.Set("Stripe-Signature", sign(payload, whsec, time.Now()))
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				codes <- 0
				return
			}
			res.Body.Close()
			codes <- res.StatusCode
		})
	}
	close(start)
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != http.StatusOK {
			t.Fatalf("a delivery answered %d", code)
		}
	}
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM stripe_events WHERE id='evt_dup'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("events=%d err=%v", n, err)
	}
	if got := e.events(ws, "owner"); len(got) != 1 {
		t.Fatalf("owner notifications %v, want one", got)
	}
	if b := e.billing(ws); b.Plan != Pro || b.Status != "active" {
		t.Fatalf("billing %+v", b)
	}
}
