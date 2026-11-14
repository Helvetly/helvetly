package ledger

import (
	"bytes"
	"strings"
	"testing"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/ledgercalc"
)

func row(desc, cur string) ledgercalc.Row {
	return ledgercalc.Row{Date: "2026-03-02", Ref: "2026-001", Description: desc, Debit: "1100", Credit: "3200",
		Amount: invoicecalc.Money(100000), Currency: cur, SourceType: "invoice", SourceID: "inv_1"}
}

func export(t *testing.T, format string, rows ...ledgercalc.Row) (string, int) {
	t.Helper()
	var buf bytes.Buffer
	skipped, err := WriteExport(&buf, format, rows, "CHF")
	if err != nil {
		t.Fatal(err)
	}
	return buf.String(), skipped
}

func TestBananaExample(t *testing.T) {
	got, skipped := export(t, "banana", row("Invoice 2026-001 · Acme", "CHF"))
	want := "Date\tDoc\tDescription\tAccountDebit\tAccountCredit\tAmount\n2026-03-02\t2026-001\tInvoice 2026-001 · Acme\t1100\t3200\t1000.00\n"
	if got != want || skipped != 0 {
		t.Fatalf("got %q skipped %d", got, skipped)
	}
}

func TestBananaSkipsForeign(t *testing.T) {
	got, skipped := export(t, "banana", row("a", "CHF"), row("b", "EUR"))
	if skipped != 1 || strings.Contains(got, "\tb\t") {
		t.Fatalf("got %q skipped %d", got, skipped)
	}
}

func TestBananaTabBecomesSpace(t *testing.T) {
	got, _ := export(t, "banana", row("a\tb\nc", "CHF"))
	if !strings.Contains(got, "\ta b c\t") {
		t.Fatalf("got %q", got)
	}
}

func TestBexioDate(t *testing.T) {
	got, _ := export(t, "bexio", row("x", "CHF"))
	want := "Document Number,Date,Description,Amount,Currency,Exchange Rate,Debit,Credit,VAT Code\n2026-001,02.03.2026,x,1000.00,CHF,,1100,3200,\n"
	if got != want {
		t.Fatalf("got %q", got)
	}
}

func TestAbacusSemicolon(t *testing.T) {
	got, _ := export(t, "abacus", row("x", "CHF"))
	want := "Datum;Beleg;Text;Soll;Haben;Betrag;Währung\n02.03.2026;2026-001;x;1100;3200;1000.00;CHF\n"
	if got != want {
		t.Fatalf("got %q", got)
	}
}

func TestCSVHeader(t *testing.T) {
	got, _ := export(t, "csv", row("x", "CHF"))
	want := "date,reference,description,debit_account,credit_account,amount,currency,source_type,source_id\n2026-03-02,2026-001,x,1100,3200,1000.00,CHF,invoice,inv_1\n"
	if got != want {
		t.Fatalf("got %q", got)
	}
}

func TestFormulaInjection(t *testing.T) {
	for _, f := range []string{"banana", "bexio", "abacus", "csv"} {
		got, _ := export(t, f, row("=SUM(A1)", "CHF"))
		if !strings.Contains(got, "'=SUM(A1)") {
			t.Errorf("%s: %q", f, got)
		}
	}
}

func TestUnknownFormat(t *testing.T) {
	if _, err := WriteExport(&bytes.Buffer{}, "xls", nil, "CHF"); err == nil {
		t.Fatal("want error")
	}
	if _, _, ok := ExportFile("xls", "a", "b"); ok {
		t.Fatal("want ok=false")
	}
}

func TestExportFile(t *testing.T) {
	n, ct, ok := ExportFile("bexio", "2026-01-01", "2026-12-31")
	if n != "journal-2026-01-01-2026-12-31-bexio.csv" || ct != "text/csv; charset=utf-8" || !ok {
		t.Fatal(n, ct, ok)
	}
	n, ct, _ = ExportFile("banana", "a", "b")
	if n != "journal-a-b-banana.txt" || ct != "text/tab-separated-values; charset=utf-8" {
		t.Fatal(n, ct)
	}
}
