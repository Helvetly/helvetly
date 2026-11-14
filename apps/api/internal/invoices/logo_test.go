package invoices

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

func pngOf(w, h int) []byte {
	var b bytes.Buffer
	_ = png.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h)))
	return b.Bytes()
}

func jpegOf(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(1, 1, color.White)
	var b bytes.Buffer
	_ = jpeg.Encode(&b, img, nil)
	return b.Bytes()
}

// upload sends one file in the multipart field "file".
func (e *env) upload(b *browser, name string, content []byte) (*http.Response, []byte) {
	e.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", name)
	_, _ = fw.Write(content)
	_ = mw.Close()
	req, _ := http.NewRequest("PUT", e.srv.URL+"/api/v1/invoice-settings/logo", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp, raw
}

func TestLogoValidation(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	member := e.join(b.workspace, "member")
	webp := append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), make([]byte, 64)...)
	for _, tt := range []struct {
		name, file string
		content    []byte
		status     int
		message    string
	}{
		{"webp", "logo.png", webp, 422, "WebP is not supported"},
		{"svg", "logo.png", []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>`), 422, "SVG is not supported"},
		{"text named .png", "logo.png", []byte("hello, I am not an image"), 422, "PNG or JPEG"},
		{"too small", "logo.png", pngOf(200, 32), 422, "at least 64 px"},
		{"too large", "logo.png", pngOf(4001, 100), 422, "at most 4000 px"},
		{"over 2 MB", "logo.png", append(pngOf(100, 100), make([]byte, 2<<20)...), 422, "at most 2 MB"},
		{"truncated png", "logo.png", pngOf(100, 100)[:40], 422, "cannot be read"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			resp, raw := e.upload(b, tt.file, tt.content)
			if resp.StatusCode != tt.status || !strings.Contains(string(raw), tt.message) {
				t.Fatalf("%d %s", resp.StatusCode, raw)
			}
		})
	}
	if resp, _ := e.upload(member, "logo.png", pngOf(100, 100)); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("member upload: %d", resp.StatusCode)
	}
	if keys := e.files.has("invoice-settings"); len(keys) != 0 {
		t.Fatalf("refused uploads were stored: %v", keys)
	}
}

func TestLogoLifecycle(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	e.fails(b, "GET", "/api/v1/invoice-settings/logo", nil, http.StatusNotFound, "not_found")
	e.fails(b, "DELETE", "/api/v1/invoice-settings/logo", nil, http.StatusNotFound, "not_found")

	// a JPEG named .png is fine: the bytes decide
	resp, raw := e.upload(b, "logo.png", jpegOf(300, 120))
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(raw), `"logo_url":"/api/v1/invoice-settings/logo"`) {
		t.Fatalf("upload: %d %s", resp.StatusCode, raw)
	}
	first := e.files.has("invoice-settings")
	if len(first) != 1 {
		t.Fatalf("stored: %v", first)
	}
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/v1/invoice-settings/logo", nil)
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	noFollow := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := noFollow.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if loc := resp.Header.Get("Location"); resp.StatusCode != http.StatusFound || !strings.Contains(loc, first[0]) || !strings.Contains(loc, "ttl=5m0s") {
		t.Fatalf("logo download: %d %s", resp.StatusCode, loc)
	}
	e.files.proxy = true // S3_PROXY_DOWNLOADS: the API streams the bytes itself
	stored, _ := e.files.Get(t.Context(), first[0])
	if resp, raw := e.send(b, "GET", "/api/v1/invoice-settings/logo", nil); resp.StatusCode != http.StatusOK ||
		resp.Header.Get("Content-Type") != "image/jpeg" || !bytes.Equal(raw, stored) {
		t.Fatalf("proxied logo: %d %v", resp.StatusCode, resp.Header)
	}
	e.files.proxy = false

	// the draft preview and the issued PDF carry the logo
	inv := e.draft(b, clientID, nil)
	_, pdf := e.send(b, "GET", "/api/v1/invoices/"+inv.ID+"/pdf", nil)
	if !bytes.Contains(pdf, []byte("/Subtype /Image")) {
		t.Fatal("draft PDF without the logo")
	}
	issued := e.invoice(b, "POST", "/api/v1/invoices/"+inv.ID+"/issue", nil, http.StatusOK)

	// replacing deletes the previous object
	if resp, raw := e.upload(b, "new.png", pngOf(500, 100)); resp.StatusCode != http.StatusOK {
		t.Fatalf("replace: %d %s", resp.StatusCode, raw)
	}
	if now := e.files.has("invoice-settings"); len(now) != 1 || now[0] == first[0] {
		t.Fatalf("after replace: %v (was %v)", now, first)
	}

	e.do(b, "DELETE", "/api/v1/invoice-settings/logo", nil, http.StatusNoContent, nil)
	if now := e.files.has("invoice-settings"); len(now) != 0 {
		t.Fatalf("after delete: %v", now)
	}
	var got struct{ Data Settings }
	e.do(b, "GET", "/api/v1/invoice-settings", nil, http.StatusOK, &got)
	if got.Data.LogoFileID != nil || got.Data.LogoURL != nil {
		t.Fatalf("settings after delete: %+v", got.Data)
	}
	// the issued PDF keeps the logo it was issued with
	_, pdf = e.send(b, "GET", "/api/v1/invoices/"+issued.ID+"/pdf", nil)
	if !bytes.Contains(pdf, []byte("/Subtype /Image")) {
		t.Fatal("issued PDF lost its logo")
	}
	// a form may send back the read-only fields it read
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"logo_file_id": "lgo_x", "logo_url": nil, "is_complete": true,
		"missing_fields": []string{}}, http.StatusOK, &got)
	if got.Data.LogoFileID != nil {
		t.Fatal("logo_file_id was writable through PUT /invoice-settings")
	}
}
