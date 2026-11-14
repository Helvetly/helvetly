package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"testing"
)

type uploadObject struct{ *bytes.Reader }

func (uploadObject) Close() error { return nil }
func (f *fakeStorage) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("missing %s", key)
	}
	return uploadObject{bytes.NewReader(b)}, nil
}

func TestClientUploadReusesExistingDocumentAndLink(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	first := e.create(b, map[string]any{"name": "First"})
	second := e.create(b, map[string]any{"name": "Second"})
	var firstID string
	for _, client := range []string{first.ID, first.ID, second.ID} {
		body, ct := multipartBody(t, [2]string{"renamed.pdf", "%PDF-1.7\nhello"})
		response, raw := e.send(b, "POST", "/api/v1/clients/"+client+"/files", body, ct)
		var out struct{ Data []fileOut }
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != 201 || len(out.Data) != 1 {
			t.Fatalf("upload: %d %s", response.StatusCode, raw)
		}
		if firstID == "" {
			firstID = out.Data[0].ID
		}
		if out.Data[0].ID != firstID || len(e.files.keys()) != 1 {
			t.Fatalf("duplicate was stored again: %+v objects=%d", out.Data, len(e.files.keys()))
		}
	}
}

func TestClientDuplicateBatchAndConcurrentRetries(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, map[string]any{"name": "Files"})
	path := "/api/v1/clients/" + c.ID + "/files"
	body, ct := multipartBody(t, [2]string{"first.pdf", "%PDF-1.7\nhello"}, [2]string{"renamed.pdf", "%PDF-1.7\nhello"})
	response, raw := e.send(b, "POST", path, body, ct)
	if response.StatusCode != http.StatusConflict || len(e.files.keys()) != 0 {
		t.Fatalf("duplicate batch: %d %s", response.StatusCode, raw)
	}
	var wg sync.WaitGroup
	ids := make(chan string, 2)
	for _, name := range []string{"first.pdf", "renamed.pdf"} {
		wg.Go(func() {
			body, ct := multipartBody(t, [2]string{name, "%PDF-1.7\nhello"})
			response, raw := e.send(b, "POST", path, body, ct)
			var out struct{ Data []fileOut }
			if err := json.Unmarshal(raw, &out); err != nil {
				t.Error(err)
				return
			}
			if response.StatusCode != 201 || len(out.Data) != 1 {
				t.Errorf("concurrent upload: %d %s", response.StatusCode, raw)
				return
			}
			ids <- out.Data[0].ID
		})
	}
	wg.Wait()
	close(ids)
	var firstID string
	for id := range ids {
		if firstID != "" && firstID != id {
			t.Errorf("different document IDs: %s/%s", firstID, id)
		}
		firstID = id
	}
	if len(e.files.keys()) != 1 {
		t.Fatalf("concurrent retries stored %d objects", len(e.files.keys()))
	}
}
