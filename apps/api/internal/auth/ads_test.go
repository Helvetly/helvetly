package auth

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestAdsSignupOnlyForNewAccountWithConsent(t *testing.T) {
	e := newEnv(t)
	e.svc.cfg.PublicURL = "https://app.helvetly.com"
	ctx := t.Context()
	for _, tc := range []struct {
		email, provider, subject, consent string
		want                              bool
	}{
		{"new@example.com", providerEmail, "new@example.com", "yes", true},
		{"new@example.com", providerEmail, "new@example.com", "yes", false},
		{"new@example.com", providerGoogle, "linked-subject", "yes", false},
		{"other@example.com", providerGoogle, "new-subject", "yes", true},
		{"declined@example.com", providerEmail, "declined@example.com", "no", false},
		{"anonymous@example.com", providerEmail, "anonymous@example.com", "", false},
	} {
		var ns newSession
		err := e.svc.db.Tx(ctx, func(q store.Q) error {
			var err error
			ns, err = e.svc.signInIdentity(ctx, q, identity{email: tc.email, provider: tc.provider, subject: tc.subject}, "", "/")
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest("GET", "https://app.helvetly.com/", nil)
		if tc.consent != "" {
			r.AddCookie(&http.Cookie{Name: "helvetly_ads", Value: tc.consent})
		}
		w := httptest.NewRecorder()
		e.svc.markAdsSignup(w, r, ns)
		cs := w.Result().Cookies()
		if (len(cs) == 1) != tc.want {
			t.Fatalf("signup %s/%s, got %d markers, want marker %v", tc.email, tc.provider, len(cs), tc.want)
		}
		if tc.want {
			c := cs[0]
			if c.Name != "__Host-helvetly_signup" || !regexp.MustCompile("^[A-Z2-7]{26}$").MatchString(c.Value) || !c.Secure || c.Domain != "" || c.Path != "/" || c.MaxAge != 600 {
				t.Fatalf("unexpected marker: %s", c.Name)
			}
		}
	}
}

func TestAdsFrameIsIsolatedAndRequiresConsent(t *testing.T) {
	s := Service{}
	s.cfg.PublicURL = "https://app.helvetly.com"
	for _, tc := range []struct {
		host, consent string
		status        int
	}{
		{"api.helvetly.com", "yes", 200}, {"app.helvetly.com", "yes", 404}, {"api.helvetly.com", "no", 404}, {"api.helvetly.com", "", 404},
	} {
		r := httptest.NewRequest("GET", "https://"+tc.host+"/api/v1/public/ads/measurement", nil)
		r.AddCookie(&http.Cookie{Name: "helvetly_ads", Value: tc.consent})
		w := httptest.NewRecorder()
		s.adsMeasurement(w, r)
		if w.Code != tc.status || !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
			t.Fatalf("%s %s: %d", tc.host, tc.consent, w.Code)
		}
		if tc.status == 200 && (w.Header().Get("Referrer-Policy") != "no-referrer" || !strings.Contains(w.Header().Get("Content-Security-Policy"), "frame-ancestors https://helvetly.com https://www.helvetly.com https://app.helvetly.com;")) {
			t.Fatal(w.Header())
		}
	}
}
