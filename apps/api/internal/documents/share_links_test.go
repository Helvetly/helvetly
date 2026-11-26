package documents

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDocumentShareLinkSingleUse(t *testing.T) {
	e := newEnv(t)
	b, other := e.workspace(), e.workspace()
	doc := e.uploaded(b, "contract.pdf", pdf)
	path := "/api/v1/documents/" + doc.ID + "/share-links"
	e.fails(other, "POST", path, map[string]any{"single_use": true}, 404, "not_found")
	e.do(nil, "POST", path, map[string]any{"single_use": true}, 401, nil)

	var created struct {
		Data struct {
			ID    string `json:"id"`
			Token string `json:"token"`
		}
	}
	e.do(b, "POST", path, map[string]any{"single_use": true}, 201, &created)
	if created.Data.Token == "" {
		t.Fatal("creation did not return a token")
	}
	response, raw := e.send(b, "GET", path, nil, "")
	if response.StatusCode != 200 || !strings.Contains(string(raw), created.Data.ID) ||
		strings.Contains(string(raw), created.Data.Token) {
		t.Fatalf("unexpected link list: %d", response.StatusCode)
	}
	const download = "/api/v1/public/document-share/download"
	resp, _ := e.send(nil, "GET", download, nil, "")
	if resp.StatusCode == 200 {
		t.Fatal("a GET preview opened the file")
	}

	form := url.Values{"token": {created.Data.Token}}.Encode()
	codes := make(chan int, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			r, err := http.Post(e.srv.URL+download, "application/x-www-form-urlencoded", strings.NewReader(form))
			if err != nil {
				t.Error(err)
				return
			}
			defer r.Body.Close()
			if r.StatusCode == 200 && (r.Header.Get("Cache-Control") != "private, no-store" ||
				r.Header.Get("Content-Disposition") != "attachment; filename=contract.pdf") {
				t.Errorf("download headers: %v", r.Header)
			}
			codes <- r.StatusCode
		})
	}
	wg.Wait()
	close(codes)
	count := map[int]int{}
	for code := range codes {
		count[code]++
	}
	if count[200] != 1 || count[404] != 1 {
		t.Fatalf("concurrent redemptions = %v", count)
	}
}

func TestDocumentShareLinkLifecycle(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc := e.uploaded(b, "shared.pdf", pdf)
	path := "/api/v1/documents/" + doc.ID + "/share-links"
	e.fails(b, "POST", path, map[string]any{"expires_in_seconds": 0}, 422, "validation_failed")
	started := time.Now()
	var elapsed atomic.Int64
	e.svc.now = func() time.Time { return started.Add(time.Duration(elapsed.Load())) }
	var created struct {
		Data struct {
			ID    string `json:"id"`
			Token string `json:"token"`
		}
	}
	e.do(b, "POST", path, map[string]any{"expires_in_seconds": 60}, 201, &created)
	open := func(want int) {
		t.Helper()
		form := url.Values{"token": {created.Data.Token}}.Encode()
		r, err := http.Post(e.srv.URL+"/api/v1/public/document-share/download", "application/x-www-form-urlencoded", strings.NewReader(form))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		if r.StatusCode != want {
			t.Fatalf("download = %d, want %d", r.StatusCode, want)
		}
	}
	open(200)
	open(200)
	elapsed.Store(int64(time.Minute))
	open(404)
	e.do(b, "POST", path, map[string]any{}, 201, &created)
	open(200)
	e.do(b, "DELETE", path+"?id="+created.Data.ID, nil, 204, nil)
	open(404)

	e.do(b, "POST", path, map[string]any{}, 201, &created)
	if _, err := e.raw.Exec(context.Background(), "UPDATE documents SET hr_private = true WHERE id = $1", doc.ID); err != nil {
		t.Fatal(fmt.Errorf("setting private document: %w", err))
	}
	open(404)
	e.fails(b, "POST", path, map[string]any{}, 404, "not_found")
}
