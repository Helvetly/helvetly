package templates

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// fakeModel answers every field it is asked ("id\tlabel" lines) with "AI " + its label, plus one field never asked.
type fakeModel struct {
	mu   sync.Mutex
	reqs []aimodel.Request
}

func (f *fakeModel) Card() aimodel.RateCard                                      { return aimodel.Cards[aimodel.DefaultModel] }
func (f *fakeModel) InputTokens(context.Context, aimodel.Request) (int64, error) { return 100, nil }
func (f *fakeModel) Answer(_ context.Context, r aimodel.Request) (aimodel.Reply, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reqs = append(f.reqs, r)
	fields := []map[string]string{{"id": "tfd_not_asked", "value": "x"}}
	_, asked, _ := strings.Cut(r.Message, "Fields to fill (id\tlabel):\n")
	for line := range strings.Lines(asked) {
		if id, label, ok := strings.Cut(strings.TrimSpace(line), "\t"); ok {
			fields = append(fields, map[string]string{"id": id, "value": "AI " + label})
		}
	}
	b, _ := json.Marshal(map[string]any{"fields": fields})
	tokens := int64(140)
	return aimodel.Reply{Text: string(b), Tokens: &tokens, Usage: &aimodel.Usage{Input: 100, Output: 40, Model: aimodel.DefaultModel, Tier: "default"}}, nil
}

func (f *fakeModel) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.reqs)
}

// withAI turns the model on; allowance nil is unlimited.
func (e *env) withAI(allowance aimodel.Allowance) *fakeModel {
	m := &fakeModel{}
	e.svc.SetAI(m, aimodel.Budget{DB: e.st, Pool: aimodel.PoolAutomation, Allowance: allowance, Now: func() time.Time { return time.Now().UTC() }})
	return m
}

func (e *env) consent(b *browser, granted bool) {
	e.t.Helper()
	if err := e.st.SetAIConsent(context.Background(), b.workspace, b.user, granted, time.Now()); err != nil {
		e.t.Fatal(err)
	}
}

// quote: a sent quote 2026/Q/001 of CHF 5'405.00 for a new client with a UID.
func (e *env) quote(b *browser) (quoteID, clientID string) {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	clientID = auth.NewID("cli")
	if err := e.st.CreateClient(ctx, b.workspace, clientID, map[string]any{"name": "Müller AG", "vat_number": "CHE-123.456.789 MWST",
		"street": "Seestrasse", "street_number": "1", "zip": "8000", "city": "Zürich", "country": "CH"}, now); err != nil {
		e.t.Fatal(err)
	}
	number := "2026/Q/001"
	q := store.Quote{ID: auth.NewID("quo"), Number: &number, Revision: 1, Status: "sent", ClientID: clientID, IssueDate: "2026-03-01",
		ValidUntil: "2099-03-31", Currency: "CHF", Language: "de", VATMode: "exclusive",
		Lines: []store.InvoiceLine{{ID: auth.NewID("lin"), Position: 1, Description: "Website", Quantity: 1000, UnitPrice: 500000,
			VATCategory: "S", VATRate: 810, Amount: 500000}},
		VATBreakdown: []invoicecalc.Group{}, Subtotal: 500000, NetTotal: 500000, VATTotal: 40500, Total: 540500}
	if err := e.st.SaveQuote(ctx, b.workspace, q, now); err != nil {
		e.t.Fatal(err)
	}
	return q.ID, clientID
}

// contractTemplate: client data, three fields named after quote facts and one only the model can fill.
func (e *env) contractTemplate(b *browser) template {
	e.t.Helper()
	field := func(kind, label string, y float64) obj {
		var l any
		if label != "" {
			l = label
		}
		return obj{"kind": kind, "signer": nil, "page": 1, "x": 0.1, "y": y, "w": 0.4, "h": 0.03, "label": l}
	}
	doc := e.document(b, samplePDF(e.t, 1), "application/pdf")
	return e.create(b, obj{"name": "Service contract", "document_id": doc, "signers": []obj{}, "fields": []obj{
		field("client.name", "", 0.1), field("custom", "Quote no.", 0.2), field("custom", "Gesamtbetrag", 0.3),
		field("custom", "Client UID", 0.4), field("custom", "Start date", 0.5)}})
}

type draftOut struct {
	Fields  map[string]string `json:"fields"`
	Sources map[string]string `json:"sources"`
	AI      string            `json:"ai"`
	Quote   struct{ ID, Number string }
}

func (e *env) draft(b *browser, quoteID string, body obj) draftOut {
	e.t.Helper()
	var out struct{ Data draftOut }
	e.do(b, "POST", "/api/v1/quotes/"+quoteID+"/contract-draft", body, http.StatusOK, &out)
	return out.Data
}

// fieldByLabel: the id of the template's custom field with that label.
func fieldByLabel(tpl template, label string) string {
	for _, f := range tpl.Fields {
		if f.Label != nil && *f.Label == label {
			return f.ID
		}
	}
	return ""
}

func TestContractDraft(t *testing.T) {
	cases := []struct {
		name      string
		ai        bool   // the model is configured
		consent   bool   // the person approved AI use
		useAI     any    // the request's use_ai
		allowance int64  // the automation pool's monthly tokens; -1 unlimited
		wantAI    string // the draft's AI outcome
		calls     int
	}{
		{"model fills the rest", true, true, nil, -1, "used", 1},
		{"no model on this server", false, true, nil, -1, "unavailable", 0},
		{"asked without AI", true, false, false, -1, "skipped", 0},
		{"pool used up", true, true, true, 0, "quota_exceeded", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t, false)
			b := e.workspace()
			e.consent(b, tc.consent)
			var model *fakeModel
			if tc.ai {
				var allowance aimodel.Allowance
				if tc.allowance >= 0 {
					allowance = func(context.Context, store.Q, string) (int64, error) { return tc.allowance, nil }
				}
				model = e.withAI(allowance)
			}
			quoteID, _ := e.quote(b)
			tpl := e.contractTemplate(b)
			body := obj{"template_id": tpl.ID}
			if tc.useAI != nil {
				body["use_ai"] = tc.useAI
			}
			got := e.draft(b, quoteID, body)

			number, total, uid, start := fieldByLabel(tpl, "Quote no."), fieldByLabel(tpl, "Gesamtbetrag"),
				fieldByLabel(tpl, "Client UID"), fieldByLabel(tpl, "Start date")
			// matched by name whatever the model does
			if got.Fields[number] != "2026/Q/001" || got.Fields[total] != "CHF 5'405.00" || got.Fields[uid] != "CHE-123.456.789 MWST" ||
				got.Sources[number] != "quote" || got.Sources[total] != "quote" || got.Sources[uid] != "quote" {
				t.Fatalf("matched fields: %+v", got)
			}
			if got.AI != tc.wantAI || got.Quote.ID != quoteID || got.Quote.Number != "2026/Q/001" {
				t.Fatalf("draft: %+v", got)
			}
			if tc.wantAI == "used" {
				if got.Fields[start] != "AI Start date" || got.Sources[start] != "ai" || len(got.Fields) != 4 {
					t.Fatalf("the model fills only the fields asked: %+v", got)
				}
				msg := model.reqs[0].Message
				if !strings.Contains(msg, "quote.number: 2026/Q/001") || !strings.Contains(msg, start+"\tStart date") ||
					strings.Contains(msg, number+"\t") {
					t.Fatalf("the model gets the facts and only the unmatched fields:\n%s", msg)
				}
				if n := e.count(`SELECT count(*) FROM ai_calls WHERE workspace_id = $1 AND pool = 'automation' AND kind = 'contract'`, b.workspace); n != 1 {
					t.Fatalf("automation pool calls: %d", n)
				}
			} else if _, ok := got.Fields[start]; ok {
				t.Fatalf("without the model the rest stays empty: %+v", got)
			}
			if model != nil && model.calls() != tc.calls {
				t.Fatalf("model calls: %d, want %d", model.calls(), tc.calls)
			}
			if n := e.count(`SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'quote.contract_drafted' AND subject_id = $2`,
				b.workspace, quoteID); n != 1 {
				t.Fatalf("audited %d times", n)
			}
		})
	}
}

func TestContractDraftRefusals(t *testing.T) {
	e := newEnv(t, false)
	b := e.workspace()
	model := e.withAI(nil)
	quoteID, _ := e.quote(b)
	tpl := e.contractTemplate(b)

	// the person has not approved AI use: refused before the model is asked
	e.consent(b, false)
	if got := e.fail(b, "POST", "/api/v1/quotes/"+quoteID+"/contract-draft", obj{"template_id": tpl.ID}, http.StatusForbidden); got.Code != "ai_consent_required" {
		t.Fatalf("consent: %+v", got)
	}
	if model.calls() != 0 {
		t.Fatal("the model was asked without approval")
	}

	// another workspace's quote and template are not found
	other := e.workspace()
	e.consent(other, true)
	otherQuote, _ := e.quote(other)
	e.fail(b, "POST", "/api/v1/quotes/"+otherQuote+"/contract-draft", obj{"template_id": tpl.ID}, http.StatusNotFound)
	if got := e.fail(other, "POST", "/api/v1/quotes/"+otherQuote+"/contract-draft", obj{"template_id": tpl.ID}, http.StatusUnprocessableEntity); got.Details.Fields["template_id"] == "" {
		t.Fatalf("another workspace's template: %+v", got)
	}

	// a plan without document templates
	e.st.SetFeatureGate(func(_ context.Context, _ store.Q, _, feature string) error {
		if feature == store.FeatureDocumentTemplates {
			return auth.Error(http.StatusPaymentRequired, "feature_not_in_plan", "Not in your plan.", nil)
		}
		return nil
	})
	if got := e.fail(b, "POST", "/api/v1/quotes/"+quoteID+"/contract-draft", obj{"template_id": tpl.ID, "use_ai": false}, http.StatusPaymentRequired); got.Code != "feature_not_in_plan" {
		t.Fatalf("plan gate: %+v", got)
	}
	if model.calls() != 0 {
		t.Fatal("the model was asked")
	}
}

func TestGenerateLinksQuote(t *testing.T) {
	e := newEnv(t, false)
	b := e.workspace()
	quoteID, clientID := e.quote(b)
	tpl := e.create(b, templateInput(e.document(b, samplePDF(t, 2), "application/pdf")))

	body := generate(clientID, tpl, obj{"type": "save"})
	body["quote_id"] = quoteID
	first := e.generate(b, tpl, body)
	second := e.generate(b, tpl, body) // made again: both stay linked, newest first

	// numbered per workspace and year (C-<year>-<seq> without a workspace format), the number as the file's name
	year := time.Now().UTC().Year()
	want1, want2 := fmt.Sprintf("C-%d-001", year), fmt.Sprintf("C-%d-002", year)
	if first.ContractNumber == nil || *first.ContractNumber != want1 || first.Document.Name != want1+".pdf" ||
		second.ContractNumber == nil || *second.ContractNumber != want2 {
		t.Fatalf("numbers: %+v %+v", first, second)
	}
	if plain := e.generate(b, tpl, generate(clientID, tpl, obj{"type": "save"})); plain.ContractNumber != nil {
		t.Fatalf("a document without a quote is no contract: %+v", plain)
	}
	var list struct{ Data []store.QuoteContract }
	e.do(b, "GET", "/api/v1/quotes/"+quoteID+"/contracts", nil, http.StatusOK, &list)
	if len(list.Data) != 2 || list.Data[0].DocumentID != second.Document.ID || list.Data[1].DocumentID != first.Document.ID ||
		list.Data[0].Signature != nil || list.Data[0].Number != want2 || list.Data[0].Name != want2+".pdf" {
		t.Fatalf("contracts: %+v", list.Data)
	}
	var counts struct{ Data map[string]int }
	e.do(b, "GET", "/api/v1/quotes/contract-counts", nil, http.StatusOK, &counts)
	if counts.Data[quoteID] != 2 {
		t.Fatalf("counts: %+v", counts.Data)
	}
	// filed in Clients/<client>/Documents/<year>/Contracts, a system folder of kind contracts
	if n := e.count(`SELECT count(*) FROM documents d JOIN document_folders c ON c.id = d.folder_id AND c.system_kind = 'contracts'
		AND c.name = 'Contracts' JOIN document_folders y ON y.id = c.parent_id AND y.system_kind = 'year'
		JOIN document_folders t ON t.id = y.parent_id AND t.system_kind = 'documents'
		JOIN document_folders cl ON cl.id = t.parent_id AND cl.system_kind = 'client' AND cl.system_ref = $2
		WHERE d.workspace_id = $1`, b.workspace, clientID); n != 2 {
		t.Fatalf("contracts in the Contracts folder: %d", n)
	}
	// the document names its quote among its links
	doc, err := e.st.Document(context.Background(), b.workspace, first.Document.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(doc.Links, func(l store.DocumentLink) bool {
		return l.Type == "quote" && l.ID == quoteID && l.Label == "2026/Q/001"
	}) {
		t.Fatalf("links: %+v", doc.Links)
	}
	// another workspace sees none of it
	other := e.workspace()
	e.fail(other, "GET", "/api/v1/quotes/"+quoteID+"/contracts", nil, http.StatusNotFound)
	counts.Data = nil
	e.do(other, "GET", "/api/v1/quotes/contract-counts", nil, http.StatusOK, &counts)
	if len(counts.Data) != 0 {
		t.Fatalf("other workspace counts: %+v", counts.Data)
	}
	// deleting the document unlinks it
	if _, err := e.raw.Exec(context.Background(), `DELETE FROM documents WHERE id = $1`, second.Document.ID); err != nil {
		t.Fatal(err)
	}
	e.do(b, "GET", "/api/v1/quotes/"+quoteID+"/contracts", nil, http.StatusOK, &list)
	if len(list.Data) != 1 || list.Data[0].DocumentID != first.Document.ID {
		t.Fatalf("after delete: %+v", list.Data)
	}

	// a quote of another client, or of another workspace, is refused before anything is filed
	body["client_id"] = e.client(b)
	if got := e.fail(b, "POST", "/api/v1/templates/"+tpl.ID+"/documents", body, http.StatusUnprocessableEntity); got.Details.Fields["quote_id"] == "" {
		t.Fatalf("another client: %+v", got)
	}
	otherQuote, _ := e.quote(e.workspace())
	body["client_id"], body["quote_id"] = clientID, otherQuote
	if got := e.fail(b, "POST", "/api/v1/templates/"+tpl.ID+"/documents", body, http.StatusUnprocessableEntity); got.Details.Fields["quote_id"] == "" {
		t.Fatalf("another workspace: %+v", got)
	}
}

// Contracts made at once each take their own number, without gaps; another workspace counts apart.
func TestContractNumbersConcurrent(t *testing.T) {
	e := newEnv(t, false)
	ws, other := e.workspace().workspace, e.workspace().workspace
	ctx := context.Background()
	const n = 12
	got := make(chan int64, n)
	var wg sync.WaitGroup
	for range n {
		wg.Go(func() {
			if err := e.st.Tx(ctx, func(q store.Q) error {
				seq, err := q.NextContractNumber(ctx, ws, 2026)
				got <- seq
				return err
			}); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	close(got)
	var seqs []int64
	for s := range got {
		seqs = append(seqs, s)
	}
	slices.Sort(seqs)
	for i, s := range seqs {
		if s != int64(i+1) {
			t.Fatalf("sequence: %v", seqs)
		}
	}
	if next, err := e.st.PeekContractNumber(ctx, ws, 2026); err != nil || next != n+1 {
		t.Fatalf("peek: %d, %v", next, err)
	}
	if next, err := e.st.PeekContractNumber(ctx, other, 2026); err != nil || next != 1 {
		t.Fatalf("other workspace: %d, %v", next, err)
	}
	if next, err := e.st.PeekContractNumber(ctx, ws, 2027); err != nil || next != 1 {
		t.Fatalf("next year: %d, %v", next, err)
	}
}
