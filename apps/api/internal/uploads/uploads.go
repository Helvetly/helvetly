// Package uploads applies content-based duplicate checks to HTTP file uploads.
package uploads

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

// MaxFileBytes is the largest file any upload entry point stores (smaller purpose-specific caps, such as photos,
// stay lower).
const MaxFileBytes = 25 << 20

// MaxRequestBytes bounds one upload request: Cloudflare's proxy refuses bodies over 100 MB, so the app sends at most
// 95 MiB of files per request, plus headroom for the multipart framing (99.7 MB in all).
const MaxRequestBytes = 95<<20 + 64<<10

// Cleanup must outlive a canceled request, but a storage failure must not leave the handler hanging.
func CleanupContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
}

// Backfill compares old files by their actual bytes. Equal size is only a candidate filter, never proof of a duplicate.
func Backfill(ctx context.Context, q store.Q, workspaceID string, sizes []int64, open func(context.Context, string) (io.ReadSeekCloser, error)) error {
	sizes = slices.Clone(sizes)
	slices.Sort(sizes)
	for _, size := range slices.Compact(sizes) {
		if err := backfillSize(ctx, q, workspaceID, size, open); err != nil {
			return err
		}
	}
	return nil
}

func backfillSize(ctx context.Context, q store.Q, workspaceID string, size int64, open func(context.Context, string) (io.ReadSeekCloser, error)) error {
	old, err := q.UnhashedUploads(ctx, workspaceID, size)
	if err != nil {
		return err
	}
	for _, f := range old {
		object, err := open(ctx, f.ObjectKey)
		if err != nil {
			return fmt.Errorf("read legacy upload %s for duplicate check: %w", f.ID, err)
		}
		sum := sha256.New()
		n, readErr := io.Copy(sum, io.LimitReader(object, size+1))
		closeErr := object.Close()
		if readErr != nil {
			return fmt.Errorf("hash legacy upload %s: %w", f.ID, readErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close legacy upload %s: %w", f.ID, closeErr)
		}
		if n != size {
			return fmt.Errorf("legacy upload %s has %d bytes, expected %d", f.ID, n, size)
		}
		if err := q.SaveUploadHash(ctx, workspaceID, f, hex.EncodeToString(sum.Sum(nil))); err != nil {
			return err
		}
	}
	return nil
}

func Hash(h *multipart.FileHeader) (string, error) {
	f, err := h.Open()
	if err != nil {
		return "", fmt.Errorf("open upload for hashing: %w", err)
	}
	defer f.Close()
	sum := sha256.New()
	if _, err := io.Copy(sum, f); err != nil {
		return "", fmt.Errorf("hash upload: %w", err)
	}
	return hex.EncodeToString(sum.Sum(nil)), nil
}

func Duplicate(sess store.Session, d store.DuplicateUpload) error {
	resource := "documents"
	if d.Resource == "receipt" {
		resource = "expenses"
	}
	if !permissions.Allows(sess.Role, sess.Scopes, "read:"+resource) {
		return auth.Error(http.StatusConflict, "duplicate_file", "This file has already been uploaded in this workspace.", nil)
	}
	details := map[string]any{"existing_id": d.ID, "existing_name": d.Name, "resource": d.Resource}
	if d.ExpenseID != nil {
		details["expense_id"] = *d.ExpenseID
	}
	return auth.Error(http.StatusConflict, "duplicate_file", "This file has already been uploaded as "+d.Name+".", details)
}

func CheckBatch(sums map[string]string, sum, name string) error {
	if first, ok := sums[sum]; ok {
		return auth.Error(http.StatusConflict, "duplicate_file", name+" contains the same file as "+first+".",
			map[string]any{"existing_name": first, "resource": "upload"})
	}
	sums[sum] = name
	return nil
}
