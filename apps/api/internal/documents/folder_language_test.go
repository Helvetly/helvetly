package documents

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/store"
)

func TestFolderNames(t *testing.T) {
	for _, tc := range []struct{ name, lang, want string }{
		{"Verträge", "en", "Contracts"},
		{"unternehmensdokumente", "en", "Company Documents"},
		{"Contracts", "de", "Verträge"},
		{"Company Documents", "fr", "Documents d'entreprise"},
		{"Insurance", "it", "Assicurazioni"},
		{"Kontoauszüge", "en", "Bank Statements"},
		{"Projekt Alpha", "en", "Projekt Alpha"}, // not a common kind: as the model named it
	} {
		if got := localName(tc.name, tc.lang); got != tc.want {
			t.Errorf("localName(%q, %s) = %q, want %q", tc.name, tc.lang, got, tc.want)
		}
	}
	for _, tc := range []struct {
		name     string
		siblings []string
		want     string
	}{
		{"Contracts", []string{"Receipts", "Verträge"}, "Verträge"},
		{"contracts", []string{"Verträge", "Contracts"}, "Contracts"}, // the exact name wins
		{"Company Documents", []string{"Firmendokumente"}, "Firmendokumente"},
		{"Insurance", []string{"Verträge"}, ""},
		{"Projekt Alpha", []string{"projekt alpha"}, "projekt alpha"},
	} {
		if got := sameFolder(tc.name, tc.siblings); got != tc.want {
			t.Errorf("sameFolder(%q, %v) = %q, want %q", tc.name, tc.siblings, got, tc.want)
		}
	}
	if !isContract([]string{"Verträge"}, nil) || !isContract(nil, []string{"vertrag"}) || isContract([]string{"Mietverträge"}, []string{"lease"}) {
		t.Error("isContract")
	}
}

func TestRequestLanguage(t *testing.T) {
	for _, tc := range []struct{ query, header, want string }{
		{"", "", ""},
		{"", "de-CH,de;q=0.9,en;q=0.8", "de"},
		{"fr", "de-CH", "fr"},
		{"", "es-ES,it;q=0.5", "it"},
		{"xx", "pl", ""},
	} {
		r := httptest.NewRequest("GET", "/api/v1/documents?lang="+tc.query, nil)
		r.Header.Set("Accept-Language", tc.header)
		if got := requestLanguage(r); got != tc.want {
			t.Errorf("requestLanguage(%q, %q) = %q, want %q", tc.query, tc.header, got, tc.want)
		}
	}
}

// Organize proposes existing folders of the same kind in any language, and names new ones in the asker's language.
func TestReadOrganizeFolderLanguage(t *testing.T) {
	folders := []store.Folder{{ID: "fld_v", Name: "Verträge"}, {ID: "fld_v25", Name: "2025", ParentID: ptr("fld_v")}}
	docs := []store.Document{{ID: "doc_1", Name: "a.pdf", Tags: []string{}}, {ID: "doc_2", Name: "b.pdf", Tags: []string{}},
		{ID: "doc_3", Name: "c.pdf", Tags: []string{}}}
	b, _ := json.Marshal(map[string]any{"proposals": []any{
		map[string]any{"document_id": "doc_1", "folder": "Contracts/2025", "tags": []string{"contract"}, "reason": "", "change": true},
		map[string]any{"document_id": "doc_2", "folder": "Unternehmensdokumente", "tags": []string{"register"}, "reason": "", "change": true},
		map[string]any{"document_id": "doc_3", "folder": "Verträge/Versicherungen", "tags": []string{"policy"}, "reason": "", "change": true},
	}})
	got, err := readOrganize(string(b), docs, folders, recordNames{}, nil, "en")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Verträge/2025", "Company Documents", "Verträge/Insurance"}
	for i, p := range got {
		if p.Folder != want[i] {
			t.Errorf("%s = %q, want %q", p.DocumentID, p.Folder, want[i])
		}
	}
}

// answeringModel is the development model with a fixed filing answer.
type answeringModel struct {
	recordingModel
	answer map[string]any
}

func (m *answeringModel) Answer(ctx context.Context, r aimodel.Request) (aimodel.Reply, error) {
	reply, err := m.recordingModel.Answer(ctx, r)
	raw, _ := json.Marshal(m.answer)
	reply.Text = string(raw)
	return reply, err
}

// uploadIn uploads a text file as someone whose interface is in lang ("" sends no language).
func (e *env) uploadIn(b *browser, lang, name, content string) store.Document {
	e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	w, _ := mw.CreateFormFile("file", name)
	_, _ = w.Write([]byte(content))
	_ = mw.Close()
	var header []string
	if lang != "" {
		header = []string{"Accept-Language", lang + ";q=0.9"}
	}
	resp, raw := e.send(b, "POST", "/api/v1/documents", &buf, mw.FormDataContentType(), header...)
	var out one[store.Document]
	if resp.StatusCode != 201 || json.Unmarshal(raw, &out) != nil {
		e.t.Fatalf("upload %s: %d %s", name, resp.StatusCode, raw)
	}
	return out.Data
}

func TestAIFilingFolderLanguage(t *testing.T) {
	german := "Handelsregisterauszug der Muster Holding AG, Sitz Zürich"
	for _, tc := range []struct {
		name        string
		lang        string // the uploader's interface
		settings    string // the workspace's document language, "" for no saved settings
		folders     []string
		client      string
		file, text  string
		answer      map[string]any
		wantAsked   string // the folder language the model was told
		wantFolder  string
		wantCreated bool
		wantSystem  string // the system kind of the folder it ends in
	}{
		{name: "english user, german document", lang: "en", settings: "de", file: "auszug.txt", text: german,
			answer:    map[string]any{"tags": []string{"handelsregister"}, "new_folder": "Unternehmensdokumente"},
			wantAsked: "English", wantFolder: "Company Documents", wantCreated: true},
		{name: "existing german folder of the same kind", lang: "en", folders: []string{"Receipts", "Verträge"},
			file: "nda.txt", text: "Geheimhaltungsvereinbarung", answer: map[string]any{"tags": []string{"nda"}, "new_folder": "Contracts"},
			wantAsked: "English", wantFolder: "Verträge"},
		{name: "contract of a known client", lang: "en", folders: []string{"Verträge"}, client: "Acme AG", file: "vertrag.txt",
			text: "Dienstleistungsvertrag zwischen Acme AG und uns, unterzeichnet am 1. März 2026",
			answer: map[string]any{"tags": []string{"vertrag"}, "new_folder": "Verträge", "is_completed_contract": true,
				"contract_reason": "Signed and complete."},
			wantAsked: "English", wantFolder: store.ContractsFolderName, wantSystem: "contracts"},
		{name: "background filing falls back to the workspace's language", settings: "fr", file: "auszug.txt", text: german,
			answer:    map[string]any{"tags": []string{"registre"}, "new_folder": "Contracts"},
			wantAsked: "French", wantFolder: "Contrats", wantCreated: true},
		{name: "no language anywhere: English", file: "auszug.txt", text: german,
			answer:    map[string]any{"tags": []string{"registre"}, "new_folder": "Verträge"},
			wantAsked: "English", wantFolder: "Contracts", wantCreated: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace()
			m := &answeringModel{answer: map[string]any{"folder_id": nil, "is_completed_contract": false, "contract_reason": ""}}
			for k, v := range tc.answer {
				m.answer[k] = v
			}
			e.svc.SetFiler(m, aimodel.Budget{DB: e.st, Pool: aimodel.PoolAutomation, Now: time.Now}, plainText)
			e.approveAI(b)
			if tc.settings != "" {
				if err := e.st.PutInvoiceSettings(context.Background(), b.workspace, map[string]any{"language": tc.settings}, time.Now()); err != nil {
					t.Fatal(err)
				}
			}
			for _, name := range tc.folders {
				e.folder(b, name, nil)
			}
			if tc.client != "" {
				e.client(b, tc.client)
			}
			up := e.uploadIn(b, tc.lang, tc.file, tc.text)
			e.fileDue()
			asked := m.asked()
			if len(asked) != 1 || !strings.Contains(asked[0].Message, "Name every new folder in "+tc.wantAsked+",") {
				t.Fatalf("asked %d times, want the folder language %s: %v", len(asked), tc.wantAsked, asked)
			}
			d := e.get(b, up.ID)
			if d.Folder == nil || d.Folder.Name != tc.wantFolder || d.AIFiling == nil || d.AIFiling.CreatedFolder != tc.wantCreated {
				t.Fatalf("filed into %+v (filing %+v), want %q created %v", d.Folder, d.AIFiling, tc.wantFolder, tc.wantCreated)
			}
			folders := e.allFolders(b)
			f := folderByID(folders, *d.FolderID)
			if kind := deref(f.SystemKind); kind != tc.wantSystem || tc.wantSystem == "" && f.ParentID != nil {
				t.Fatalf("filed into %+v, want system kind %q", f, tc.wantSystem)
			}
			plain := slices.DeleteFunc(slices.Clone(folders), func(f store.Folder) bool { return f.SystemKind != nil || f.ParentID != nil })
			if want := len(tc.folders) + map[bool]int{true: 1}[tc.wantCreated]; len(plain) != want {
				t.Fatalf("%d top-level plain folders, want %d: %+v", len(plain), want, plain)
			}
		})
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
