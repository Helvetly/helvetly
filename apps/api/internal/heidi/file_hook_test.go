package heidi

import (
	"context"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestAttachmentsAreQueuedForFiling(t *testing.T) {
	s, mux, _, _ := fixture(t)
	var queued []string
	s.file = func(_ context.Context, _ store.Session, id string) { queued = append(queued, id) }
	if w := chat(t, mux, "file", "Keep this attachment", "%PDF-1.7\nfile me"); w.Code != 200 {
		t.Fatalf("upload: %d %s", w.Code, w.Body)
	}
	list, _, err := s.db.ListDocuments(context.Background(), "ws_heidi", store.DocumentFilter{Sort: "name"}, 50, 0)
	if err != nil || len(list) != 1 || len(queued) != 1 || queued[0] != list[0].ID {
		t.Fatalf("queued %v, documents %+v, err %v", queued, list, err)
	}
}
