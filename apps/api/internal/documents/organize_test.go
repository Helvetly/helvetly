package documents

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

func TestReadOrganize(t *testing.T) {
	inv, deep := "fld_inv", "fld_deep"
	folders := []store.Folder{{ID: inv, Name: "Invoices"}, {ID: "fld_a", Name: "A"}, {ID: "fld_b", Name: "B", ParentID: ptr("fld_a")},
		{ID: "fld_c", Name: "C", ParentID: ptr("fld_b")}, {ID: deep, Name: "D", ParentID: ptr("fld_c")}}
	docs := []store.Document{{ID: "doc_top", Name: "top.pdf", Tags: []string{}},
		{ID: "doc_inv", Name: "inv.pdf", FolderID: &inv, Tags: []string{"invoice"}}}
	row := func(id, folder string, change bool, tags ...string) string {
		b, _ := json.Marshal(map[string]any{"document_id": id, "folder": folder, "tags": tags, "reason": " Looks  like it. ", "change": change})
		return string(b)
	}
	answer := func(rows ...string) string { return `{"proposals":[` + strings.Join(rows, ",") + `]}` }
	for _, tc := range []struct {
		name      string
		text      string
		want      []proposal // Name and Reason not compared
		unreadble bool
	}{
		{name: "unknown id dropped", text: answer(row("doc_other", "X", true), row("doc_top", "Invoices/2025", true, "invoice")),
			want: []proposal{{DocumentID: "doc_top", Folder: "Invoices/2025", Tags: []string{"invoice"}, Change: true}}},
		{name: "bad segment keeps the folder", text: answer(row("doc_top", "Invoices/a\x01b", true, "invoice")),
			want: []proposal{{DocumentID: "doc_top", Folder: "", Tags: []string{"invoice"}, Change: true}}},
		{name: "segment too long keeps the folder", text: answer(row("doc_inv", strings.Repeat("x", 61), true)),
			want: []proposal{{DocumentID: "doc_inv", FromFolder: ptr("Invoices"), Folder: "Invoices", Tags: []string{}, Change: false}}},
		{name: "new path deeper than 3 refused", text: answer(row("doc_top", "W/X/Y/Z", true, "x")),
			want: []proposal{{DocumentID: "doc_top", Folder: "", Tags: []string{"x"}, Change: true}}},
		{name: "existing deep path allowed", text: answer(row("doc_top", "A/B/C/D", true)),
			want: []proposal{{DocumentID: "doc_top", Folder: "A/B/C/D", Tags: []string{}, Change: true}}},
		{name: "slashes and spaces tidied", text: answer(row("doc_top", "/ Receipts //2024/", true)),
			want: []proposal{{DocumentID: "doc_top", Folder: "Receipts/2024", Tags: []string{}, Change: true}}},
		{name: "tags cleaned and capped", text: answer(row("doc_top", "", true, " Invoice ", "invoice", "Q1 / 2026", "ACME", "extra")),
			want: []proposal{{DocumentID: "doc_top", Folder: "", Tags: []string{"invoice", "q1-2026", "acme"}, Change: true}}},
		{name: "model says it sits well", text: answer(row("doc_inv", "Contracts", false, "contract")),
			want: []proposal{{DocumentID: "doc_inv", FromFolder: ptr("Invoices"), Folder: "Invoices", Tags: []string{"contract"}, Change: false}}},
		{name: "nothing new is no change", text: answer(row("doc_inv", "Invoices", true, "invoice")),
			want: []proposal{{DocumentID: "doc_inv", FromFolder: ptr("Invoices"), Folder: "Invoices", Tags: []string{"invoice"}, Change: false}}},
		{name: "first answer per document", text: answer(row("doc_top", "Invoices", true), row("doc_top", "Contracts", true)),
			want: []proposal{{DocumentID: "doc_top", Folder: "Invoices", Tags: []string{}, Change: true}}},
		{name: "not JSON", text: "sorry", unreadble: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := readOrganize(tc.text, docs, folders, nil)
			if tc.unreadble {
				if _, code, _, _ := auth.Describe(err); code != "ai_unreadable" {
					t.Fatalf("err = %v, want ai_unreadable", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			for i := range got {
				if got[i].Reason != "Looks like it." {
					t.Fatalf("reason = %q", got[i].Reason)
				}
				got[i].Name, got[i].Reason = "", ""
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %+v\nwant %+v", got, tc.want)
			}
		})
	}
}

func ptr(s string) *string { return &s }

type organizeAnswer struct {
	Data struct {
		Proposals  []proposal `json:"proposals"`
		Considered int        `json:"considered"`
	}
}

func TestOrganizeProposes(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	m := e.filer(nil)
	e.approveAI(b)
	invoices := e.folder(b, "Invoices", nil)
	inv := e.uploaded(b, "invoice-acme.txt", "Invoice 42 from Acme")
	contract := e.uploaded(b, "contract baker.txt", "Contract between Baker and us", "folder_id", invoices.ID)
	trashed := e.uploaded(b, "receipt old.txt", "old")
	e.do(b, "POST", "/api/v1/documents/bulk", map[string]any{"action": "trash", "document_ids": []string{trashed.ID}}, 200, nil)
	ctx, hr := context.Background(), auth.NewID("doc")
	if err := e.st.CreateDocument(ctx, b.workspace, b.user, store.Document{ID: hr, Name: "payslip anna.pdf", Size: 3,
		ContentType: "application/pdf", ObjectKey: "hr/" + hr, HRPrivate: true, CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}

	var out organizeAnswer
	e.do(b, "POST", "/api/v1/documents/organize", map[string]any{}, 200, &out)
	if out.Data.Considered != 2 || len(out.Data.Proposals) != 2 {
		t.Fatalf("got %+v", out.Data)
	}
	asked := m.asked()
	if len(asked) != 1 {
		t.Fatalf("model asked %d times", len(asked))
	}
	msg := asked[0].Message
	for _, gone := range []string{"payslip", "receipt old", hr, trashed.ID} {
		if strings.Contains(msg, gone) {
			t.Fatalf("request names %q:\n%s", gone, msg)
		}
	}
	if !strings.Contains(msg, "Invoice 42 from Acme") || !strings.Contains(msg, "Invoices\n") {
		t.Fatalf("request lacks the text or the folders:\n%s", msg)
	}
	// unfiled first: the top-level invoice, then the contract
	p0, p1 := out.Data.Proposals[0], out.Data.Proposals[1]
	if p0.DocumentID != inv.ID || p0.FromFolder != nil || p0.Folder != "Invoices" || !p0.Change || !slices.Equal(p0.Tags, []string{"invoice"}) {
		t.Fatalf("invoice proposal = %+v", p0)
	}
	if p1.DocumentID != contract.ID || p1.FromFolder == nil || *p1.FromFolder != "Invoices" || p1.Folder != "Contracts" || !p1.Change {
		t.Fatalf("contract proposal = %+v", p1)
	}
	// nothing was written
	if d := e.get(b, inv.ID); d.FolderID != nil || len(d.Tags) != 0 {
		t.Fatalf("proposing changed the file: %+v", d)
	}

	// limited to a folder's subtree
	out = organizeAnswer{}
	e.do(b, "POST", "/api/v1/documents/organize", map[string]any{"folder_id": invoices.ID}, 200, &out)
	if out.Data.Considered != 1 || out.Data.Proposals[0].DocumentID != contract.ID {
		t.Fatalf("subtree got %+v", out.Data)
	}
	e.do(b, "POST", "/api/v1/documents/organize", map[string]any{"folder_id": "fld_nope"}, 422, nil)
}

func TestOrganizeGate(t *testing.T) {
	for _, tc := range []struct {
		name      string
		off       bool
		noConsent bool
		noFeature bool
		status    int
		code      string
	}{
		{name: "no consent", noConsent: true, status: 403, code: "ai_consent_required"},
		{name: "not in plan", noFeature: true, status: 403, code: "feature_not_in_plan"},
		{name: "AI off", off: true, status: 503, code: "ai_unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace()
			var m *recordingModel
			if !tc.off {
				m = e.filer(nil)
			}
			if !tc.noConsent {
				e.approveAI(b)
			}
			if tc.noFeature {
				e.st.SetFeatureGate(func(_ context.Context, _ store.Q, _, feature string) error {
					if feature == store.FeatureAIImport {
						return fmt.Errorf("%w: %w", store.ErrFeatureDenied,
							auth.Error(http.StatusForbidden, "feature_not_in_plan", "Not in your plan.", nil))
					}
					return nil
				})
			}
			e.uploaded(b, "invoice.txt", "Invoice")
			var out struct{ Error struct{ Code string } }
			e.do(b, "POST", "/api/v1/documents/organize", map[string]any{}, tc.status, &out)
			if out.Error.Code != tc.code {
				t.Fatalf("code = %q, want %q", out.Error.Code, tc.code)
			}
			if m != nil && len(m.asked()) != 0 {
				t.Fatal("the model was asked")
			}
		})
	}
}

type applyAnswer struct {
	Data struct {
		Moved, Tagged int
		Undo          organizeUndo
	}
}

func TestOrganizeApplyAndUndo(t *testing.T) {
	e := newEnv(t)
	b := e.workspace() // no AI approval: applying asks no model
	other := e.workspace()
	foreign := e.uploaded(other, "theirs.txt", "x")
	invoices := e.folder(b, "Invoices", nil)
	misc := e.folder(b, "Misc", nil)
	a := e.uploaded(b, "same.txt", "a")
	e.do(b, "PATCH", "/api/v1/documents/"+a.ID, map[string]any{"tags": []string{"old"}}, 200, nil)
	c := e.uploaded(b, "same.txt", "c", "folder_id", misc.ID)
	kept := e.uploaded(b, "kept.txt", "k", "folder_id", invoices.ID)

	items := []map[string]any{
		{"document_id": a.ID, "folder": "invoices/2025", "tags": []string{"Invoice", "old"}}, // Invoices reused
		{"document_id": c.ID, "folder": "Invoices/2025", "tags": []string{}},                 // same name: kept both
		{"document_id": kept.ID, "folder": "Invoices", "tags": []string{}},                   // already there
		{"document_id": foreign.ID, "folder": "Stolen", "tags": []string{"x"}},
		{"document_id": "doc_missing", "folder": "Gone", "tags": []string{}},
	}
	var out applyAnswer
	e.do(b, "POST", "/api/v1/documents/organize/apply", map[string]any{"items": items}, 200, &out)
	if out.Data.Moved != 2 || out.Data.Tagged != 1 || len(out.Data.Undo.Previous) != 2 || len(out.Data.Undo.CreatedFolders) != 1 {
		t.Fatalf("apply = %+v", out.Data)
	}
	var folders one[[]store.Folder]
	folders.Data = e.userFolders(b)
	if len(folders.Data) != 3 { // Invoices, Misc, 2025 (no Stolen, no Gone)
		t.Fatalf("folders = %+v", folders.Data)
	}
	year := out.Data.Undo.CreatedFolders[0]
	da, dc := e.get(b, a.ID), e.get(b, c.ID)
	if da.FolderID == nil || *da.FolderID != year || !slices.Equal(da.Tags, []string{"old", "invoice"}) {
		t.Fatalf("a = %+v", da)
	}
	if dc.FolderID == nil || *dc.FolderID != year || dc.Name == "same.txt" {
		t.Fatalf("c = %+v (want kept both under a free name)", dc)
	}
	if f := folderByID(folders.Data, year); f.Name != "2025" || f.ParentID == nil || *f.ParentID != invoices.ID {
		t.Fatalf("2025 = %+v", f)
	}
	if d := e.get(other, foreign.ID); d.FolderID != nil || len(d.Tags) != 0 {
		t.Fatalf("another workspace's file changed: %+v", d)
	}

	for range 2 { // twice is fine
		e.do(b, "POST", "/api/v1/documents/organize/undo", out.Data.Undo, 200, nil)
		da, dc = e.get(b, a.ID), e.get(b, c.ID)
		if da.FolderID != nil || !slices.Equal(da.Tags, []string{"old"}) {
			t.Fatalf("a after undo = %+v", da)
		}
		if dc.FolderID == nil || *dc.FolderID != misc.ID {
			t.Fatalf("c after undo = %+v", dc)
		}
		folders.Data = e.userFolders(b)
		if len(folders.Data) != 2 {
			t.Fatalf("folders after undo = %+v", folders.Data)
		}
	}
}

// A folder the run made stays when something was put in it since, and a previous folder that is gone means the top level.
func TestOrganizeUndoKeepsUsedFolders(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	gone := e.folder(b, "Old", nil)
	d := e.uploaded(b, "a.txt", "a", "folder_id", gone.ID)
	var out applyAnswer
	e.do(b, "POST", "/api/v1/documents/organize/apply", map[string]any{"items": []map[string]any{
		{"document_id": d.ID, "folder": "Contracts", "tags": []string{"contract"}}}}, 200, &out)
	e.uploaded(b, "later.txt", "l", "folder_id", out.Data.Undo.CreatedFolders[0])
	e.do(b, "POST", "/api/v1/documents/bulk", map[string]any{"action": "trash", "folder_ids": []string{gone.ID}}, 200, nil)

	e.do(b, "POST", "/api/v1/documents/organize/undo", out.Data.Undo, 200, nil)
	if got := e.get(b, d.ID); got.FolderID != nil || len(got.Tags) != 0 {
		t.Fatalf("after undo = %+v", got)
	}
	var folders one[[]store.Folder]
	folders.Data = e.userFolders(b)
	if len(folders.Data) != 1 || folders.Data[0].Name != "Contracts" {
		t.Fatalf("folders = %+v", folders.Data)
	}
}

func TestOrganizeApplyRefuses(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	d := e.uploaded(b, "a.txt", "a")
	for _, items := range [][]map[string]any{
		{},
		{{"document_id": d.ID, "folder": "a\x01b", "tags": []string{}}},
		{{"document_id": d.ID, "folder": "", "tags": []string{strings.Repeat("t", 33)}}},
	} {
		e.do(b, "POST", "/api/v1/documents/organize/apply", map[string]any{"items": items}, 422, nil)
	}
	if got := e.get(b, d.ID); got.FolderID != nil || len(got.Tags) != 0 {
		t.Fatalf("refused apply changed the file: %+v", got)
	}
}

func folderByID(folders []store.Folder, id string) store.Folder {
	i := slices.IndexFunc(folders, func(f store.Folder) bool { return f.ID == id })
	if i < 0 {
		return store.Folder{}
	}
	return folders[i]
}
