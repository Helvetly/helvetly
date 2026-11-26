package clients

import (
	"context"
	"testing"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

func (e *env) client(b *browser, id string) store.Client {
	e.t.Helper()
	var out struct{ Data store.Client }
	e.do(b, "GET", "/api/v1/clients/"+id, nil, 200, &out)
	return out.Data
}

// On Basic the portal cannot be opened, by PATCH or POST, and no invitation goes out; turning it off still works.
func TestPortalNeedsPlanWithIt(t *testing.T) {
	e, m := newPortalEnv(t)
	billingtest.Wire(t, e.st)
	b := e.workspace()
	billingtest.On(t, e.st, b.workspace, billing.Business)
	c := e.create(b, address("Acme"))
	e.do(b, "PATCH", "/api/v1/clients/"+c.ID, map[string]any{"email": "ana@acme.ch", "portal_enabled": true}, 200, nil)
	other, _ := e.portalClient(b)
	invites := m.count()
	bulk := map[string]any{"action": "enable_portal", "ids": []string{c.ID}}
	ctx := context.Background()
	if err := e.st.SetPortalOff(ctx, b.workspace, true); err != nil {
		t.Fatal(err)
	}
	e.fails(b, "POST", "/api/v1/clients/bulk", bulk, 409, "portal_closed")
	if err := e.st.SetPortalOff(ctx, b.workspace, false); err != nil {
		t.Fatal(err)
	}

	billingtest.On(t, e.st, b.workspace, billing.Basic)
	e.do(b, "POST", "/api/v1/clients/bulk", map[string]any{"action": "disable_portal", "ids": []string{other}}, 200, nil)
	if e.client(b, other).PortalEnabled {
		t.Fatal("bulk disable left access on after downgrade")
	}
	e.do(b, "PATCH", "/api/v1/clients/"+c.ID, map[string]any{"portal_enabled": false}, 200, nil)
	e.fails(b, "POST", "/api/v1/clients/bulk", bulk, 403, "feature_not_in_plan")
	e.fails(b, "PATCH", "/api/v1/clients/"+c.ID, map[string]any{"portal_enabled": true}, 403, "feature_not_in_plan")
	if got := e.client(b, c.ID); got.PortalEnabled {
		t.Fatal("the portal was opened on Basic")
	}
	if m.count() != invites {
		t.Fatalf("an invitation went out on Basic: %d", m.count()-invites)
	}
	body := address("Beta")
	body["email"], body["portal_enabled"] = "bea@beta.ch", true
	e.fails(b, "POST", "/api/v1/clients", body, 403, "feature_not_in_plan")
	if n := e.list(b, "").Meta.Total; n != 2 {
		t.Fatalf("clients after the refused create: %d", n)
	}
}

// Asking for XML needs Business; a client that asked before keeps its format while other fields change on Pro.
func TestEInvoiceFormatNeedsBusiness(t *testing.T) {
	xml := map[string]any{"einvoice_format": "xrechnung_ubl", "leitweg_id": "991-33333test-33"}
	e := newEnv(t)
	billingtest.Wire(t, e.st)
	b := e.workspace()
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	pro := e.create(b, address("Stadt Bonn"))
	e.fails(b, "PATCH", "/api/v1/clients/"+pro.ID, xml, 403, "feature_not_in_plan")
	if got := e.client(b, pro.ID); got.EInvoiceFormat != "none" {
		t.Fatalf("format saved on Pro: %s", got.EInvoiceFormat)
	}

	billingtest.On(t, e.st, b.workspace, billing.Business)
	e.do(b, "PATCH", "/api/v1/clients/"+pro.ID, xml, 200, nil)

	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.do(b, "PATCH", "/api/v1/clients/"+pro.ID, map[string]any{"name": "Stadt Bonn Amt", "einvoice_format": "xrechnung_ubl"}, 200, nil)
	if got := e.client(b, pro.ID); got.Name != "Stadt Bonn Amt" || got.EInvoiceFormat != "xrechnung_ubl" {
		t.Fatalf("after editing on Pro: %s %s", got.Name, got.EInvoiceFormat)
	}
	e.fails(b, "PATCH", "/api/v1/clients/"+pro.ID, map[string]any{"einvoice_format": "xrechnung_cii"}, 403, "feature_not_in_plan")
}
