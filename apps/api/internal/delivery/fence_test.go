package delivery

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// A run whose claim ended (another run reclaimed and delivered the transmission) must not overwrite the newer outcome
// or notify again when its own late answer finally arrives.
func TestLateOutcomeOfStaleClaimIsDropped(t *testing.T) {
	tests := []struct {
		name string
		late func(p *fakeIntermediary)
	}{
		{"late rejection", func(p *fakeIntermediary) { p.answer, p.reason = "rejected", "late" }},
		{"late error", func(p *fakeIntermediary) { p.fail = errors.New("connection reset") }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace()
			e.send(b, "PUT", "/api/v1/transmission-channels/fake-peppol/credentials", map[string]any{"credentials": map[string]string{"k": "v"}})
			ctx := context.Background()
			e.issued(b.workspace, "inv_1")
			stale := time.Now().Add(-lease - time.Minute)
			if _, _, err := e.st.QueueTransmission(ctx, store.Transmission{ID: auth.NewID("trn"), WorkspaceID: b.workspace,
				InvoiceID: "inv_1", Channel: "fake-peppol", Format: "peppol"}, stale); err != nil {
				t.Fatal(err)
			}
			first, err := e.st.ClaimTransmissions(ctx, stale, lease, 1)
			if err != nil || len(first) != 1 {
				t.Fatal(first, err)
			}
			now := time.Now()
			second, err := e.st.ClaimTransmissions(ctx, now, lease, 1) // the first lease ended: reclaimed
			if err != nil || len(second) != 1 {
				t.Fatal(second, err)
			}
			e.svc.send(ctx, ctx, second[0], now)
			tt.late(e.peer)
			e.svc.send(ctx, ctx, first[0], now)
			got := e.transmissions(b, "inv_1")
			if got[0].Status != "accepted" || got[0].LastError != nil || got[0].ExternalID == nil {
				t.Fatalf("the late outcome overwrote the delivery: %+v", got[0])
			}
			if ev := e.events(b.workspace); !slices.Equal(ev["owner"], []string{"einvoice.delivered"}) {
				t.Fatalf("notifications: %v", ev)
			}
		})
	}
}

// A channel's reason for a rejection is kept as the transmission's last error.
func TestRejectionReasonIsStored(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.send(b, "PUT", "/api/v1/transmission-channels/fake-peppol/credentials", map[string]any{"credentials": map[string]string{"k": "v"}})
	ctx := context.Background()
	e.issued(b.workspace, "inv_1")
	if _, _, err := e.st.QueueTransmission(ctx, store.Transmission{ID: auth.NewID("trn"), WorkspaceID: b.workspace,
		InvoiceID: "inv_1", Channel: "fake-peppol", Format: "peppol"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	e.peer.answer, e.peer.reason = "rejected", "Unknown receiver endpoint 0192:999999999"
	if err := e.svc.Tick(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	got := e.transmissions(b, "inv_1")
	if got[0].Status != "rejected" || got[0].LastError == nil || *got[0].LastError != e.peer.reason {
		t.Fatalf("rejected transmission: %+v", got[0])
	}
}
