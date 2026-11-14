package invoices

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/retention/retentiontest"
)

// retainingStorage records Object Lock retention and, once armed, cancels the request right after a PDF is stored,
// so the rest of the issue transaction fails and rolls back.
type retainingStorage struct {
	*fakeStorage
	retentiontest.Lock
	cancel context.CancelFunc
}

func (s *retainingStorage) Put(ctx context.Context, key string, body io.Reader, size int64, contentType, name string) error {
	if err := s.fakeStorage.Put(ctx, key, body, size, contentType, name); err != nil {
		return err
	}
	if s.cancel != nil && strings.HasSuffix(key, ".pdf") {
		s.cancel()
	}
	return nil
}

func TestIssuedPDFIsRetainedOnlyAfterCommit(t *testing.T) {
	e := newEnv(t)
	files := &retainingStorage{fakeStorage: e.files}
	e.svc.files = files
	b, clientID := e.ready()

	inv := e.issued(b, clientID, nil)
	if pdfs := e.files.has(inv.ID); len(files.Keys()) != 1 || len(pdfs) != 1 || files.Keys()[0] != pdfs[0] {
		t.Fatalf("committed issue retained %v, want its PDF %v", files.Keys(), pdfs)
	}

	draft := e.draft(b, clientID, nil)
	sum := sha256.Sum256([]byte(b.token))
	sess, err := e.st.SessionByToken(context.Background(), hex.EncodeToString(sum[:]), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	files.cancel = cancel
	req := httptest.NewRequest("POST", "/api/v1/invoices/"+draft.ID+"/issue", nil).WithContext(ctx)
	req.SetPathValue("id", draft.ID)
	if err := e.svc.issue(httptest.NewRecorder(), req, sess); err == nil {
		t.Fatal("issue with a cancelled transaction succeeded")
	}
	if len(files.Keys()) != 1 || len(e.files.has(draft.ID)) != 0 {
		t.Fatalf("rolled-back issue: retained %v, objects %v", files.Keys(), e.files.has(draft.ID))
	}
}
