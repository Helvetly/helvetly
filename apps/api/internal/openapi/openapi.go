// Package openapi is the public API catalogue (docs/openapi.md): the hand-written OpenAPI 3.1 document of the
// operations an API token may call, served at GET /api/v1/openapi.json. The same document decides which routes
// accept a token (BearerRoutes) and which tools the MCP server offers (Operations).
package openapi

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
)

//go:embed openapi.json
var spec []byte

// Param is a path or query parameter.
type Param struct {
	Name        string          `json:"name"`
	In          string          `json:"in"`
	Required    bool            `json:"required"`
	Description string          `json:"description"`
	Schema      json.RawMessage `json:"schema"`
}

// Operation is one documented route, with its request body schema resolved (no $ref left). Resource is its tag in
// lower case: what an API token's scopes name ("read:invoices", docs/api-tokens-contract.md).
type Operation struct {
	ID, Method, Path, Tag, Resource, Summary, Description string
	Write, Destructive                                    bool
	Params                                                []Param
	Body                                                  json.RawMessage // nil: no body
	BodyRequired                                          bool
	// Upload: the body is multipart/form-data; its file fields have "format": "binary" (or are arrays of them).
	Upload bool
}

// Operations is the catalogue, in document order (paths sorted, then GET before writes).
var Operations = mustLoad(spec)

type document struct {
	Paths      map[string]map[string]rawOperation `json:"paths"`
	Components struct {
		Schemas map[string]json.RawMessage `json:"schemas"`
	} `json:"components"`
}

type rawOperation struct {
	OperationID string   `json:"operationId"`
	Tags        []string `json:"tags"`
	Summary     string   `json:"summary"`
	Description string   `json:"description"`
	Parameters  []Param  `json:"parameters"`
	RequestBody *struct {
		Required bool `json:"required"`
		Content  map[string]struct {
			Schema json.RawMessage `json:"schema"`
		} `json:"content"`
	} `json:"requestBody"`
	Write       bool `json:"x-helvetly-write"`
	Destructive bool `json:"x-helvetly-destructive"`
}

var methods = []string{"get", "post", "put", "patch", "delete"}

func mustLoad(raw []byte) []Operation {
	ops, err := load(raw)
	if err != nil {
		panic(fmt.Errorf("openapi.json: %w", err))
	}
	return ops
}

func load(raw []byte) ([]Operation, error) {
	var doc document
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(doc.Paths))
	for p := range doc.Paths {
		paths = append(paths, p)
	}
	slices.Sort(paths)
	var ops []Operation
	for _, p := range paths {
		for _, m := range methods {
			ro, ok := doc.Paths[p][m]
			if !ok {
				continue
			}
			if len(ro.Tags) != 1 {
				return nil, fmt.Errorf("%s %s: want exactly one tag", m, p)
			}
			op := Operation{ID: ro.OperationID, Method: strings.ToUpper(m), Path: p, Tag: ro.Tags[0], Resource: strings.ToLower(ro.Tags[0]), Summary: ro.Summary,
				Description: ro.Description, Write: ro.Write, Destructive: ro.Destructive, Params: ro.Parameters}
			for i, prm := range op.Params {
				s, err := resolve(prm.Schema, doc.Components.Schemas, 0)
				if err != nil {
					return nil, fmt.Errorf("%s: %s: %w", op.ID, prm.Name, err)
				}
				op.Params[i].Schema = s
			}
			if ro.RequestBody != nil {
				body, ok := ro.RequestBody.Content["application/json"]
				if !ok {
					body, op.Upload = ro.RequestBody.Content["multipart/form-data"]
				}
				if !op.Upload && !ok || len(ro.RequestBody.Content) != 1 {
					return nil, fmt.Errorf("%s: one application/json or multipart/form-data body", op.ID)
				}
				s, err := resolve(body.Schema, doc.Components.Schemas, 0)
				if err != nil {
					return nil, fmt.Errorf("%s: body: %w", op.ID, err)
				}
				op.Body, op.BodyRequired = s, ro.RequestBody.Required
			}
			ops = append(ops, op)
		}
	}
	return ops, nil
}

// resolve inlines every "#/components/schemas/…" reference, for clients (MCP) that take one self-contained schema.
func resolve(raw json.RawMessage, schemas map[string]json.RawMessage, depth int) (json.RawMessage, error) {
	if depth > 16 {
		return nil, fmt.Errorf("schema nested too deep (a cycle?)")
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	out, err := inline(v, schemas, depth)
	if err != nil {
		return nil, err
	}
	return json.Marshal(out)
}

func inline(v any, schemas map[string]json.RawMessage, depth int) (any, error) {
	switch t := v.(type) {
	case map[string]any:
		if ref, ok := t["$ref"].(string); ok {
			name, ok := strings.CutPrefix(ref, "#/components/schemas/")
			target, found := schemas[name]
			if !ok || !found {
				return nil, fmt.Errorf("unknown $ref %q", ref)
			}
			r, err := resolve(target, schemas, depth+1)
			if err != nil {
				return nil, err
			}
			var out any
			return out, json.Unmarshal(r, &out)
		}
		for k, e := range t {
			r, err := inline(e, schemas, depth)
			if err != nil {
				return nil, err
			}
			t[k] = r
		}
	case []any:
		for i, e := range t {
			r, err := inline(e, schemas, depth)
			if err != nil {
				return nil, err
			}
			t[i] = r
		}
	}
	return v, nil
}

// Register serves the document; it is public, like any API reference.
func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/openapi.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.Header().Set("Access-Control-Allow-Origin", "*") // a public document: let API tools in a browser load it
		_, _ = w.Write(spec)
	})
}

// Resources are the catalogue's resources in operation order, each with whether any operation writes it.
func Resources() []Resource {
	var out []Resource
	for _, op := range Operations {
		i := slices.IndexFunc(out, func(r Resource) bool { return r.Name == op.Resource })
		if i < 0 {
			out = append(out, Resource{Name: op.Resource})
			i = len(out) - 1
		}
		out[i].Writable = out[i].Writable || op.Write
	}
	return out
}

type Resource struct {
	Name     string
	Writable bool
}

// BearerRoutes reports whether an API token may call a request (a documented operation, or one of the extra
// patterns such as the MCP endpoint, which name no resource and check each tool themselves), the operation's
// resource and whether it writes.
func BearerRoutes(extra ...string) func(*http.Request) (allowed bool, resource string, write bool) {
	mux := http.NewServeMux()
	ops := map[string]Operation{}
	nop := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	for _, op := range Operations {
		pattern := op.Method + " " + op.Path
		mux.Handle(pattern, nop)
		ops[pattern] = op
	}
	for _, p := range extra {
		mux.Handle(p, nop)
	}
	return func(r *http.Request) (bool, string, bool) {
		_, pattern := mux.Handler(r)
		op := ops[pattern]
		return pattern != "", op.Resource, op.Write
	}
}
