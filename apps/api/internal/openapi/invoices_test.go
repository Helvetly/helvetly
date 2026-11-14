package openapi_test

import (
	"reflect"
	"testing"

	"helvetly.com/api/internal/dunning"
	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/store"
)

// TestSchemasMatchGoTypesInvoices: the invoice summary, delivery and dunning response schemas match their Go types.
func TestSchemasMatchGoTypesInvoices(t *testing.T) {
	for _, c := range []struct {
		schema string
		typ    reflect.Type
	}{
		{"InvoiceDelivery", reflect.TypeFor[store.Delivery]()},
		{"InvoiceSummary", reflect.TypeFor[store.InvoiceSummary]()},
		{"InvoiceSummaryAmount", reflect.TypeFor[store.Amount]()},
		{"InvoiceSummaryMonth", reflect.TypeFor[store.MonthTotals]()},
		{"InvoiceSummaryPeriod", reflect.TypeFor[store.PeriodSummary]()},
		{"DunningStatus", reflect.TypeFor[dunning.Status]()},
		{"DunningNext", reflect.TypeFor[dunning.Next]()},
		{"DunningNotice", reflect.TypeFor[dunning.Notice]()},
	} {
		t.Run(c.schema, func(t *testing.T) {
			for _, d := range openapi.Drift(c.schema, c.typ) {
				t.Error(d)
			}
		})
	}
}
