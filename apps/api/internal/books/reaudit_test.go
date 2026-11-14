package books

import (
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestAgreementAcceptanceCannotBeInTheFuture(t *testing.T) {
	now := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	for _, delta := range []time.Duration{-time.Second, 0, time.Second} {
		accepted := now.Add(delta).Format(time.RFC3339)
		_, err := (agreementInput{StartsOn: "2026-01-01", AcceptedAt: &accepted}).agreement(store.Session{}, "cli_supplier", now)
		if (err != nil) != (delta > 0) {
			t.Errorf("acceptance %s at now %s: error=%v", accepted, now, err)
		}
	}
}
