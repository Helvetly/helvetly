package billing

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestCallStripeVersion(t *testing.T) {
	for _, tc := range []struct {
		name string
		form url.Values
		want string
	}{
		{"plain call keeps the pinned version", url.Values{"mode": {"subscription"}}, stripeVersion},
		{"managed payments needs basil or later", url.Values{"managed_payments[enabled]": {"true"}}, managedPaymentsVersion},
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
			if got != tc.want {
				t.Fatalf("Stripe-Version = %q, want %q", got, tc.want)
			}
		})
	}
}
