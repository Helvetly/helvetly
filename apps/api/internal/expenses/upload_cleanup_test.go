package expenses

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"mime/multipart"
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

func TestCanceledReceiptUploadCleansStoredObjectWithBoundedContext(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	x := e.create(b, complete(e.categories(b)["6640"].ID))
	sum := sha256.Sum256([]byte(b.token))
	sess, err := e.st.SessionByToken(context.Background(), hex.EncodeToString(sum[:]), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	files := &cancelingStorage{Storage: e.files, cancel: cancel}
	e.svc.files = files
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, _ := mw.CreateFormFile("files[]", "cancelled.pdf")
	_, _ = part.Write(pdf)
	_ = mw.Close()
	req := httptest.NewRequest("POST", "/api/v1/expenses/"+x.ID+"/receipts", &body).WithContext(ctx)
	req.SetPathValue("id", x.ID)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if err := e.svc.uploadReceipts(httptest.NewRecorder(), req, sess); err == nil {
		t.Fatal("cancelled persistence succeeded")
	}
	if e.files.count() != 0 || !files.bounded {
		t.Fatalf("cancelled request left objects=%d cleanupBounded=%t", e.files.count(), files.bounded)
	}
	list, err := e.st.Receipts(context.Background(), x.ID)
	if err != nil || len(list) != 0 {
		t.Fatalf("receipts after cancellation: %v %v", list, err)
	}
}
