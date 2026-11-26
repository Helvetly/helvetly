package instalments

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

func TestReminderWaitsForOriginalPlanDeliveryOrManualHandoff(t *testing.T) {
	for name, uncertain := range map[string]bool{"refused": false, "uncertain": true} {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t)
			b := e.ready()
			p := e.plan(b, e.client(b, "billing@example.test"), map[string]any{"first_due_date": days(20).In(zone).Format(time.DateOnly), "lead_days": 20, "auto_send": true})
			if uncertain {
				e.mail.sendError = mail.ErrUncertain
			} else {
				e.mail.fail = true
			}
			e.tick(time.Now())
			id := *e.get(b, p.ID).Items[0].InvoiceID
			e.mail.fail = false
			e.mail.sendError = nil
			e.tick(days(16))
			if n := len(e.mail.with("Zahlungserinnerung")); n != 0 {
				t.Fatalf("reminders before original: %d", n)
			}
			_, lines, err := e.svc.DigestSection(context.Background(), store.Workspace{ID: b.workspace, Timezone: zone.String()}, days(16))
			action := "Send original invoice"
			if uncertain {
				action = "Check delivery"
			}
			if err != nil || !slices.ContainsFunc(lines, func(l engagements.DigestLine) bool {
				return strings.Contains(l.Text, action) && l.Path == invoicePath(id)
			}) {
				t.Fatalf("%+v, %v", lines, err)
			}
			e.do(b, "POST", "/api/v1/invoices/"+id+"/send", map[string]any{"email": false}, 200, nil)
			e.tick(days(16))
			e.tick(days(16))
			if n := len(e.mail.with("Zahlungserinnerung")); n != 1 {
				t.Fatalf("reminders after handoff: %d", n)
			}
		})
	}
}
