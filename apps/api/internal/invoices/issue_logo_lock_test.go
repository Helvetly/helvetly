package invoices

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// pausedLogo holds the first read of a logo until resumed, so a test can look at the locks held meanwhile.
type pausedLogo struct {
	*fakeStorage
	started, resume chan struct{}
}

func (s *pausedLogo) Get(ctx context.Context, key string) ([]byte, error) {
	if strings.Contains(key, "/invoice-settings/") && s.started != nil {
		close(s.started)
		s.started = nil
		<-s.resume
	}
	return s.fakeStorage.Get(ctx, key)
}

func TestIssueReadsTheLogoBeforeTakingANumber(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	if resp, raw := e.upload(b, "logo.png", pngOf(100, 100)); resp.StatusCode != 200 {
		t.Fatalf("logo upload: %d %s", resp.StatusCode, raw)
	}
	draft := e.draft(b, clientID, nil)
	sum := sha256.Sum256([]byte(b.token))
	sess, err := e.st.SessionByToken(context.Background(), hex.EncodeToString(sum[:]), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	paused := &pausedLogo{fakeStorage: e.files, started: make(chan struct{}), resume: make(chan struct{})}
	started := paused.started
	e.svc.files = paused

	issued := make(chan error, 1)
	go func() {
		req := httptest.NewRequest("POST", "/api/v1/invoices/"+draft.ID+"/issue", nil)
		req.SetPathValue("id", draft.ID)
		issued <- e.svc.issue(httptest.NewRecorder(), req, sess)
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("issue did not read the logo")
	}

	// while the logo is read, the gapless counter must stay free for other issues in the workspace
	series, _ := Series("invoice")
	year, _ := strconv.Atoi(e.today()[:4])
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	probe := errors.New("probe only")
	err = e.st.Tx(ctx, func(q store.Q) error {
		if _, err := q.NextInvoiceSeq(ctx, b.workspace, series, year); err != nil {
			return err
		}
		return probe // roll back: the probe must not take a number
	})
	close(paused.resume)
	if !errors.Is(err, probe) {
		t.Fatalf("invoice counter locked while the logo was read: %v", err)
	}
	if err := <-issued; err != nil {
		t.Fatalf("issue: %v", err)
	}
}
