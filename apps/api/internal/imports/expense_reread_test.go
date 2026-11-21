package imports

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// draftWithReceipts stores a draft expense in ws with one stored receipt per file, oldest first.
func (e *env) draftWithReceipts(ws string, files ...[]byte) string {
	e.t.Helper()
	ctx, now := e.t.Context(), time.Now().UTC()
	exp, _, err := checkExpense(ctx, e.db.Q, ws, store.User{ID: "usr_a"}, now.Format(time.DateOnly),
		Data{"supplier_name": json.RawMessage(`"Swisscom"`), "amount": json.RawMessage(`"10.00"`), "vat_rate": json.RawMessage(`"8.1"`)})
	if err != nil {
		e.t.Fatal(err)
	}
	if err := e.db.CreateExpense(ctx, ws, &exp, now); err != nil {
		e.t.Fatal(err)
	}
	for i, data := range files {
		r := store.Receipt{ID: auth.NewID("rcp"), Name: "page.png", ContentType: typePNG, Size: int64(len(data)), CreatedAt: now.Add(time.Duration(i) * time.Second)}
		r.ObjectKey = "workspaces/" + ws + "/expenses/" + exp.ID + "/" + r.ID + "/receipt.png"
		e.files.objects[r.ObjectKey] = data
		if err := e.db.CreateReceipt(ctx, ws, exp.ID, "usr_a", r); err != nil {
			e.t.Fatal(err)
		}
	}
	return exp.ID
}

func (e *env) reread(id, requestID string) *httptest.ResponseRecorder {
	e.t.Helper()
	return e.do("POST", "/api/v1/expenses/"+id+"/read", map[string]any{"request_id": requestID})
}

func TestRereadReadsADraftsReceiptsAndStoresNothing(t *testing.T) {
	e := previewEnv(t)
	c := e.category("ws_a")
	first := pngBytes(t)
	second := append(pngBytes(t), 0) // a different page, still a valid PNG
	id := e.draftWithReceipts("ws_a", first, second)
	e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){answer(recordJSON(t, threeRates(*c.Preset)))}
	w := e.reread(id, "request-0001")
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	got := decode[receiptReading](t, w)
	if len(got.VATBreakdown) != 3 || got.Category == nil || got.Category.ID != c.ID {
		t.Errorf("reading %+v", got)
	}
	files := e.model.seen[0].Files
	if len(files) != 2 || string(files[0].Bytes) != string(first) || string(files[1].Bytes) != string(second) {
		t.Errorf("pages sent out of order: %d files", len(files))
	}
	exp, err := e.db.Expense(t.Context(), "ws_a", id, "2026-01-01", false)
	if err != nil || value(exp.SupplierName) != "Swisscom" || e.files.puts != 0 {
		t.Errorf("the draft changed: %+v %v, %d puts", exp.SupplierName, err, e.files.puts)
	}
	if w := e.reread(id, "request-0001"); w.Code != http.StatusConflict || code(w) != "receipt_already_read" {
		t.Errorf("repeat: %d %s", w.Code, w.Body)
	}
}

func TestRereadRefusals(t *testing.T) {
	e := previewEnv(t)
	e.person("ws_b", "usr_b", "owner", nil)
	draft := e.draftWithReceipts("ws_a", pngBytes(t))
	booked := e.draftWithReceipts("ws_a", pngBytes(t))
	if _, err := e.raw.Exec(t.Context(), `UPDATE expenses SET status = 'booked', booked_at = now() WHERE id = $1`, booked); err != nil {
		t.Fatal(err)
	}
	bare := e.draftWithReceipts("ws_a")
	foreign := e.draftWithReceipts("ws_b", pngBytes(t))
	reader := e.person("ws_a", "usr_reader", "member", []string{"read:*"})
	clerk := e.person("ws_a", "usr_clerk", "member", []string{"read:*", "write:expenses"}) // no AI approval of their own

	for name, c := range map[string]struct {
		as     *store.Session
		id     string
		status int
		code   string
	}{
		"booked":              {e.sess, booked, http.StatusConflict, "expense_not_draft"},
		"no receipt":          {e.sess, bare, http.StatusUnprocessableEntity, "no_readable_file"},
		"another workspace's": {e.sess, foreign, http.StatusNotFound, "not_found"},
		"unknown":             {e.sess, "exp_missing", http.StatusNotFound, "not_found"},
		"a reader":            {reader, draft, http.StatusForbidden, "forbidden"},
		"without approval":    {clerk, draft, http.StatusForbidden, "ai_consent_required"},
	} {
		t.Run(name, func(t *testing.T) {
			if w := e.as(c.as).reread(c.id, "request-0001"); w.Code != c.status || code(w) != c.code {
				t.Errorf("%d %s", w.Code, w.Body)
			}
		})
	}
	e.as(e.sess)
	if w := e.reread(draft, "x"); w.Code != http.StatusBadRequest {
		t.Errorf("bad request id: %d %s", w.Code, w.Body)
	}
	if n := e.model.calls.Load(); n != 0 {
		t.Errorf("the model was called %d times", n)
	}
}

// A failed call is still charged to the automation pool (its whole reservation when no usage is reported), never Heidi's.
func TestRereadFailureChargesTheAutomationPool(t *testing.T) {
	e := previewEnv(t)
	id := e.draftWithReceipts("ws_a", pngBytes(t))
	e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){func(aimodel.Request) (aimodel.Reply, error) {
		return aimodel.Reply{}, http.ErrHandlerTimeout
	}}
	if w := e.reread(id, "request-0001"); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var pool string
	var reserved, charged int64
	if err := e.raw.QueryRow(t.Context(), `SELECT pool, reserved_tokens, coalesce(total_tokens, reserved_tokens) FROM ai_calls
		WHERE workspace_id = 'ws_a' AND operation LIKE 'rcp_%'`).Scan(&pool, &reserved, &charged); err != nil {
		t.Fatal(err)
	}
	if pool != "automation" || reserved == 0 || charged != reserved {
		t.Errorf("pool %s reserved %d charged %d", pool, reserved, charged)
	}
}

// The same action sent twice at once reads once.
func TestRereadConcurrentRepeatReadsOnce(t *testing.T) {
	e := previewEnv(t)
	id := e.draftWithReceipts("ws_a", pngBytes(t))
	slow := func(aimodel.Request) (aimodel.Reply, error) {
		time.Sleep(100 * time.Millisecond)
		return answer(`{"records":[{"supplier":{"name":"Swisscom"}}]}`)(aimodel.Request{})
	}
	e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){slow, slow}
	var wg sync.WaitGroup
	codes := make([]int, 2)
	for i := range codes {
		wg.Go(func() { codes[i] = e.reread(id, "request-0001").Code })
	}
	wg.Wait()
	if n := e.model.calls.Load(); n != 1 {
		t.Errorf("model calls = %d, answers %v", n, codes)
	}
	if codes[0] != 200 && codes[1] != 200 {
		t.Errorf("answers %v", codes)
	}
}
