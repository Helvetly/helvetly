package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// fakeMeter records each reservation and what it settled; refuse makes it answer as an exhausted allowance.
type fakeMeter struct {
	mu       sync.Mutex
	refuse   bool
	reserved []int64
	settled  []int64
}

func (m *fakeMeter) ReserveDownload(_ context.Context, workspaceID string, n int64) (func(int64), error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if workspaceID != "wsp_1" {
		return nil, fmt.Errorf("reserved for %q", workspaceID)
	}
	if m.refuse {
		return nil, fmt.Errorf("%w: downloads used up", store.ErrAdmissionDenied)
	}
	m.reserved = append(m.reserved, n)
	return func(sent int64) {
		m.mu.Lock()
		defer m.mu.Unlock()
		m.settled = append(m.settled, sent)
	}, nil
}

type meteredSource struct {
	memSource
	meter *fakeMeter
}

func (m meteredSource) DownloadMeter() Meter { return m.meter }

// brokenWriter is a client that hangs up after limit body bytes.
type brokenWriter struct {
	*httptest.ResponseRecorder
	limit int
}

func (b *brokenWriter) Write(p []byte) (int, error) {
	if room := b.limit - b.Body.Len(); len(p) > room {
		n, _ := b.ResponseRecorder.Write(p[:max(room, 0)])
		return n, errors.New("connection reset by peer")
	}
	return b.ResponseRecorder.Write(p)
}

func TestServeCountsTheBytesItSends(t *testing.T) {
	body := strings.Repeat("0123456789", 100) // 1000 bytes
	for _, tc := range []struct {
		name, method, rangeHeader string
		limit                     int // the client hangs up after this many bytes; 0: never
		refuse                    bool
		status                    int
		reserved, settled         []int64
	}{
		{name: "whole file", method: "GET", status: 200, reserved: []int64{1000}, settled: []int64{1000}},
		{name: "range counts its bytes", method: "GET", rangeHeader: "bytes=990-", status: 206, reserved: []int64{1000}, settled: []int64{10}},
		{name: "cancelled keeps what was sent", method: "GET", limit: 300, status: 200, reserved: []int64{1000}, settled: []int64{300}},
		{name: "HEAD counts nothing", method: "HEAD", status: 200},
		{name: "refused sends nothing", method: "GET", refuse: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			meter := &fakeMeter{refuse: tc.refuse}
			src := meteredSource{memSource{proxy: false, objects: map[string]string{"k": body}}, meter}
			r := httptest.NewRequest(tc.method, "/download", nil)
			if tc.rangeHeader != "" {
				r.Header.Set("Range", tc.rangeHeader)
			}
			rec := httptest.NewRecorder()
			var w http.ResponseWriter = rec
			if tc.limit > 0 {
				w = &brokenWriter{rec, tc.limit}
			}
			err := Serve(w, r, src, "wsp_1", "k", "f.txt", "text/plain")
			if tc.refuse {
				if !errors.Is(err, store.ErrAdmissionDenied) || rec.Body.Len() != 0 || rec.Header().Get("Location") != "" {
					t.Fatalf("refusal: err %v, %d bytes, location %q", err, rec.Body.Len(), rec.Header().Get("Location"))
				}
				return
			}
			// a metered download is never presigned, even without S3_PROXY_DOWNLOADS
			if err != nil || rec.Code != tc.status || rec.Header().Get("Location") != "" {
				t.Fatalf("err %v, status %d, location %q", err, rec.Code, rec.Header().Get("Location"))
			}
			if fmt.Sprint(meter.reserved) != fmt.Sprint(tc.reserved) || fmt.Sprint(meter.settled) != fmt.Sprint(tc.settled) {
				t.Fatalf("reserved %v settled %v, want %v %v", meter.reserved, meter.settled, tc.reserved, tc.settled)
			}
		})
	}
}

func TestServeWithoutAWorkspaceIsNotCounted(t *testing.T) {
	meter := &fakeMeter{refuse: true}
	src := meteredSource{memSource{objects: map[string]string{"k": "avatar"}}, meter}
	w := httptest.NewRecorder()
	if err := Serve(w, httptest.NewRequest("GET", "/", nil), src, "", "k", "avatar", ""); err != nil || w.Code != http.StatusFound {
		t.Fatalf("a personal avatar: %v %d", err, w.Code)
	}
}

type versionSource struct {
	objects map[string]string
	meter   *fakeMeter
}

func (v versionSource) OpenVersion(_ context.Context, key, _ string) (io.ReadSeekCloser, error) {
	return memObject{bytes.NewReader([]byte(v.objects[key]))}, nil
}

func (v versionSource) DownloadMeter() Meter { return v.meter }

// TestMediaLinkCountsAgainstItsWorkspace: every GET of a signed link counts for the workspace it was signed for; an
// exhausted allowance answers 402 without bytes and without the plan, since a client may hold the link.
func TestMediaLinkCountsAgainstItsWorkspace(t *testing.T) {
	m := newTestMedia(t, 1, time.Now())
	meter := &fakeMeter{}
	mux := http.NewServeMux()
	mux.Handle("GET /api/media/{token}", m.Handler(versionSource{map[string]string{"k": "hello"}, meter}))
	token := strings.TrimPrefix(m.link("wsp_1", "k", "", "f.txt", "text/plain"), "https://media.test/api/media/")
	for range 2 { // a reused link counts each time
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/media/"+token, nil))
		if w.Code != 200 || w.Body.String() != "hello" {
			t.Fatalf("download: %d %q", w.Code, w.Body.String())
		}
	}
	if fmt.Sprint(meter.settled) != "[5 5]" {
		t.Fatalf("settled %v", meter.settled)
	}
	meter.refuse = true
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/media/"+token, nil))
	if w.Code != http.StatusPaymentRequired || strings.Contains(w.Body.String(), "hello") || !strings.Contains(w.Body.String(), "used its downloads") {
		t.Fatalf("refused: %d %q", w.Code, w.Body.String())
	}
}
