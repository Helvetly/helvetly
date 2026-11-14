package openapi

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
)

// Drift compares the component schema `name` with the Go type a handler serialises: the same JSON property
// names (extra: properties the handler adds around the type), the same JSON type, and a pointer exactly where the
// schema allows null. It returns every difference; the spec tests fail on any.
func Drift(name string, t reflect.Type, extra ...string) []string {
	var doc struct {
		Components struct {
			Schemas map[string]map[string]any `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(spec, &doc); err != nil {
		return []string{err.Error()}
	}
	schemas := doc.Components.Schemas
	schema, ok := schemas[name]
	if !ok {
		return []string{"no schema " + name}
	}
	props, _ := schema["properties"].(map[string]any)
	fields := map[string]reflect.Type{}
	collectFields(t, fields)
	var diffs []string
	for _, e := range extra {
		fields[e] = nil
	}
	for f, ft := range fields {
		p, ok := props[f].(map[string]any)
		if !ok {
			diffs = append(diffs, fmt.Sprintf("%s.%s: serialised by %s but not documented", name, f, t))
			continue
		}
		if ft == nil {
			continue
		}
		wantType, wantNull := goJSONType(ft)
		gotType, gotNull := schemaType(p, schemas)
		if wantType != gotType {
			diffs = append(diffs, fmt.Sprintf("%s.%s: Go %s is %s, schema says %s", name, f, ft, wantType, gotType))
		}
		if wantType != "array" && wantType != "object" && wantNull != gotNull {
			diffs = append(diffs, fmt.Sprintf("%s.%s: Go nullable %v, schema nullable %v", name, f, wantNull, gotNull))
		}
	}
	for p := range props {
		if _, ok := fields[p]; !ok {
			diffs = append(diffs, fmt.Sprintf("%s.%s: documented but not serialised by %s", name, p, t))
		}
	}
	slices.Sort(diffs)
	return diffs
}

func collectFields(t reflect.Type, out map[string]reflect.Type) {
	for f := range t.Fields() {
		tag, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		if tag == "-" || (!f.IsExported() && !f.Anonymous) {
			continue
		}
		if f.Anonymous && tag == "" && f.Type.Kind() == reflect.Struct {
			collectFields(f.Type, out)
			continue
		}
		if tag == "" {
			tag = f.Name
		}
		out[tag] = f.Type
	}
}

var marshaler = reflect.TypeFor[json.Marshaler]()

func goJSONType(t reflect.Type) (string, bool) {
	null := false
	if t.Kind() == reflect.Pointer {
		null, t = true, t.Elem()
	}
	if t.Implements(marshaler) || reflect.PointerTo(t).Implements(marshaler) {
		return "string", null // time.Time and the exact decimals (invoicecalc) marshal to strings
	}
	switch t.Kind() {
	case reflect.String:
		return "string", null
	case reflect.Bool:
		return "boolean", null
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint32, reflect.Uint64:
		return "integer", null
	case reflect.Float32, reflect.Float64:
		return "number", null
	case reflect.Slice, reflect.Array:
		return "array", null
	default:
		return "object", null
	}
}

// schemaType reads {"type": x}, {"type": [x, "null"]}, {"$ref"} and {"anyOf": [{"$ref"}, {"type": "null"}]}.
func schemaType(p map[string]any, schemas map[string]map[string]any) (string, bool) {
	if ref, ok := p["$ref"].(string); ok {
		typ, _ := schemaType(schemas[strings.TrimPrefix(ref, "#/components/schemas/")], schemas)
		return typ, false
	}
	if alts, ok := p["anyOf"].([]any); ok {
		typ, null := "", false
		for _, a := range alts {
			m, _ := a.(map[string]any)
			if m["type"] == "null" {
				null = true
				continue
			}
			typ, _ = schemaType(m, schemas)
		}
		return typ, null
	}
	switch v := p["type"].(type) {
	case string:
		return v, false
	case []any:
		typ, null := "", false
		for _, x := range v {
			if x == "null" {
				null = true
			} else if s, ok := x.(string); ok {
				typ = s
			}
		}
		return typ, null
	}
	return "", false
}
