package dunning

import (
	"net/http"
	"testing"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
)

// TestRemindersWaitForAPlanWithThem: on Basic a due reminder is neither sent nor recorded, and sending by hand is
// refused; after the upgrade to Pro the next tick sends it (paused, not lost).
func TestRemindersWaitForAPlanWithThem(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	id := e.invoice(b, nil)
	billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, b.workspace, billing.Basic)

	e.tickAt(10)
	if got := e.mail.subjects(); len(got) != 0 {
		t.Fatalf("sent on Basic: %v", got)
	}
	if st := e.status(b, id); len(st.Notices) != 0 {
		t.Fatalf("notices on Basic: %+v", st.Notices)
	}
	e.fails(b, "POST", "/api/v1/invoices/"+id+"/dunning/send", http.StatusForbidden, "feature_not_in_plan")
	if got := e.mail.subjects(); len(got) != 0 {
		t.Fatalf("sent by hand on Basic: %v", got)
	}

	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.tickAt(11)
	if got := e.mail.subjects(); len(got) != 1 {
		t.Fatalf("on Pro: %v", got)
	}
	if st := e.status(b, id); len(st.Notices) != 1 {
		t.Fatalf("notices on Pro: %+v", st.Notices)
	}
}
