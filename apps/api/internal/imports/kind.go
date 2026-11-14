package imports

import (
	"context"
	"encoding/json"
	"maps"
	"slices"
	"strings"

	"helvetly.com/api/internal/store"
)

// Data is one record as the kind's create input: field name to its JSON value. Absent means empty.
type Data = map[string]json.RawMessage

// Kind is one importable entity: what the model is asked for, and how a reviewed record becomes a real one. A kind
// registers itself in Kinds from its own file (kind_<name>.go); the engine (upload, extraction job, review, commit) is the same for every kind.
//
// The model's output is untrusted: the engine keeps only the schema's top-level properties, drops nulls and hands the
// rest to Check. Check, Duplicate and Create run in the request's or the job's transaction, scoped to the workspace.
type Kind struct {
	// Name is the batch's kind and the API's `kind` (a value of import_batches.kind).
	Name string
	// Label names the kind for people ("Clients"): Heidi offers it, and the platform's IMPORT_KINDS uses the same.
	Label string
	// Resource is the permission resource: read:<Resource> sees a batch, write:<Resource> uploads, edits and commits.
	Resource string
	// LabelField names a record (default "name"): the same-batch duplicate hint compares it.
	LabelField string
	// Prompt says what to extract from a document; the engine adds the rules about untrusted content.
	Prompt string
	// Schema is the JSON schema of one record in OpenAI's strict structured-output form: an object whose properties
	// are all listed in required (nullable where optional) with additionalProperties false.
	Schema map[string]any
	// Check applies the create rules: a message per invalid field, none when the record can be created.
	Check func(ctx context.Context, q store.Q, workspaceID string, data Data) (map[string]string, error)
	// Duplicate names an existing record this one may repeat, or nil.
	Duplicate func(ctx context.Context, q store.Q, workspaceID string, data Data) (*store.ImportDuplicate, error)
	// Create makes the record through the canonical write (plan limits included) and returns its id. It runs only
	// after Check found nothing, inside the commit's transaction for this one record.
	Create func(ctx context.Context, q store.Q, sess store.Session, data Data, src Source) (string, error)
	// Conflict (optional) names an existing record this one cannot be created beside (an invoice number already used).
	// Commit then creates nothing and answers "conflict" until the person resolves the record: skip, or overwrite.
	Conflict func(ctx context.Context, q store.Q, workspaceID string, data Data) (*store.ImportConflict, error)
	// Overwrite (with Conflict) replaces the conflicting record id with this one and returns its id, inside the commit's
	// transaction; it refuses (an auth error under 500) a record that may not be overwritten.
	Overwrite func(ctx context.Context, q store.Q, sess store.Session, data Data, src Source, id string) (string, error)
}

// Resolutions a person sends for a record at commit: replace the conflicting record, or leave the record out.
const (
	Overwrite = "overwrite"
	Skip      = "skip"
)

// write creates the record, or returns its conflict, or overwrites the conflicting record when the person chose that.
func (k Kind) write(ctx context.Context, q store.Q, sess store.Session, data Data, src Source, resolution string) (string, *store.ImportConflict, error) {
	var c *store.ImportConflict
	if k.Conflict != nil {
		var err error
		if c, err = k.Conflict(ctx, q, sess.Workspace.ID, data); err != nil {
			return "", nil, err
		}
	}
	switch {
	case c == nil:
		id, err := k.Create(ctx, q, sess, data, src)
		return id, nil, err
	case resolution == Overwrite:
		id, err := k.Overwrite(ctx, q, sess, data, src, c.ID)
		return id, nil, err
	}
	return "", c, nil
}

// Source is the file a record was read from.
type Source struct {
	// DocumentID is the Document holding the file (an existing one when its bytes were reused); nil for a ZIP entry,
	// whose bytes are not a Document of their own.
	DocumentID *string
	Name       string
	// ContentType is the file's type, sniffed from its bytes (the entry's, for a ZIP entry).
	ContentType string
	// Keep stores a copy of the file's bytes as an object of the record's own at key and returns its size and SHA-256.
	// The engine deletes the copy again when the record's transaction fails.
	Keep func(ctx context.Context, key string) (size int64, sum string, err error)
}

func (k Kind) labelField() string {
	if k.LabelField == "" {
		return "name"
	}
	return k.LabelField
}

// Kinds are the registered kinds by name. A kind registers itself from its own file (kind_<name>.go) with
// `func init() { register(myKind) }`, so kinds never touch each other's code.
var Kinds = map[string]Kind{}

func register(k Kind) {
	if _, taken := Kinds[k.Name]; taken {
		panic("imports: kind " + k.Name + " registered twice")
	}
	Kinds[k.Name] = k
}

// text: a normalised field's string value ("" for none).
func text(v any) string {
	s, _ := v.(string)
	return s
}

// rawText: a JSON string's trimmed value ("" for anything else).
func rawText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return ""
	}
	return strings.TrimSpace(s)
}

// Offered: the labels of the kinds allows(resource) lets a person import, in name order (for Heidi's form).
func Offered(allows func(resource string) bool) []string {
	var out []string
	for _, name := range slices.Sorted(maps.Keys(Kinds)) {
		if k := Kinds[name]; allows(k.Resource) {
			out = append(out, k.Label)
		}
	}
	return out
}

// fields: the record's keys, from the schema.
func (k Kind) fields() []string {
	props, _ := k.Schema["properties"].(map[string]any)
	return slices.Sorted(maps.Keys(props))
}

// record is the strict schema of one record with these properties, all required.
func record(props map[string]any) map[string]any {
	return map[string]any{"type": "object", "additionalProperties": false, "properties": props,
		"required": slices.Sorted(maps.Keys(props))}
}

// nullable is an optional property of a JSON type ("string", "number", "integer", "boolean") with a hint.
func nullable(typ, description string) map[string]any {
	return map[string]any{"type": []string{typ, "null"}, "description": description}
}
