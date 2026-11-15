package signatures

import (
	"context"
	"net/http"
	"testing"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
)

// A package sent on Pro is finished after a downgrade to Basic: reminders and signing work and the expiry stays;
// a new request on Basic is refused by the canonical write's admission as a missing feature, not a spent allowance.
func TestDowngradeFinishesStartedPackageRefusesNewOne(t *testing.T) {
	e := newEnv(t)
	billingtest.Wire(t, e.st)
	b := e.workspace()
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "one@example.com", "two@example.com"))
	expiry := func() time.Time {
		var at time.Time
		if err := e.raw.QueryRow(context.Background(), `SELECT expires_at FROM signature_requests WHERE id = $1`, req.ID).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}
	before := expiry()

	billingtest.On(t, e.st, b.workspace, billing.Basic)
	e.sign(e.mail.link("one@example.com"), http.StatusOK)
	old := e.mail.link("two@example.com")
	e.do(b, "POST", "/api/v1/signatures/"+req.ID+"/remind", nil, http.StatusOK, nil)
	fresh := e.mail.link("two@example.com")
	if fresh == "" || fresh == old {
		t.Fatal("the reminder on Basic sent no new link")
	}
	e.sign(fresh, http.StatusOK)
	if got := e.get(b, req.ID); got.Status != "completed" || got.SignedDocument == nil {
		t.Fatalf("not completed on Basic: %+v", got)
	}
	if after := expiry(); !after.Equal(before) {
		t.Fatalf("expiry changed: %v -> %v", before, after)
	}

	if code := e.code(b, "POST", "/api/v1/signatures", newRequest(doc, "parallel", "three@example.com"), http.StatusForbidden); code != "feature_not_in_plan" {
		t.Fatalf("new request on Basic: %s", code)
	}
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM signature_requests WHERE workspace_id = $1`, b.workspace).Scan(&n); err != nil || n != 1 {
		t.Fatalf("requests after the refusal: %d %v", n, err)
	}
}
