package billing

import (
	"context"
	"testing"
	"time"
)

// The hourly job forgets a trial claim 24 months after it was made, also with billing off.
func TestTrialClaimsTickForgetsClaimsAfter24Months(t *testing.T) {
	e := newEnv(t, false)
	ctx, now := context.Background(), time.Date(2028, 3, 15, 12, 0, 0, 0, time.UTC)
	e.svc.now = func() time.Time { return now }
	ws := e.workspace().workspace
	cases := []struct {
		digest    string
		claimedAt time.Time
		kept      bool
	}{
		{"recent", now.AddDate(0, -1, 0), true},
		{"just inside", now.AddDate(-2, 0, 0).Add(time.Minute), true},
		{"just past", now.AddDate(-2, 0, 0).Add(-time.Minute), false},
		{"long ago", now.AddDate(-5, 0, 0), false},
	}
	for _, c := range cases {
		if _, err := e.st.ClaimTrial(ctx, ws, map[string]string{"email": c.digest}, c.claimedAt); err != nil {
			t.Fatal(err)
		}
	}
	if err := e.svc.TrialClaimsTick(ctx); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		if got, err := e.st.TrialClaimed(ctx, map[string]string{"email": c.digest}); err != nil || got != c.kept {
			t.Errorf("%s: kept %v (%v), want %v", c.digest, got, err, c.kept)
		}
	}
}
