package imports

import (
	"context"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

const receiptReply = `{"records":[{"supplier_name":"Migros","amount":"108.10","vat_rate":"8.1"}]}`

// planEnv: the test env with billing's gate wired and ws_a (owner usr_a, consent given) on plan.
func planEnv(t *testing.T, plan string) *env {
	t.Helper()
	e := newEnv(t)
	billingtest.Wire(t, e.db)
	billingtest.On(t, e.db, "ws_a", plan)
	e.consent("ws_a", "usr_a")
	return e
}

func (e *env) expenseCount(ws string) int {
	e.t.Helper()
	_, total, err := e.db.ListExpenses(context.Background(), ws, time.Now().Format(time.DateOnly), store.ExpenseFilter{}, 10, 0)
	if err != nil {
		e.t.Fatal(err)
	}
	return total
}

func (e *env) commitAll(b store.ImportBatch) []commitResult {
	e.t.Helper()
	ids := []string{}
	for _, r := range b.Records {
		ids = append(ids, r.ID)
	}
	w := e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": ids})
	if w.Code != 200 {
		e.t.Fatalf("commit: %d %s", w.Code, w.Body)
	}
	return decode[commitOut](e.t, w).Results
}

// TestProImportsClientsAndProducts: kinds every AI-import plan has are read and committed on Pro.
func TestProImportsClientsAndProducts(t *testing.T) {
	e := planEnv(t, billing.Pro)
	for _, c := range []struct{ kind, name, csv string }{
		{"clients", "c.csv", "name,email\nAcme AG,office@acme.example\n"},
		{"products", "p.csv", "name,unit_price\nAudit,90\n"},
	} {
		w := e.upload(c.kind, map[string][]byte{c.name: []byte(c.csv)})
		if w.Code != 201 {
			t.Fatalf("%s upload: %d %s", c.kind, w.Code, w.Body)
		}
		b := e.extracted(decode[store.ImportBatch](t, w).ID)
		res := e.commitAll(b)
		if len(res) != 1 || res[0].Status != "created" || res[0].EntityID == nil {
			t.Fatalf("%s commit: %+v", c.kind, res)
		}
	}
}

// TestBasicRefusesTheAIImport: Basic has no AI import, so every kind the model reads is refused naming Pro, before a
// file is stored, a batch made or the model asked.
func TestBasicRefusesTheAIImport(t *testing.T) {
	e := planEnv(t, billing.Basic)
	for _, c := range []struct{ kind, name string }{
		{"clients", "c.csv"}, {"products", "p.csv"}, {"expenses", "r.jpg"}, {Auto, "bill.txt"},
	} {
		w := e.upload(c.kind, map[string][]byte{c.name: []byte("name\nAcme AG\n")})
		if w.Code != 403 || code(w) != "feature_not_in_plan" ||
			!strings.Contains(w.Body.String(), `"feature":"ai_import"`) || !strings.Contains(w.Body.String(), `"required_plan":"pro"`) {
			t.Fatalf("%s upload: %d %s", c.kind, w.Code, w.Body)
		}
	}
	if e.files.puts != 0 || e.model.calls.Load() != 0 {
		t.Fatalf("puts=%d calls=%d after the refusals", e.files.puts, e.model.calls.Load())
	}
	if list := decode[[]store.ImportBatchSummary](t, e.do("GET", "/api/v1/imports", nil)); len(list) != 0 {
		t.Fatalf("batches: %+v", list)
	}
}

// TestAutoBatchAsksOnlyForWhatThePlanHas: on Pro with expenses turned off for the workspace the model is not asked
// for expenses, so a bill fails with a plan message while a client list is read and committed; with Pro's own value
// back the schema asks for expenses again.
func TestAutoBatchAsksOnlyForWhatThePlanHas(t *testing.T) {
	e := planEnv(t, billing.Pro)
	if err := e.db.SetWorkspaceLimit(context.Background(), store.WorkspaceLimit{WorkspaceID: "ws_a", OfferID: "helvetly-v2",
		Key: store.FeatureExpenses, State: "disabled", Reason: "test", SetBy: "support"}); err != nil {
		t.Fatal(err)
	}
	byFile := func(r aimodel.Request) (aimodel.Reply, error) {
		if strings.Contains(r.Message, "Migros") {
			return answer(`{"document_type":"bill","clients":[],"products":[],"invoices":[],"engagements":[],
				"expenses":[{"supplier_name":"Migros","amount":"108.10","vat_rate":"8.1"}]}`)(r)
		}
		return answer(`{"document_type":"client_list","clients":[{"name":"Acme AG"}],"products":[],"invoices":[],
			"engagements":[],"expenses":[]}`)(r)
	}
	e.model.replies = append(e.model.replies, byFile, byFile, byFile)
	w := e.upload(Auto, map[string][]byte{"bill.txt": []byte("Migros receipt"), "clients.txt": []byte("Customer list")})
	if w.Code != 201 {
		t.Fatalf("upload: %d %s", w.Code, w.Body)
	}
	b := e.extracted(decode[store.ImportBatch](t, w).ID)
	for _, req := range e.model.seen {
		if _, ok := req.Schema.JSON["properties"].(map[string]any)["expenses"]; ok {
			t.Fatal("the schema asks for expenses")
		}
		if !strings.Contains(req.Instructions, "bill: nothing (this workspace's plan does not include expenses)") {
			t.Fatalf("instructions: %s", req.Instructions)
		}
	}
	if len(autoRecords(b, "clients")) != 1 || len(autoRecords(b, "expenses")) != 0 {
		t.Fatalf("records: %+v", b.Records)
	}
	for _, f := range b.Files {
		if f.Name == "bill.txt" && (f.Status != "failed" || f.Error == nil || !strings.Contains(*f.Error, "plan does not include expenses")) {
			t.Fatalf("bill file: %+v", f)
		}
	}
	if res := e.commitAll(b); len(res) != 1 || res[0].Status != "created" {
		t.Fatalf("commit without expenses: %+v", res)
	}

	if err := e.db.ClearWorkspaceLimit(context.Background(), "ws_a", "helvetly-v2", store.FeatureExpenses); err != nil {
		t.Fatal(err)
	}
	w = e.upload(Auto, map[string][]byte{"bill.txt": []byte("Migros receipt, again")})
	if w.Code != 201 {
		t.Fatalf("Pro upload: %d %s", w.Code, w.Body)
	}
	b = e.extracted(decode[store.ImportBatch](t, w).ID)
	last := e.model.seen[len(e.model.seen)-1]
	if _, ok := last.Schema.JSON["properties"].(map[string]any)["expenses"]; !ok {
		t.Fatal("Pro schema does not ask for expenses")
	}
	if res := e.commitAll(b); len(res) != 1 || res[0].Status != "created" || e.expenseCount("ws_a") != 1 {
		t.Fatalf("Pro commit: %+v", res)
	}
}
