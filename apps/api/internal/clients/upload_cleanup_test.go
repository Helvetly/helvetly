package clients

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"
)

type cancelingStorage struct {
	Storage
	cancel  context.CancelFunc
	bounded bool
}

func (s *cancelingStorage) Put(ctx context.Context, key string, body io.Reader, size int64, contentType, name string) error {
	if err := s.Storage.Put(ctx, key, body, size, contentType, name); err != nil {
		return err
	}
	s.cancel()
	return nil
}
func (s *cancelingStorage) Delete(ctx context.Context, key string) error {
	deadline, ok := ctx.Deadline()
	s.bounded = ok && time.Until(deadline) > 0 && time.Until(deadline) <= 5*time.Second
	if err := ctx.Err(); err != nil {
		return err
	}
	return s.Storage.Delete(ctx, key)
}

func TestCanceledClientUploadCleansStoredObjectWithBoundedContext(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, map[string]any{"name": "Files"})
	sum := sha256.Sum256([]byte(b.token))
	sess, err := e.st.SessionByToken(context.Background(), hex.EncodeToString(sum[:]), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	files := &cancelingStorage{Storage: e.files, cancel: cancel}
	svc := &Service{db: e.st, files: files, log: slog.New(slog.NewTextHandler(io.Discard, nil)), now: time.Now}
	body, ct := multipartBody(t, [2]string{"cancelled.pdf", "%PDF-1.7\nhello"})
	req := httptest.NewRequest("POST", "/api/v1/clients/"+c.ID+"/files", body).WithContext(ctx)
	req.SetPathValue("id", c.ID)
	req.Header.Set("Content-Type", ct)
	if err := svc.uploadFiles(httptest.NewRecorder(), req, sess); err == nil {
		t.Fatal("cancelled persistence succeeded")
	}
	if len(e.files.keys()) != 0 || !files.bounded {
		t.Fatalf("cancelled request left objects=%d cleanupBounded=%t", len(e.files.keys()), files.bounded)
	}
	list, err := e.st.ClientFiles(context.Background(), c.ID)
	if err != nil || len(list) != 0 {
		t.Fatalf("files after cancellation: %v %v", list, err)
	}
}
