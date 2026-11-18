package expenses

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http/httptest"
	"testing"
	"time"

	"helvetly.com/api/internal/storage"
)

// cancelingRetain cancels the request when a receipt is locked, so whatever the booking still writes afterwards fails.
type cancelingRetain struct {
	*fakeStorage
	cancel context.CancelFunc
}

func (s *cancelingRetain) Retain(ctx context.Context, key string, until time.Time) (storage.Lock, error) {
	s.cancel()
	return s.fakeStorage.Retain(ctx, key, until)
}

func TestReceiptsAreRetainedOnlyForACommittedBooking(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	draft := e.create(owner, complete(e.categories(owner)["6640"].ID))
	if resp := e.upload(owner, draft.ID, "ticket.pdf", pdf); resp.StatusCode != 201 {
		t.Fatalf("upload: %d", resp.StatusCode)
	}
	token := sha256.Sum256([]byte(owner.token))
	sess, err := e.st.SessionByToken(context.Background(), hex.EncodeToString(token[:]), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	e.svc.files = &cancelingRetain{fakeStorage: e.files, cancel: cancel}
	req := httptest.NewRequest("POST", "/api/v1/expenses/"+draft.ID+"/book", nil).WithContext(ctx)
	req.SetPathValue("id", draft.ID)
	_ = e.svc.book(httptest.NewRecorder(), req, sess)

	got, err := e.st.Expense(context.Background(), owner.workspace, draft.ID, "2026-11-05", false)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range e.files.receiptKeys() {
		if e.files.isRetained(key) != (got.Status == "booked") {
			t.Fatalf("expense %s, receipt %s retained %t", got.Status, key, e.files.isRetained(key))
		}
	}
}
