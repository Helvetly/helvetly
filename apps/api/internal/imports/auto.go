package imports

import (
	"cmp"
	"context"
	"slices"
	"strings"

	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/store"
)

// Auto is the batch kind that works out what each file is: one model call per chunk recognises the document type and
// fills the records of every kind it holds (a sales invoice gives the invoice and its client). Each record keeps its
// own kind; reading a file needs write:documents, creating a record its kind's write scope.
const Auto = "auto"

var autoKind = Kind{Name: Auto, Label: "Documents", Resource: "documents"}

// DocumentTypes the model chooses from, with the kinds each one fills. "other" fills none.
var documentTypes = []struct{ Name, Means string }{
	{"sales_invoice", "an invoice or credit note the workspace issued to its customer"},
	{"bill", "an invoice or receipt the workspace received from a supplier: a cost"},
	{"contract", "an agreement, offer, order confirmation or statement of work between the workspace and a customer"},
	{"client_list", "a list or register of customers or contacts"},
	{"product_list", "a price list or catalogue of products or services the workspace sells"},
	{"other", "anything else, or not a business document"},
}

// autoKinds are the kinds an auto batch fills, in the order a commit creates them: clients and products first, so the
// invoices and engagements of the same commit find their client.
var autoKinds = []string{"clients", "products", "invoices", "engagements", "expenses"}

// commitRank orders records for a commit by autoKinds.
func commitRank(kind string) int {
	if i := slices.Index(autoKinds, kind); i >= 0 {
		return i
	}
	return len(autoKinds)
}

// byCommitOrder sorts record ids so clients and products come before what refers to them; stable otherwise.
func byCommitOrder(ids []string, records []store.ImportRecord) []string {
	kinds := map[string]string{}
	for _, r := range records {
		kinds[r.ID] = r.Kind
	}
	out := slices.Clone(ids)
	slices.SortStableFunc(out, func(a, b string) int { return cmp.Compare(commitRank(kinds[a]), commitRank(kinds[b])) })
	return out
}

// fills says which arrays each document type fills, and how.
var fills = []struct {
	Type  string
	Kinds []string
	Text  string
}{
	{"sales_invoice", []string{"invoices", "clients"}, "invoices (one per invoice) and clients (the billed customer, once)"},
	{"bill", []string{"expenses"}, "expenses"},
	{"contract", []string{"engagements", "clients"}, "engagements and clients (the customer, once)"},
	{"client_list", []string{"clients"}, "clients"},
	{"product_list", []string{"products"}, "products"},
}

// missing lists the kinds a document type fills that the plan does not offer.
func missing(docType string, offered []string) []string {
	var out []string
	for _, f := range fills {
		if f.Type == docType {
			for _, k := range f.Kinds {
				if !slices.Contains(offered, k) {
					out = append(out, k)
				}
			}
		}
	}
	return out
}

// offeredKinds are the auto kinds the workspace's plan includes now: the model is not asked for the others.
func offeredKinds(ctx context.Context, q store.Q, workspaceID string) ([]string, error) {
	var out []string
	for _, name := range autoKinds {
		if f := Kinds[name].Feature; f != "" {
			ok, err := q.FeatureAllowed(ctx, workspaceID, f)
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
		}
		out = append(out, name)
	}
	return out, nil
}

// autoSchema asks for the document type and one array per offered kind.
func autoSchema(kinds []string) map[string]any {
	types := []string{}
	for _, t := range documentTypes {
		types = append(types, t.Name)
	}
	props := map[string]any{"document_type": map[string]any{"type": "string", "enum": types}}
	for _, name := range kinds {
		props[name] = map[string]any{"type": "array", "items": Kinds[name].Schema}
	}
	return record(props)
}

// autoPrompt names the workspace (so "issued" and "received" can be told apart), the document types and each kind's rules.
func autoPrompt(seller store.Party, workspaceName string, kinds []string, extra map[string]string) string {
	var b strings.Builder
	name := cmp.Or(strings.TrimSpace(seller.Name), workspaceName)
	b.WriteString("You read business documents for Helvetly's import and decide what each one is. The workspace importing " +
		"them is the business \"" + name + "\"")
	if seller.VATNumber != nil && *seller.VATNumber != "" {
		b.WriteString(" (VAT " + *seller.VATNumber + ")")
	}
	b.WriteString(": a document this business issued is a sale, one addressed to it is a cost. When the document names " +
		"neither, treat its issuer as the workspace when it bills someone else.\n\nFirst choose document_type:\n")
	for _, t := range documentTypes {
		b.WriteString("- " + t.Name + ": " + t.Means + "\n")
	}
	b.WriteString("\nThen fill only the arrays that type holds and leave every other array empty:\n")
	for _, f := range fills {
		if gone := missing(f.Type, kinds); len(gone) > 0 {
			b.WriteString("- " + f.Type + ": nothing (this workspace's plan does not include " + strings.Join(gone, ", ") + ").\n")
		} else {
			b.WriteString("- " + f.Type + ": " + f.Text + ".\n")
		}
	}
	b.WriteString("- other: nothing.\n\nRules per array:\n")
	for _, kind := range kinds {
		b.WriteString("- " + kind + ": " + Kinds[kind].Prompt + extra[kind] + "\n")
	}
	return b.String()
}

func (s *Service) autoInstructions(ctx context.Context, ws store.Workspace, kinds []string) (string, error) {
	seller, err := invoices.SellerOf(ctx, s.db.Q, ws.ID)
	if err != nil {
		return "", err
	}
	extra, err := s.kindContext(ctx, ws.ID, kinds)
	if err != nil {
		return "", err
	}
	return autoPrompt(seller, ws.Name, kinds, extra), nil
}

// linkedClient: the record's client is not in the workspace yet but a client record of the same batch has its name,
// so creating that one first (commit order) resolves it.
func linkedClient(ctx context.Context, q store.Q, k Kind, batchID string, r store.ImportRecord) (bool, error) {
	name := rawText(r.Data["client_name"])
	if k.Name == "clients" || r.Issues["client_id"] == "" || rawText(r.Data["client_id"]) != "" || name == "" {
		return false, nil
	}
	return q.ImportNameTaken(ctx, batchID, "", "clients", "name", name)
}
