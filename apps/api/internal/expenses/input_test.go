package expenses

import (
	"encoding/json"
	"maps"
	"slices"
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestBookedExpenseKeepsItsAccountingCurrency(t *testing.T) {
	for _, status := range []string{"booked", "void"} {
		t.Run(status, func(t *testing.T) {
			e := store.Expense{Status: status, Currency: "EUR", AmountMode: "gross", InputTax: "none",
				ExchangeRate: 950000, PaymentStatus: "unpaid", Lines: []store.ExpenseLine{{Amount: 10000}}}
			compute(&e, "CHF")
			before, rate := e.Base, e.ExchangeRate
			_, err := applyInput(&e, map[string]json.RawMessage{"note": json.RawMessage(`"Corrected note"`)},
				store.WorkspaceDefaults{Currency: "EUR"}, "2026-11-07")
			if err != nil {
				t.Fatal(err)
			}
			if e.Base != before || e.ExchangeRate != rate {
				t.Fatalf("editing the note rewrote booked amounts: base %+v, rate %s; want %+v, %s", e.Base, e.ExchangeRate, before, rate)
			}
			if e.Note == nil || *e.Note != "Corrected note" {
				t.Fatal("note was not saved")
			}
		})
	}
}

func TestExplicitUnpaidClearsOutOfPocketPayment(t *testing.T) {
	for _, status := range []string{"draft", "booked"} {
		t.Run(status, func(t *testing.T) {
			paidOn, paidBy, reimbursedOn, method := "2026-11-01", "usr_payer", "2026-11-03", "card"
			e := store.Expense{Status: status, Currency: "CHF", AmountMode: "gross", InputTax: "none",
				ExchangeRate: 1000000, PaymentStatus: "paid", PaidOn: &paidOn, PaymentMethod: &method,
				PaidByID: &paidBy, ReimbursedOn: &reimbursedOn}
			_, err := applyInput(&e, map[string]json.RawMessage{"payment_status": json.RawMessage(`"unpaid"`)},
				store.WorkspaceDefaults{Currency: "CHF"}, "2026-11-07")
			if err != nil {
				t.Fatal(err)
			}
			if e.PaymentStatus != "unpaid" || e.PaidOn != nil || e.PaymentMethod != nil || e.PaidByID != nil || e.ReimbursedOn != nil {
				t.Fatalf("explicit unpaid kept payment data: %+v", e)
			}
		})
	}
}

func TestCheckCreate(t *testing.T) {
	d := store.WorkspaceDefaults{Currency: "CHF", VATRegistered: true, DefaultVATRate: 810}
	tests := []struct {
		name, body string
		invalid    []string
		total      string
		badRequest bool
	}{
		{name: "a gross receipt", body: `{"supplier_name":"Migros","lines":[{"amount":"108.10","vat_rate":"8.1"}]}`, total: "108.10"},
		{name: "per-field messages", body: `{"currency":"XYZ","document_date":"2025-13-01","lines":[{"amount":"-1"}]}`,
			invalid: []string{"currency", "document_date", "lines.0.amount"}},
		{name: "letters in an amount", body: `{"lines":[{"amount":"22ssss"}]}`, invalid: []string{"lines.0.amount"}},
		{name: "a third decimal in an amount", body: `{"lines":[{"amount":"1.234"}]}`, invalid: []string{"lines.0.amount"}},
		{name: "a VAT rate above 100", body: `{"lines":[{"amount":"10","vat_rate":"150"}]}`, invalid: []string{"lines.0.vat_rate"}},
		{name: "letters in a VAT rate", body: `{"lines":[{"amount":"10","vat_rate":"8.1x"}]}`, invalid: []string{"lines.0.vat_rate"}},
		{name: "a negative VAT rate", body: `{"lines":[{"amount":"10","vat_rate":"-1"}]}`, invalid: []string{"lines.0.vat_rate"}},
		{name: "a VAT rate of 100", body: `{"lines":[{"amount":"200","vat_rate":"100"}]}`, total: "200.00"},
		{name: "the total limit", body: `{"lines":[` + strings.Repeat(`{"amount":"100000000"},`, 10) + `{"amount":"1"}]}`, invalid: []string{"lines"}},
		{name: "an unknown field is malformed", body: `{"status":"booked"}`, badRequest: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var body map[string]json.RawMessage
			if err := json.Unmarshal([]byte(tt.body), &body); err != nil {
				t.Fatal(err)
			}
			e, invalid, err := CheckCreate(body, d, store.User{ID: "usr_1"}, "2026-11-07")
			if (err != nil) != tt.badRequest {
				t.Fatalf("err %v", err)
			}
			if got := slices.Sorted(maps.Keys(invalid)); !slices.Equal(got, tt.invalid) {
				t.Fatalf("invalid %v, want %v", invalid, tt.invalid)
			}
			if tt.total != "" && (e.Status != "draft" || e.Total.String() != tt.total || e.CreatedBy.ID != "usr_1") {
				t.Fatalf("draft %+v", e)
			}
		})
	}
}
