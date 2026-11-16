package imports

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"helvetly.com/api/internal/aimodel"
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

// preview posts a multipart form; fields are the form's extra parts (name to value), file the receipt (nil = none).
func (e *env) preview(requestID string, file []byte, extra map[string]string) *httptest.ResponseRecorder {
	e.t.Helper()
	var b bytes.Buffer
	form := multipart.NewWriter(&b)
	if requestID != "" {
		_ = form.WriteField("request_id", requestID)
	}
	for k, v := range extra {
		_ = form.WriteField(k, v)
	}
	if file != nil {
		f, _ := form.CreateFormFile("file", "receipt.png")
		_, _ = f.Write(file)
	}
	_ = form.Close()
	r := httptest.NewRequest("POST", "/api/v1/expenses/receipt-preview", &b)
	r.Header.Set("Content-Type", form.FormDataContentType())
	w := httptest.NewRecorder()
	e.mux.ServeHTTP(w, r)
	return w
}

type previewOut struct {
	Fields map[string]any    `json:"fields"`
	Issues map[string]string `json:"issues"`
}

func recordJSON(t *testing.T, fields map[string]any) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"records": []any{fields}})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestPreviewSuggestsAndStoresNothing(t *testing.T) {
	e := previewEnv(t)
	e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){answer(`{"records":[{"supplier_name":"Migros","supplier_country":"ch","currency":"chf",` +
		`"document_date":"2025-03-01","amount":"108.10","vat_rate":"8.1","reference":null,"ignore_me":"x"}]}`)}
	w := e.preview("request-0001", pngBytes(t), nil)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	out := decode[previewOut](t, w)
	for k, want := range map[string]any{"supplier_name": "Migros", "supplier_country": "CH", "currency": "CHF", "amount": "108.10", "vat_rate": "8.1", "document_date": "2025-03-01", "reference": nil, "amount_2": nil} {
		if out.Fields[k] != want {
			t.Errorf("%s = %v, want %v", k, out.Fields[k], want)
		}
	}
	if _, ok := out.Fields["ignore_me"]; ok || len(out.Issues) != 0 {
		t.Errorf("fields %v issues %v", out.Fields, out.Issues)
	}
	if n := e.expenseCount("ws_a"); n != 0 || e.files.puts != 0 {
		t.Errorf("stored: %d expenses, %d files", n, e.files.puts)
	}
	if batches, err := e.db.ImportBatches(t.Context(), "ws_a", "usr_a", "expenses"); err != nil || len(batches) != 0 {
		t.Errorf("batches %v %v", batches, err)
	}
}

func TestPreviewNeverAssumesTheAmounts(t *testing.T) {
	for name, c := range map[string]struct {
		fields map[string]any
		issue  bool // the amounts are withheld with a review issue
	}{
		"no VAT rate shown":   {map[string]any{"supplier_name": "Kiosk", "currency": "CHF", "amount": "5.00"}, true},
		"reverse charge":      {map[string]any{"supplier_name": "GmbH", "currency": "EUR", "amount": "100.00", "vat_rate": "0", "reverse_charge": true}, true},
		"second band alone":   {map[string]any{"supplier_name": "Coop", "currency": "CHF", "amount": "10.00", "vat_rate": "8.1", "amount_2": "5.00"}, true},
		"invalid Swiss rate":  {map[string]any{"supplier_name": "Coop", "currency": "CHF", "amount": "10.00", "vat_rate": "9.5", "supplier_country": "CH"}, true},
		"three bands nulled":  {map[string]any{"supplier_name": "Coop", "currency": "CHF", "amount": nil, "vat_rate": nil, "amount_2": nil, "vat_rate_2": nil}, true},
		"one band of three":   {map[string]any{"supplier_name": "Coop", "currency": "CHF", "amount": "50.00", "vat_rate": "8.1", "amount_2": nil, "vat_rate_2": "2.6"}, true},
		"no amounts at all":   {map[string]any{"supplier_name": "Coop"}, false},
		"foreign rate is own": {map[string]any{"supplier_name": "Shop", "supplier_country": "DE", "currency": "EUR", "amount": "119.00", "vat_rate": "19"}, false},
	} {
		t.Run(name, func(t *testing.T) {
			e := previewEnv(t)
			e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){answer(recordJSON(t, c.fields))}
			w := e.preview("request-0001", pngBytes(t), nil)
			if w.Code != 200 {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			out := decode[previewOut](t, w)
			if out.Fields["supplier_name"] == nil {
				t.Error("the supplier was dropped with the amounts")
			}
			filled := out.Fields["amount"] != nil
			if filled == c.issue && name != "no amounts at all" {
				t.Errorf("amount filled=%v with issues %v", filled, out.Issues)
			}
			if c.issue {
				if out.Issues["amounts"] == "" && out.Issues["vat_rate"] == "" {
					t.Errorf("no review issue: %v", out.Issues)
				}
				for _, f := range previewAmounts {
					if out.Fields[f] != nil {
						t.Errorf("%s kept: %v", f, out.Fields[f])
					}
				}
			}
		})
	}
}

func TestPreviewPromptForbidsPartialBands(t *testing.T) {
	e := previewEnv(t)
	e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){answer(`{"records":[{"supplier_name":"Coop"}]}`)}
	if w := e.preview("request-0001", pngBytes(t), nil); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if got := e.model.seen[0].Instructions; !strings.Contains(got, "more than two rates") || !strings.Contains(got, "to null") {
		t.Errorf("instructions lack the band rule: %s", got)
	}
}

func TestPreviewOneReceiptOnly(t *testing.T) {
	for reply, want := range map[string]string{
		`{"records":[]}`: "no_receipt",
		`{"records":[{"supplier_name":"A","amount":"1.00","vat_rate":"0"},{"supplier_name":"B","amount":"2.00","vat_rate":"0"}]}`: "multiple_receipts",
		`not json`: "receipt_unreadable",
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

func code_(w *httptest.ResponseRecorder) string { return code(w) }

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
		"bare pdf":      e.preview("request-0001", []byte("%PDF-1.4\nnothing"), nil),
	} {
		if w.Code < 400 || w.Code >= 500 {
			t.Errorf("%s: %d %s", name, w.Code, w.Body)
		}
	}
	if n := e.model.calls.Load(); n != 0 {
		t.Errorf("the model was called %d times", n)
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
	e.model.replies = []func(aimodel.Request) (aimodel.Reply, error){answer(`{"records":[{"supplier_name":"Migros"}]}`), answer(`{"records":[{"supplier_name":"Migros"}]}`)}
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
	if w := e.preview("request-0001", pngBytes(t), nil); w.Code != 503 || code(w) != "ai_unavailable" {
		t.Errorf("%d %s", w.Code, w.Body)
	}
	if n := e.expenseCount("ws_a"); n != 0 {
		t.Errorf("%d expenses", n)
	}
}
