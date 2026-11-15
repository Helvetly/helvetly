package delivery

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

// TestTransmissionNeedsAPlanWithEInvoiceXML: a transmission queued on Business whose workspace moved to Pro ends
// failed at once (no retry) with the plan's reason, the channel never called; back on Business a retry sends it.
func TestTransmissionNeedsAPlanWithEInvoiceXML(t *testing.T) {
	e := newEnv(t)
	billingtest.Wire(t, e.st)
	b := e.workspace()
	billingtest.On(t, e.st, b.workspace, billing.Business)
	e.issued(b.workspace, "inv_1")
	if code, raw := e.send(b, "PUT", "/api/v1/transmission-channels/fake-peppol/credentials", map[string]any{"credentials": map[string]string{"k": "v"}}); code != http.StatusNoContent {
		t.Fatalf("credentials: %d %s", code, raw)
	}
	code, raw := e.send(b, "POST", "/api/v1/invoices/inv_1/transmissions", map[string]string{"channel": "fake-peppol", "format": "peppol"})
	var queued struct{ Data store.Transmission }
	if code != http.StatusAccepted || json.Unmarshal(raw, &queued) != nil {
		t.Fatalf("queue: %d %s", code, raw)
	}

	billingtest.On(t, e.st, b.workspace, billing.Pro)
	if err := e.svc.Tick(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	got := e.transmissions(b, "inv_1")
	if got[0].Status != "failed" || got[0].NextAttempt != nil || got[0].LastError == nil || !strings.Contains(*got[0].LastError, "Business") {
		t.Fatalf("on Pro: %+v", got[0])
	}
	if len(e.peer.sent) != 0 {
		t.Fatalf("channel called on Pro: %d", len(e.peer.sent))
	}

	billingtest.On(t, e.st, b.workspace, billing.Business)
	if code, raw := e.send(b, "POST", "/api/v1/invoices/inv_1/transmissions/"+queued.Data.ID+"/retry", nil); code != http.StatusAccepted {
		t.Fatalf("retry: %d %s", code, raw)
	}
	if err := e.svc.Tick(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if got := e.transmissions(b, "inv_1"); got[0].Status != "accepted" || len(e.peer.sent) != 1 {
		t.Fatalf("on Business: %+v, sent %d", got[0], len(e.peer.sent))
	}
}
