package imports

import (
	"archive/zip"
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestFileContent(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	entry := "name,email\nZip AG,zip@example.test\n"
	w := e.upload("clients", map[string][]byte{"clients.csv": []byte(clientsCSV),
		"more.zip": zipOf(t, map[string][]byte{"inner.csv": []byte(entry)}, zip.Deflate)})
	if w.Code != 201 {
		t.Fatalf("upload: %d %s", w.Code, w.Body)
	}
	b := decode[store.ImportBatch](t, e.do("GET", "/api/v1/imports/"+decode[store.ImportBatch](t, w).ID, nil))
	byName := map[string]store.ImportFile{}
	for _, f := range b.Files {
		byName[f.Name] = f
	}
	csv, inner := byName["clients.csv"], byName["more.zip › inner.csv"]
	if csv.ID == "" || inner.ID == "" || !strings.HasPrefix(csv.ContentType, "text/plain") {
		t.Fatalf("files: %+v", b.Files)
	}
	other := e.person("ws_b", "usr_b", "owner", nil)
	colleague := e.person("ws_a", "usr_colleague", "admin", nil)
	url := func(file string) string { return "/api/v1/imports/" + b.ID + "/files/" + file + "/content" }
	for _, tc := range []struct {
		name   string
		as     *store.Session
		target string
		status int
		body   string
	}{
		{"uploaded file", e.sess, url(csv.ID), 200, clientsCSV},
		{"zip entry", e.sess, url(inner.ID), 200, entry},
		{"unknown file", e.sess, url("imf_missing"), 404, ""},
		{"unknown batch", e.sess, "/api/v1/imports/imb_missing/files/" + csv.ID + "/content", 404, ""},
		{"another workspace", other, url(csv.ID), 404, ""},
		{"colleague's batch", colleague, url(csv.ID), 404, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := e.as(tc.as).do("GET", tc.target, nil)
			if w.Code != tc.status {
				t.Fatalf("status %d %s", w.Code, w.Body)
			}
			if tc.status != 200 {
				return
			}
			if w.Body.String() != tc.body || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/plain") ||
				!strings.HasPrefix(w.Header().Get("Content-Disposition"), "inline") {
				t.Fatalf("got %q %v", w.Body, w.Header())
			}
		})
	}
}
