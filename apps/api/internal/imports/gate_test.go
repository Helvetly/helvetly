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

// TestBasicImportsClientsAndProducts: kinds every plan has are read and committed on Basic.
func TestBasicImportsClientsAndProducts(t *testing.T) {
	e := planEnv(t, billing.Basic)
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

// TestBasicRefusesAnExpensesUpload: the refusal comes before a file is stored, a batch made or the model asked.
func TestBasicRefusesAnExpensesUpload(t *testing.T) {
	e := planEnv(t, billing.Basic)
	w := e.upload("expenses", map[string][]byte{"r.jpg": append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, "receipt"...)})
	if w.Code != 403 || code(w) != "feature_not_in_plan" {
		t.Fatalf("upload: %d %s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), `"required_plan":"pro"`) {
		t.Fatalf("details: %s", w.Body)
	}
	if e.files.puts != 0 || e.model.calls.Load() != 0 {
		t.Fatalf("puts=%d calls=%d after the refusal", e.files.puts, e.model.calls.Load())
	}
	if list := decode[[]store.ImportBatchSummary](t, e.do("GET", "/api/v1/imports?kind=expenses", nil)); len(list) != 0 {
		t.Fatalf("batches: %+v", list)
	}
}

// TestAutoBatchCommitsOnlyWhatThePlanHas: an auto batch holding a client and an expense creates the client on Basic
// and fails the expense with feature_not_in_plan; on Pro the expense is created.
func TestAutoBatchCommitsOnlyWhatThePlanHas(t *testing.T) {
	e := planEnv(t, billing.Basic)
	byFile := func(r aimodel.Request) (aimodel.Reply, error) {
		if strings.Contains(r.Message, "Migros") {
			return answer(`{"document_type":"bill","clients":[],"products":[],"invoices":[],"engagements":[],
				"expenses":[{"supplier_name":"Migros","amount":"108.10","vat_rate":"8.1"}]}`)(r)
		}
		return answer(`{"document_type":"client_list","clients":[{"name":"Acme AG"}],"products":[],"invoices":[],
			"engagements":[],"expenses":[]}`)(r)
	}
	e.model.replies = append(e.model.replies, byFile, byFile)
	w := e.upload(Auto, map[string][]byte{"bill.txt": []byte("Migros receipt"), "clients.txt": []byte("Customer list")})
	if w.Code != 201 {
		t.Fatalf("upload: %d %s", w.Code, w.Body)
	}
	b := e.extracted(decode[store.ImportBatch](t, w).ID)
	if len(autoRecords(b, "clients")) != 1 || len(autoRecords(b, "expenses")) != 1 {
		t.Fatalf("records: %+v", b.Records)
	}
	expense := autoRecords(b, "expenses")[0].ID
	status := map[string]commitResult{}
	for _, r := range e.commitAll(b) {
		status[r.ID] = r
	}
	client := status[autoRecords(b, "clients")[0].ID]
	if client.Status != "created" || status[expense].Status != "failed" || status[expense].Error == nil ||
		status[expense].Error.Code != "feature_not_in_plan" {
		t.Fatalf("Basic commit: %+v", status)
	}
	if n := e.expenseCount("ws_a"); n != 0 {
		t.Fatalf("Basic: %d expenses", n)
	}

	billingtest.On(t, e.db, "ws_a", billing.Pro)
	w = e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": []string{expense}})
	if res := decode[commitOut](t, w).Results; len(res) != 1 || res[0].Status != "created" {
		t.Fatalf("Pro commit: %d %s", w.Code, w.Body)
	}
	if n := e.expenseCount("ws_a"); n != 1 {
		t.Fatalf("Pro: %d expenses", n)
	}
}

// TestDowngradeStopsAQueuedExpensesFile: an expenses file queued on Pro whose workspace moved to Basic fails before
// the model is asked, with the plan's message; another workspace on Pro reads and commits its own.
func TestDowngradeStopsAQueuedExpensesFile(t *testing.T) {
	e := planEnv(t, billing.Pro)
	other := e.person("ws_b", "usr_b", "owner", nil)
	billingtest.On(t, e.db, "ws_b", billing.Pro)
	e.consent("ws_b", "usr_b")
	e.model.replies = append(e.model.replies, answer(receiptReply))

	w := e.upload("expenses", map[string][]byte{"a.jpg": append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, "receipt a"...)})
	if w.Code != 201 {
		t.Fatalf("upload on Pro: %d %s", w.Code, w.Body)
	}
	queued := decode[store.ImportBatch](t, w)
	billingtest.On(t, e.db, "ws_a", billing.Basic)
	got := e.extracted(queued.ID)
	if f := got.Files[0]; f.Status != "failed" || f.Error == nil || !strings.Contains(*f.Error, "Pro") || e.model.calls.Load() != 0 {
		t.Fatalf("downgraded file: %+v calls=%d", f, e.model.calls.Load())
	}

	w = e.as(other).upload("expenses", map[string][]byte{"b.jpg": append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, "receipt b"...)})
	if w.Code != 201 {
		t.Fatalf("upload on ws_b: %d %s", w.Code, w.Body)
	}
	b := e.extracted(decode[store.ImportBatch](t, w).ID)
	if res := e.commitAll(b); len(res) != 1 || res[0].Status != "created" || e.expenseCount("ws_b") != 1 {
		t.Fatalf("ws_b commit: %+v", res)
	}
	if n := e.expenseCount("ws_a"); n != 0 {
		t.Fatalf("ws_a: %d expenses", n)
	}
}
