package imports

import (
	"context"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/store"
)

func TestBatchDoneNotifiesTheUploaderOnce(t *testing.T) {
	for _, c := range []struct {
		name   string
		reply  func(aimodel.Request) (aimodel.Reply, error)
		event  string
		detail string
	}{
		{"records", answer(`{"records":[{"name":"Acme AG"},{"name":"Beta GmbH"}]}`), "import.ready", `"records": 2`},
		{"nothing found", answer(`{"records":[]}`), "import.failed", "No records were found"},
		{"unreadable", func(aimodel.Request) (aimodel.Reply, error) { return aimodel.Reply{}, context.DeadlineExceeded }, "import.failed", "not asked again"},
	} {
		t.Run(c.name, func(t *testing.T) {
			e := newEnv(t)
			admin := e.person("ws_a", "usr_b", "admin", nil)
			other := e.person("ws_b", "usr_c", "owner", nil)
			e.model.replies = append(e.model.replies, c.reply)
			b := decode[store.ImportBatch](t, e.upload("clients", map[string][]byte{"c.pdf": []byte("%PDF-1.7 fake")}))
			e.extracted(b.ID)
			e.extracted(b.ID) // a later run tells nobody again
			ctx := context.Background()
			got, err := e.db.Notifications(ctx, "ws_a", "usr_a", store.NotificationFilter{Limit: 50})
			if err != nil || len(got) != 1 || got[0].Event != c.event || !strings.Contains(string(got[0].Data), c.detail) ||
				!strings.Contains(string(got[0].Data), `"/clients"`) {
				t.Fatalf("uploader: %+v %v", got, err)
			}
			for _, s := range []*store.Session{admin, other} {
				if got, _ := e.db.Notifications(ctx, s.Workspace.ID, s.User.ID, store.NotificationFilter{Limit: 50}); len(got) != 0 {
					t.Fatalf("%s told: %+v", s.User.ID, got)
				}
			}
		})
	}
}

func TestBatchDoneRespectsPrefsAndWaitsForEveryFile(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if err := e.db.SetUserNotificationPrefs(ctx, "usr_a", store.NotificationPrefs{"import.ready": {}}, time.Now()); err != nil {
		t.Fatal(err)
	}
	b := decode[store.ImportBatch](t, e.upload("clients", map[string][]byte{"c.csv": []byte(clientsCSV)}))
	if got := e.extracted(b.ID); got.Status != "review" {
		t.Fatalf("batch %+v", got)
	}
	if got, _ := e.db.Notifications(ctx, "ws_a", "usr_a", store.NotificationFilter{Limit: 50}); len(got) != 0 {
		t.Fatalf("switched off, still told: %+v", got)
	}
}
