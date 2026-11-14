package expenses

import (
	"context"
	"io"
	"net/http"
	"sync"
	"testing"
	"time"
)

type pausedReceiptStorage struct {
	*fakeStorage
	started chan struct{}
	resume  chan struct{}
}

func (s *pausedReceiptStorage) Put(ctx context.Context, key string, body io.Reader, size int64, contentType, filename string) error {
	close(s.started)
	select {
	case <-s.resume:
		return s.fakeStorage.Put(ctx, key, body, size, contentType, filename)
	case <-ctx.Done():
		return ctx.Err()
	}
}

func TestReceiptUploadRechecksExpenseAfterStorage(t *testing.T) {
	for _, action := range []string{"book", "void", "delete"} {
		t.Run(action, func(t *testing.T) {
			e := newEnv(t)
			owner := e.workspace()
			body := complete(e.categories(owner)["6640"].ID)
			body["receipt_missing_reason"] = "Original is being scanned."
			draft := e.create(owner, body)
			path := "/api/v1/expenses/" + draft.ID
			if action == "void" {
				e.do(owner, http.MethodPost, path+"/book", nil, http.StatusOK, nil)
			}

			paused := &pausedReceiptStorage{fakeStorage: e.files, started: make(chan struct{}), resume: make(chan struct{})}
			e.svc.files = paused
			var release sync.Once
			unblock := func() { release.Do(func() { close(paused.resume) }) }
			t.Cleanup(unblock)
			result := make(chan *http.Response, 1)
			go func() { result <- e.upload(owner, draft.ID, "scan.pdf", pdf) }()
			select {
			case <-paused.started:
			case <-time.After(5 * time.Second):
				t.Fatal("upload did not reach storage")
			}

			switch action {
			case "book":
				e.do(owner, http.MethodPost, path+"/book", nil, http.StatusOK, nil)
			case "void":
				e.do(owner, http.MethodPost, path+"/void", map[string]any{"reason": "Duplicate"}, http.StatusOK, nil)
			case "delete":
				e.do(owner, http.MethodDelete, path, nil, http.StatusNoContent, nil)
			}
			unblock()
			var response *http.Response
			select {
			case response = <-result:
			case <-time.After(5 * time.Second):
				t.Fatal("upload did not finish")
			}
			if action == "book" {
				if response.StatusCode != http.StatusCreated {
					t.Fatalf("upload after booking: status %d, want 201", response.StatusCode)
				}
				keys := e.files.keys()
				if len(keys) != 1 || !e.files.isRetained(keys[0]) {
					t.Fatalf("receipt uploaded during booking must be retained: keys %v", keys)
				}
				return
			}
			want := http.StatusConflict
			if action == "delete" {
				want = http.StatusNotFound
			}
			if response.StatusCode != want {
				t.Errorf("upload after %s: status %d, want %d", action, response.StatusCode, want)
			}
			receipts, err := e.st.Receipts(context.Background(), draft.ID)
			if err != nil {
				t.Fatal(err)
			}
			if len(receipts) != 0 || e.files.count() != 0 {
				t.Errorf("refused upload left %d receipts and %d objects", len(receipts), e.files.count())
			}
		})
	}
}
