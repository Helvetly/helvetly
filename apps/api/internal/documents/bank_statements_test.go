package documents

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// bankFolder files Bank Statements/<year> through the store, as filing does.
func (e *env) bankFolder(b *browser, year int) string {
	e.t.Helper()
	var id string
	err := e.st.Tx(context.Background(), func(q store.Q) error {
		var err error
		id, err = q.BankStatementsFolder(context.Background(), b.workspace, year, b.user, time.Now())
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

func TestBankStatementsFolder(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	year := e.bankFolder(b, 2025)
	if again := e.bankFolder(b, 2025); again != year {
		t.Fatalf("a second Bank Statements/2025: %s, %s", again, year)
	}
	folders := e.allFolders(b)
	root := folderByKind(t, folders, "bank_statements", store.BankStatementsFolderName)
	if f := folderByKind(t, folders, "year", "2025"); f.ID != year || f.ParentID == nil || *f.ParentID != root.ID {
		t.Fatalf("Bank Statements/2025: %+v", f)
	}
	// like the other system folders: never renamed, moved or trashed
	mine := e.folder(b, "Mine", nil)
	for _, id := range []string{root.ID, year} {
		e.fails(b, "PATCH", "/api/v1/documents/folders/"+id, map[string]any{"name": "Renamed"}, 409, "system_folder")
		e.fails(b, "PATCH", "/api/v1/documents/folders/"+id, map[string]any{"parent_id": mine.ID}, 409, "system_folder")
		if out := e.bulk(b, map[string]any{"action": "trash", "folder_ids": []string{id}}); out.Updated != 0 || len(out.Skipped) != 1 {
			t.Fatalf("trashed %s: %+v", id, out)
		}
	}
	// answered in the asker's language, stored in English
	for lang, want := range map[string]string{"de": "Kontoauszüge", "fr": "Relevés bancaires", "it": "Estratti conto", "en": "Bank Statements"} {
		if got := folderByKind(t, e.allFolders(b, "Accept-Language", lang), "bank_statements", "").Name; got != want {
			t.Errorf("%s: %q, want %q", lang, got, want)
		}
	}
	// a statement filed there is tagged from the folder and grouped as a bank statement
	d := e.uploaded(b, "ubs.pdf", pdf, "folder_id", year)
	if got := e.get(b, d.ID); !slices.Contains(got.Tags, "bank-statement") || !slices.Contains(got.Tags, "year-2025") {
		t.Fatalf("tags = %v", got.Tags)
	}
	var out groupsOut
	e.do(b, "GET", "/api/v1/documents/groups?group=type", nil, 200, &out)
	if got := counts(out.Data.Groups); got["bank_statements"] != 1 {
		t.Fatalf("type groups = %+v", out.Data.Groups)
	}
	e.do(b, "GET", "/api/v1/documents/groups?group=type,year&type=bank_statements", nil, 200, &out)
	if !slices.Equal(keys(out.Data.Groups), []string{"2025"}) {
		t.Fatalf("bank statement years = %+v", out.Data.Groups)
	}
}

func TestBackfillMakesBankStatementsAndAdoptsATranslatedFolder(t *testing.T) {
	e := newEnv(t)
	b, other := e.workspace(), e.workspace()
	ctx := context.Background()
	e.allFolders(other) // its roots exist
	// before: a workspace with Clients and Expenses only, and a plain German folder of statements with a file in it
	if _, err := e.raw.Exec(ctx, `DELETE FROM document_folders WHERE system_kind = 'bank_statements'`); err != nil {
		t.Fatal(err)
	}
	mine := e.folder(b, "Kontoauszüge", nil)
	kept := e.uploaded(b, "jan.pdf", pdf, "folder_id", mine.ID)
	for range 2 { // twice: nothing more the second time
		if err := e.svc.BackfillSystemFolders(ctx); err != nil {
			t.Fatal(err)
		}
	}
	root := folderByKind(t, e.allFolders(b), "bank_statements", store.BankStatementsFolderName)
	if root.ID != mine.ID {
		t.Fatalf("made %s beside the German folder %s", root.ID, mine.ID)
	}
	if d := e.get(b, kept.ID); d.FolderID == nil || *d.FolderID != mine.ID {
		t.Fatalf("the file moved: %+v", d.Folder)
	}
	var n int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM document_folders WHERE system_kind = 'bank_statements'`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("Bank Statements folders = %d, %v", n, err)
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
	upload := time.Now().Year()
	for _, tc := range []struct{ name, body, want string }{
		{"revolut account statement 2025.pdf", pdf + "1", "Bank Statements/2025"},
		{"kontoauszug-ubs.pdf", pdf + "2", "Bank Statements/" + time.Now().Format("2006")},
		{"january.txt", "UBS Switzerland AG\nIBAN CH93 0076 2011 6238 5295 7\nOpening balance 1'200.00\nClosing balance 980.00",
			"Bank Statements/" + time.Now().Format("2006")},
		{"zeta invoice 2025.txt", "Invoice 17\nPlease pay to IBAN CH93 0076 2011 6238 5295 7\nTotal CHF 100.00", "Zeta"},
		{"statement RE-2025-77.pdf", pdf + "3", "Clients/Acme AG/Invoices/2025"},
		{"taxi receipt statement 2023.pdf", pdf + "4", "Expenses/2023/Uncategorised"},
	} {
		up := e.uploaded(b, tc.name, tc.body)
		e.fileDue()
		if got := e.filedPath(b, up.ID); got != tc.want {
			t.Errorf("%s filed in %q, want %q (uploaded %d)", tc.name, got, tc.want, upload)
		}
	}
	for _, f := range e.allFolders(b) {
		if f.ParentID != nil && f.SystemKind == nil && strings.HasPrefix(folderPath(e.allFolders(b), f), store.BankStatementsFolderName) {
			t.Fatalf("filing made a plain folder in Bank Statements: %+v", f)
		}
	}
}

func TestOrganizeProposesBankStatements(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.approveAI(b)
	e.filer(nil)
	finance := e.folder(b, "Finance", nil)
	statement := e.uploaded(b, "postfinance statement 2024.pdf", pdf, "folder_id", finance.ID)
	invoice := e.uploaded(b, "zeta invoice 2024.pdf", pdf+"i", "folder_id", finance.ID)
	var out one[struct {
		Proposals []proposal `json:"proposals"`
	}]
	e.do(b, "POST", "/api/v1/documents/organize", map[string]any{}, 200, &out)
	found := map[string]proposal{}
	for _, p := range out.Data.Proposals {
		found[p.DocumentID] = p
	}
	if p := found[statement.ID]; p.Folder != "Bank Statements/2024" || !p.Change {
		t.Fatalf("statement: %+v", p)
	}
	if p := found[invoice.ID]; strings.HasPrefix(p.Folder, store.BankStatementsFolderName) {
		t.Fatalf("invoice: %+v", p)
	}
	// applying it files it into the system folder, made on demand
	e.do(b, "POST", "/api/v1/documents/organize/apply", map[string]any{"items": []map[string]any{
		{"document_id": statement.ID, "folder": "Bank Statements/2024", "tags": []string{}}}}, 200, nil)
	if got := e.filedPath(b, statement.ID); got != "Bank Statements/2024" {
		t.Fatalf("applied into %q", got)
	}
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
