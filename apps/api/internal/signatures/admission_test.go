package signatures

import (
	"context"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"

	"helvetly.com/api/internal/store"
)

// TestFullStorageStillCompletesAStartedPackage: the room for the signed result was held when the package was sent, so
// a workspace that filled its storage since (or was downgraded) still gets its signed contract, counted.
func TestFullStorageStillCompletesAStartedPackage(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "signer@example.com"))
	token := e.mail.link("signer@example.com")
	e.st.SetAdmission(func(_ context.Context, _ store.Q, _, resource string, _ int64) error {
		if resource == "storage_bytes" {
			return fmt.Errorf("%w: private Basic plan usage 5000/5000", store.ErrAdmissionDenied)
		}
		return nil
	})
	e.sign(token, http.StatusOK)
	got := e.get(b, req.ID)
	if got.Status != "completed" || got.SignedDocument == nil || got.FinalSHA256 == "" {
		t.Fatalf("a started package did not complete: %+v", got)
	}
	var counted int64
	if err := e.raw.QueryRow(context.Background(), `SELECT o.size FROM stored_objects o JOIN documents d ON d.object_key = o.object_key
		WHERE d.id = $1`, got.SignedDocument.ID).Scan(&counted); err != nil || counted == 0 {
		t.Fatalf("signed result counted %d bytes, err %v", counted, err)
	}
}

// TestSendingAPackageHoldsRoomForTheSignedResult: a new package needs room for its original and the signed result.
func TestSendingAPackageHoldsRoomForTheSignedResult(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	var asked atomic.Int64
	e.st.SetAdmission(func(_ context.Context, _ store.Q, _, resource string, add int64) error {
		if resource == "storage_bytes" {
			asked.Store(add)
			return fmt.Errorf("%w: full", store.ErrAdmissionDenied)
		}
		return nil
	})
	res, body := e.send(b, http.MethodPost, "/api/v1/signatures", newRequest(doc, "parallel", "signer@example.com"))
	if res.StatusCode == http.StatusCreated || asked.Load() == 0 {
		t.Fatalf("sent without room: %d %s (asked %d)", res.StatusCode, body, asked.Load())
	}
	var original int64
	if err := e.raw.QueryRow(context.Background(), `SELECT size FROM documents WHERE id = $1`, doc).Scan(&original); err != nil {
		t.Fatal(err)
	}
	if asked.Load() < 2*original-1024 { // the original as stamped for signing, twice
		t.Fatalf("asked room for %d bytes, the original has %d", asked.Load(), original)
	}
}
