package ledgercalc

import (
	"reflect"
	"testing"

	"helvetly.com/api/internal/invoicecalc"
)

func row(date, debit, credit string, amount int64, cur string) Row {
	return Row{Date: date, Ref: "R-" + date, Debit: debit, Credit: credit, Amount: invoicecalc.Money(amount), Currency: cur}
}

func TestBalancesExample(t *testing.T) {
	rows := []Row{row("2025-12-31", "1100", "3200", 1000, "CHF"), row("2026-01-05", "1020", "1100", 400, "CHF")}
	got := Balances(rows, "2026-01-01", "2026-12-31", nil)
	want := []Balance{
		{"1020", "Bank", "CHF", 0, 400, 0, 400},
		{"1100", "Debitoren", "CHF", 1000, 0, 400, 600},
		{"2970", "Gewinnvortrag / Verlustvortrag", "CHF", -1000, 0, 0, -1000},
		{"3200", "Dienstleistungserlöse", "CHF", 0, 0, 0, 0},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	if in := InRange(rows, "2026-01-01", "2026-12-31"); len(in) != 1 || in[0].Date != "2026-01-05" {
		t.Fatalf("InRange %v", in)
	}
}

func TestBalancesOpeningExcludesAfterTo(t *testing.T) {
	rows := []Row{row("2027-01-01", "1100", "3200", 500, "CHF"), row("2026-02-01", "1100", "3200", 100, "CHF")}
	got := Balances(rows, "2026-01-01", "2026-12-31", nil)
	if len(got) != 2 || got[0].Closing != 100 || got[1].Closing != -100 {
		t.Fatalf("got %v", got)
	}
	if b := Balances(rows[:1], "2026-01-01", "2026-12-31", nil); len(b) != 0 {
		t.Fatalf("expected none, got %v", b)
	}
}

func TestBalancesPerCurrency(t *testing.T) {
	rows := []Row{row("2026-02-01", "1100", "3200", 100, "EUR"), row("2026-02-01", "1100", "3200", 200, "CHF")}
	got := Balances(rows, "2026-01-01", "2026-12-31", nil)
	if len(got) != 4 || got[0].Currency != "CHF" || got[1].Currency != "EUR" || got[0].Closing != 200 || got[1].Closing != 100 {
		t.Fatalf("got %v", got)
	}
}

func TestStatementRunningBalance(t *testing.T) {
	rows := []Row{
		row("2026-03-01", "1020", "1100", 400, "CHF"),
		row("2025-12-31", "1100", "3200", 1000, "CHF"),
		row("2026-02-01", "1100", "3200", 50, "CHF"),
		row("2026-02-01", "1100", "3200", 50, "EUR"),
	}
	st := AccountStatement(rows, "1100", "CHF", "2026-01-01", "2026-12-31", nil)
	if st.Opening != 1000 || st.Closing != 650 || st.Name != "Debitoren" || len(st.Lines) != 2 {
		t.Fatalf("got %+v", st)
	}
	l0, l1 := st.Lines[0], st.Lines[1]
	if l0.Date != "2026-02-01" || l0.Contra != "3200" || l0.Debit != 50 || l0.Balance != 1050 {
		t.Fatalf("line0 %+v", l0)
	}
	if l1.Contra != "1020" || l1.Credit != 400 || l1.Balance != 650 {
		t.Fatalf("line1 %+v", l1)
	}
}

func TestNamesOverride(t *testing.T) {
	rows := []Row{row("2026-02-01", "6640", "1020", 100, "CHF")}
	names := map[string]string{"6640": "Travel"}
	got := Balances(rows, "2026-01-01", "2026-12-31", names)
	if got[1].Name != "Travel" || got[0].Name != "Bank" {
		t.Fatalf("got %v", got)
	}
	if n := AccountStatement(rows, "6640", "CHF", "2026-01-01", "2026-12-31", names).Name; n != "Travel" {
		t.Fatal(n)
	}
}

func byAccount(bs []Balance, account string) Balance {
	for _, b := range bs {
		if b.Account == account {
			return b
		}
	}
	return Balance{}
}

func TestBalancesCarryIncomeStatementIntoPriorYearResult(t *testing.T) {
	rows := []Row{row("2025-12-31", "1100", "3200", 1000, "CHF"), row("2026-01-05", "1020", "1100", 400, "CHF")}
	got := Balances(rows, "2026-01-01", "2026-12-31", nil)
	var sum invoicecalc.Money
	for _, b := range got {
		sum += b.Opening
	}
	if sum != 0 {
		t.Fatalf("opening does not balance: %v", got)
	}
	if b := byAccount(got, "3200"); b.Opening != 0 || b.Closing != 0 {
		t.Fatalf("3200 %+v", b)
	}
	if b := byAccount(got, "2970"); b.Opening != -1000 || b.Name != "Gewinnvortrag / Verlustvortrag" {
		t.Fatalf("2970 %+v", b)
	}
	if b := byAccount(got, "1100"); b.Opening != 1000 {
		t.Fatalf("1100 %+v", b)
	}
	if st := AccountStatement(rows, "2970", "CHF", "2026-01-01", "2026-12-31", nil); st.Opening != -1000 || st.Closing != -1000 {
		t.Fatalf("2970 statement %+v", st)
	}
	if st := AccountStatement(rows, "3200", "CHF", "2026-01-01", "2026-12-31", nil); st.Opening != 0 {
		t.Fatalf("3200 statement %+v", st)
	}
}

func TestBalancesMidYearOpensIncomeStatementWithSameYear(t *testing.T) {
	rows := []Row{
		row("2025-06-01", "1100", "3200", 1000, "CHF"),
		row("2026-03-01", "1100", "3200", 200, "CHF"),
		row("2026-08-01", "1100", "3200", 50, "CHF"),
	}
	got := Balances(rows, "2026-07-01", "2026-12-31", nil)
	if b := byAccount(got, "3200"); b.Opening != -200 || b.Credit != 50 {
		t.Fatalf("3200 %+v", b)
	}
	if b := byAccount(got, "2970"); b.Opening != -1000 {
		t.Fatalf("2970 %+v", b)
	}
	if st := AccountStatement(rows, "3200", "CHF", "2026-07-01", "2026-12-31", nil); st.Opening != -200 {
		t.Fatalf("statement %+v", st)
	}
}
