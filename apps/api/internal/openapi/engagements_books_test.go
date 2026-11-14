package openapi_test

import (
	"reflect"
	"testing"

	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/ledgercalc"
	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/vatcalc"
	"helvetly.com/api/internal/vatreturn"
)

// TestSchemasMatchGoTypesEngagementsBooks: the Engagements and Books response schemas with an exported Go type. The
// unexported ones (periods, activity, audit events, the summary) are checked in their own packages.
func TestSchemasMatchGoTypesEngagementsBooks(t *testing.T) {
	for _, c := range []struct {
		schema string
		typ    reflect.Type
	}{
		{"EngagementEntry", reflect.TypeFor[store.EngagementEntry]()},
		{"EngagementPeriodDetail", reflect.TypeFor[engagements.Period]()},
		{"SelfBillingAgreement", reflect.TypeFor[store.SelfBillingAgreement]()},
		{"VatReturn", reflect.TypeFor[vatreturn.Report]()},
		{"VatReturnLine", reflect.TypeFor[vatcalc.Line]()},
		{"VatReturnWarning", reflect.TypeFor[vatcalc.Warning]()},
		{"VatReturnNetRate", reflect.TypeFor[vatcalc.NetRate]()},
		{"LedgerBalance", reflect.TypeFor[ledgercalc.Balance]()},
		{"LedgerEntry", reflect.TypeFor[ledgercalc.Row]()},
		{"LedgerStatement", reflect.TypeFor[ledgercalc.Statement]()},
		{"LedgerStatementLine", reflect.TypeFor[ledgercalc.StatementLine]()},
	} {
		t.Run(c.schema, func(t *testing.T) {
			for _, d := range openapi.Drift(c.schema, c.typ) {
				t.Error(d)
			}
		})
	}
}
