package invoices

import (
	"context"
	"net/http"
	"testing"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

// readyOn is ready with billing's gates wired and the workspace on plan.
func (e *env) readyOn(plan string) (*browser, string) {
	e.t.Helper()
	billingtest.Wire(e.t, e.st)
	b := e.workspace()
	billingtest.On(e.t, e.st, b.workspace, plan)
	e.do(b, "PUT", "/api/v1/invoice-settings", completeSettings, http.StatusOK, nil)
	return b, e.client(b, nil)
}

func (e *env) settings(b *browser) Settings {
	e.t.Helper()
	var got struct{ Data Settings }
	e.do(b, "GET", "/api/v1/invoice-settings", nil, http.StatusOK, &got)
	return got.Data
}

// A credit note or correction drafted on Pro is not issued after a downgrade to Basic, and nothing is numbered.
func TestCorrectionDraftNotIssuedOnBasic(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.readyOn(billing.Pro)
	src := e.issued(b, clientID, nil)
	cn := e.invoice(b, "POST", path(src.ID, "credit-note"), map[string]any{"lines": []any{line("1", "10")}}, http.StatusCreated)
	other := e.issued(b, clientID, nil)
	cor := e.invoice(b, "POST", path(other.ID, "correct"), nil, http.StatusCreated)

	billingtest.On(t, e.st, b.workspace, billing.Basic)
	for _, d := range []Invoice{cn, cor} {
		e.fails(b, "POST", path(d.ID, "issue"), nil, http.StatusForbidden, "feature_not_in_plan")
		if got := e.invoice(b, "GET", path(d.ID), nil, http.StatusOK); got.Status != "draft" || got.Number != nil {
			t.Fatalf("%s after the refusal: %s %v", d.Kind, got.Status, got.Number)
		}
	}
	var events int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND subject_id = ANY($2)`,
		b.workspace, []string{cn.ID, cor.ID}).Scan(&events); err != nil || events != 0 {
		t.Fatalf("financial events of the refused drafts: %d %v", events, err)
	}

	billingtest.On(t, e.st, b.workspace, billing.Pro)
	if got := e.invoice(b, "POST", path(cn.ID, "issue"), nil, http.StatusOK); got.Number == nil {
		t.Fatal("the credit note was not issued back on Pro")
	}
}

// Switching an automation on needs a plan with it; one switched on before stays while the rest of the settings change.
func TestAutomationSwitchesNeedPlan(t *testing.T) {
	e := newEnv(t)
	b, _ := e.readyOn(billing.Basic)
	on := map[string]any{"dunning": map[string]any{"enabled": true}}
	e.fails(b, "PUT", "/api/v1/invoice-settings", on, http.StatusForbidden, "feature_not_in_plan")
	if e.settings(b).Dunning.Enabled {
		t.Fatal("dunning switched on on Basic")
	}
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"instalments": map[string]any{"plan_auto_send": false}}, http.StatusOK, nil)
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"instalments": map[string]any{"plan_auto_send": true}},
		http.StatusForbidden, "feature_not_in_plan")

	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.do(b, "PUT", "/api/v1/invoice-settings", on, http.StatusOK, nil)

	billingtest.On(t, e.st, b.workspace, billing.Basic)
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"footer": "Danke", "dunning": map[string]any{"enabled": true}}, http.StatusOK, nil)
	if got := e.settings(b); !got.Dunning.Enabled || got.Footer == nil || *got.Footer != "Danke" {
		t.Fatalf("settings saved on Basic: dunning %v footer %v", got.Dunning.Enabled, got.Footer)
	}
}

// An issued invoice's reminders go off on Basic but not on.
func TestIssuedInvoiceRemindersNeedPlan(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.readyOn(billing.Basic)
	inv := e.issued(b, clientID, nil)
	if got := e.sched(b, "PATCH", path(inv.ID), map[string]any{"reminders_enabled": false}, http.StatusOK); got.RemindersEnabled {
		t.Fatal("reminders still on")
	}
	e.fails(b, "PATCH", path(inv.ID), map[string]any{"reminders_enabled": true}, http.StatusForbidden, "feature_not_in_plan")
	if got := e.sched(b, "GET", path(inv.ID), nil, http.StatusOK); got.RemindersEnabled {
		t.Fatal("reminders switched on on Basic")
	}
}

// A draft takes, and is issued with, an instalment schedule only on a plan with instalment plans; on Basic it can
// still drop one.
func TestInstalmentScheduleNeedsPlan(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.readyOn(billing.Basic)
	e.fails(b, "POST", "/api/v1/invoices", map[string]any{"client_id": clientID, "lines": []any{line("1", "1000.00")}, "instalments": monthly3},
		http.StatusForbidden, "feature_not_in_plan")
	plain := e.draft1081(b, clientID, nil)
	e.fails(b, "PATCH", path(plain.ID), map[string]any{"instalments": monthly3}, http.StatusForbidden, "feature_not_in_plan")

	billingtest.On(t, e.st, b.workspace, billing.Pro)
	withPlan := e.draft1081(b, clientID, map[string]any{"instalments": monthly3})
	if withPlan.Instalments == nil || len(withPlan.Instalments.Items) != 3 {
		t.Fatalf("schedule on Pro: %+v", withPlan.Instalments)
	}

	billingtest.On(t, e.st, b.workspace, billing.Basic)
	// Drafted on Pro, it is not issued with its schedule on Basic either.
	e.fails(b, "POST", path(withPlan.ID, "issue"), map[string]any{}, http.StatusForbidden, "feature_not_in_plan")
	if got := e.sched(b, "PATCH", path(withPlan.ID), map[string]any{"instalments": nil}, http.StatusOK); got.Instalments != nil {
		t.Fatalf("schedule kept: %+v", got.Instalments)
	}
}

// Sending to a client that asked for XML needs Business: on Pro nothing goes out, on Business the XML is attached.
func TestEInvoiceSendNeedsBusiness(t *testing.T) {
	e := newEnv(t)
	b, _ := e.readyOn(billing.Business)
	e.svc.SetEInvoice(func(_ context.Context, _ store.Session, inv store.Invoice, _ string) (string, []byte, error) {
		return *inv.Number + ".xml", []byte("<Invoice/>"), nil
	})
	public := e.client(b, map[string]any{"name": "Stadt Bonn", "country": "DE", "einvoice_format": "xrechnung_ubl",
		"leitweg_id": "04011000-1234512345-06"})
	inv := e.issued(b, public, nil)

	billingtest.On(t, e.st, b.workspace, billing.Pro)
	sent := len(e.mail.sent)
	e.fails(b, "POST", path(inv.ID, "send"), map[string]any{}, http.StatusForbidden, "feature_not_in_plan")
	if len(e.mail.sent) != sent {
		t.Fatal("sent on Pro")
	}

	billingtest.On(t, e.st, b.workspace, billing.Business)
	e.do(b, "POST", path(inv.ID, "send"), map[string]any{}, http.StatusOK, nil)
	if m := e.mail.sent[len(e.mail.sent)-1]; len(m.Attachments) != 2 || m.Attachments[1].Name != *inv.Number+".xml" {
		t.Fatalf("attachments on Business: %+v", m.Attachments)
	}
}

// TestSentWithHelvetlyByPlan: client email and the PDFs carry "Sent with Helvetly" on Free and Basic, never on Pro
// or Business (remove_branding), nor on a self-hosted server.
func TestSentWithHelvetlyByPlan(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	if got, err := e.svc.sentWith(ctx, e.workspace().workspace); err != nil || got {
		t.Fatalf("self-hosted: %v %v", got, err)
	}
	billingtest.Wire(t, e.st)
	for _, c := range []struct {
		plan string
		want bool
	}{{"", true}, {billing.Basic, true}, {billing.Pro, false}, {billing.Business, false}} {
		b := e.workspace()
		if c.plan != "" {
			billingtest.On(t, e.st, b.workspace, c.plan)
		}
		brand, err := e.svc.MailBrand(ctx, b.workspace)
		pdf, perr := e.svc.sentWith(ctx, b.workspace)
		if err != nil || perr != nil || brand.SentWith != c.want || pdf != c.want {
			t.Errorf("plan %q: email %v, PDF %v (%v %v), want %v", c.plan, brand.SentWith, pdf, err, perr, c.want)
		}
	}
}
