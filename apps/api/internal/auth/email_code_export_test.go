package auth

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestConsumeEmailCodeSingleUse(t *testing.T) {
	e := newEnv(t)
	r := httptest.NewRequest("POST", "/", nil)
	if err := e.svc.SendEmailCode(r, "ana@acme.ch", "", true); err != nil {
		t.Fatal(err)
	}
	code := e.devCode("ana@acme.ch")
	if got, err := e.svc.ConsumeEmailCode(r.Context(), "Ana@Acme.ch", code); err != nil || got != "ana@acme.ch" {
		t.Fatalf("first use = %q, %v", got, err)
	}
	if _, err := e.svc.ConsumeEmailCode(r.Context(), "ana@acme.ch", code); !errors.Is(err, errCodeExpired) {
		t.Fatalf("second use = %v, want errCodeExpired", err)
	}
}

func TestSendEmailCodeIPLimit(t *testing.T) {
	e := newEnv(t)
	r := httptest.NewRequest("POST", "/", nil)
	r.RemoteAddr = "203.0.113.9:1234"
	var err error
	for i := 0; i < 21 && err == nil; i++ {
		e.clock.t = e.clock.t.Add(time.Minute) // past the per-address cooldown
		err = e.svc.SendEmailCode(r, "ana"+string(rune('a'+i))+"@acme.ch", "", true)
		if i < 20 && err != nil {
			t.Fatalf("send %d: %v", i, err)
		}
	}
	var ae *apiError
	if !errors.As(err, &ae) || ae.status != http.StatusTooManyRequests || ae.code != "rate_limited" {
		t.Fatalf("21st send = %v, want 429 rate_limited", err)
	}
}
