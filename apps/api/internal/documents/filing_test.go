package documents

import (
	"context"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// recordingModel is the development model, keeping each request it was asked and counting its input countings (which
// send the content too).
type recordingModel struct {
	aimodel.Fake
	mu      sync.Mutex
	reqs    []aimodel.Request
	counted atomic.Int32
}

func (m *recordingModel) InputTokens(ctx context.Context, r aimodel.Request) (int64, error) {
	m.counted.Add(1)
	return m.Fake.InputTokens(ctx, r)
}

func (m *recordingModel) Answer(ctx context.Context, r aimodel.Request) (aimodel.Reply, error) {
	m.mu.Lock()
	m.reqs = append(m.reqs, r)
	m.mu.Unlock()
	return m.Fake.Answer(ctx, r)
}

func (m *recordingModel) asked() []aimodel.Request {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.reqs)
}

// plainText stands in for the imports' reader: text files as themselves.
func plainText(b []byte, limit int) string {
	if strings.HasPrefix(string(b), "%PDF") {
		return ""
	}
	return string(b[:min(len(b), limit)])
}

// filer turns AI filing on with the development model; allowance nil is unlimited.
func (e *env) filer(allowance aimodel.Allowance) *recordingModel {
	m := &recordingModel{}
	e.svc.SetFiler(m, aimodel.Budget{DB: e.st, Pool: aimodel.PoolAutomation, Allowance: allowance, Now: time.Now}, plainText)
	return m
}

func (e *env) approveAI(b *browser) {
	e.t.Helper()
	if err := e.st.SetAIConsent(context.Background(), b.workspace, b.user, true, time.Now()); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) fileDue() {
	e.t.Helper()
	if err := e.svc.FileDue(context.Background()); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) get(b *browser, id string) store.Document {
	e.t.Helper()
	var out one[store.Document]
	e.do(b, "GET", "/api/v1/documents/"+id, nil, 200, &out)
	return out.Data
}

func noTokens(context.Context, store.Q, string) (int64, error) { return 0, nil }

func TestAIFiling(t *testing.T) {
	for _, tc := range []struct {
		name        string
		folders     []string
		intoFolder  string // upload into this folder instead of the top level
		file, body  string
		off         bool
		noConsent   bool
		allowance   aimodel.Allowance
		wantStatus  string // "" = never queued
		wantFolder  string // folder name the file ends in, "" = top level
		wantTags    []string
		wantCreated bool
		wantCalls   int
	}{
		{name: "existing folder", folders: []string{"Contracts", "Invoices"}, file: "invoice-acme.pdf", body: pdf,
			wantStatus: "filed", wantFolder: "Invoices", wantTags: []string{"invoice", "acme"}, wantCalls: 1},
		{name: "new folder", folders: []string{"Receipts"}, file: "contract baker.txt", body: "Contract between Baker and us",
			wantStatus: "filed", wantFolder: "Contract", wantTags: []string{"contract", "baker"}, wantCreated: true, wantCalls: 1},
		{name: "into a folder only tags", folders: []string{"Misc", "Invoices"}, intoFolder: "Misc", file: "invoice-acme.pdf",
			body: pdf, wantStatus: "filed", wantFolder: "Misc", wantTags: []string{"invoice", "acme"}, wantCalls: 1},
		{name: "no consent", file: "invoice-acme.pdf", body: pdf, noConsent: true},
		{name: "filing off", file: "invoice-acme.pdf", body: pdf, off: true},
		{name: "quota used", folders: []string{"Invoices"}, file: "invoice-acme.pdf", body: pdf, allowance: noTokens,
			wantStatus: "skipped", wantTags: []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace()
			var m *recordingModel
			if !tc.off {
				m = e.filer(tc.allowance)
			}
			if !tc.noConsent {
				e.approveAI(b)
			}
			ids := map[string]string{}
			for _, name := range tc.folders {
				ids[name] = e.folder(b, name, nil).ID
			}
			var fields []string
			if tc.intoFolder != "" {
				fields = []string{"folder_id", ids[tc.intoFolder]}
			}
			up := e.uploaded(b, tc.file, tc.body, fields...)
			if tc.wantStatus == "" {
				if up.AIFiling != nil {
					t.Fatalf("queued: %+v", up.AIFiling)
				}
			} else if up.AIFiling == nil || up.AIFiling.Status != "queued" {
				t.Fatalf("upload's filing = %+v, want queued", up.AIFiling)
			}
			e.fileDue()
			d := e.get(b, up.ID)
			if m != nil && len(m.asked()) != tc.wantCalls {
				t.Fatalf("model asked %d times, want %d", len(m.asked()), tc.wantCalls)
			}
			if tc.wantStatus == "" {
				if d.AIFiling != nil || len(d.Tags) != 0 || d.FolderID != nil {
					t.Fatalf("filed without approval: %+v", d)
				}
				return
			}
			if d.AIFiling == nil || d.AIFiling.Status != tc.wantStatus {
				t.Fatalf("filing = %+v, want %s", d.AIFiling, tc.wantStatus)
			}
			folder := ""
			if d.Folder != nil {
				folder = d.Folder.Name
			}
			if folder != tc.wantFolder || !slices.Equal(d.Tags, tc.wantTags) || d.AIFiling.CreatedFolder != tc.wantCreated {
				t.Fatalf("filed into %q with %v (created %v), want %q with %v (created %v)", folder, d.Tags,
					d.AIFiling.CreatedFolder, tc.wantFolder, tc.wantTags, tc.wantCreated)
			}
			if tc.wantCalls == 0 {
				return
			}
			msg := m.asked()[0].Message
			if listed := strings.Contains(msg, "Folders:"); listed != (tc.intoFolder == "") {
				t.Fatalf("folders listed = %v for an upload into %q: %s", listed, tc.intoFolder, msg)
			}
			if strings.HasSuffix(tc.file, ".txt") && !strings.Contains(msg, tc.body) {
				t.Fatalf("the text was not sent: %s", msg)
			}
			if strings.HasSuffix(tc.file, ".pdf") && len(m.asked()[0].Files) != 1 {
				t.Fatal("the PDF was not attached")
			}
			if tc.wantCreated {
				var f one[[]store.Folder]
				e.do(b, "GET", "/api/v1/documents/folders", nil, 200, &f)
				i := slices.IndexFunc(f.Data, func(f store.Folder) bool { return f.Name == tc.wantFolder })
				if i < 0 || f.Data[i].ParentID != nil {
					t.Fatalf("new folder not at the top level: %+v", f.Data)
				}
			}
		})
	}
}

// While an import of the workspace is still reading files, filing waits: both use the automation pool, which runs
// one call at a time per workspace, and the person is watching the import. It files once the import has read them.
func TestAIFilingWaitsForAReadingImport(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	m := e.filer(nil)
	e.approveAI(b)
	ctx := context.Background()
	now := time.Now()
	if _, err := e.raw.Exec(ctx, `INSERT INTO import_batches (id, workspace_id, user_id, kind, created_at)
		VALUES ('imp_1', $1, $2, 'clients', $3)`, b.workspace, b.user, now); err != nil {
		t.Fatal(err)
	}
	if _, err := e.raw.Exec(ctx, `INSERT INTO import_files (id, batch_id, workspace_id, "position", name, size,
		content_type, status, created_at, updated_at) VALUES ('imf_1', 'imp_1', $1, 0, 'clients.csv', 10,
		'text/plain', 'extracting', $2, $2)`, b.workspace, now); err != nil {
		t.Fatal(err)
	}
	up := e.uploaded(b, "invoice-acme.pdf", pdf)

	e.fileDue()
	if d := e.get(b, up.ID); len(m.asked()) != 0 || d.AIFiling == nil || d.AIFiling.Status != "queued" {
		t.Fatalf("filed while the import was reading: %d calls, %+v", len(m.asked()), d.AIFiling)
	}

	if _, err := e.raw.Exec(ctx, `UPDATE import_files SET status = 'done' WHERE id = 'imf_1'`); err != nil {
		t.Fatal(err)
	}
	e.fileDue()
	if d := e.get(b, up.ID); len(m.asked()) != 1 || d.AIFiling == nil || d.AIFiling.Status != "filed" {
		t.Fatalf("after the import: %d calls, %+v", len(m.asked()), d.AIFiling)
	}
}

func TestAIFilingNeverSendsHRFiles(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	m := e.filer(nil)
	e.approveAI(b)
	ctx, id := context.Background(), auth.NewID("doc")
	if err := e.st.CreateDocument(ctx, b.workspace, b.user, store.Document{ID: id, Name: "payslip.pdf", Size: 3,
		ContentType: "application/pdf", ObjectKey: "hr/" + id, HRPrivate: true, CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	// queued by mistake: the job still never sends it
	if err := e.st.QueueFiling(ctx, b.workspace, id, b.user, true, time.Now()); err != nil {
		t.Fatal(err)
	}
	e.fileDue()
	if n := len(m.asked()); n != 0 {
		t.Fatalf("an HR file reached the model %d times", n)
	}
	var status string
	if err := e.raw.QueryRow(ctx, `SELECT status FROM document_filings WHERE document_id = $1`, id).Scan(&status); err != nil || status != "skipped" {
		t.Fatalf("status %q, %v", status, err)
	}
}

// A queued filing is admitted for the uploader's approval as it is when the job runs: withdrawn, or given for an
// earlier notice (a new one deployed since), it is skipped once, with nothing counted or sent and the file left where
// it is. An upload made without a current approval is never queued.
func TestAIFilingNeedsAnApprovalOfTheNoticeInForce(t *testing.T) {
	for _, c := range []struct {
		name          string
		afterApproval func(e *env, b *browser)
		beforeUpload  bool
	}{
		{"withdrawn after the upload", func(e *env, b *browser) {
			if err := e.st.SetAIConsent(context.Background(), b.workspace, b.user, false, time.Now()); err != nil {
				e.t.Fatal(err)
			}
		}, false},
		{"a new notice after the upload", func(e *env, b *browser) { storetest.OutdateAIConsent(e.t, e.raw, b.workspace, b.user) }, false},
		{"a new notice before the upload", func(e *env, b *browser) { storetest.OutdateAIConsent(e.t, e.raw, b.workspace, b.user) }, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace()
			m := e.filer(nil)
			e.approveAI(b)
			if c.beforeUpload {
				c.afterApproval(e, b)
			}
			up := e.uploaded(b, "invoice-acme.pdf", pdf)
			if !c.beforeUpload {
				c.afterApproval(e, b)
			}
			e.fileDue()
			e.fileDue() // a refused job is not retried
			d := e.get(b, up.ID)
			if len(m.asked()) != 0 || m.counted.Load() != 0 || d.FolderID != nil {
				t.Fatalf("reached the model: %d calls, %d countings, %+v", len(m.asked()), m.counted.Load(), d)
			}
			if want := map[bool]string{false: "skipped", true: ""}[c.beforeUpload]; d.AIFiling == nil && want != "" || d.AIFiling != nil && d.AIFiling.Status != want {
				t.Fatalf("filing %+v, want %q", d.AIFiling, want)
			}
		})
	}
}

func TestUndoAIFiling(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.filer(nil)
	e.approveAI(b)
	first := e.uploaded(b, "contract-baker.txt", "Contract with Baker")
	second := e.uploaded(b, "contract-acme.txt", "Contract with Acme")
	e.fileDue()
	for _, id := range []string{first.ID, second.ID} {
		if d := e.get(b, id); d.Folder == nil || d.Folder.Name != "Contract" {
			t.Fatalf("not filed: %+v", d)
		}
	}
	// a tag the person adds stays after undo
	e.do(b, "PATCH", "/api/v1/documents/"+first.ID, map[string]any{"tags": []string{"contract", "baker", "Signed"}}, 200, nil)
	var out one[store.Document]
	e.do(b, "DELETE", "/api/v1/documents/"+first.ID+"/filing", nil, 200, &out)
	if d := out.Data; d.FolderID != nil || !slices.Equal(d.Tags, []string{"signed"}) || d.AIFiling.Status != "undone" {
		t.Fatalf("after undo: folder %v tags %v filing %+v", d.FolderID, d.Tags, d.AIFiling)
	}
	e.do(b, "DELETE", "/api/v1/documents/"+first.ID+"/filing", nil, 200, nil) // twice is fine
	// the folder filing made stays while a file is in it, and goes with the last one
	var folders one[[]store.Folder]
	e.do(b, "GET", "/api/v1/documents/folders", nil, 200, &folders)
	if len(folders.Data) != 1 {
		t.Fatalf("folders after first undo: %+v", folders.Data)
	}
	e.do(b, "DELETE", "/api/v1/documents/"+second.ID+"/filing", nil, 200, nil)
	e.do(b, "GET", "/api/v1/documents/folders", nil, 200, &folders)
	if len(folders.Data) != 0 {
		t.Fatalf("folder filing made was kept: %+v", folders.Data)
	}
	// a file filing didn't touch can't be undone
	plain := e.uploaded(b, "notes.txt", "x")
	e.fails(b, "DELETE", "/api/v1/documents/"+plain.ID+"/filing", nil, 409, "not_filed")
}

func TestDocumentTags(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	a := e.uploaded(b, "a.pdf", pdf)
	e.uploaded(b, "b.pdf", pdf+"b")
	var out one[store.Document]
	e.do(b, "PATCH", "/api/v1/documents/"+a.ID, map[string]any{"tags": []string{" Tax  2026 ", "tax 2026", "bank"}}, 200, &out)
	if !slices.Equal(out.Data.Tags, []string{"tax 2026", "bank"}) {
		t.Fatalf("tags %v", out.Data.Tags)
	}
	if got := names(e.list(b, "tag=bank").Data); !slices.Equal(got, []string{"a.pdf"}) {
		t.Fatalf("tag filter: %v", got)
	}
	e.fails(b, "PATCH", "/api/v1/documents/"+a.ID, map[string]any{"tags": []string{strings.Repeat("x", 33)}}, 422, "validation_failed")
	e.fails(b, "PATCH", "/api/v1/documents/"+a.ID, map[string]any{"tags": "bank"}, 422, "validation_failed")
}

func TestAIFilingSpendsTheAutomationPool(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.filer(nil)
	e.approveAI(b)
	e.uploaded(b, "invoice-acme.pdf", pdf)
	e.fileDue()
	ctx, period := context.Background(), store.UsagePeriod(time.Now())
	automation, err := e.st.HeidiUsage(ctx, b.workspace, aimodel.PoolAutomation, period)
	if err != nil {
		t.Fatal(err)
	}
	heidi, err := e.st.HeidiUsage(ctx, b.workspace, aimodel.PoolHeidi, period)
	if err != nil {
		t.Fatal(err)
	}
	if automation.TokensUsed == 0 || heidi.TokensUsed != 0 || heidi.TokensReserved != 0 {
		t.Fatalf("automation used %d, Heidi used %d reserved %d", automation.TokensUsed, heidi.TokensUsed, heidi.TokensReserved)
	}
}
