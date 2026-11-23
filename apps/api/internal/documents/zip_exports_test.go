package documents

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

type exportsOut struct{ Data []store.ZipExport }

func (g grouped) exports(b *browser) []store.ZipExport {
	g.e.t.Helper()
	var out exportsOut
	g.e.do(b, "GET", "/api/v1/documents/exports", nil, 200, &out)
	return out.Data
}

func (g grouped) count(sql string, args ...any) int {
	g.e.t.Helper()
	var n int
	if err := g.e.raw.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		g.e.t.Fatal(err)
	}
	return n
}

// Up to zipStream bytes a group streams; above, check=1 says it is built in the background and the stream refuses.
func TestZipStreamThreshold(t *testing.T) {
	g := newGrouped(t)
	for _, tc := range []struct {
		name   string
		stream int64
		check  int
		code   string
	}{
		{"small streams", 1 << 20, 204, ""},
		{"big goes to the background", 10, 200, "zip_async"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			g.e.svc.zipStream = tc.stream
			var out struct {
				Data struct {
					Async bool
					Files int
				}
			}
			if tc.code == "" {
				g.e.do(g.b, "GET", "/api/v1/documents/groups/zip?type=invoices&check=1", nil, tc.check, nil)
				resp, _ := g.e.send(g.b, "GET", "/api/v1/documents/groups/zip?type=invoices", nil, "")
				if resp.StatusCode != 200 {
					t.Fatalf("stream = %d", resp.StatusCode)
				}
				return
			}
			g.e.do(g.b, "GET", "/api/v1/documents/groups/zip?type=invoices&check=1", nil, tc.check, &out)
			if !out.Data.Async || out.Data.Files != 2 {
				t.Fatalf("check = %+v", out.Data)
			}
			g.e.fails(g.b, "GET", "/api/v1/documents/groups/zip?type=invoices", nil, 409, tc.code)
		})
	}
}

func TestZipExportQueueBuildDownload(t *testing.T) {
	g := newGrouped(t)
	g.e.svc.zipStream = 10
	var queued struct{ Data store.ZipExport }
	g.e.do(g.b, "POST", "/api/v1/documents/groups/zip?group=type,year&type=invoices", nil, 202, &queued)
	id := queued.Data.ID
	if queued.Data.Status != "pending" || queued.Data.Name != "documents-invoices.zip" || queued.Data.Files != 2 {
		t.Fatalf("queued = %+v", queued.Data)
	}
	g.e.fails(g.b, "POST", "/api/v1/documents/groups/zip?type=quotes", nil, 409, "zip_pending")
	g.e.fails(g.b, "POST", "/api/v1/documents/groups/zip?type=quotes&year=1999", nil, 422, "empty")
	g.e.fails(g.b, "GET", "/api/v1/documents/exports/"+id+"/download", nil, 409, "zip_pending")
	if list := g.exports(g.b); len(list) != 1 || list[0].Status != "pending" {
		t.Fatalf("exports = %+v", list)
	}

	g.e.svc.ZipExportsTick(context.Background())
	list := g.exports(g.b)
	if len(list) != 1 || list[0].Status != "ready" || list[0].ExpiresAt == nil {
		t.Fatalf("after the build = %+v", list)
	}
	key := "workspaces/" + g.b.workspace + "/exports/documents-" + id + ".zip"
	g.e.files.mu.Lock()
	raw := g.e.files.objects[key]
	g.e.files.mu.Unlock()
	got := []string{}
	for name := range readZip(t, raw) {
		got = append(got, name)
	}
	slices.Sort(got)
	if want := []string{"2025/Acme AG/a.pdf", "2026/No client/Rechnung-7.pdf"}; !slices.Equal(got, want) {
		t.Fatalf("zip entries = %v, want %v", got, want)
	}
	if n := g.count(`SELECT count(*) FROM stored_objects WHERE object_key = $1`, key); n != 0 {
		t.Fatal("the export counts as storage")
	}
	if n := g.count(`SELECT count(*) FROM documents WHERE object_key = $1`, key); n != 0 {
		t.Fatal("the export is a document")
	}
	if n := g.count(`SELECT count(*) FROM notifications WHERE user_id = $1 AND event = 'documents.zip_ready' AND data->>'export_id' = $2`,
		g.b.user, id); n != 1 {
		t.Fatalf("notifications = %d", n)
	}
	if n := g.count(`SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'documents.exported'`, g.b.workspace); n != 1 {
		t.Fatalf("audited %d times", n)
	}

	// only the member who asked downloads it, through storage.Serve
	resp, _ := g.e.send(g.b, "GET", "/api/v1/documents/exports/"+id+"/download", nil, "")
	if resp.StatusCode != 302 || !strings.HasPrefix(resp.Header.Get("Location"), "https://s3.test/"+key) {
		t.Fatalf("download = %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	colleague := g.e.join(g.b.workspace, "admin")
	g.e.fails(colleague, "GET", "/api/v1/documents/exports/"+id+"/download", nil, 404, "not_found")
	g.e.fails(g.other, "GET", "/api/v1/documents/exports/"+id+"/download", nil, 404, "not_found")
	if len(g.exports(colleague)) != 0 {
		t.Fatal("a colleague sees the member's exports")
	}

	// expired: refused at once, deleted with its object by the next tick
	later := time.Now().Add(zipKeep + time.Hour)
	g.e.svc.now = func() time.Time { return later }
	g.e.fails(g.b, "GET", "/api/v1/documents/exports/"+id+"/download", nil, 410, "zip_expired")
	g.e.svc.ZipExportsTick(context.Background())
	g.e.files.mu.Lock()
	_, kept := g.e.files.objects[key]
	g.e.files.mu.Unlock()
	if kept || g.count(`SELECT count(*) FROM document_zip_exports WHERE id = $1`, id) != 0 {
		t.Fatal("the expired export was not deleted")
	}
}

// One export at a time per workspace: a second one of the same workspace waits for the first's lease; another
// workspace's goes ahead.
func TestZipExportClaimOnePerWorkspace(t *testing.T) {
	g := newGrouped(t)
	ctx := context.Background()
	now := time.Now()
	colleague := g.e.join(g.b.workspace, "admin")
	for i, w := range []struct{ ws, user string }{{g.b.workspace, g.b.user}, {g.b.workspace, colleague.user},
		{g.other.workspace, g.other.user}} {
		e := store.ZipExport{ID: "zip_" + string(rune('a'+i)), WorkspaceID: w.ws, UserID: w.user, Query: "type=invoices",
			Zone: "Europe/Zurich", Name: "documents.zip", CreatedAt: now.Add(time.Duration(i) * time.Second)}
		if ok, err := g.e.st.QueueZipExport(ctx, e); err != nil || !ok {
			t.Fatal(ok, err)
		}
	}
	claim := func(at time.Time) string {
		var e store.ZipExport
		err := g.e.st.Tx(ctx, func(q store.Q) (err error) {
			e, err = q.ClaimZipExport(ctx, at, zipLease)
			return err
		})
		if errors.Is(err, store.ErrNotFound) {
			return ""
		}
		if err != nil {
			t.Fatal(err)
		}
		return e.ID
	}
	for _, want := range []string{"zip_a", "zip_c", ""} {
		if got := claim(now.Add(time.Minute)); got != want {
			t.Fatalf("claimed %q, want %q", got, want)
		}
	}
	// the first one's instance died: its lease lapses and it is the next again, still before its colleague's
	if got := claim(now.Add(zipLease + 2*time.Minute)); got != "zip_a" {
		t.Fatalf("after the lease claimed %q", got)
	}
}

// A deleted workspace's exports go with their objects; a refusal at build time fails the export and says so.
func TestZipExportDeletedWorkspaceAndFailure(t *testing.T) {
	g := newGrouped(t)
	ctx := context.Background()
	g.e.svc.zipStream = 10
	var queued struct{ Data store.ZipExport }
	g.e.do(g.b, "POST", "/api/v1/documents/groups/zip?type=invoices", nil, 202, &queued)
	g.e.svc.zipFiles = 1 // the files grew past the cap since it was queued
	g.e.svc.ZipExportsTick(ctx)
	if list := g.exports(g.b); len(list) != 1 || list[0].Status != "failed" {
		t.Fatalf("exports = %+v", list)
	}
	if n := g.count(`SELECT count(*) FROM notifications WHERE user_id = $1 AND data->>'failed' = 'true'`, g.b.user); n != 1 {
		t.Fatalf("failure notifications = %d", n)
	}

	g.e.svc.zipFiles = maxZipFiles
	g.e.do(g.b, "POST", "/api/v1/documents/groups/zip?type=invoices", nil, 202, &queued)
	g.e.svc.ZipExportsTick(ctx)
	before := g.e.files.count()
	if _, err := g.e.raw.Exec(ctx, `UPDATE workspaces SET deleted_at = now() WHERE id = $1`, g.b.workspace); err != nil {
		t.Fatal(err)
	}
	g.e.svc.ZipExportsTick(ctx)
	if g.e.files.count() != before-1 || g.count(`SELECT count(*) FROM document_zip_exports WHERE workspace_id = $1`, g.b.workspace) != 0 {
		t.Fatal("a deleted workspace kept its exports")
	}
}

func TestZipExportScopes(t *testing.T) {
	for _, tc := range []struct{ method, path string }{
		{"POST", "/api/v1/documents/groups/zip"},
		{"GET", "/api/v1/documents/exports"},
		{"GET", "/api/v1/documents/exports/zip_x/download"},
	} {
		if need := permissions.Required(tc.method, tc.path); !slices.Equal(need, []string{"read:documents"}) {
			t.Errorf("%s %s needs %v", tc.method, tc.path, need)
		}
	}
}

// Group levels come in any order and every chip narrows together (AND): Client → Year → Type.
func TestGroupedViewsAnyOrderAndCombinedFilters(t *testing.T) {
	g := newGrouped(t)
	if got := counts(g.groups(g.b, "group=year,client&year=2024").Data.Groups); !maps(got, map[string]int{g.acme: 1, g.beta: 1}) {
		t.Fatalf("clients of 2024 = %v", got)
	}
	byType := g.groups(g.b, "group=client,year,type&client="+g.acme+"&year=2024")
	if byType.Data.By != "type" || !maps(counts(byType.Data.Groups), map[string]int{"quotes": 1}) {
		t.Fatalf("types of Acme 2024 = %+v", byType.Data)
	}
	var leaf page
	g.e.do(g.b, "GET", "/api/v1/documents/groups?group=client,year&client="+g.acme+"&year=2024", nil, 200, &leaf)
	if !slices.Equal(names(leaf.Data), []string{"c.pdf"}) {
		t.Fatalf("Acme 2024 = %v", names(leaf.Data))
	}
	for _, tc := range []struct {
		query string
		want  []string
	}{
		{"client=" + g.acme + "&year=2025", []string{"a.pdf"}},
		{"client=" + g.acme + "&type=invoices&year=2025", []string{"a.pdf"}},
		{"client=" + g.acme + "&type=quotes&year=2025", []string{}},
		{"type=invoices&year=2026", []string{"Rechnung-7.pdf"}},
	} {
		if got := names(g.e.list(g.b, tc.query+"&sort=name").Data); !slices.Equal(got, tc.want) {
			t.Errorf("%s = %v, want %v", tc.query, got, tc.want)
		}
	}
}
