package dataexport

import (
	"archive/zip"
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func zipEntries(t *testing.T, body string) map[string]string {
	t.Helper()
	r, err := zip.NewReader(strings.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, f := range r.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(rc)
		_ = rc.Close()
		out[f.Name] = string(b)
	}
	return out
}

func TestBackupDoesNotArchiveRestoredWorkspace(t *testing.T) {
	files := fakeFiles{"k/doc_a": "%PDF", "k/quo_a": "%PDF quote"}
	e := newEnv(t, files)
	ctx, now := t.Context(), time.Now()
	if err := e.st.DeleteWorkspace(ctx, "ws_a", "wdl_a", "usr_a", now); err != nil {
		t.Fatal(err)
	}
	pending, err := e.st.PendingBackups(ctx, now, 1)
	if err != nil || len(pending) != 1 {
		t.Fatalf("before restore: %+v, %v", pending, err)
	}
	if err := e.st.Tx(ctx, func(q store.Q) error {
		_, err := q.RestoreWorkspace(ctx, "wdl_a", "usr_a", now.Add(-time.Hour), now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.backup(ctx, pending[0]); err != nil {
		t.Fatal(err)
	}
	if _, found := files[BackupKey(pending[0])]; found {
		t.Fatal("created an archive for a restored workspace")
	}
	pending, err = e.st.PendingBackups(ctx, now, 1)
	if err != nil || len(pending) != 0 {
		t.Fatalf("after restore: %+v, %v", pending, err)
	}
}

// TestBackupDeleted: a deleted workspace gets one archive of its own records and files plus who deleted it and its
// members; a failed write is recorded and tried again only after backupRetry.
func TestBackupDeleted(t *testing.T) {
	files := fakeFiles{"k/doc_a": "%PDF", "k/quo_a": "%PDF quote", "fail-put": ""}
	e := newEnv(t, files)
	ctx := context.Background()
	if err := e.st.DeleteWorkspace(ctx, "ws_a", "wdl_a", "usr_a", time.Now()); err != nil {
		t.Fatal(err)
	}
	key := BackupKey(store.PendingBackup{ID: "wdl_a", WorkspaceID: "ws_a"})

	e.svc.BackupDeleted(ctx)
	if _, stored := files[key]; stored {
		t.Fatal("stored while storage is down")
	}
	delete(files, "fail-put")
	e.svc.BackupDeleted(ctx)
	if _, stored := files[key]; stored {
		t.Fatal("retried before backupRetry")
	}
	e.svc.now = func() time.Time { return time.Now().Add(2 * backupRetry) }
	e.svc.BackupDeleted(ctx)
	body, stored := files[key]
	if !stored {
		t.Fatal("no archive after the retry")
	}
	z := zipEntries(t, body)
	if !strings.Contains(z["data/clients.json"], "Kunde A") || strings.Contains(z["data/clients.json"], "Secret Kunde B") {
		t.Fatalf("clients: %s", z["data/clients.json"])
	}
	if z["files/documents/doc_a-.._.._contract.pdf"] != "%PDF" {
		t.Fatalf("document missing: %v", keys(z))
	}
	if d := z["deletion.json"]; !strings.Contains(d, `"deleted_by": "usr_a"`) || !strings.Contains(d, `"role": "owner"`) {
		t.Fatalf("deletion.json: %s", d)
	}
	if !strings.Contains(z["README.txt"], "Muster AG") {
		t.Fatalf("README: %s", z["README.txt"])
	}

	files[key] = "untouched"
	e.svc.BackupDeleted(ctx)
	if files[key] != "untouched" {
		t.Fatal("archived twice")
	}
}
