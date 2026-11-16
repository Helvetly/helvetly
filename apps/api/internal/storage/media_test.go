package storage

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"

	"helvetly.com/api/internal/store/storetest"
)

func newTestMedia(t *testing.T, secret byte, now time.Time) *Media {
	t.Helper()
	m, err := NewMedia("https://media.test", bytes.Repeat([]byte{secret}, 32))
	if err != nil {
		t.Fatal(err)
	}
	m.now = func() time.Time { return now }
	return m
}

func TestMediaToken(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	m := newTestMedia(t, 1, now)
	link := m.link("", "ws/a.pdf", "v1", "Grüezi \"x\".pdf", "application/pdf")
	token, ok := strings.CutPrefix(link, "https://media.test/api/media/")
	if !ok || strings.ContainsAny(token, "/?#=+") {
		t.Fatalf("link %q is not origin + /api/media/ + a URL-safe token", link)
	}
	payload, sig, _ := strings.Cut(token, ".")
	other, _ := base64.RawURLEncoding.DecodeString(payload)
	forged := base64.RawURLEncoding.EncodeToString(bytes.Replace(other, []byte("ws/a.pdf"), []byte("ws/b.pdf"), 1))
	for _, tc := range []struct {
		name  string
		media *Media
		token string
		ok    bool
	}{
		{"valid", m, token, true},
		{"just before expiry", newTestMedia(t, 1, now.Add(DownloadTTL-time.Second)), token, true},
		{"expired", newTestMedia(t, 1, now.Add(DownloadTTL)), token, false},
		{"wrong key", newTestMedia(t, 2, now), token, false},
		{"payload changed", m, forged + "." + sig, false},
		{"signature changed", m, payload + "." + strings.ToUpper(sig[:4]) + sig[4:], false},
		{"signature missing", m, payload, false},
		{"empty signature", m, payload + ".", false},
		{"not base64", m, "!!.!!", false},
		{"empty", m, "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, ok := tc.media.verify(tc.token)
			if ok != tc.ok {
				t.Fatalf("verify = %v, want %v", ok, tc.ok)
			}
			if ok && (c.Key != "ws/a.pdf" || c.Version != "v1" || c.Filename != "Grüezi \"x\".pdf" || c.ContentType != "application/pdf") {
				t.Fatalf("claims %+v", c)
			}
		})
	}
	if _, err := NewMedia("https://media.test", []byte("short")); err == nil {
		t.Fatal("accepted a short secret")
	}
}

func TestMediaHandlerRefusesBadTokens(t *testing.T) {
	m := newTestMedia(t, 1, time.Now())
	mux := http.NewServeMux()
	mux.Handle("GET /api/media/{token}", m.Handler(nil)) // never reached: nothing is opened without a valid token
	for _, token := range []string{"x", "a.b", strings.TrimPrefix(newTestMedia(t, 2, time.Now()).link("", "k", "", "f", ""), "https://media.test/api/media/")} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/media/"+token, nil))
		if w.Code != http.StatusNotFound || w.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("%q: %d %v", token, w.Code, w.Header())
		}
	}
}

// End to end against the S3 in compose: Serve redirects to MEDIA_URL, and the media route streams the version that
// was recorded when the link was signed, with the proxy path's headers; HEAD works too.
func TestMediaDownload(t *testing.T) {
	cfg := testConfig(t)
	cfg.Bucket = newBucket(t, cfg, false)
	db, _ := storetest.New(t)
	s, err := New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	key, body := randomKey("invoice.pdf"), "%PDF-1.7 original"
	if err := s.Put(ctx, key, strings.NewReader(body), int64(len(body)), "application/pdf", "invoice.pdf"); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	srv := httptest.NewServer(mux)
	defer srv.Close()
	media, err := NewMedia(srv.URL, bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	s.UseMedia(media)
	s.proxy = true // MEDIA_URL wins over S3_PROXY_DOWNLOADS
	mux.Handle("GET /api/media/{token}", media.Handler(s))

	w := httptest.NewRecorder()
	if err := Serve(w, httptest.NewRequest("GET", "/download", nil), s, "", key, "Grüezi.pdf", "application/pdf"); err != nil {
		t.Fatal(err)
	}
	link := w.Header().Get("Location")
	if w.Code != http.StatusFound || !strings.HasPrefix(link, srv.URL+"/api/media/") {
		t.Fatalf("serve: %d %q", w.Code, link)
	}
	// a later overwrite by someone else does not change what the link downloads
	if _, err := s.client.PutObject(ctx, cfg.Bucket, key, strings.NewReader("tampered"), 8, minio.PutObjectOptions{}); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"GET", "HEAD"} {
		req, _ := http.NewRequest(method, link, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		got, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		want := map[string]string{"Content-Type": "application/pdf", "Content-Disposition": "attachment; filename*=utf-8''Gr%C3%BCezi.pdf",
			"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Length": "17"}
		for k, v := range want {
			if resp.Header.Get(k) != v {
				t.Errorf("%s %s: %q, want %q", method, k, resp.Header.Get(k), v)
			}
		}
		if wantBody := map[string]string{"GET": body, "HEAD": ""}[method]; resp.StatusCode != 200 || string(got) != wantBody {
			t.Fatalf("%s: %d %q", method, resp.StatusCode, got)
		}
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if resp, err := http.Get(link); err != nil || resp.StatusCode != http.StatusNotFound {
		t.Fatalf("after delete: %v %v", resp, err)
	}
}
