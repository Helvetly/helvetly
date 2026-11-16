package engagements

import (
	"net/http"
	"testing"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
)

// TestAutoDraftsWaitForAPlanWithEngagementAutomation: an auto-invoiced engagement's due draft is not made on Basic;
// after the upgrade to Pro the next tick makes it.
func TestAutoDraftsWaitForAPlanWithEngagementAutomation(t *testing.T) {
	e := newEnv(t)
	e.svc.inv = &fakeDrafts{e: e}
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"auto_invoice": true}))
	billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, b.workspace, billing.Basic)

	e.tick(fixedNow)
	if n := e.invoicesOf(v.ID, "advance"); n != 0 {
		t.Fatalf("Basic: %d advance drafts", n)
	}
	if got := e.noticeKinds(v.ID); got != "" {
		t.Fatalf("Basic: notices %q", got)
	}
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.tick(fixedNow)
	if n := e.invoicesOf(v.ID, "advance"); n != 1 {
		t.Fatalf("Pro: %d advance drafts", n)
	}
}

// TestAutomationSwitchesNeedAPlanWithThem: on Basic auto_invoice and the digest cannot be switched on, while an
// engagement without automation and switching the digest off still work.
func TestAutomationSwitchesNeedAPlanWithThem(t *testing.T) {
	e := newEnv(t)
	billingtest.Wire(t, e.st)
	b := e.workspace()
	billingtest.On(t, e.st, b.workspace, billing.Basic)
	cli := e.client(b)

	e.fails(b, "POST", "/api/v1/engagements", input(cli, map[string]any{"auto_invoice": true}), http.StatusForbidden, "feature_not_in_plan")
	if n := e.count(`SELECT count(*) FROM engagements WHERE workspace_id = $1`, b.workspace); n != 0 {
		t.Fatalf("%d engagements stored after the refusal", n)
	}
	e.create(b, input(cli, nil))
	e.fails(b, "PUT", "/api/v1/engagement-settings", map[string]any{"digest": true}, http.StatusForbidden, "feature_not_in_plan")
	e.do(b, "PUT", "/api/v1/engagement-settings", map[string]any{"digest": false}, http.StatusOK, nil)

	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.create(b, input(cli, map[string]any{"auto_invoice": true}))
	e.do(b, "PUT", "/api/v1/engagement-settings", map[string]any{"digest": true}, http.StatusOK, nil)
}

// TestDigestWaitsForAPlanWithEngagementAutomation: notices raised on Pro are not mailed in the digest after a
// downgrade to Basic; back on Pro the digest goes out.
func TestDigestWaitsForAPlanWithEngagementAutomation(t *testing.T) {
	e := newEnv(t)
	m := &jobMailer{}
	e.svc.SetMailer(m, "https://app.example.com")
	b := e.workspace()
	e.endingSoon(b)
	billingtest.Wire(t, e.st)
	notices := func() int {
		return e.count(`SELECT count(*) FROM engagement_notices n JOIN engagements g ON g.id = n.engagement_id WHERE g.workspace_id = $1`, b.workspace)
	}
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.tick(zurich("06:59")) // raises the notices; the digest goes from 07:00
	if m.count() != 0 || notices() == 0 {
		t.Fatalf("before 07:00: %d digests, notices %d", m.count(), notices())
	}
	billingtest.On(t, e.st, b.workspace, billing.Basic)
	e.tick(zurich("07:05"))
	if m.count() != 0 {
		t.Fatalf("Basic: %d digests", m.count())
	}
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.tick(zurich("08:05"))
	if m.count() != 1 {
		t.Fatalf("Pro: %d digests", m.count())
	}
}
