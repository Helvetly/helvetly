package instalments

import (
	"context"
	"fmt"
	"testing"
	"time"

	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

type auditUncertain struct{ attempts int }

func (m *auditUncertain) Send(_ context.Context, _ mail.Message) error {
	m.attempts++
	if m.attempts == 1 {
		return mail.ErrUncertain
	}
	return nil
}
func TestUncertainInstalmentReminder(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	plan := e.plan(b, e.client(b, "ap@example.test"), map[string]any{"first_due_date": days(20).In(zone).Format(time.DateOnly), "lead_days": 20, "auto_send": false})
	e.tick(time.Now())
	m := &auditUncertain{}
	e.svc.SetMailer(m)
	e.tick(days(16))
	e.tick(days(16))
	if m.attempts != 1 || e.count("SELECT count(*) FROM reminder_log WHERE confirmed=false") != 1 {
		t.Fatalf("attempts %d", m.attempts)
	}
	var detail struct{ Data store.Invoice }
	e.do(b, "GET", "/api/v1/invoices/"+*e.get(b, plan.ID).Items[0].InvoiceID, nil, 200, &detail)
	if len(detail.Data.UnconfirmedReminders) != 1 || detail.Data.UnconfirmedReminders[0].Seq != 1 {
		t.Fatal(detail.Data.UnconfirmedReminders)
	}
}
func TestReminderAfterOptOutAndAddressChange(t *testing.T) {
	for name, optOut := range map[string]bool{"disabled": true, "address changed": false} {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t)
			b := e.ready()
			client := e.client(b, "old@example.test")
			p := e.plan(b, client, map[string]any{"first_due_date": days(20).In(zone).Format(time.DateOnly), "lead_days": 20, "auto_send": false})
			e.tick(time.Now())
			id := *e.get(b, p.ID).Items[0].InvoiceID
			e.svc.files = &paymentDuringRemind{Storage: e.svc.files, pay: func() {
				_, err := e.pool.Exec(context.Background(), "UPDATE clients SET email=$2 WHERE id=$1", client, "new@example.test")
				if err != nil {
					t.Fatal(err)
				}
				if optOut {
					e.do(b, "PATCH", "/api/v1/invoices/"+id, map[string]any{"reminders_enabled": false}, 200, nil)
				}
			}}
			e.tick(days(16))
			msgs := e.mail.with("Zahlungserinnerung")
			if optOut && len(msgs) != 0 || !optOut && (len(msgs) != 1 || msgs[0].To[0] != "new@example.test") {
				t.Fatalf("%+v", msgs)
			}
		})
	}
}
func TestPlanEmailFormat(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	c := e.client(b, "ap@example.test")
	_, err := e.pool.Exec(context.Background(), "UPDATE clients SET einvoice_format='xrechnung_ubl' WHERE id=$1", c)
	if err != nil {
		t.Fatal(err)
	}
	asked := 0
	exportFails := true
	e.svc.inv.SetEInvoice(func(_ context.Context, _ store.Session, _ store.Invoice, format string) (string, []byte, error) {
		asked++
		if exportFails {
			return "", nil, fmt.Errorf("export failed")
		}
		return "invoice.xml", []byte("<Invoice/>"), nil
	})
	p := e.plan(b, c, nil)
	e.tick(time.Now())
	id := *e.get(b, p.ID).Items[0].InvoiceID
	if len(e.mail.with("")) != 0 {
		t.Fatal("automated invoice sent without the required XML")
	}
	e.do(b, "POST", "/api/v1/invoices/"+id+"/send", map[string]any{}, 500, nil)
	if len(e.mail.with("")) != 0 {
		t.Fatal("manual invoice sent without the required XML")
	}
	exportFails = false
	e.tick(time.Now())
	auto := e.mail.with("")[0]
	e.do(b, "POST", "/api/v1/invoices/"+id+"/send", map[string]any{}, 200, nil)
	msgs := e.mail.with("")
	manual := msgs[len(msgs)-1]
	if len(auto.Attachments) != 2 || len(manual.Attachments) != 2 || asked != 4 || string(auto.Attachments[1].Data) != string(manual.Attachments[1].Data) {
		t.Fatalf("auto=%d manual=%d exports=%d", len(auto.Attachments), len(manual.Attachments), asked)
	}
}

func TestImpossiblePlan(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	c := e.client(b, "ap@example.test")
	var draft struct{ Data struct{ ID string } }
	e.do(b, "POST", "/api/v1/invoices", map[string]any{"client_id": c, "currency": "EUR", "lines": []any{map[string]any{"description": "unit", "quantity": "1", "unit_price": "0.01"}}}, 201, &draft)
	url := "/api/v1/invoices/" + draft.Data.ID
	e.do(b, "POST", url+"/plan", map[string]any{"count": 3, "interval": "monthly", "first_due_date": today()}, 422, nil)
	e.do(b, "PATCH", url, map[string]any{"reference": "editable"}, 200, nil)
}
func TestAutoManualDuplicateDelivery(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	c := e.client(b, "ap@example.test")
	e.mail.fail = true
	p := e.plan(b, c, nil)
	e.tick(time.Now())
	id := *e.get(b, p.ID).Items[0].InvoiceID
	e.mail.fail = false
	e.mail.delay = 500 * time.Millisecond
	finish := make(chan error, 1)
	go func() { finish <- e.svc.Tick(context.Background(), time.Now()) }()
	deadline := time.Now().Add(4 * time.Second)
	for e.count("SELECT count(*) FROM invoices WHERE id=$1 AND send_claimed_at IS NOT NULL", id) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("worker did not claim")
		}
		time.Sleep(time.Millisecond * 5)
	}
	e.do(b, "POST", "/api/v1/invoices/"+id+"/send", map[string]any{}, 409, nil)
	if err := <-finish; err != nil {
		t.Fatal(err)
	}
	n := e.count("SELECT count(*) FROM invoice_deliveries WHERE invoice_id=$1", id)
	if n != 1 {
		t.Fatalf("deliveries %d", n)
	}
	e.do(b, "POST", "/api/v1/invoices/"+id+"/send", map[string]any{}, 200, nil)
}

func TestCorrectionPlanDoubleReceivable(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	c := e.client(b, "ap@example.test")
	var original, corrected struct{ Data struct{ ID string } }
	root := "/api/v1/invoices"
	e.do(b, "POST", root, map[string]any{"client_id": c, "lines": []any{map[string]any{"description": "Service", "quantity": "1", "unit_price": "100.00"}}}, 201, &original)
	e.do(b, "POST", root+"/"+original.Data.ID+"/issue", nil, 200, nil)
	e.do(b, "POST", root+"/"+original.Data.ID+"/correct", nil, 201, &corrected)

	e.do(b, "POST", root+"/"+corrected.Data.ID+"/plan", map[string]any{"count": 2, "interval": "monthly", "first_due_date": today(), "auto_send": false}, 422, nil)
	e.tick(time.Now())
	e.tick(days(35))
	var s struct{ Data store.InvoiceSummary }
	e.do(b, "GET", root+"/summary?client_id="+c, nil, 200, &s)
	if s.Data.Outstanding.Count != 1 || s.Data.Outstanding.Amount != 10810 {
		t.Fatalf("outstanding %+v", s.Data.Outstanding)
	}
}

func TestUnconfirmedInvoiceSendStopsWorkerRetry(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	e.mail.sendError = mail.ErrUncertain
	plan := e.plan(b, e.client(b, "ap@example.test"), nil)
	e.tick(time.Now())
	id := *e.get(b, plan.ID).Items[0].InvoiceID
	e.mail.sendError = nil
	e.tick(time.Now())
	e.tick(time.Now().Add(time.Hour))
	var detail struct{ Data store.Invoice }
	e.do(b, "GET", "/api/v1/invoices/"+id, nil, 200, &detail)
	if e.mail.attempts != 1 || detail.Data.SendUncertainAt == nil || detail.Data.SentAt != nil {
		t.Fatal(e.mail.attempts, detail.Data.SendUncertainAt, detail.Data.SentAt)
	}
	e.do(b, "POST", "/api/v1/invoices/"+id+"/send", map[string]any{}, 200, nil)
	if e.mail.attempts != 2 {
		t.Fatal(e.mail.attempts)
	}
	e.mail.sendError = mail.ErrUncertain
	var outcome struct{ Error struct{ Code string } }
	e.do(b, "POST", "/api/v1/invoices/"+id+"/send", map[string]any{}, 502, &outcome)
	if outcome.Error.Code != "delivery_uncertain" {
		t.Fatal(outcome.Error.Code)
	}
}

func TestAcceptedInvoiceWithLostReceiptIsNotRetried(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	ctx := context.Background()
	// Simulate losing the acknowledgement record after the mail server has accepted the invoice.
	if _, err := e.pool.Exec(ctx, `CREATE FUNCTION refuse_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated receipt failure'; END $$;
		CREATE TRIGGER refuse_delivery BEFORE INSERT ON invoice_deliveries FOR EACH ROW EXECUTE FUNCTION refuse_delivery()`); err != nil {
		t.Fatal(err)
	}
	plan := e.plan(b, e.client(b, "ap@example.test"), nil)
	e.tick(time.Now())
	id := *e.get(b, plan.ID).Items[0].InvoiceID
	if _, err := e.pool.Exec(ctx, `DROP TRIGGER refuse_delivery ON invoice_deliveries`); err != nil {
		t.Fatal(err)
	}
	e.tick(time.Now().Add(time.Hour))
	if len(e.mail.with("")) != 1 || e.count("SELECT count(*) FROM invoices WHERE id=$1 AND send_uncertain_at IS NOT NULL AND sent_at IS NULL", id) != 1 {
		t.Fatal("worker retried an accepted message or lost its intent")
	}
}
