package billing

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestCallStripeVersion(t *testing.T) {
	for _, tc := range []struct {
		name string
		form url.Values
	}{
		{"plain call", url.Values{"mode": {"subscription"}}},
		{"managed payments uses the same version", url.Values{"managed_payments[enabled]": {"true"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var got string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				got = r.Header.Get("Stripe-Version")
				_, _ = w.Write([]byte(`{}`))
			}))
			defer srv.Close()
			if err := NewStripeClient("sk_test", srv.URL).Call(context.Background(), http.MethodPost, "/v1/checkout/sessions", tc.form, "", nil); err != nil {
				t.Fatal(err)
			}
			if got != "2026-09-30.endive" {
				t.Fatalf("Stripe-Version = %q", got)
			}
		})
	}
}

// answer is one reply of the test server: a status, a Stripe-Should-Retry header ("" for none) and an error code.
type answer struct {
	status      int
	shouldRetry string
	code        string
}

func TestCallRetries(t *testing.T) {
	ok := answer{http.StatusOK, "", ""}
	for _, tc := range []struct {
		name     string
		answers  []answer // the last one repeats
		attempts int
		success  bool
	}{
		{"Stripe-Should-Retry: true", []answer{{http.StatusInternalServerError, "true", "api_error"}, ok}, 2, true},
		{"a 429", []answer{{http.StatusTooManyRequests, "", "lock_timeout"}, ok}, 2, true},
		{"a 429 Stripe says not to repeat", []answer{{http.StatusTooManyRequests, "false", "rate_limit"}}, 1, false},
		{"a 409 idempotency_key_in_use", []answer{{http.StatusConflict, "", "idempotency_key_in_use"}, ok}, 2, true},
		{"another 409", []answer{{http.StatusConflict, "", "resource_already_exists"}}, 1, false},
		{"another 5xx", []answer{{http.StatusInternalServerError, "", "api_error"}}, 1, false},
		{"a 400", []answer{{http.StatusBadRequest, "", "parameter_invalid"}}, 1, false},
		{"three retries at most", []answer{{http.StatusTooManyRequests, "", "lock_timeout"}}, 4, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var attempts int
			var bodies []string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = r.ParseForm()
				bodies = append(bodies, r.PostForm.Encode()+" "+r.Header.Get("Idempotency-Key"))
				a := tc.answers[min(attempts, len(tc.answers)-1)]
				attempts++
				if a.shouldRetry != "" {
					w.Header().Set("Stripe-Should-Retry", a.shouldRetry)
				}
				w.WriteHeader(a.status)
				if a.status >= 300 {
					_, _ = w.Write([]byte(`{"error":{"type":"api_error","code":"` + a.code + `"}}`))
					return
				}
				_, _ = w.Write([]byte(`{"id":"cus_1"}`))
			}))
			defer srv.Close()
			var out struct {
				ID string `json:"id"`
			}
			err := NewStripeClient("sk_test", srv.URL).Call(context.Background(), http.MethodPost, "/v1/customers",
				url.Values{"name": {"Acme"}}, "key-1", &out)
			if attempts != tc.attempts || (err == nil) != tc.success || (tc.success && out.ID != "cus_1") {
				t.Fatalf("attempts %d, err %v, out %+v", attempts, err, out)
			}
			var se *StripeError
			if !tc.success && !errors.As(err, &se) {
				t.Fatalf("err %v is not Stripe's refusal", err)
			}
			for _, b := range bodies {
				if b != "name=Acme key-1" {
					t.Fatalf("a retry sent %q", b)
				}
			}
		})
	}
}

func TestCallDoesNotRetryANetworkError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	base := srv.URL
	srv.Close()
	if err := NewStripeClient("sk_test", base).Call(context.Background(), http.MethodGet, "/v1/prices", nil, "", nil); err == nil {
		t.Fatal("a closed server answered")
	}
}
