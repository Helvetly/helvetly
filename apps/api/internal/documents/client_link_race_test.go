package documents

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/clients"
)

type linkResult struct {
	status int
	body   []byte
}

func TestClientUploadLocksClientBeforeLegacyDocumentRows(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	clientID := e.client(b, "Client lock order")
	doc := e.uploaded(b, "legacy.pdf", pdf)
	mux := http.NewServeMux()
	e.svc.Register(mux)
	clients.New(e.st, e.svc.auth, sharedUploadStorage{e.files}, slog.New(slog.NewTextHandler(io.Discard, nil))).Register(mux)
	e.srv.Close()
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := e.raw.Exec(ctx, `UPDATE documents SET sha256=NULL WHERE id=$1`, doc.ID); err != nil {
		t.Fatal(err)
	}
	tx, err := e.raw.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(ctx, `SELECT 1 FROM clients WHERE id=$1 FOR UPDATE`, clientID); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("files[]", "new.pdf")
	_, _ = part.Write([]byte(strings.Replace(pdf, "hello", "other", 1)))
	_ = mw.Close()
	result := make(chan linkResult, 1)
	go func() {
		response, raw := e.send(b, "POST", "/api/v1/clients/"+clientID+"/files", &buf, mw.FormDataContentType())
		result <- linkResult{response.StatusCode, raw}
	}()
	for {
		var waiting bool
		if err := e.raw.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))`, tx.Conn().PgConn().PID()).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("client upload did not reach row lock")
		case <-time.After(5 * time.Millisecond):
		}
	}
	if _, err := tx.Exec(ctx, `SET LOCAL lock_timeout='1s'`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE documents SET name=name WHERE id=$1`, doc.ID); err != nil {
		t.Fatal("upload locked legacy document before client:", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-result:
		if got.status != 201 {
			t.Fatalf("client upload failed after opposite client/document lock order: %d %s", got.status, got.body)
		}
	case <-ctx.Done():
		t.Fatal("client upload did not finish")
	}
}

func TestDocumentUploadRechecksClientInsideTransaction(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	clientID := e.client(b, "Deleted during upload")
	ctx := context.Background()
	tx, err := e.raw.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	sum := sha256.Sum256([]byte(pdf))
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "upload:"+b.workspace+":"+hex.EncodeToString(sum[:])); err != nil {
		t.Fatal(err)
	}
	result := make(chan linkResult, 1)
	go func() {
		response, raw := e.upload(b, "client.pdf", pdf, "client_id", clientID)
		result <- linkResult{response.StatusCode, raw}
	}()
	deadline := time.After(5 * time.Second)
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for {
		var waiting bool
		if err := e.raw.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))`, tx.Conn().PgConn().PID()).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case <-deadline:
			t.Fatal("upload did not wait for hash lock")
		case <-tick.C:
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE clients SET deleted_at=now() WHERE id=$1`, clientID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-result:
		if got.status != 422 || !strings.Contains(string(got.body), "client_id") || e.files.count() != 0 {
			t.Fatalf("upload linked deleted client: %d %s objects=%d", got.status, got.body, e.files.count())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upload did not finish")
	}
}

func TestDocumentLinkWaitsForClientDeletion(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	clientID := e.client(b, "Concurrent deletion")
	doc := e.uploaded(b, "live.pdf", pdf)
	ctx := context.Background()
	tx, err := e.raw.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE clients SET deleted_at=now() WHERE id=$1`, clientID); err != nil {
		t.Fatal(err)
	}
	result := make(chan linkResult, 1)
	go func() {
		response, raw := e.send(b, http.MethodPost, "/api/v1/documents/"+doc.ID+"/links", map[string]any{"type": "client", "id": clientID}, "")
		result <- linkResult{response.StatusCode, raw}
	}()
	var early *linkResult
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	deadline := time.After(5 * time.Second)
	waiting := false
	for !waiting && early == nil {
		if err := e.raw.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))`, tx.Conn().PgConn().PID()).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case got := <-result:
			early = &got
		case <-deadline:
			t.Fatal("link did not finish or wait for client")
		case <-tick.C:
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var got linkResult
	if early != nil {
		got = *early
	} else {
		select {
		case got = <-result:
		case <-time.After(5 * time.Second):
			t.Fatal("link did not finish")
		}
	}
	if got.status != 422 || !strings.Contains(string(got.body), `"id"`) {
		t.Fatalf("linked concurrently deleted client: %d %s", got.status, got.body)
	}
	var count int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM document_links WHERE target_type='client' AND target_id=$1`, clientID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("links to deleted client: %d %v", count, err)
	}
}
