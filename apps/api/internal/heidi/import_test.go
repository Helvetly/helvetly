package heidi

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func chatImport(t *testing.T, mux http.Handler, conversation, importID string, files ...string) (int, string) {
	t.Helper()
	var b bytes.Buffer
	form := multipart.NewWriter(&b)
	for k, v := range map[string]string{"conversation_id": conversation, "message": "Import these", "import_id": importID} {
		_ = form.WriteField(k, v)
	}
	for _, name := range files {
		f, _ := form.CreateFormFile("files[]", name)
		_, _ = f.Write([]byte("%PDF-1.4"))
	}
	_ = form.Close()
	w := call(mux, "POST", "/api/v1/heidi/chat", b.String(), form.FormDataContentType())
	return w.Code, w.Body.String()
}

func TestChatFollowsAnAutoImport(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	ctx, now := context.Background(), time.Now().UTC()
	key := "k"
	files := []store.ImportFile{{ID: "imf_1", Name: "2025-IN-001.pdf", Size: 1, ContentType: "application/pdf", ObjectKey: &key, Status: "queued"},
		{ID: "imf_2", Position: 1, Name: "contract.pdf", Size: 1, ContentType: "application/pdf", ObjectKey: &key, Status: "queued"}}
	for _, b := range []store.ImportBatch{{ID: "imp_auto", Kind: "auto"}, {ID: "imp_clients", Kind: "clients"}} {
		b.WorkspaceID, b.UserID = sess.Workspace.ID, sess.User.ID
		list := files
		if b.Kind != "auto" {
			list = nil
		}
		if err := s.db.CreateImportBatch(ctx, b, list, now); err != nil {
			t.Fatal(err)
		}
	}
	conversation := "conv_import"
	code, body := chatImport(t, mux, conversation, "imp_auto")
	if code != 200 || !strings.Contains(body, `{"import_id":"imp_auto","type":"import"}`) || !strings.Contains(body, "these 2 files") {
		t.Fatalf("auto import: %d %s", code, body)
	}
	msgs, err := s.db.HeidiMessages(ctx, sess.Workspace.ID, sess.User.ID, conversation)
	if err != nil || len(msgs) != 2 || !strings.Contains(string(msgs[1]), `"import_id": "imp_auto"`) || !strings.Contains(string(msgs[0]), "contract.pdf") {
		t.Fatalf("stored transcript: %v %s", err, msgs)
	}
	for name, importID := range map[string]string{"another kind": "imp_clients", "unknown": "imp_nope"} {
		if code, body := chatImport(t, mux, conversation, importID); code != 404 {
			t.Fatalf("%s: %d %s", name, code, body)
		}
	}
	if code, body := chatImport(t, mux, conversation, "imp_auto", "a.pdf"); code != 400 {
		t.Fatalf("files and an import: %d %s", code, body)
	}
	if code, body := chatImport(t, mux, conversation, "../imp"); code != 400 {
		t.Fatalf("malformed id: %d %s", code, body)
	}
}
