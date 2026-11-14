package mcp

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUploadSchema(t *testing.T) {
	raw := json.RawMessage(`{"type":"object","properties":{
		"file":{"type":"string","format":"binary","description":"The file."},
		"files[]":{"type":"array","items":{"type":"string","format":"binary"}},
		"folder_id":{"type":"string"}}}`)
	schema, _ := uploadSchema(raw).(map[string]any)
	props := schema["properties"].(map[string]any)
	file := props["file"].(map[string]any)
	if file["type"] != "object" || file["description"] != "The file." || file["properties"].(map[string]any)["content_base64"] == nil {
		t.Errorf("file: %v", file)
	}
	if list := props["files[]"].(map[string]any); list["type"] != "array" || list["items"].(map[string]any)["type"] != "object" {
		t.Errorf("files[]: %v", list)
	}
	if props["folder_id"].(map[string]any)["type"] != "string" {
		t.Errorf("folder_id: %v", props["folder_id"])
	}
}

func TestMultipartBody(t *testing.T) {
	b64 := base64.StdEncoding.EncodeToString
	for _, c := range []struct {
		name    string
		form    map[string]any
		want    map[string]string // part name → filename or field value
		wantErr bool
	}{
		{"file and field", map[string]any{"file": map[string]any{"filename": "a.pdf", "content_base64": b64([]byte("%PDF"))},
			"folder_id": "fld_1", "skipped": nil}, map[string]string{"file": "a.pdf", "folder_id": "fld_1"}, false},
		{"list of files", map[string]any{"files[]": []any{map[string]any{"filename": "a.png", "content_base64": b64([]byte("x"))}}},
			map[string]string{"files[]": "a.png"}, false},
		{"number field", map[string]any{"n": float64(1000000)}, map[string]string{"n": "1000000"}, false},
		{"bad base64", map[string]any{"file": map[string]any{"filename": "a", "content_base64": "%%%"}}, nil, true},
		{"no filename", map[string]any{"file": map[string]any{"content_base64": b64([]byte("x"))}}, nil, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			body, ct, err := multipartBody(c.form)
			if (err != nil) != c.wantErr {
				t.Fatalf("err %v", err)
			}
			if err != nil {
				return
			}
			_, params, _ := mime.ParseMediaType(ct)
			r := multipart.NewReader(body, params["boundary"])
			got := map[string]string{}
			for {
				p, err := r.NextPart()
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Fatal(err)
				}
				v, _ := io.ReadAll(p)
				got[p.FormName()] = string(v)
				if p.FileName() != "" {
					got[p.FormName()] = p.FileName()
				}
			}
			for k, v := range c.want {
				if got[k] != v {
					t.Errorf("%s = %q, want %q (all %v)", k, got[k], v, got)
				}
			}
			if len(got) != len(c.want) {
				t.Errorf("parts %v, want %v", got, c.want)
			}
		})
	}
}

func TestResult(t *testing.T) {
	rec := func(code int, ct, body string, headers ...string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		if ct != "" {
			r.Header().Set("Content-Type", ct)
		}
		for i := 0; i+1 < len(headers); i += 2 {
			r.Header().Set(headers[i], headers[i+1])
		}
		r.WriteHeader(code)
		_, _ = r.WriteString(body)
		return r
	}
	for _, c := range []struct {
		name, kind, contains string
		rec                  *httptest.ResponseRecorder
		isError              bool
	}{
		{"json", "text", `{"data":1}`, rec(200, "application/json", `{"data":1}`), false},
		{"csv", "text", "a,b", rec(200, "text/csv; charset=utf-8", "a,b"), false},
		{"xml", "text", "<Invoice/>", rec(200, "application/xml", "<Invoice/>"), false},
		{"redirect", "text", "https://s3.example/x?sig", rec(302, "", "", "Location", "https://s3.example/x?sig"), false},
		{"pdf", "resource", "", rec(200, "application/pdf", "%PDF-1.7"), false},
		{"error", "text", "not_found", rec(404, "application/json", `{"error":{"code":"not_found"}}`), true},
		{"too large", "text", "REST", rec(200, "application/pdf", strings.Repeat("x", maxBlob+1)), false},
	} {
		t.Run(c.name, func(t *testing.T) {
			out := result(c.rec, "/api/v1/invoices/inv_1/pdf")
			content := out["content"].([]map[string]any)[0]
			if content["type"] != c.kind || out["isError"] != c.isError {
				t.Fatalf("%v", out)
			}
			if c.kind == "resource" {
				res := content["resource"].(map[string]any)
				if res["mimeType"] != "application/pdf" || res["blob"] != base64.StdEncoding.EncodeToString([]byte("%PDF-1.7")) ||
					res["uri"] != "helvetly://api/v1/invoices/inv_1/pdf" {
					t.Errorf("%v", res)
				}
				return
			}
			if !strings.Contains(content["text"].(string), c.contains) {
				t.Errorf("text %q, want %q", content["text"], c.contains)
			}
		})
	}
}
