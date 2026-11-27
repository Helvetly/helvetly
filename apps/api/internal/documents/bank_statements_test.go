package documents

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// clientStatements makes Clients/<client>/Documents/<year>/Bank Statements through the store, as filing does.
func (e *env) clientStatements(b *browser, client string, year int) string {
	e.t.Helper()
	var id string
	err := e.st.Tx(context.Background(), func(q store.Q) error {
		var err error
		id, err = q.ClientBankStatementsFolder(context.Background(), b.workspace, client, year, b.user, time.Now())
		return err
	})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

// clientYear makes Clients/<client>/Documents/<year> through the store.
func (e *env) clientYear(b *browser, client string, year int) string {
	e.t.Helper()
	var id string
	err := e.st.Tx(context.Background(), func(q store.Q) error {
		var err error
		id, err = q.ClientRecordFolder(context.Background(), b.workspace, client, "documents", year, b.user, time.Now())
		return err
	})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

// filedPath: the folder path a document sits in, "" for the top level.
func (e *env) filedPath(b *browser, id string) string {
	e.t.Helper()
	d := e.get(b, id)
	if d.FolderID == nil {
		return ""
	}
	folders := e.allFolders(b)
	i := slices.IndexFunc(folders, func(f store.Folder) bool { return f.ID == *d.FolderID })
	return folderPath(folders, folders[i])
}

func (e *env) linkClient(b *browser, docID, client string) {
	e.t.Helper()
	e.do(b, "POST", "/api/v1/documents/"+docID+"/links", map[string]any{"type": "client", "id": client}, 201, nil)
}

func TestClientBankStatementsFolder(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	acme := e.client(b, "Acme AG")
	id := e.clientStatements(b, acme, 2024)
	if again := e.clientStatements(b, acme, 2024); again != id {
		t.Fatalf("a second Bank Statements: %s, %s", again, id)
	}
	folders := e.allFolders(b)
	if got := folderPath(folders, folderByKind(t, folders, "client_bank_statements", "")); got != "Clients/Acme AG/Documents/2024/Bank Statements" {
		t.Fatalf("path = %q", got)
	}
	// like the other system folders: never renamed, moved or trashed
	mine := e.folder(b, "Mine", nil)
	e.fails(b, "PATCH", "/api/v1/documents/folders/"+id, map[string]any{"name": "Renamed"}, 409, "system_folder")
	e.fails(b, "PATCH", "/api/v1/documents/folders/"+id, map[string]any{"parent_id": mine.ID}, 409, "system_folder")
	if out := e.bulk(b, map[string]any{"action": "trash", "folder_ids": []string{id}}); out.Updated != 0 || len(out.Skipped) != 1 {
		t.Fatalf("trashed: %+v", out)
	}
	// answered in the asker's language, stored in English
	for lang, want := range map[string]string{"de": "Kontoauszüge", "fr": "Relevés bancaires", "it": "Estratti conto", "en": "Bank Statements"} {
		if got := folderByKind(t, e.allFolders(b, "Accept-Language", lang), "client_bank_statements", "").Name; got != want {
			t.Errorf("%s: %q, want %q", lang, got, want)
		}
	}
	// a file without a kind is a bank statement there; a payment confirmation stays one; Group by type follows the tags
	statement := e.uploaded(b, "ubs.pdf", pdf, "folder_id", id)
	if got := e.get(b, statement.ID); !slices.Contains(got.Tags, "bank-statement") || !slices.Contains(got.Tags, "year-2024") {
		t.Fatalf("tags = %v", got.Tags)
	}
	paid := e.uploaded(b, "gutschrift.pdf", pdf+"p", "folder_id", id)
	if err := e.st.Tx(context.Background(), func(q store.Q) error {
		return q.SetDocumentKind(context.Background(), b.workspace, paid.ID, "payment-confirmation", time.Now())
	}); err != nil {
		t.Fatal(err)
	}
	if got := e.get(b, paid.ID); !slices.Contains(got.Tags, "payment-confirmation") || slices.Contains(got.Tags, "bank-statement") {
		t.Fatalf("payment confirmation tags = %v", got.Tags)
	}
	var out groupsOut
	e.do(b, "GET", "/api/v1/documents/groups?group=type", nil, 200, &out)
	if got := counts(out.Data.Groups); got["bank_statements"] != 1 || got["payment_confirmations"] != 1 {
		t.Fatalf("type groups = %+v", out.Data.Groups)
	}
}

func TestClientBankStatementsAdoptsATranslatedFolder(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	acme := e.client(b, "Acme AG")
	year := e.clientYear(b, acme, 2025)
	mine := e.folder(b, "Kontoauszüge", &year)
	kept := e.uploaded(b, "jan.pdf", pdf, "folder_id", mine.ID)
	if id := e.clientStatements(b, acme, 2025); id != mine.ID {
		t.Fatalf("made %s beside the German folder %s", id, mine.ID)
	}
	if d := e.get(b, kept.ID); d.FolderID == nil || *d.FolderID != mine.ID {
		t.Fatalf("the file moved: %+v", d.Folder)
	}
	if f := folderByKind(t, e.allFolders(b, "Accept-Language", "de"), "client_bank_statements", ""); f.Name != "Kontoauszüge" {
		t.Fatalf("not shown in German: %q", f.Name)
	}
	var stored string
	if err := e.raw.QueryRow(context.Background(), `SELECT name FROM document_folders WHERE id = $1`, mine.ID).Scan(&stored); err != nil ||
		stored != store.BankStatementsFolderName {
		t.Fatalf("stored name %q, %v", stored, err)
	}
}

func TestNoBankStatementsRoot(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	for _, f := range e.allFolders(b) {
		if f.SystemKind != nil && *f.SystemKind == "bank_statements" {
			t.Fatalf("a top-level Bank Statements: %+v", f)
		}
	}
}

func TestAIFilingBankStatements(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.approveAI(b)
	e.filer(nil)
	acme := e.client(b, "Acme AG")
	// an issued invoice whose number a file names: the invoice wins over the word statement
	if _, err := e.raw.Exec(context.Background(), `INSERT INTO invoices (id, workspace_id, kind, status, number, client_id,
			issue_date, due_date, currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total,
			total, rounding_amount, vat_breakdown, created_at, updated_at)
		VALUES ($1, $2, 'invoice', 'open', 'RE-2025-77', $3, '2025-03-01', '2025-03-31', 'CHF', 'de', 'none', 0, 0, 0, 0, 0, 0, 0,
			'[]', now(), now())`, auth.NewID("inv"), b.workspace, acme); err != nil {
		t.Fatal(err)
	}
	this := strconv.Itoa(time.Now().Year())
	for _, tc := range []struct{ name, body, want, kind string }{
		{"acme ag statement 2025.pdf", pdf + "1", "Clients/Acme AG/Documents/2025/Bank Statements", "bank-statement"},
		{"acme ag payment 2024.pdf", pdf + "2", "Clients/Acme AG/Documents/2024/Bank Statements", "payment-confirmation"},
		// without a client: no system folder, a plain one named in the asker's language
		{"revolut account statement 2025.pdf", pdf + "3", "Bank Statements", "bank-statement"},
		{"january.txt", "UBS Switzerland AG\nIBAN CH93 0076 2011 6238 5295 7\nOpening balance 1'200.00\nClosing balance 980.00",
			"January", "bank-statement"},
		{"zeta invoice 2025.txt", "Invoice 17\nPlease pay to IBAN CH93 0076 2011 6238 5295 7\nTotal CHF 100.00", "Zeta", ""},
		// a statement naming an invoice is a statement of it, in the invoice's client's folder
		{"statement RE-2025-77.pdf", pdf + "4", "Clients/Acme AG/Documents/2025/Bank Statements", "bank-statement"},
		{"taxi receipt statement 2023.pdf", pdf + "5", "Expenses/2023/Uncategorised", "receipt"},
		{"payment " + this + ".pdf", pdf + "6", "Payment", "payment-confirmation"},
	} {
		up := e.uploaded(b, tc.name, tc.body)
		e.fileDue()
		if got := e.filedPath(b, up.ID); got != tc.want {
			t.Errorf("%s filed in %q, want %q", tc.name, got, tc.want)
		}
		if got := e.get(b, up.ID); tc.kind != "" && !slices.Contains(got.Tags, tc.kind) {
			t.Errorf("%s tags %v, want %s", tc.name, got.Tags, tc.kind)
		}
	}
	for _, f := range e.allFolders(b) {
		if f.SystemKind != nil && *f.SystemKind == "bank_statements" {
			t.Fatalf("filing made a top-level system folder: %+v", f)
		}
		path := folderPath(e.allFolders(b), f)
		if f.SystemKind == nil && strings.HasPrefix(path, "Clients/") {
			t.Fatalf("filing made a plain folder in Clients: %q", path)
		}
	}
}

func TestOrganizeProposesClientBankStatements(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.approveAI(b)
	e.filer(nil)
	acme := e.client(b, "Acme AG")
	// a person's plain folder in the client's Documents/2024, as the owner had: credit advices linked to the client
	year := e.clientYear(b, acme, 2024)
	gut := e.folder(b, "Eingänge", &year)
	advice := e.uploaded(b, "Gutschrift 01.24.pdf", pdf, "folder_id", gut.ID)
	e.linkClient(b, advice.ID, acme)
	var out one[struct {
		Proposals []proposal `json:"proposals"`
	}]
	e.do(b, "POST", "/api/v1/documents/organize", map[string]any{}, 200, &out)
	i := slices.IndexFunc(out.Data.Proposals, func(p proposal) bool { return p.DocumentID == advice.ID })
	want := "Clients/Acme AG/Documents/2024/Bank Statements"
	if i < 0 || out.Data.Proposals[i].Folder != want || !out.Data.Proposals[i].Change {
		t.Fatalf("proposals = %+v", out.Data.Proposals)
	}
	// applying it files it into the system folder, made on demand
	e.do(b, "POST", "/api/v1/documents/organize/apply", map[string]any{"items": []map[string]any{
		{"document_id": advice.ID, "folder": want, "tags": out.Data.Proposals[i].Tags}}}, 200, nil)
	if got := e.filedPath(b, advice.ID); got != want {
		t.Fatalf("applied into %q", got)
	}
	if got := e.get(b, advice.ID); !slices.Contains(got.Tags, "payment-confirmation") {
		t.Fatalf("tags = %v", got.Tags)
	}
}

func TestRepairMisfiledStatementFolders(t *testing.T) {
	e := newEnv(t)
	b, other := e.workspace(), e.workspace()
	ctx := context.Background()
	acme := e.client(b, "Jullian Odendaal")
	y24 := e.clientYear(b, acme, 2024)
	// as production had them: "Gutschriften" with credit advices tagged payment-confirmation (no filed kind)
	gut := e.folder(b, "Gutschriften", &y24)
	files := []store.Document{e.uploaded(b, "Gutschrift 01.24.pdf", pdf+"1", "folder_id", gut.ID),
		e.uploaded(b, "Gutschrift 02.24.pdf", pdf+"2", "folder_id", gut.ID)}
	trashed := e.uploaded(b, "Gutschrift 03.24.pdf", pdf+"3", "folder_id", gut.ID)
	for _, d := range append(files, trashed) {
		e.linkClient(b, d.ID, acme)
		if _, err := e.raw.Exec(ctx, `UPDATE documents SET tags = array_append(tags, 'payment-confirmation') WHERE id = $1`, d.ID); err != nil {
			t.Fatal(err)
		}
	}
	e.bulk(b, map[string]any{"action": "trash", "document_ids": []string{trashed.ID}})
	// left alone: a folder of another name, one holding something else, one in another workspace
	mine := e.folder(b, "Korrespondenz", &y24)
	letter := e.uploaded(b, "Gutschrift brief.pdf", pdf+"4", "folder_id", mine.ID)
	mixed := e.folder(b, "Zahlungen", &y24)
	e.uploaded(b, "notes.pdf", pdf+"5", "folder_id", mixed.ID)
	oc := e.client(other, "Other AG")
	oy := e.clientYear(other, oc, 2024)
	og := e.folder(other, "Gutschriften", &oy)
	odoc := e.uploaded(other, "x.pdf", pdf+"6", "folder_id", og.ID)
	for range 2 { // twice: nothing more the second time
		if err := e.svc.BackfillSystemFolders(ctx); err != nil {
			t.Fatal(err)
		}
	}
	want := "Clients/Jullian Odendaal/Documents/2024/Bank Statements"
	for _, d := range files {
		if got := e.filedPath(b, d.ID); got != want {
			t.Errorf("%s in %q", d.Name, got)
		}
		if got := e.get(b, d.ID); !slices.Contains(got.Tags, "payment-confirmation") || slices.Contains(got.Tags, "bank-statement") {
			t.Errorf("%s tags %v", d.Name, got.Tags)
		}
	}
	var gone, trashedTo string
	if err := e.raw.QueryRow(ctx, `SELECT coalesce((SELECT id FROM document_folders WHERE id = $1), ''),
		coalesce((SELECT folder_id FROM documents WHERE id = $2), '')`, gut.ID, trashed.ID).Scan(&gone, &trashedTo); err != nil {
		t.Fatal(err)
	}
	if gone != "" {
		t.Fatalf("Gutschriften kept")
	}
	if to := folderByKind(t, e.allFolders(b), "client_bank_statements", ""); trashedTo != to.ID {
		t.Fatalf("the trashed file stayed behind: %q", trashedTo)
	}
	if d := e.get(b, letter.ID); d.FolderID == nil || *d.FolderID != mine.ID {
		t.Fatalf("a person's folder was emptied")
	}
	for _, f := range []string{mixed.ID} {
		if !slices.ContainsFunc(e.allFolders(b), func(x store.Folder) bool { return x.ID == f }) {
			t.Fatalf("a folder of other files went")
		}
	}
	if d := e.get(other, odoc.ID); d.FolderID == nil || *d.FolderID != og.ID {
		t.Fatalf("another workspace's untagged folder moved")
	}
	var events int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'documents.folder_repaired'`,
		b.workspace).Scan(&events); err != nil || events != 1 {
		t.Fatalf("audit events = %d, %v", events, err)
	}
}

func TestRepairBankStatementsRoot(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	// the top-level root and its year folders as migration 00079 made them
	root := func(b *browser, years ...string) (string, []string) {
		t.Helper()
		id := auth.NewID("fld")
		if _, err := e.raw.Exec(ctx, `INSERT INTO document_folders (id, workspace_id, name, created_at, updated_at, system_kind)
			VALUES ($1, $2, 'Bank Statements', now(), now(), 'bank_statements')`, id, b.workspace); err != nil {
			t.Fatal(err)
		}
		var ids []string
		for _, y := range years {
			yid := auth.NewID("fld")
			if _, err := e.raw.Exec(ctx, `INSERT INTO document_folders (id, workspace_id, parent_id, name, created_at, updated_at, system_kind)
				VALUES ($1, $2, $3, $4, now(), now(), 'year')`, yid, b.workspace, id, y); err != nil {
				t.Fatal(err)
			}
			ids = append(ids, yid)
		}
		return id, ids
	}
	empty, filled := e.workspace(), e.workspace()
	emptyRoot, _ := root(empty, "2025", "2026")
	filledRoot, years := root(filled, "2024", "2025", "2026")
	acme := e.client(filled, "Acme AG")
	moved := e.uploaded(filled, "acme.pdf", pdf+"1", "folder_id", years[0])
	e.linkClient(filled, moved.ID, acme)
	left := e.uploaded(filled, "ubs.pdf", pdf+"2", "folder_id", years[1])
	sub := e.folder(filled, "Mine", &filledRoot)
	for range 2 {
		if err := e.svc.BackfillSystemFolders(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM document_folders WHERE workspace_id = $1 AND (id = $2 OR parent_id = $2)`,
		empty.workspace, emptyRoot).Scan(&n); err != nil || n != 0 {
		t.Fatalf("empty root left %d folders, %v", n, err)
	}
	if got := e.filedPath(filled, moved.ID); got != "Clients/Acme AG/Documents/2024/Bank Statements" {
		t.Fatalf("client file in %q", got)
	}
	if got := e.filedPath(filled, left.ID); got != "Bank Statements/2025" {
		t.Fatalf("other file in %q", got)
	}
	if got := e.get(filled, left.ID); !slices.Contains(got.Tags, "bank-statement") {
		t.Fatalf("the kind went: %v", got.Tags)
	}
	folders := e.allFolders(filled)
	for _, f := range folders {
		if f.ID == filledRoot || f.ID == years[1] || f.ID == sub.ID {
			if f.SystemKind != nil {
				t.Fatalf("still locked: %+v", f)
			}
		}
		if f.ID == years[0] || f.ID == years[2] {
			t.Fatalf("an emptied year folder stayed: %+v", f)
		}
	}
	e.do(filled, "PATCH", "/api/v1/documents/folders/"+filledRoot, map[string]any{"name": "Old statements"}, 200, nil)
}

func TestLooksLikeStatement(t *testing.T) {
	balances := "IBAN CH93 0076 2011 6238 5295 7\nAnfangssaldo 100.00\nSchlusssaldo 50.00"
	for _, tc := range []struct {
		name, text string
		want       bool
	}{
		{"Kontoauszug_2025-01.pdf", "", true},
		{"account-statement_2025-01-01_2025-01-31_en.pdf", "", true},
		{"statement_12345_CHF_2025-01-01_2025-01-31.pdf", "", true},
		{"Relevé de compte janvier.pdf", "", true},
		{"estratto conto 2025.pdf", "", true},
		{"export.camt.053.xml", "", true},
		{"export.xml", "<Document><BkToCstmrStmt><Stmt/></BkToCstmrStmt></Document>", true},
		{"ubs.sta", ":20:STARTUMS\n:25:CH9300762011623852957\n:60F:C250101CHF1000,00\n", true},
		{"scan.pdf", balances, true},
		{"Statement of work.pdf", "", false},
		{"invoice 2025-17.pdf", "Please pay to IBAN CH93 0076 2011 6238 5295 7. Total CHF 100.00", false},
		{"receipt.pdf", "Opening balance", false},
		{"notes.txt", "Opening balance and closing balance, no account", false},
	} {
		if got := looksLikeStatement(tc.name, tc.text); got != tc.want {
			t.Errorf("%q: %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestBankStatementDecision(t *testing.T) {
	expenses := &recordPlace{kind: "expenses", year: 2025}
	for _, tc := range []struct {
		name  string
		doc   store.Document
		kind  string
		place *recordPlace
		want  bool
	}{
		{"the model says so", store.Document{Name: "scan.pdf"}, "bank-statement", nil, true},
		{"the name says so", store.Document{Name: "kontoauszug.pdf"}, "", nil, true},
		{"nothing says so", store.Document{Name: "scan.pdf"}, "", nil, false},
		{"the model names an invoice", store.Document{Name: "statement.pdf"}, "invoice", nil, false},
		{"the model names a receipt", store.Document{Name: "statement.pdf"}, "receipt", nil, false},
		{"the model filed it in Expenses", store.Document{Name: "statement.pdf"}, "bank-statement", expenses, false},
		{"an expense's receipt", store.Document{Name: "statement.pdf", Links: []store.DocumentLink{{Type: "expense"}}}, "bank-statement", nil, false},
	} {
		if got := bankStatement(tc.doc, "", tc.kind, tc.place); got != tc.want {
			t.Errorf("%s: %v, want %v", tc.name, got, tc.want)
		}
	}
	client := &store.ClientName{ID: "cli_a"}
	for _, tc := range []struct {
		name   string
		kind   string
		record *recordPlace
		named  *store.ClientName
		want   string
	}{
		{"a statement the model filed to a client", "bank-statement", &recordPlace{clientID: "cli_b", kind: "invoices"}, client, "cli_b"},
		{"a payment confirmation naming a client", "payment-confirmation", nil, client, "cli_a"},
		{"a statement of nobody", "bank-statement", nil, nil, ""},
		{"a contract of a client", "contract", nil, client, ""},
	} {
		got := statementPlace(store.Document{}, tc.kind, tc.record, tc.named, 2024)
		if tc.want == "" && got != nil || tc.want != "" && (got == nil || got.clientID != tc.want || !got.statements || got.year != 2024) {
			t.Errorf("%s: %+v", tc.name, got)
		}
	}
	zurich, _ := time.LoadLocation("Europe/Zurich")
	newYear := time.Date(2025, 12, 31, 23, 30, 0, 0, time.UTC) // 2026 in Zurich
	for _, tc := range []struct {
		end, date string
		want      int
	}{{"2024-12-31", "2025-01-03", 2024}, {"", "2025-01-03", 2025}, {"", "", 2026}, {"soon", "", 2026}} {
		if got := statementYear(tc.end, tc.date, newYear, zurich); got != tc.want {
			t.Errorf("statementYear(%q, %q) = %d, want %d", tc.end, tc.date, got, tc.want)
		}
	}
}

// The owner's case: payment confirmations named by the invoice they pay go to the client's Bank Statements, not
// Invoices; the invoice itself, named by its number, still goes to Invoices, and a shared PDF never asks the model.
func TestNumberedPaymentsGoToBankStatements(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	m := e.filer(nil)
	e.approveAI(b)
	sumara, schumer := e.client(b, "Altaf Sumara"), e.client(b, "Anna Schumer")
	e.invoice(b, sumara, "invoice", "2026/IN/031", 2026, "")
	e.invoice(b, sumara, "invoice", "2026/IN/026", 2026, "")
	e.invoice(b, schumer, "invoice", "2025/IN/038", 2025, "")
	e.invoice(b, schumer, "invoice", "2026/IN/037", 2026, "")
	paid := pdf + "\nRaiffeisen Gutschrift, Zahlung Rechnung 2026/IN/031"
	this := strconv.Itoa(time.Now().Year())
	for _, tc := range []struct{ name, body, want string }{
		{"2026_IN_031_Sumara_1st.pdf", paid + "1", "Clients/Altaf Sumara/Documents/" + this + "/Bank Statements"},
		{"2025_IN_038 A.Schumer 2nd.pdf", paid + "3", "Clients/Anna Schumer/Documents/" + this + "/Bank Statements"},
		{"2026-IN-037_Schumer 1st.pdf", paid + "4", "Clients/Anna Schumer/Documents/" + this + "/Bank Statements"},
		{"2026_IN_026_Daza bezahlt.pdf", paid + "2", "Clients/Altaf Sumara/Documents/" + this + "/Bank Statements"},
		// the invoice itself, named by its number: the model does not call it a payment, so it is the invoice
		{"2026-IN-026.pdf", pdf + "i", "Clients/Altaf Sumara/Invoices/2026"},
	} {
		up := e.uploaded(b, tc.name, tc.body)
		e.fileDue()
		if got := e.filedPath(b, up.ID); got != tc.want {
			t.Errorf("%s filed in %q, want %q", tc.name, got, tc.want)
		}
		if got := e.get(b, up.ID); strings.HasSuffix(tc.want, "Bank Statements") && !slices.Contains(got.Tags, "payment-confirmation") {
			t.Errorf("%s tags %v", tc.name, got.Tags)
		}
	}
	// a file the invoice was imported from is the invoice: no model
	calls := len(m.asked())
	orig := e.uploaded(b, "scan-original.pdf", pdf+"o")
	e.invoice(b, schumer, "invoice", "2024/IN/001", 2024, orig.ID)
	e.fileDue()
	if len(m.asked()) != calls {
		t.Fatal("the model was asked about an imported original")
	}

	// organize, production's shape: an AI-made Gutschriften folder in the client's Documents/2026 holding a payment
	// confirmation named by the invoice number, linked to the client, tagged payment-confirmation, no filed kind
	cregan := e.client(b, "Kim Cregan")
	e.invoice(b, cregan, "invoice", "2026/IN/004", 2026, "")
	year := e.clientYear(b, cregan, 2026)
	gut := e.folder(b, "Gutschriften", &year)
	advice := e.uploaded(b, "2026_IN_004_Cregan.pdf", pdf+"c", "folder_id", gut.ID)
	e.linkClient(b, advice.ID, cregan)
	if _, err := e.raw.Exec(context.Background(), `UPDATE documents SET tags = tags || '{payment-confirmation,2026-in-004}'
		WHERE id = $1`, advice.ID); err != nil {
		t.Fatal(err)
	}
	var out one[struct {
		Proposals []proposal `json:"proposals"`
	}]
	e.do(b, "POST", "/api/v1/documents/organize", map[string]any{"folder_id": gut.ID}, 200, &out)
	i := slices.IndexFunc(out.Data.Proposals, func(p proposal) bool { return p.DocumentID == advice.ID })
	if i < 0 {
		t.Fatalf("no proposal: %+v", out.Data.Proposals)
	}
	p := out.Data.Proposals[i]
	if p.Folder != "Clients/Kim Cregan/Documents/2026/Bank Statements" || !p.Change || !slices.Contains(p.Tags, "payment-confirmation") ||
		p.Reason != "Payment confirmation for invoice 2026/IN/004." {
		t.Fatalf("proposal = %+v", p)
	}
	// and the start-up repair moves it there too
	if err := e.svc.BackfillSystemFolders(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := e.filedPath(b, advice.ID); got != "Clients/Kim Cregan/Documents/2026/Bank Statements" {
		t.Fatalf("repaired into %q", got)
	}
}
