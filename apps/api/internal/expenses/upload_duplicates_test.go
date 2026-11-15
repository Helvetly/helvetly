package expenses

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"sync"
	"testing"
)

type uploadObject struct{ *bytes.Reader }

func (uploadObject) Close() error { return nil }
func (f *fakeStorage) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	b, err := f.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	return uploadObject{bytes.NewReader(b)}, nil
}

func TestReceiptUploadChecksContentNotFilename(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	x := e.create(b, complete(e.categories(b)["6640"].ID))
	if response := e.upload(b, x.ID, "first.pdf", pdf); response.StatusCode != 201 {
		t.Fatalf("first: %d", response.StatusCode)
	}
	if response := e.upload(b, x.ID, "renamed.pdf", pdf); response.StatusCode != 409 {
		t.Fatalf("duplicate receipt: %d, want 409", response.StatusCode)
	}
	if e.files.count() != 1 {
		t.Fatalf("duplicate left %d objects", e.files.count())
	}
	second := e.create(b, complete(e.categories(b)["6640"].ID))
	if response := e.upload(b, second.ID, "copied.pdf", pdf); response.StatusCode != 409 {
		t.Fatalf("duplicate on another expense: %d", response.StatusCode)
	}
	other := e.workspace()
	otherExpense := e.create(other, complete(e.categories(other)["6640"].ID))
	if response := e.upload(other, otherExpense.ID, "separate-tenant.pdf", pdf); response.StatusCode != 201 {
		t.Fatalf("another tenant: %d", response.StatusCode)
	}
	list, err := e.st.Receipts(context.Background(), x.ID)
	if err != nil || len(list) != 1 {
		t.Fatalf("receipts: %v %v", list, err)
	}
	e.do(b, "DELETE", "/api/v1/expenses/"+x.ID+"/receipts/"+list[0].ID, nil, 204, nil)
	if response := e.upload(b, second.ID, "reuploaded.pdf", pdf); response.StatusCode != 201 {
		t.Fatalf("after deleting draft receipt: %d", response.StatusCode)
	}
}

func TestConcurrentReceiptUploadsShareWorkspaceHashGuard(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	category := e.categories(b)["6640"].ID
	a, c := e.create(b, complete(category)), e.create(b, complete(category))
	start := make(chan struct{})
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for _, id := range []string{a.ID, c.ID} {
		wg.Go(func() { <-start; response := e.upload(b, id, id+".pdf", pdf); statuses <- response.StatusCode })
	}
	close(start)
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[201] != 1 || counts[409] != 1 || e.files.count() != 1 {
		t.Fatalf("concurrent receipts: %v objects=%d", counts, e.files.count())
	}
}

func TestReceiptHashCheckIncludesLegacyFiles(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	x := e.create(b, complete(e.categories(b)["6640"].ID))
	if response := e.upload(b, x.ID, "legacy.pdf", pdf); response.StatusCode != 201 {
		t.Fatalf("first:%d", response.StatusCode)
	}
	if _, err := e.raw.Exec(context.Background(), `UPDATE expense_receipts SET sha256=NULL WHERE expense_id=$1`, x.ID); err != nil {
		t.Fatal(err)
	}
	if response := e.upload(b, x.ID, "renamed.pdf", pdf); response.StatusCode != 409 {
		t.Fatalf("legacy duplicate: %d want409", response.StatusCode)
	}
	if e.files.count() != 1 {
		t.Fatalf("legacy upload duplicated: %d", e.files.count())
	}
}

func TestReceiptBatchRejectsIdenticalFilesBeforeStorage(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	x := e.create(b, complete(e.categories(b)["6640"].ID))
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for _, name := range []string{"first.pdf", "renamed.pdf"} {
		part, _ := mw.CreateFormFile("files[]", name)
		_, _ = part.Write(pdf)
	}
	_ = mw.Close()
	response, raw := e.send(b, "POST", "/api/v1/expenses/"+x.ID+"/receipts", &body, mw.FormDataContentType())
	if response.StatusCode != http.StatusConflict || !strings.Contains(string(raw), "duplicate_file") || e.files.count() != 0 {
		t.Fatalf("duplicate batch: %d %s, objects %d", response.StatusCode, raw, e.files.count())
	}
}

// Receipts of up to 25 MB each, but no request over the 95 MB the frontend packs, under Cloudflare's 100 MB.
func TestReceiptRequestLimit(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	x := e.create(b, complete(e.categories(b)["6640"].ID))
	filler := bytes.Repeat([]byte("x"), maxFileSize-512<<10)
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for i := range 5 {
		part, _ := mw.CreateFormFile("files[]", "part.pdf")
		_, _ = part.Write(append([]byte("%PDF-1.7\n"+string(rune('a'+i))), filler...))
	}
	_ = mw.Close()
	response, raw := e.send(b, "POST", "/api/v1/expenses/"+x.ID+"/receipts", &body, mw.FormDataContentType())
	if response.StatusCode != http.StatusRequestEntityTooLarge || !strings.Contains(string(raw), "payload_too_large") ||
		!strings.Contains(string(raw), "95 MB") || e.files.count() != 0 {
		t.Fatalf("over the request limit: %d %s, objects %d", response.StatusCode, raw, e.files.count())
	}
}
