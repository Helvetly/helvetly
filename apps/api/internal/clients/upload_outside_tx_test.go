package clients

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
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

func TestClientUploadHoldsNoLockWhileStoring(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, map[string]any{"name": "Files"})
	token := sha256.Sum256([]byte(b.token))
	sess, err := e.st.SessionByToken(context.Background(), hex.EncodeToString(token[:]), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	paused := &pausedStorage{Storage: e.files, started: make(chan struct{}), resume: make(chan struct{})}
	svc := &Service{db: e.st, files: paused, log: slog.New(slog.NewTextHandler(io.Discard, nil)), now: time.Now}
	const content = "%PDF-1.7\nslow"
	body, ct := multipartBody(t, [2]string{"slow.pdf", content})
	req := httptest.NewRequest("POST", "/api/v1/clients/"+c.ID+"/files", body)
	req.SetPathValue("id", c.ID)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	result := make(chan error, 1)
	go func() { result <- svc.uploadFiles(rec, req, sess) }()
	select {
	case <-paused.started:
	case <-time.After(5 * time.Second):
		t.Fatal("upload did not reach storage")
	}
	sum := sha256.Sum256([]byte(content))
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err = e.st.Tx(ctx, func(q store.Q) error {
		if err := q.LockUploadHashes(ctx, b.workspace, []string{hex.EncodeToString(sum[:])}); err != nil {
			return err
		}
		_, err := q.LockClient(ctx, b.workspace, c.ID)
		return err
	})
	close(paused.resume)
	if err != nil {
		t.Fatalf("locks held while the object was stored: %v", err)
	}
	if err := <-result; err != nil || rec.Code != http.StatusCreated {
		t.Fatalf("upload: %v, status %d", err, rec.Code)
	}
}
