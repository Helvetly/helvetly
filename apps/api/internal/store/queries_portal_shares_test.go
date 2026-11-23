package store

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func sharesDB(t *testing.T) (Q, *pgxpool.Pool) {
	q, pool := typesDB(t)
	exec(t, pool, `INSERT INTO workspaces (id, name, timezone, created_at) VALUES ('wsp_b', 'B', 'UTC', now())`)
	exec(t, pool, `INSERT INTO documents (id, workspace_id, name, size, content_type, object_key, created_at, updated_at)
		VALUES ('doc_1', 'wsp_a', 'Contract.pdf', 1200, 'application/pdf', 'k1', now(), now())`)
	return q, pool
}

func TestShareTwiceNoop(t *testing.T) {
	q, _ := sharesDB(t)
	ctx, now := context.Background(), time.Now().UTC().Truncate(time.Microsecond)
	for i := 0; i < 2; i++ {
		if err := q.ShareDocument(ctx, "wsp_a", "doc_1", "cli_1", "", now.Add(time.Duration(i)*time.Hour)); err != nil {
			t.Fatalf("share %d: %v", i, err)
		}
	}
	got, err := q.SharedDocuments(ctx, "wsp_a", "cli_1")
	if err != nil || len(got) != 1 || got[0].Name != "Contract.pdf" || got[0].Size != 1200 || !got[0].SharedAt.Equal(now) {
		t.Fatalf("shared = %+v, %v", got, err)
	}
	if sh, err := q.DocumentShares(ctx, "wsp_a", "doc_1"); err != nil || len(sh) != 1 || sh[0].ClientName != "One" {
		t.Fatalf("shares = %+v, %v", sh, err)
	}
	if d, err := q.Document(ctx, "wsp_a", "doc_1"); err != nil || len(d.SharedWith) != 1 || d.SharedWith[0].ClientName != "One" {
		t.Fatalf("document shared_with = %+v, %v", d.SharedWith, err)
	}
	if err := q.UnshareDocument(ctx, "wsp_a", "doc_1", "cli_1"); err != nil {
		t.Fatal(err)
	}
	if err := q.UnshareDocument(ctx, "wsp_a", "doc_1", "cli_1"); err != nil {
		t.Fatal(err)
	}
	if got, _ := q.SharedDocuments(ctx, "wsp_a", "cli_1"); len(got) != 0 {
		t.Fatalf("after unshare = %+v", got)
	}
}

func TestSharedDocumentTrashedHidden(t *testing.T) {
	q, pool := sharesDB(t)
	ctx := context.Background()
	if err := q.ShareDocument(ctx, "wsp_a", "doc_1", "cli_1", "", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := q.SharedDocument(ctx, "wsp_a", "cli_1", "doc_1"); err != nil {
		t.Fatal(err)
	}
	exec(t, pool, `UPDATE documents SET deleted_at = now() WHERE id = 'doc_1'`)
	if got, _ := q.SharedDocuments(ctx, "wsp_a", "cli_1"); len(got) != 0 {
		t.Fatalf("trashed listed: %+v", got)
	}
	if _, err := q.SharedDocument(ctx, "wsp_a", "cli_1", "doc_1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("trashed download = %v", err)
	}
	if err := q.ShareDocument(ctx, "wsp_a", "doc_1", "cli_1", "", time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("share trashed = %v", err)
	}
}

func TestSharedDocumentOtherWorkspace(t *testing.T) {
	q, _ := sharesDB(t)
	ctx := context.Background()
	if err := q.ShareDocument(ctx, "wsp_b", "doc_1", "cli_1", "", time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("share across workspaces = %v", err)
	}
	if err := q.ShareDocument(ctx, "wsp_a", "doc_1", "cli_1", "", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := q.SharedDocument(ctx, "wsp_b", "cli_1", "doc_1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("read across workspaces = %v", err)
	}
	if got, _ := q.SharedDocuments(ctx, "wsp_b", "cli_1"); len(got) != 0 {
		t.Fatalf("listed across workspaces: %+v", got)
	}
}

func TestUpsertChangeRequestConcurrent(t *testing.T) {
	q, pool := sharesDB(t)
	ctx, now := context.Background(), time.Now().UTC()
	exec(t, pool, `INSERT INTO client_contacts (id, workspace_id, client_id, name, is_primary, created_at, updated_at)
		VALUES ('con_1', 'wsp_a', 'cli_1', 'Ana', true, now(), now())`)
	if _, err := q.DecideChangeRequest(ctx, "wsp_a", "cli_1", "rejected", "", nil, "", now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("decide none = %v", err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := q.UpsertChangeRequest(ctx, "ccr_"+string(rune('a'+i)), "wsp_a", "cli_1", "con_1", map[string]any{"name": "N"}, now)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	first, err := q.PendingChangeRequest(ctx, "wsp_a", "cli_1")
	if err != nil || first.ContactName != "Ana" {
		t.Fatalf("pending = %+v, %v", first, err)
	}
	second, err := q.UpsertChangeRequest(ctx, "ccr_x", "wsp_a", "cli_1", "con_1", map[string]any{"name": "M"}, now)
	if err != nil || second.ID != first.ID || second.Fields["name"] != "M" {
		t.Fatalf("second = %+v, %v", second, err)
	}
	if _, err := q.LastDecidedChangeRequest(ctx, "wsp_a", "cli_1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("last decided before any = %v", err)
	}
	done, err := q.DecideChangeRequest(ctx, "wsp_a", "cli_1", "approved", "", []string{"name"}, "", now)
	if err != nil || done.Status != "approved" || !slices.Equal(done.Applied, []string{"name"}) || done.Reason != nil || done.DecidedAt == nil {
		t.Fatalf("decide = %+v, %v", done, err)
	}
	if _, err := q.PendingChangeRequest(ctx, "wsp_a", "cli_1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("pending after decide = %v", err)
	}
	if again, err := q.UpsertChangeRequest(ctx, "ccr_new", "wsp_a", "cli_1", "con_1", map[string]any{"name": "P"}, now); err != nil || again.ID != "ccr_new" {
		t.Fatalf("new after decided = %+v, %v", again, err)
	}
	rejected, err := q.DecideChangeRequest(ctx, "wsp_a", "cli_1", "rejected", "", nil, "Wrong VAT", now.Add(time.Minute))
	if err != nil || rejected.Applied != nil || rejected.Reason == nil || *rejected.Reason != "Wrong VAT" {
		t.Fatalf("reject = %+v, %v", rejected, err)
	}
	if last, err := q.LastDecidedChangeRequest(ctx, "wsp_a", "cli_1"); err != nil || last.ID != "ccr_new" {
		t.Fatalf("last decided = %+v, %v", last, err)
	}
	if _, err := q.LastDecidedChangeRequest(ctx, "wsp_b", "cli_1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("last decided across workspaces = %v", err)
	}
}
