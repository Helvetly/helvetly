package openapi_test

import (
	"reflect"
	"testing"

	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/store"
)

// TestSchemasMatchGoTypesQuotesInstalments: the quote and instalment plan response schemas against their Go types.
func TestSchemasMatchGoTypesQuotesInstalments(t *testing.T) {
	for _, c := range []struct {
		schema string
		typ    reflect.Type
	}{
		{"Quote", reflect.TypeFor[store.Quote]()},
		{"Plan", reflect.TypeFor[invoices.PlanView]()},
		{"PlanItem", reflect.TypeFor[invoices.PlanItemView]()},
	} {
		t.Run(c.schema, func(t *testing.T) {
			for _, d := range openapi.Drift(c.schema, c.typ) {
				t.Error(d)
			}
		})
	}
}
