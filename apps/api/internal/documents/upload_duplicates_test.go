package documents

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/expenses"
	"helvetly.com/api/internal/store"
)

type sharedUploadStorage struct{ *fakeStorage }

func (s sharedUploadStorage) Get(ctx context.Context, key string) ([]byte, error) {
	f, err := s.Open(ctx, key)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(f)
}

func TestHashCheckSpansDocumentsClientsAndReceipts(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	mux := http.NewServeMux()
	e.svc.Register(mux)
	files := sharedUploadStorage{e.files}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	clients.New(e.st, e.svc.auth, files, log).Register(mux)
	expenses.New(e.st, e.svc.auth, files, log).Register(mux)
	e.srv.Close()
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	doc := e.uploaded(b, "source.pdf", pdf)
	clientID := e.client(b, "Acme")
	postFile := func(endpoint, field, name, content string) (*http.Response, []byte) {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		part, _ := mw.CreateFormFile(field, name)
		_, _ = part.Write([]byte(content))
		_ = mw.Close()
		return e.send(b, "POST", endpoint, &buf, mw.FormDataContentType())
	}
	response, raw := postFile("/api/v1/clients/"+clientID+"/files", "files[]", "copy.pdf", pdf)
	var linked struct{ Data []store.ClientFile }
	if err := json.Unmarshal(raw, &linked); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 201 || len(linked.Data) != 1 || linked.Data[0].ID != doc.ID || e.files.count() != 1 {
		t.Fatalf("client did not reuse document: %d %s", response.StatusCode, raw)
	}
	var expense struct{ Data struct{ ID string } }
	e.do(b, "POST", "/api/v1/expenses", map[string]any{}, 201, &expense)
	response, raw = postFile("/api/v1/expenses/"+expense.Data.ID+"/receipts", "files[]", "renamed.pdf", pdf)
	if response.StatusCode != 201 { // Agent B: the receipt now reuses the Document (object count is theirs to pin)
		t.Fatalf("receipt duplicated document: %d %s", response.StatusCode, raw)
	}
	response, raw = postFile("/api/v1/expenses/"+expense.Data.ID+"/receipts", "files[]", "receipt.pdf", pdf+"unique")
	if response.StatusCode != 201 {
		t.Fatalf("first receipt: %d %s", response.StatusCode, raw)
	}
	response, raw = e.upload(b, "copied-receipt.pdf", pdf+"unique")
	if response.StatusCode != 200 || !strings.Contains(string(raw), `"reused":true`) || !strings.Contains(string(raw), "receipt.pdf") { // reused: nothing new stored
		t.Fatalf("document duplicated receipt: %d %s", response.StatusCode, raw)
	}
	member := e.join(b.workspace, "member")
	if _, err := e.raw.Exec(context.Background(), `UPDATE workspace_members SET scopes=ARRAY['write:clients'] WHERE workspace_id=$1 AND user_id=$2`, b.workspace, member.user); err != nil {
		t.Fatal(err)
	}
	privateClient := e.client(b, "Private link target")
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("files[]", "known-bytes.pdf")
	_, _ = part.Write([]byte(pdf))
	_ = mw.Close()
	response, raw = e.send(member, "POST", "/api/v1/clients/"+privateClient+"/files", &buf, mw.FormDataContentType())
	if response.StatusCode != 409 || strings.Contains(string(raw), doc.ID) || strings.Contains(string(raw), doc.Name) {
		t.Fatalf("client-only member gained private document metadata/link: %d %s", response.StatusCode, raw)
	}
}

type reusedBody struct {
	Data   store.Document
	Reused bool
}

func TestUploadReusesIdenticalBytesAcrossNamesAndFolders(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	first := e.uploaded(b, "first.pdf", pdf)
	folder := e.folder(b, "Elsewhere", nil)
	client := e.client(b, "Acme")
	response, raw := e.upload(b, "renamed.pdf", pdf, "folder_id", folder.ID, "client_id", client)
	var got reusedBody
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !got.Reused || got.Data.ID != first.ID || got.Data.Name != "first.pdf" {
		t.Fatalf("identical bytes not reused: %d %s", response.StatusCode, raw)
	}
	// a top-level Document moves into the folder the upload named, and is linked to the client
	if got.Data.FolderID == nil || *got.Data.FolderID != folder.ID || len(got.Data.Links) != 1 || got.Data.Links[0].ID != client {
		t.Fatalf("folder %v links %+v", got.Data.FolderID, got.Data.Links)
	}
	if e.files.count() != 1 {
		t.Fatalf("reuse left %d objects", e.files.count())
	}
	// Another upload naming another folder leaves the Document where it is; the link is not duplicated.
	other := e.folder(b, "Other", nil)
	_, raw = e.upload(b, "again.pdf", pdf, "folder_id", other.ID, "client_id", client)
	got = reusedBody{}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.Data.FolderID == nil || *got.Data.FolderID != folder.ID || len(got.Data.Links) != 1 {
		t.Fatalf("second reuse moved or relinked: %s", raw)
	}
	// Content hashes are scoped to a workspace, not shared between tenants.
	if d := e.uploaded(e.workspace(), "first.pdf", pdf); d.ID == first.ID {
		t.Fatal("another workspace reused the Document")
	}
	e.bulk(b, map[string]any{"action": "trash", "document_ids": []string{first.ID}})
	e.uploaded(b, "replacement.pdf", pdf)
}

func TestDocumentHashCheckIncludesLegacyAndFailsClosed(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(map[bool]string{false: "legacy duplicate", true: "missing legacy object"}[missing], func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace()
			first := e.uploaded(b, "legacy.pdf", pdf)
			if _, err := e.raw.Exec(context.Background(), `UPDATE documents SET sha256=NULL WHERE id=$1`, first.ID); err != nil {
				t.Fatal(err)
			}
			if missing {
				var key string
				if err := e.raw.QueryRow(context.Background(), `SELECT object_key FROM documents WHERE id=$1`, first.ID).Scan(&key); err != nil {
					t.Fatal(err)
				}
				if err := e.files.Delete(context.Background(), key); err != nil {
					t.Fatal(err)
				}
			}
			response, raw := e.upload(b, "renamed.pdf", pdf)
			want, count := 200, 1
			if missing {
				want, count = 500, 0
			}
			if response.StatusCode != want || e.files.count() != count {
				t.Fatalf("legacy SHA check: %d %s objects=%d want=%d/%d", response.StatusCode, raw, e.files.count(), want, count)
			}
		})
	}
}

func TestConcurrentUploadCreatesOneDocument(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	start := make(chan struct{})
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for _, name := range []string{"first.pdf", "second.pdf"} {
		wg.Go(func() { <-start; response, _ := e.upload(b, name, pdf); statuses <- response.StatusCode })
	}
	close(start)
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[201] != 1 || counts[200] != 1 || e.files.count() != 1 {
		t.Fatalf("concurrent duplicate uploads: statuses %v, objects %d", counts, e.files.count())
	}
	response, raw := e.upload(b, "invalid.pdf", "<script>not a PDF</script>")
	if response.StatusCode != 422 || !strings.Contains(string(raw), "validation_failed") {
		t.Fatalf("type validation: %d %s", response.StatusCode, raw)
	}
}
