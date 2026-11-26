package documents

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"slices"
	"strconv"
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
			got, err := readOrganize(tc.text, docs, folders, recordNames{}, nil, "en")
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
				if !strings.HasPrefix(got[i].Reason, "Looks like it.") {
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

func TestReadOrganizeTaggedContract(t *testing.T) {
	const year = "Clients/Acme AG/Documents/2026"
	const contracts = year + "/Contracts"
	names := recordNames{clients: []store.ClientName{{ID: "cli_acme", Name: "Acme AG"}}}
	folders := []store.Folder{
		{ID: "root", Name: "Clients"}, {ID: "client", Name: "Acme AG", ParentID: ptr("root")},
		{ID: "documents", Name: "Documents", ParentID: ptr("client")},
		{ID: "year", Name: "2026", ParentID: ptr("documents")},
		{ID: "contracts", Name: "Contracts", ParentID: ptr("year")},
	}
	for _, tc := range []struct {
		name, filename, fromID, suggested, want string
		tags                                    []string
		modelChange, wantChange                 bool
	}{
		{"already in the year", "2026-C-001.pdf", "year", year, contracts, []string{"year-2026", "contract"}, false, true},
		{"already in Contracts", "2026-C-001.pdf", "contracts", year, contracts, []string{"contract"}, true, false},
		{"year found by model", "2026-C-001.pdf", "", year, contracts, []string{"contract"}, true, true},
		{"explicit draft", "draft-contract.pdf", "year", year, year, []string{"contract"}, false, false},
		{"tag only suggested by model", "agreement.pdf", "year", year, year, nil, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			doc := store.Document{ID: "doc", Name: tc.filename, Tags: tc.tags}
			if tc.fromID != "" {
				doc.FolderID = &tc.fromID
			}
			reply := fmt.Sprintf(`{"proposals":[{"document_id":"doc","folder":%q,"tags":["contract"],"reason":"Could not confirm it was signed.","change":%t}]}`, tc.suggested, tc.modelChange)
			got, err := readOrganize(reply, []store.Document{doc}, folders, names, nil, "en")
			if err != nil || len(got) != 1 || got[0].Folder != tc.want || got[0].Change != tc.wantChange {
				t.Fatalf("got %+v, %v; want folder %q, change %v", got, err, tc.want, tc.wantChange)
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

// invoice inserts an open invoice of the client (kind, number, issue year); imported from the source document when
// source is set.
func (e *env) invoice(b *browser, client, kind, number string, year int, source string) {
	e.t.Helper()
	origin := "helvetly"
	if source != "" {
		origin = "imported"
	}
	if _, err := e.raw.Exec(context.Background(), `INSERT INTO invoices (id, workspace_id, kind, status, origin, number, client_id,
			issue_date, due_date, currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total,
			total, rounding_amount, vat_breakdown, source_document_id, created_at, updated_at)
		VALUES ($1, $2, $3, 'open', $4, $5, $6, make_date($7, 1, 15), make_date($7, 2, 15), 'CHF', 'de', 'none', 0, 0, 0, 0,
			0, 0, 0, '[]', nullif($8, ''), now(), now())`, auth.NewID("inv"), b.workspace, kind, origin, number, client, year, source); err != nil {
		e.t.Fatal(err)
	}
}

// The screenshot's case: files named by invoice numbers go to their clients' folders without asking the model, also
// from a plain Invoices folder; an ambiguous number and a file without client go to the model, whose plain Invoices
// path stays only when no client can be found.
func TestOrganizeClientRecords(t *testing.T) {
	e := newEnv(t)
	b, other := e.workspace(), e.workspace()
	m := e.filer(nil)
	e.approveAI(b)
	acme, baker := e.client(b, "Acme AG"), e.client(b, "Baker GmbH")
	plain := e.folder(b, "Invoices", nil)
	year := e.folder(b, "2026", &plain.ID)
	d5 := e.uploaded(b, "2026-IN-005.pdf", pdf)
	d6 := e.uploaded(b, "2026-IN-006.pdf", pdf+"6")
	e.invoice(b, acme, "invoice", "2026/IN/005", 2026, "")
	e.invoice(b, acme, "invoice", "2026/IN/006", 2026, d6.ID) // imported as issued elsewhere, from this file
	e.invoice(b, baker, "credit_note", "2026/IN/011", 2026, "")
	e.invoice(b, acme, "invoice", "2026/IN/007", 2026, "")
	e.invoice(b, baker, "credit_note", "2026/IN/007", 2026, "")
	e.invoice(other, e.client(other, "Zeta AG"), "invoice", "2026/IN/012", 2026, "") // another workspace's
	d11 := e.uploaded(b, "2026_IN_011.pdf", pdf+"11", "folder_id", year.ID)
	twice := e.uploaded(b, "2026-IN-007.pdf", pdf+"7")
	theirs := e.uploaded(b, "2026-IN-012.pdf", pdf+"12")
	named := e.uploaded(b, "invoice-march.txt", "Invoice to Baker GmbH for March")
	nobody := e.uploaded(b, "invoice-misc.txt", "Invoice for something")

	var out organizeAnswer
	e.do(b, "POST", "/api/v1/documents/organize", map[string]any{}, 200, &out)
	if out.Data.Considered != 6 || len(out.Data.Proposals) != 4 { // the fake model skips names without a word
		t.Fatalf("got %+v", out.Data)
	}
	got := map[string]proposal{}
	for _, p := range out.Data.Proposals {
		got[p.DocumentID] = p
	}
	for _, w := range []struct {
		doc            store.Document
		folder, reason string
		tag            string
	}{
		{d5, "Clients/Acme AG/Invoices/2026", "Matches invoice 2026/IN/005 for Acme AG.", "invoice"},
		{d11, "Clients/Baker GmbH/Invoices/2026", "Matches credit note 2026/IN/011 for Baker GmbH.", "credit-note"},
		{named, "Clients/Baker GmbH/Invoices/" + strconv.Itoa(time.Now().Year()), "An invoice for Baker GmbH, so it goes in the client's folder.", "invoice"},
		{nobody, "Invoices", "No known client could be found in it", "invoice"},
	} {
		p := got[w.doc.ID]
		if p.Folder != w.folder || !p.Change || !strings.Contains(p.Reason, w.reason) || !slices.Contains(p.Tags, w.tag) {
			t.Errorf("%s = %+v, want %q (%q)", w.doc.Name, p, w.folder, w.reason)
		}
	}
	if p := got[d11.ID]; p.FromFolder == nil || *p.FromFolder != "Invoices/2026" {
		t.Errorf("credit note from = %v", p.FromFolder)
	}
	if _, ok := got[d6.ID]; ok {
		t.Fatal("organizer proposed moving a locked original")
	}
	for _, d := range []store.Document{twice, theirs} { // the model's (fake) Clients-less guess, no client known
		if p := got[d.ID]; strings.HasPrefix(p.Folder, "Clients/") {
			t.Errorf("%s guessed a client: %+v", d.Name, p)
		}
	}
	asked := m.asked()
	if len(asked) != 1 {
		t.Fatalf("model asked %d times", len(asked))
	}
	for _, d := range []store.Document{d5, d6, d11} { // decided without the model
		if strings.Contains(asked[0].Message, d.ID) {
			t.Errorf("the model was asked about %s", d.Name)
		}
	}
	for _, d := range []store.Document{twice, theirs, named, nobody} {
		if !strings.Contains(asked[0].Message, d.ID) {
			t.Errorf("the model was not asked about %s", d.Name)
		}
	}

	// applying a matched proposal files it in the client's system folder
	p := got[d5.ID]
	e.do(b, "POST", "/api/v1/documents/organize/apply", map[string]any{"items": []map[string]any{
		{"document_id": d5.ID, "folder": p.Folder, "tags": p.Tags}}}, 200, nil)
	inv := folderByKind(t, e.allFolders(b), "invoices", "")
	if moved := e.get(b, d5.ID); moved.FolderID == nil || folderByID(e.allFolders(b), *moved.FolderID).ParentID == nil ||
		*folderByID(e.allFolders(b), *moved.FolderID).ParentID != inv.ID {
		t.Fatalf("applied = %+v", moved)
	}
}
