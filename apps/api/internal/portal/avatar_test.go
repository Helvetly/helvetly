package portal

import (
	"bytes"
	"encoding/json"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"sync"
	"testing"

	"helvetly.com/api/internal/uploads"
)

func encode(t *testing.T, format string, w, h int, shade uint8) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = shade
	}
	var buf bytes.Buffer
	var err error
	switch format {
	case "png":
		err = png.Encode(&buf, img)
	case "jpeg":
		err = jpeg.Encode(&buf, img, nil)
	case "gif":
		err = gif.Encode(&buf, img, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func (e *env) upload(c *http.Cookie, csrf string, body []byte) (*http.Response, map[string]any) {
	e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("file", "photo.png")
	_, _ = part.Write(body)
	_ = mw.Close()
	req, _ := http.NewRequest("PUT", e.srv.URL+avatarPath, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("X-CSRF-Token", csrf)
	req.AddCookie(c)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	b, _ := io.ReadAll(res.Body)
	_ = json.Unmarshal(b, &out)
	return res, out
}

func (e *env) avatarObjects() int {
	e.files.mu.Lock()
	defer e.files.mu.Unlock()
	n := 0
	for k := range e.files.objects {
		if strings.Contains(k, "/portal-avatars/") {
			n++
		}
	}
	return n
}

func (e *env) sessionAvatar(c *http.Cookie) any {
	e.t.Helper()
	_, out := e.do("GET", "/session", nil, c, "")
	return out["avatar_url"]
}

func TestAvatarLifecycle(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.signIn("ana@acme.ch")
	if got := e.sessionAvatar(c); got != "" {
		t.Fatalf("no photo yet: %v", got)
	}
	if res, _ := e.get(c, "/avatar"); res.StatusCode != 404 {
		t.Fatalf("get without photo: %d", res.StatusCode)
	}

	first := encode(t, "png", 64, 64, 10)
	res, out := e.upload(c, csrf, first)
	url, _ := out["avatar_url"].(string)
	if res.StatusCode != 200 || !strings.HasPrefix(url, avatarPath+"?v=") || e.avatarObjects() != 1 {
		t.Fatalf("upload: %d %v (%d objects)", res.StatusCode, out, e.avatarObjects())
	}
	if got := e.sessionAvatar(c); got != url {
		t.Fatalf("session avatar %v, want %s", got, url)
	}
	res, _ = e.get(c, "/avatar")
	if loc := res.Header.Get("Location"); res.StatusCode != 302 || !strings.Contains(loc, "workspaces/wsp_a/portal-avatars/pav_") {
		t.Fatalf("download: %d %s", res.StatusCode, loc)
	}

	// The same bytes again store nothing new; other bytes replace the object.
	if res, again := e.upload(c, csrf, first); res.StatusCode != 200 || again["avatar_url"] != url || e.avatarObjects() != 1 {
		t.Fatalf("same bytes: %d %v (%d objects)", res.StatusCode, again, e.avatarObjects())
	}
	if res, next := e.upload(c, csrf, encode(t, "jpeg", 80, 80, 20)); res.StatusCode != 200 || next["avatar_url"] == url || e.avatarObjects() != 1 {
		t.Fatalf("replace: %d %v (%d objects)", res.StatusCode, next, e.avatarObjects())
	}

	// The photo belongs to this client's login: the same address on another client has none.
	if res, out := e.do("POST", "/session/client", map[string]string{"client_id": "cli_2"}, c, csrf); res.StatusCode != 201 {
		t.Fatalf("switch: %d %v", res.StatusCode, out)
	} else {
		c2 := sessionCookie_(res)
		if got := e.sessionAvatar(c2); got != "" {
			t.Fatalf("other client's avatar: %v", got)
		}
	}

	c, csrf = e.signIn("ana@acme.ch")
	if res, _ := e.do("DELETE", "/avatar", nil, c, csrf); res.StatusCode != 204 || e.avatarObjects() != 0 {
		t.Fatalf("delete: %d (%d objects)", res.StatusCode, e.avatarObjects())
	}
	if got := e.sessionAvatar(c); got != "" {
		t.Fatalf("after delete: %v", got)
	}
	if res, _ := e.do("DELETE", "/avatar", nil, c, csrf); res.StatusCode != 404 {
		t.Fatalf("delete again: %d", res.StatusCode)
	}
}

func TestAvatarRejects(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.signIn("ana@acme.ch")
	for _, tc := range []struct {
		name   string
		csrf   string
		cookie *http.Cookie
		body   []byte
		status int
	}{
		{"no CSRF token", "", c, encode(t, "png", 64, 64, 1), 403},
		{"signed out", csrf, &http.Cookie{Name: sessionCookie, Value: "nope"}, encode(t, "png", 64, 64, 1), 401},
		{"not an image", csrf, c, []byte("%PDF-1.7 not a photo"), 422},
		{"over 1 MB", csrf, c, bytes.Repeat([]byte{0x89}, uploads.MaxPhotoSize+1), 422},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if res, out := e.upload(tc.cookie, tc.csrf, tc.body); res.StatusCode != tc.status {
				t.Fatalf("got %d %v, want %d", res.StatusCode, out, tc.status)
			}
		})
	}
	if n := e.avatarObjects(); n != 0 {
		t.Fatalf("rejected uploads stored %d objects", n)
	}
}

// Simultaneous uploads of one login end with one photo: the stored object is the one the row points at.
func TestAvatarConcurrentUploads(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.signIn("ana@acme.ch")
	var wg sync.WaitGroup
	for i := range 6 {
		body := encode(t, "png", 64, 64, uint8(30+i))
		wg.Go(func() {
			if res, out := e.upload(c, csrf, body); res.StatusCode != 200 {
				t.Errorf("upload: %d %v", res.StatusCode, out)
			}
		})
	}
	wg.Wait()
	var key string
	if err := e.raw.QueryRow(t.Context(), `SELECT object_key FROM portal_avatars`).Scan(&key); err != nil {
		t.Fatal(err)
	}
	e.files.mu.Lock()
	_, ok := e.files.objects[key]
	e.files.mu.Unlock()
	if !ok || e.avatarObjects() != 1 {
		t.Fatalf("row points at %s (stored: %v), %d objects", key, ok, e.avatarObjects())
	}
}
