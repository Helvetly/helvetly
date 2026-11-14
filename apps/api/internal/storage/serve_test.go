package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

type memObject struct{ *bytes.Reader }

func (memObject) Close() error { return nil }

type memSource struct {
	proxy   bool
	objects map[string]string
}

func (m memSource) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	b, ok := m.objects[key]
	if !ok {
		return nil, fmt.Errorf("open %s: %w", key, store.ErrNotFound)
	}
	return memObject{bytes.NewReader([]byte(b))}, nil
}

func (m memSource) PresignDownload(_ context.Context, key string, ttl time.Duration, filename string) (string, error) {
	return "https://s3.test/" + key + "?ttl=" + ttl.String() + "&name=" + url.QueryEscape(filename), nil
}

func (m memSource) ProxyDownloads() bool { return m.proxy }

func TestServe(t *testing.T) {
	body := "%PDF-1.7 hello"
	for _, tc := range []struct {
		name, key, contentType, rangeHeader string
		proxy                               bool
		status                              int
		want                                map[string]string
		wantBody                            string
		wantErr                             error
	}{
		{name: "redirect", key: "a/b.pdf", proxy: false, status: http.StatusFound, want: map[string]string{
			"Location": "https://s3.test/a/b.pdf?ttl=5m0s&name=Gr%C3%BCezi.pdf", "Cache-Control": "private, no-store"}},
		{name: "stream", key: "a/b.pdf", contentType: "application/pdf", proxy: true, status: http.StatusOK, wantBody: body,
			want: map[string]string{"Content-Type": "application/pdf", "Content-Length": "14", "Cache-Control": "private, no-store",
				"Content-Disposition": "attachment; filename*=utf-8''Gr%C3%BCezi.pdf", "X-Content-Type-Options": "nosniff",
				"Accept-Ranges": "bytes", "Location": ""}},
		{name: "stream sniffs a missing type", key: "a/b.pdf", proxy: true, status: http.StatusOK, wantBody: body,
			want: map[string]string{"Content-Type": "application/pdf"}},
		{name: "range", key: "a/b.pdf", contentType: "application/pdf", rangeHeader: "bytes=9-", proxy: true,
			status: http.StatusPartialContent, wantBody: "hello", want: map[string]string{"Content-Range": "bytes 9-13/14", "Content-Length": "5"}},
		{name: "missing object", key: "a/gone.pdf", proxy: true, wantErr: store.ErrNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			src := memSource{proxy: tc.proxy, objects: map[string]string{"a/b.pdf": body}}
			r := httptest.NewRequest("GET", "/download", nil)
			if tc.rangeHeader != "" {
				r.Header.Set("Range", tc.rangeHeader)
			}
			w := httptest.NewRecorder()
			err := Serve(w, r, src, tc.key, "Grüezi.pdf", tc.contentType)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil || w.Code != tc.status {
				t.Fatalf("status %d, err %v; want %d", w.Code, err, tc.status)
			}
			for k, v := range tc.want {
				if got := w.Header().Get(k); got != v {
					t.Errorf("%s: %q, want %q", k, got, v)
				}
			}
			if tc.wantBody != "" && w.Body.String() != tc.wantBody {
				t.Errorf("body %q, want %q", w.Body.String(), tc.wantBody)
			}
		})
	}
}
