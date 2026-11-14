package documents

import (
	"testing"

	"helvetly.com/api/internal/store"
)

func TestStarFolders(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	member := e.join(b.workspace, "member")
	stranger := e.workspace()
	f := e.folder(b, "Contracts", nil)
	old := e.folder(b, "Old", nil)
	theirs := e.folder(stranger, "Theirs", nil)
	e.bulk(b, map[string]any{"action": "trash", "folder_ids": []string{old.ID}})

	path := func(id string) string { return "/api/v1/documents/folders/" + id + "/star" }
	for _, tc := range []struct {
		name   string
		who    *browser
		method string
		id     string
		want   int
	}{
		{"star", b, "PUT", f.ID, 204},
		{"star again is fine", b, "PUT", f.ID, 204},
		{"another workspace's folder", b, "PUT", theirs.ID, 404},
		{"a trashed folder", b, "PUT", old.ID, 404},
		{"no such folder", b, "PUT", "fld_nope", 404},
		{"unstar what was never starred", member, "DELETE", f.ID, 204},
		{"unstar a trashed folder", b, "DELETE", old.ID, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e.do(tc.who, tc.method, path(tc.id), nil, tc.want, nil)
		})
	}

	starred := func(who *browser) map[string]bool {
		var out one[[]store.Folder]
		e.do(who, "GET", "/api/v1/documents/folders", nil, 200, &out)
		m := map[string]bool{}
		for _, folder := range out.Data {
			m[folder.Name] = folder.Starred
		}
		return m
	}
	// Stars are personal: the member sees the same folder unstarred.
	if got := starred(b); !got["Contracts"] {
		t.Fatalf("owner's folders: %v", got)
	}
	if got := starred(member); got["Contracts"] {
		t.Fatalf("member's folders: %v", got)
	}

	e.do(b, "DELETE", path(f.ID), nil, 204, nil)
	e.do(b, "DELETE", path(f.ID), nil, 204, nil)
	if got := starred(b); got["Contracts"] {
		t.Fatalf("after unstar: %v", got)
	}
}
