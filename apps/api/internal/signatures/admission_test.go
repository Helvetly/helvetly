package signatures

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestStorageAdmissionFailureKeepsLastSignaturePendingAndRetryable(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "signer@example.com"))
	token := e.mail.link("signer@example.com")
	var blocked atomic.Bool
	blocked.Store(true)
	e.st.SetAdmission(func(_ context.Context, _ store.Q, _, resource string, _ int64) error {
		if resource == "storage_bytes" && blocked.Load() {
			return fmt.Errorf("%w: private Basic plan usage 5000/5000", store.ErrAdmissionDenied)
		}
		return nil
	})
	res, body := e.send(nil, http.MethodPost, "/api/v1/public/sign/"+token, map[string]any{
		"consent": true, "signature": map[string]string{"method": "drawn", "image": signatureDataURL(t)}, "values": map[string]string{},
	})
	if res.StatusCode != http.StatusConflict || !strings.Contains(string(body), `"code":"completion_unavailable"`) {
		t.Fatalf("blocked completion status=%d body=%s", res.StatusCode, body)
	}
	for _, private := range []string{"Basic", "5000", "private", "limit_reached", `"plan"`} {
		if strings.Contains(string(body), private) {
			t.Fatalf("public response exposed private quota information: %s", body)
		}
	}
	got := e.get(b, req.ID)
	if got.Status != "pending" || statuses(got) != "sent" || got.SignedDocument != nil || got.FinalSHA256 != "" {
		t.Fatalf("failed completion was committed: %+v", got)
	}
	for _, event := range got.Events {
		if event.Type == "signed" || event.Type == "completed" {
			t.Fatalf("rolled-back signature left event %s", event.Type)
		}
	}
	var signedDocuments int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM documents WHERE workspace_id=$1 AND name LIKE '%signed.pdf'`, b.workspace).Scan(&signedDocuments); err != nil || signedDocuments != 0 {
		t.Fatalf("failed completion left signed documents=%d err=%v", signedDocuments, err)
	}
	blocked.Store(false)
	e.sign(token, http.StatusOK)
	got = e.get(b, req.ID)
	if got.Status != "completed" || statuses(got) != "signed" || got.SignedDocument == nil || got.FinalSHA256 == "" {
		t.Fatalf("retry did not complete request: %+v", got)
	}
}
