package invoices

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

type cancelingLogoStorage struct {
	Storage
	cancel  context.CancelFunc
	bounded bool
}

func (s *cancelingLogoStorage) Put(ctx context.Context, key string, body io.Reader, size int64, contentType, name string) error {
	if err := s.Storage.Put(ctx, key, body, size, contentType, name); err != nil {
		return err
	}
	s.cancel()
	return nil
}
func (s *cancelingLogoStorage) Delete(ctx context.Context, key string) error {
	deadline, ok := ctx.Deadline()
	s.bounded = ok && time.Until(deadline) > 0 && time.Until(deadline) <= 5*time.Second
	if err := ctx.Err(); err != nil {
		return err
	}
	return s.Storage.Delete(ctx, key)
}

func TestCanceledLogoUploadCleansStoredObjectWithBoundedContext(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	sum := sha256.Sum256([]byte(b.token))
	sess, err := e.st.SessionByToken(context.Background(), hex.EncodeToString(sum[:]), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	files := &cancelingLogoStorage{Storage: e.files, cancel: cancel}
	e.svc.files = files
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, _ := mw.CreateFormFile("file", "logo.png")
	_, _ = part.Write(pngOf(100, 100))
	_ = mw.Close()
	req := httptest.NewRequest("PUT", logoPath, &body).WithContext(ctx)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if err := e.svc.putLogo(httptest.NewRecorder(), req, sess); err == nil {
		t.Fatal("cancelled persistence succeeded")
	}
	if len(e.files.has("invoice-settings")) != 0 || !files.bounded {
		t.Fatalf("cancelled request left objects=%d cleanupBounded=%t", len(e.files.has("invoice-settings")), files.bounded)
	}
	set, err := loadSettings(context.Background(), e.st.Q, b.workspace)
	if err != nil || set.LogoFileID != nil {
		t.Fatalf("logo after cancellation: %v %v", set.LogoFileID, err)
	}
}
