package openapi_test

import (
	"reflect"
	"testing"

	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/store"
)

func TestSchemasMatchGoTypesClientsProducts(t *testing.T) {
	for _, c := range []struct {
		schema string
		typ    reflect.Type
	}{
		{"ClientFile", reflect.TypeFor[store.ClientFile]()},
		{"ClientTag", reflect.TypeFor[store.TagCount]()},
	} {
		t.Run(c.schema, func(t *testing.T) {
			for _, d := range openapi.Drift(c.schema, c.typ) {
				t.Error(d)
			}
		})
	}
}
