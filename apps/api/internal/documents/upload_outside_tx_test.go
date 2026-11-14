package documents

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// pausedStorage holds every Put until resume is closed.
type pausedStorage struct {
	Storage
	started chan struct{}
	resume  chan struct{}
}

func (s *pausedStorage) Put(ctx context.Context, key string, body io.Reader, size int64, contentType, name string) error {
	close(s.started)
	<-s.resume
	return s.Storage.Put(ctx, key, body, size, contentType, name)
}

func TestUploadHoldsNoLockWhileStoring(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	client := e.client(b, "Muster AG")
	paused := &pausedStorage{Storage: e.files, started: make(chan struct{}), resume: make(chan struct{})}
	e.svc.files = paused
	result := make(chan *http.Response, 1)
	go func() { resp, _ := e.upload(b, "slow.pdf", pdf, "client_id", client); result <- resp }()
	select {
	case <-paused.started:
	case <-time.After(5 * time.Second):
		t.Fatal("upload did not reach storage")
	}
	sum := sha256.Sum256([]byte(pdf))
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := e.st.Tx(ctx, func(q store.Q) error {
		if err := q.LockUploadHashes(ctx, b.workspace, []string{hex.EncodeToString(sum[:])}); err != nil {
			return err
		}
		_, err := q.LockClient(ctx, b.workspace, client)
		return err
	})
	close(paused.resume)
	if err != nil {
		t.Fatalf("locks held while the object was stored: %v", err)
	}
	if resp := <-result; resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload: status %d", resp.StatusCode)
	}
}
