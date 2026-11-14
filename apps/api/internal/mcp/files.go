package mcp

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
)

// maxBlob is the largest file a tool call returns inline (base64 in the JSON-RPC answer); larger ones are refused
// with a pointer to the REST operation, which streams them.
const maxBlob = 4 << 20

// maxRequest bounds one JSON-RPC message; uploads carry their files base64 encoded inside it.
const maxRequest = 8 << 20

// fileSchema is how a tool takes one file of a multipart upload: JSON has no bytes, so the name and base64 content.
var fileSchema = map[string]any{
	"type": "object", "additionalProperties": false, "required": []string{"filename", "content_base64"},
	"properties": map[string]any{
		"filename":       map[string]any{"type": "string", "description": "The file's name, with its extension (receipt.pdf)."},
		"content_base64": map[string]any{"type": "string", "contentEncoding": "base64", "description": "The file's bytes, base64 encoded."},
	},
}

// uploadSchema turns a multipart body schema into the tool's JSON body: each binary field takes fileSchema.
func uploadSchema(raw json.RawMessage) any {
	var schema map[string]any
	if err := json.Unmarshal(raw, &schema); err != nil {
		return raw
	}
	props, _ := schema["properties"].(map[string]any)
	for name, p := range props {
		prop, _ := p.(map[string]any)
		switch {
		case isBinary(prop):
			props[name] = withDescription(fileSchema, prop)
		case prop["type"] == "array" && isBinary(asMap(prop["items"])):
			props[name] = map[string]any{"type": "array", "items": fileSchema, "description": prop["description"]}
		}
	}
	return schema
}

func isBinary(p map[string]any) bool { return p["format"] == "binary" }

func asMap(v any) map[string]any { m, _ := v.(map[string]any); return m }

func withDescription(schema, from map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range schema {
		out[k] = v
	}
	if d, ok := from["description"]; ok {
		out["description"] = d
	}
	return out
}

// multipartBody writes a tool's upload body as multipart/form-data: file objects as file parts, the rest as fields.
func multipartBody(form map[string]any) (io.Reader, string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	names := make([]string, 0, len(form))
	for k := range form {
		names = append(names, k)
	}
	slices.Sort(names)
	for _, name := range names {
		files, isList := form[name].([]any)
		if !isList {
			files = []any{form[name]}
		}
		for _, v := range files {
			if err := writePart(w, name, v); err != nil {
				return nil, "", err
			}
		}
	}
	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return &buf, w.FormDataContentType(), nil
}

func writePart(w *multipart.Writer, name string, v any) error {
	file, isFile := v.(map[string]any)
	if !isFile {
		if v == nil {
			return nil
		}
		text := fmt.Sprint(v)
		if f, isNum := v.(float64); isNum {
			text = strconv.FormatFloat(f, 'f', -1, 64)
		}
		return w.WriteField(name, text)
	}
	filename, _ := file["filename"].(string)
	encoded, _ := file["content_base64"].(string)
	content, err := base64.StdEncoding.DecodeString(encoded)
	if filename == "" || err != nil {
		return fmt.Errorf("%s: want {filename, content_base64} with standard base64 content", name)
	}
	part, err := w.CreateFormFile(name, filename)
	if err != nil {
		return err
	}
	_, err = part.Write(content)
	return err
}

// result wraps the handler's answer as tool content: JSON and other text as text, a redirect (a presigned
// download) as its URL, a binary file (a PDF) as an embedded resource.
func result(rec *httptest.ResponseRecorder, target string) map[string]any {
	isError := rec.Code >= 400
	text := func(s string) map[string]any {
		return map[string]any{"content": []map[string]any{{"type": "text", "text": s}}, "isError": isError}
	}
	if loc := rec.Header().Get("Location"); rec.Code >= 300 && rec.Code < 400 && loc != "" {
		raw, _ := json.Marshal(map[string]string{"download_url": loc, "note": "A short-lived link to the file (about 5 minutes)."})
		return text(string(raw))
	}
	ct := rec.Header().Get("Content-Type")
	kind, _, _ := mime.ParseMediaType(ct)
	if kind == "" || kind == "application/json" || strings.HasPrefix(kind, "text/") || strings.HasSuffix(kind, "xml") || isError {
		return text(rec.Body.String())
	}
	if rec.Body.Len() > maxBlob {
		return text(fmt.Sprintf("The file is %d bytes, more than a tool answer carries (%d): download it with the REST "+
			"operation (GET %s).", rec.Body.Len(), maxBlob, target))
	}
	resource := map[string]any{"uri": "helvetly://" + strings.TrimPrefix(target, "/"), "mimeType": kind,
		"blob": base64.StdEncoding.EncodeToString(rec.Body.Bytes())}
	return map[string]any{"content": []map[string]any{{"type": "resource", "resource": resource}}, "isError": false}
}
