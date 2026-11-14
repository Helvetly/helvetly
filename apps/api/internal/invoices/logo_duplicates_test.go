package invoices

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
)

func TestUploadingSameLogoPreservesObject(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	var first, second struct{ Data Settings }
	response, raw := e.upload(b, "first.png", pngOf(100, 100))
	if response.StatusCode != 200 {
		t.Fatalf("first logo: %d %s", response.StatusCode, raw)
	}
	if err := json.Unmarshal(raw, &first); err != nil {
		t.Fatal(err)
	}
	response, raw = e.upload(b, "renamed.png", pngOf(100, 100))
	if err := json.Unmarshal(raw, &second); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || first.Data.LogoFileID == nil || second.Data.LogoFileID == nil || *first.Data.LogoFileID != *second.Data.LogoFileID {
		t.Fatalf("identical logo replaced its object: first=%v second=%v status=%d", first.Data.LogoFileID, second.Data.LogoFileID, response.StatusCode)
	}
}

func TestConcurrentLogoChangesKeepCurrentObject(t *testing.T) {
	for _, same := range []bool{true, false} {
		t.Run(map[bool]string{true: "same bytes", false: "different bytes"}[same], func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace()
			start := make(chan struct{})
			var wg sync.WaitGroup
			for _, width := range []int{100, 200} {
				wg.Go(func() {
					<-start
					if same {
						width = 100
					}
					response, raw := e.upload(b, "logo.png", pngOf(width, 100))
					if response.StatusCode != 200 {
						t.Errorf("concurrent logo: %d %s", response.StatusCode, raw)
					}
				})
			}
			close(start)
			wg.Wait()
			set, err := loadSettings(context.Background(), e.st.Q, b.workspace)
			if err != nil || set.LogoFileID == nil {
				t.Fatalf("current logo: %v %v", set.LogoFileID, err)
			}
			if _, err := e.files.Get(context.Background(), logoKey(b.workspace, *set.LogoFileID)); err != nil {
				t.Fatal("cleanup deleted current logo:", err)
			}
			if objects := e.files.has("invoice-settings"); len(objects) != 1 {
				t.Fatalf("obsolete or duplicate logo objects: %v", objects)
			}
		})
	}
}
