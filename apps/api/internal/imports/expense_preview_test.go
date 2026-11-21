package imports

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

func pngBytes(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// previewEnv: planEnv-like (consent given) with the preview route registered. The consent line goes when the
// consent-free imports.go lands (ai-on-by-default).
func previewEnv(t *testing.T) *env {
	t.Helper()
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	return e
}

// preview posts a multipart form; extra are the form's other parts (name to value), file the receipt (nil = none).
func (e *env) preview(requestID string, file []byte, extra map[string]string) *httptest.ResponseRecorder {
	e.t.Helper()
	if file == nil {
		return e.previewPages(requestID, nil, extra)
	}
	return e.previewPages(requestID, [][]byte{file}, extra)
}

// previewPages posts several files as the pages of one receipt.
func (e *env) previewPages(requestID string, files [][]byte, extra map[string]string) *httptest.ResponseRecorder {
	e.t.Helper()
	var b bytes.Buffer
	form := multipart.NewWriter(&b)
	if requestID != "" {
		_ = form.WriteField("request_id", requestID)
	}
	for k, v := range extra {
		_ = form.WriteField(k, v)
	}
	for i, file := range files {
		f, _ := form.CreateFormFile("file", fmt.Sprintf("page-%d.png", i))
		_, _ = f.Write(file)
	}
	_ = form.Close()
	r := httptest.NewRequest("POST", "/api/v1/expenses/receipt-preview", &b)
	r.Header.Set("Content-Type", form.FormDataContentType())
	w := httptest.NewRecorder()
	e.mux.ServeHTTP(w, r)
	return w
}

func recordJSON(t *testing.T, fields map[string]any) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"records": []any{fields}})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// threeRates is a Swiss receipt at all three rates whose items, bands and totals agree.
func threeRates(categoryKey string) map[string]any {
	band := func(rate, net, vat, gross string) map[string]any {
		return map[string]any{"rate": rate, "net": net, "vat": vat, "gross": gross}
	}
	item := func(d, amount, rate string) map[string]any {
		return map[string]any{"description": d, "quantity": "1", "unit_price": amount, "amount": amount, "vat_rate": rate, "category": nil}
	}
	return map[string]any{
		"supplier":    map[string]any{"name": " Hotel Alpina ", "vat_number": "CHE-123.456.789 MWST", "country": "ch", "iban": "ch93 0076 2011 6238 5295 7"},
		"document":    map[string]any{"type": "invoice", "number": "R-1", "date": "2026-03-01", "due_date": "2026-03-31", "service_period": map[string]any{"from": nil, "to": nil}},
		"description": "Seminar", "currency": "chf",
		"totals":         map[string]any{"net": "300.00", "vat": "14.50", "gross": "314.50"},
		"vat_breakdown":  []any{band("8.1", "100.00", "8.10", "108.10"), band("2.6", "100.00", "2.60", "102.60"), band("3.8", "100.00", "3.80", "103.80")},
		"items":          []any{item("Room", "103.80", "3.8"), item("Dinner", "108.10", "8.1"), item("Books", "102.60", "2.6")},
		"payment":        map[string]any{"status": "paid", "method": "card", "paid_on": "2026-03-01"},
		"reverse_charge": false,
		"category":       map[string]any{"key": categoryKey, "confidence": 0.92, "reason": "a hotel bill"},
		"confidence":     map[string]any{"supplier": "high", "document": "high", "totals": "high", "vat_breakdown": "high", "items": "medium", "payment": "high"},
	}
}

func (e *env) category(ws string) store.ExpenseCategory {
	e.t.Helper()
	if err := e.db.SeedExpenseCategories(e.t.Context(), ws, func() string { return auth.NewID("exc") }, time.Now()); err != nil {
		e.t.Fatal(err)
	}
	list, err := e.db.ExpenseCategories(e.t.Context(), ws, false)
	if err != nil || len(list) == 0 {
		e.t.Fatal(list, err)
	}
	return list[0]
}

func TestPreviewReadsTheFullBreakdownAndStoresNothing(t *testing.T) {
	e := previewEnv(t)
	c := e.category("ws_a")
	e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){answer(recordJSON(t, threeRates(*c.Preset)))}
	w := e.previewPages("request-0001", [][]byte{pngBytes(t), pngBytes(t)}, nil)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	got := decode[receiptReading](t, w)
	if len(got.VATBreakdown) != 3 || len(got.Items) != 3 || len(got.Issues) != 0 {
		t.Errorf("bands %d items %d issues %v", len(got.VATBreakdown), len(got.Items), got.Issues)
	}
	if value(got.Supplier.Name) != "Hotel Alpina" || value(got.Supplier.Country) != "CH" || value(got.Currency) != "CHF" ||
		value(got.Supplier.IBAN) != "CH9300762011623852957" || got.Payment.Status != "paid" || value(got.Payment.Method) != "card" {
		t.Errorf("normalised: %+v", got)
	}
	if got.Category == nil || got.Category.ID != c.ID || got.Category.Name != c.Name || got.Category.Confidence != 0.92 {
		t.Errorf("category %+v, want %s", got.Category, c.ID)
	}
	for g, l := range got.Confidence {
		if l == "low" {
			t.Errorf("%s is low", g)
		}
	}
	seen := e.model.seen[0]
	if len(seen.Files) != 2 || !strings.Contains(seen.Instructions, *c.Preset+" | "+c.Name+" | "+c.AccountCode) {
		t.Errorf("files %d, instructions lack the category list: %s", len(seen.Files), seen.Instructions)
	}
	if n := e.expenseCount("ws_a"); n != 0 || e.files.puts != 0 {
		t.Errorf("stored: %d expenses, %d files", n, e.files.puts)
	}
	if batches, err := e.db.ImportBatches(t.Context(), "ws_a", "usr_a", "expenses", nil); err != nil || len(batches) != 0 {
		t.Errorf("batches %v %v", batches, err)
	}
	var pool string
	if err := e.raw.QueryRow(t.Context(), `SELECT pool FROM ai_calls WHERE workspace_id = 'ws_a'`).Scan(&pool); err != nil || pool != "automation" {
		t.Errorf("pool %q %v", pool, err)
	}
}

// checkReceipt keeps every figure but marks a disagreement low with a message, and never invents a category.
func TestCheckReceiptCrossChecks(t *testing.T) {
	categories := []receiptCategory{{Key: "telecom", ID: "exc_1", Name: "Telecom", AccountCode: "6510"}}
	for name, c := range map[string]struct {
		change func(map[string]any)
		group  string // the part set low with an issue; "" = none
		check  func(receiptReading) bool
	}{
		"all agree":       {func(map[string]any) {}, "", nil},
		"totals disagree": {func(r map[string]any) { r["totals"].(map[string]any)["vat"] = "20.00" }, "totals", nil},
		"bands short of the total": {func(r map[string]any) {
			r["vat_breakdown"] = r["vat_breakdown"].([]any)[:2]
			r["items"] = []any{}
		}, "vat_breakdown", nil},
		"items short of the total": {func(r map[string]any) { r["items"] = r["items"].([]any)[:2] }, "items", nil},
		"items add up to the net": {func(r map[string]any) {
			r["items"] = []any{map[string]any{"description": "All", "quantity": nil, "unit_price": nil, "amount": "300.00", "vat_rate": nil, "category": "telecom"}}
		}, "", func(r receiptReading) bool { return value(r.Items[0].CategoryID) == "exc_1" }},
		"no Swiss rate": {func(r map[string]any) { r["vat_breakdown"].([]any)[0].(map[string]any)["rate"] = "9.5" }, "vat_breakdown", nil},
		"a foreign rate is its own": {func(r map[string]any) {
			r["supplier"].(map[string]any)["country"] = "DE"
			r["vat_breakdown"].([]any)[0].(map[string]any)["rate"] = "19"
		}, "", nil},
		"a band without its rate": {func(r map[string]any) { r["vat_breakdown"].([]any)[1].(map[string]any)["rate"] = nil }, "vat_breakdown", nil},
		"a bad date": {func(r map[string]any) { r["document"].(map[string]any)["date"] = "1.3.2026" }, "document",
			func(r receiptReading) bool { return r.Document.Date == nil }},
		"an unreadable amount": {func(r map[string]any) { r["totals"].(map[string]any)["gross"] = "CHF 314,50" }, "totals", nil},
		"gross from net and VAT": {func(r map[string]any) {
			r["totals"].(map[string]any)["gross"] = nil
			r["vat_breakdown"].([]any)[0].(map[string]any)["gross"] = nil
		}, "", func(r receiptReading) bool {
			return value(r.Totals.Gross) == "314.50" && value(r.VATBreakdown[0].Gross) == "108.10"
		}},
		"an unknown method": {func(r map[string]any) { r["payment"].(map[string]any)["method"] = "cheque" }, "",
			func(r receiptReading) bool { return r.Payment.Method == nil }},
		"a category by preset key": {func(r map[string]any) { r["category"].(map[string]any)["key"] = "TELECOM" }, "",
			func(r receiptReading) bool { return r.Category != nil && r.Category.ID == "exc_1" }},
		"no VAT shown": {func(r map[string]any) {
			r["vat_breakdown"] = []any{}
			r["items"] = []any{}
		}, "vat_breakdown", nil},
		"a reverse charge": {func(r map[string]any) { r["reverse_charge"] = true }, "",
			func(r receiptReading) bool { return r.Issues["reverse_charge"] != "" }},
		"a confidence out of range": {func(r map[string]any) { r["category"].(map[string]any)["confidence"] = 7 }, "",
			func(r receiptReading) bool { return r.Category.Confidence == 1 }},
	} {
		t.Run(name, func(t *testing.T) {
			rec := threeRates("exc_1")
			c.change(rec)
			raw, _ := json.Marshal(rec)
			got, err := checkReceipt(raw, categories)
			if err != nil {
				t.Fatal(err)
			}
			for g, l := range got.Confidence {
				if (g == c.group) != (l == "low") {
					t.Errorf("%s = %s", g, l)
				}
			}
			if c.check != nil && !c.check(got) {
				t.Errorf("reading %+v", got)
			}
			delete(got.Issues, "reverse_charge")
			if (c.group == "") != (len(got.Issues) == 0) || (c.group != "" && got.Issues[c.group] == "") {
				t.Errorf("issues %v", got.Issues)
			}
		})
	}
}

func TestCheckReceiptNeverInventsACategory(t *testing.T) {
	rec := threeRates("travel")
	raw, _ := json.Marshal(rec)
	got, err := checkReceipt(raw, []receiptCategory{{Key: "telecom", ID: "exc_1"}})
	if err != nil || got.Category != nil || got.Issues["category"] == "" {
		t.Errorf("%+v %v", got.Category, err)
	}
	if _, err := checkReceipt(json.RawMessage(`"x"`), nil); err == nil {
		t.Error("a non-object answer was read")
	}
}

func TestPreviewOneReceiptOnly(t *testing.T) {
	for reply, want := range map[string]string{
		`{"records":[]}`:      "no_receipt",
		`{"records":[{},{}]}`: "multiple_receipts",
		`not json`:            "receipt_unreadable",
	} {
		t.Run(want, func(t *testing.T) {
			e := previewEnv(t)
			e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){answer(reply)}
			if w := e.preview("request-0001", pngBytes(t), nil); w.Code < 400 || code(w) != want {
				t.Errorf("%d %s", w.Code, w.Body)
			}
		})
	}
}

func TestPreviewRefusesBadInputBeforeTheModel(t *testing.T) {
	e := previewEnv(t)
	good := pngBytes(t)
	for name, w := range map[string]*httptest.ResponseRecorder{
		"no request id": e.preview("", good, nil),
		"short id":      e.preview("abc", good, nil),
		"no file":       e.preview("request-0001", nil, nil),
		"empty file":    e.preview("request-0001", []byte{}, nil),
		"extra field":   e.preview("request-0001", good, map[string]string{"workspace_id": "ws_b"}),
		"text file":     e.preview("request-0001", []byte("a,b\n1,2\n"), nil),
		"zip":           e.preview("request-0001", []byte("PK\x03\x04\x14\x00\x00\x00"), nil),
		"heic":          e.preview("request-0001", append([]byte{0, 0, 0, 24}, []byte("ftypheic\x00\x00\x00\x00")...), nil),
		"corrupt png":   e.preview("request-0001", append(good[:20:20], 0xff, 0xff), nil),
		"huge png":      e.preview("request-0001", hugePNG(), nil),
		"short webp":    e.preview("request-0001", []byte("RIFF\x10\x00\x00\x00WEBPVP8X\x00\x00\x00\x00"), nil),
		"huge webp":     e.preview("request-0001", webpVP8X(16000, 16000), nil),
		"bare pdf":      e.preview("request-0001", []byte("%PDF-1.4\nnothing"), nil),
		"six pages":     e.previewPages("request-0001", [][]byte{good, good, good, good, good, good}, nil),
		"one bad page":  e.previewPages("request-0001", [][]byte{good, []byte("a,b\n")}, nil),
	} {
		if w.Code < 400 || w.Code >= 500 {
			t.Errorf("%s: %d %s", name, w.Code, w.Body)
		}
	}
	if n := e.model.calls.Load(); n != 0 {
		t.Errorf("the model was called %d times", n)
	}
}

// webpVP8X is an extended WebP header declaring the canvas size, without image data.
func webpVP8X(w, h int) []byte {
	b := []byte("RIFF\x16\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x00\x00\x00\x00")
	for _, v := range []int{w - 1, h - 1} {
		b = append(b, byte(v), byte(v>>8), byte(v>>16))
	}
	return b
}

func TestWebPSize(t *testing.T) {
	lossy := append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00\x00\x00\x00\x9d\x01\x2a"), 0x40, 0x01, 0xf0, 0x00)
	lossless := append([]byte("RIFF\x00\x00\x00\x00WEBPVP8L\x00\x00\x00\x00\x2f"), 0x3f, 0x80, 0x0f, 0x00, 0, 0, 0, 0, 0)
	for name, c := range map[string]struct {
		data []byte
		w, h int
	}{
		"extended": {webpVP8X(300, 200), 300, 200},
		"lossy":    {lossy, 320, 240},
		"lossless": {lossless, 64, 63},
	} {
		got, err := webpConfig(c.data)
		if err != nil || got.Width != c.w || got.Height != c.h {
			t.Errorf("%s: %dx%d %v", name, got.Width, got.Height, err)
		}
	}
}

func TestPreviewReadsAWebP(t *testing.T) {
	e := previewEnv(t)
	e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){answer(recordJSON(t, map[string]any{"supplier": map[string]any{"name": "Kiosk"}}))}
	if w := e.preview("request-0001", webpVP8X(400, 300), nil); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if f := e.model.seen[0].Files[0]; f.ContentType != typeWEBP {
		t.Errorf("sent as %s", f.ContentType)
	}
}

// hugePNG declares 20000 x 20000 pixels in its header without carrying them.
func hugePNG() []byte {
	b := pngHeader(20000, 20000)
	return b
}

func pngHeader(w, h uint32) []byte {
	var b bytes.Buffer
	b.Write([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR"))
	for _, v := range []uint32{w, h} {
		b.Write([]byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)})
	}
	b.Write([]byte{8, 6, 0, 0, 0, 0, 0, 0, 0})
	return b.Bytes()
}

func TestPreviewRefusesARepeatedActionWithoutPayingTwice(t *testing.T) {
	e := previewEnv(t)
	reply := answer(`{"records":[{"supplier":{"name":"Migros"}}]}`)
	e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){reply, reply}
	img := pngBytes(t)
	if w := e.preview("request-0001", img, nil); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w := e.preview("request-0001", img, nil); w.Code != http.StatusConflict || code(w) != "receipt_already_read" {
		t.Errorf("repeat: %d %s", w.Code, w.Body)
	}
	if n := e.model.calls.Load(); n != 1 {
		t.Errorf("model calls = %d", n)
	}
	// A new explicit action is a new request.
	if w := e.preview("request-0002", img, nil); w.Code != 200 {
		t.Errorf("new action: %d %s", w.Code, w.Body)
	}
}

func TestPreviewNeedsPermissionAndAProvider(t *testing.T) {
	e := previewEnv(t)
	reader := e.person("ws_a", "usr_reader", "member", []string{"read:*"})
	if w := e.as(reader).preview("request-0001", pngBytes(t), nil); w.Code != 403 {
		t.Errorf("reader: %d %s", w.Code, w.Body)
	}
	e.as(e.sess)
	e.s.provider = nil
	if w := e.preview("request-0001", pngBytes(t), nil); w.Code != 409 || code(w) != "ai_not_configured" {
		t.Errorf("no provider: %d %s", w.Code, w.Body)
	}
	if n := e.model.calls.Load(); n != 0 {
		t.Errorf("the model was called %d times", n)
	}
}

func TestPreviewProviderFailureIsKnownAndStoresNothing(t *testing.T) {
	e := previewEnv(t)
	e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){func(aimodel.Request) (aimodel.Reply, error) {
		tokens := int64(5)
		return aimodel.Reply{Tokens: &tokens}, http.ErrHandlerTimeout
	}}
	if w := e.preview("request-0001", pngBytes(t), nil); w.Code != 503 || code(w) != "ai_failed" {
		t.Errorf("%d %s", w.Code, w.Body)
	}
	if n := e.expenseCount("ws_a"); n != 0 {
		t.Errorf("%d expenses", n)
	}
}

// Approval is each person's own in each workspace: another member's does not count, and nothing is sent without it.
func TestPreviewNeedsThePersonsOwnApproval(t *testing.T) {
	e := previewEnv(t) // usr_a approved in ws_a
	clerk := e.person("ws_a", "usr_clerk", "member", []string{"read:*", "write:expenses"})
	w := e.as(clerk).preview("request-0001", pngBytes(t), nil)
	if w.Code != http.StatusForbidden || code(w) != "ai_consent_required" {
		t.Fatalf("clerk without own approval: %d %s", w.Code, w.Body)
	}
	if n := e.model.calls.Load(); n != 0 {
		t.Errorf("the model was called %d times", n)
	}
	e.consent("ws_a", "usr_clerk")
	e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){answer(`{"records":[{"supplier":{"name":"Migros"}}]}`)}
	if w := e.as(clerk).preview("request-0002", pngBytes(t), nil); w.Code != 200 {
		t.Errorf("after their own approval: %d %s", w.Code, w.Body)
	}
}

func TestPreviewWithdrawnApprovalStopsTheNextRead(t *testing.T) {
	e := previewEnv(t)
	if err := e.db.SetAIConsent(t.Context(), "ws_a", "usr_a", false, time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if w := e.preview("request-0001", pngBytes(t), nil); w.Code != http.StatusForbidden || code(w) != "ai_consent_required" {
		t.Errorf("%d %s", w.Code, w.Body)
	}
	if n := e.model.calls.Load(); n != 0 {
		t.Errorf("the model was called %d times", n)
	}
}

// With the catalogue's preset column (migration 00043), a category's key is its preset, and the answer resolves by it.
func TestPreviewCategoryKeyIsThePreset(t *testing.T) {
	e := previewEnv(t)
	c := e.category("ws_a")
	if _, err := e.raw.Exec(t.Context(), `ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS preset text`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.raw.Exec(t.Context(), `UPDATE expense_categories SET preset = 'goods_purchase' WHERE id = $1`, c.ID); err != nil {
		t.Fatal(err)
	}
	e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){answer(recordJSON(t, threeRates("goods_purchase")))}
	w := e.preview("request-0001", pngBytes(t), nil)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if got := decode[receiptReading](t, w); got.Category == nil || got.Category.ID != c.ID || value(got.Category.Key) != "goods_purchase" || value(got.Category.Preset) != "goods_purchase" {
		t.Errorf("category %+v", got.Category)
	}
	if !strings.Contains(e.model.seen[0].Instructions, "- goods_purchase | "+c.Name+" | "+c.AccountCode) {
		t.Errorf("instructions: %s", e.model.seen[0].Instructions)
	}
}
