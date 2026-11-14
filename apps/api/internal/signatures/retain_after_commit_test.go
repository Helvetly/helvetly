package signatures

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSignedPDFIsRetainedAfterTheCompletionCommits(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "one@example.com"))
	var seen []string
	e.files.retain = func(key string) {
		if !strings.HasSuffix(key, "/signed.pdf") {
			return
		}
		var status string // read on another connection: only a committed completion is visible
		if err := e.raw.QueryRow(context.Background(), `SELECT status FROM signature_requests WHERE id = $1`, req.ID).Scan(&status); err != nil {
			t.Error(err)
		}
		seen = append(seen, status)
	}
	e.sign(e.mail.link("one@example.com"), http.StatusOK)
	if len(seen) != 1 || seen[0] != "completed" {
		t.Fatalf("signed PDF retained while the request was %v, want once after completion", seen)
	}
}

// A request sent in one year and signed in the next: the original's lock is extended to the signed contract's deadline.
func TestCompletionExtendsTheOriginalsLock(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	doc, _ := e.pdfDocument(b, samplePDF(t, 2), "application/pdf")
	req := e.create(b, newRequest(doc, "parallel", "one@example.com"))
	ctx := context.Background()
	var original string
	if err := e.raw.QueryRow(ctx, `SELECT original_key FROM signature_requests WHERE id = $1`, req.ID).Scan(&original); err != nil {
		t.Fatal(err)
	}
	// as if sent a year earlier: requested and confirmed to the end of the previous year's tenth year
	if tag, err := e.raw.Exec(ctx, `UPDATE object_retention SET requested_until = requested_until - interval '1 year',
		locked_until = requested_until - interval '1 year' WHERE object_key = $1 AND status = 'confirmed'`, original); err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("original not confirmed on send: %v %v", tag, err)
	}
	e.sign(e.mail.link("one@example.com"), http.StatusOK)
	var signedUntil, originalUntil time.Time
	if err := e.raw.QueryRow(ctx, `SELECT locked_until FROM object_retention WHERE object_key = $1`, original).Scan(&originalUntil); err != nil {
		t.Fatal(err)
	}
	if err := e.raw.QueryRow(ctx, `SELECT r.locked_until FROM object_retention r JOIN documents d ON d.object_key = r.object_key
		JOIN signature_requests s ON s.signed_document_id = d.id WHERE s.id = $1`, req.ID).Scan(&signedUntil); err != nil {
		t.Fatal(err)
	}
	if originalUntil.Before(signedUntil) {
		t.Fatalf("original locked to %v, the signed PDF to %v", originalUntil, signedUntil)
	}
}
