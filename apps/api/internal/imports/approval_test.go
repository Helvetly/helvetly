package imports

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// Uploading needs the uploader's own approval in this workspace: another member's, or their own in another
// workspace, never counts, and nothing is counted or sent.
func TestUploadNeedsTheUploadersOwnApproval(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a") // the owner approved for themselves
	member := e.person("ws_a", "usr_b", "member", []string{"write:clients", "write:documents"})
	ctx, now := context.Background(), time.Now()
	for _, err := range []error{ // the same person approved in another workspace
		e.db.CreateWorkspace(ctx, store.Workspace{ID: "ws_b", Name: "ws_b"}, "UTC", now),
		e.db.JoinMember(ctx, "ws_b", "usr_b", "owner", nil, now),
		e.db.SetAIConsent(ctx, "ws_b", "usr_b", true, now),
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	csv := map[string][]byte{"c.csv": []byte(clientsCSV)}
	if w := e.as(member).upload("clients", csv); w.Code != 403 || code(w) != "ai_consent_required" {
		t.Fatalf("member without own approval: %d %s", w.Code, w.Body)
	}
	if n, c := e.model.calls.Load(), e.model.counted.Load(); n != 0 || c != 0 {
		t.Fatalf("provider reached: answer=%d count=%d", n, c)
	}
	e.consent("ws_a", "usr_b")
	if w := e.as(member).upload("clients", csv); w.Code != 201 {
		t.Fatalf("after own approval: %d %s", w.Code, w.Body)
	}
}

// Queued reading is admitted for whoever started the import, as they are now: their approval withdrawn, their
// membership ended or their write access taken stops it before anything is counted or sent, even when other members
// have approved.
func TestQueuedReadingNeedsTheUploaderAsTheyAreNow(t *testing.T) {
	for name, change := range map[string]func(e *env) error{
		"approval withdrawn": func(e *env) error {
			return e.db.SetAIConsent(context.Background(), "ws_a", "usr_m", false, time.Now().Add(time.Second))
		},
		"no longer a member": func(e *env) error { return e.db.RemoveMember(context.Background(), "ws_a", "usr_m") },
		"write access taken": func(e *env) error {
			return e.db.SetMemberRole(context.Background(), "ws_a", "usr_m", "member", []string{"read:clients"})
		},
	} {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t)
			e.consent("ws_a", "usr_a") // another member's approval must not release it
			uploader := e.person("ws_a", "usr_m", "member", []string{"write:clients", "write:documents"})
			e.consent("ws_a", "usr_m")
			b := decode[store.ImportBatch](t, e.as(uploader).upload("clients", map[string][]byte{"c.pdf": []byte("%PDF-1.7 clients")}))
			if err := change(e); err != nil {
				t.Fatal(err)
			}
			got := e.as(e.sess).extractedAny(b.ID)
			if got != "failed" || e.model.calls.Load() != 0 || e.model.counted.Load() != 0 {
				t.Fatalf("status=%s answer=%d count=%d", got, e.model.calls.Load(), e.model.counted.Load())
			}
		})
	}
}

// extractedAny runs the queue once and returns the first file's status, read straight from the store (the uploader
// may no longer see the batch).
func (e *env) extractedAny(batchID string) string {
	e.t.Helper()
	if err := e.s.Tick(context.Background()); err != nil {
		e.t.Fatal(err)
	}
	var status string
	if err := e.raw.QueryRow(context.Background(), `SELECT status FROM import_files WHERE batch_id = $1 ORDER BY position LIMIT 1`, batchID).Scan(&status); err != nil {
		e.t.Fatal(err)
	}
	return status
}
