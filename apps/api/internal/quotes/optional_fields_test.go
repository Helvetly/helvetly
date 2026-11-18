package quotes

import (
	"net/http"
	"testing"
)

// A quote takes the invoice's optional client and contract numbers, and the invoice made from it keeps them.
func TestQuoteOptionalFieldsCarryToInvoice(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	q := e.draft(b, e.client(b))
	path := "/api/v1/quotes/" + q.ID
	e.fails(b, "PATCH", path, map[string]any{"contract_document_id": "doc_missing"}, 422, "validation_failed", "contract_document_id")
	q = e.quote(b, "PATCH", path, map[string]any{"client_number_display": "", "contract_reference": "C23-25-CP2302"}, http.StatusOK)
	if q.ClientNumberDisplay == nil || *q.ClientNumberDisplay != "" || q.ContractReference == nil || *q.ContractReference != "C23-25-CP2302" {
		t.Fatalf("quote: %v %v", q.ClientNumberDisplay, q.ContractReference)
	}
	e.quote(b, "POST", path+"/send", map[string]any{}, http.StatusOK)
	e.quote(b, "POST", path+"/accept", map[string]any{}, http.StatusOK)
	q = e.quote(b, "POST", path+"/invoice", map[string]any{}, http.StatusCreated)
	var inv struct {
		Data struct {
			ClientNumberDisplay *string `json:"client_number_display"`
			ContractReference   *string `json:"contract_reference"`
		}
	}
	e.do(b, "GET", "/api/v1/invoices/"+q.Invoice.ID, nil, http.StatusOK, &inv)
	if inv.Data.ClientNumberDisplay == nil || *inv.Data.ClientNumberDisplay != "" || inv.Data.ContractReference == nil ||
		*inv.Data.ContractReference != "C23-25-CP2302" {
		t.Fatalf("invoice: %v %v", inv.Data.ClientNumberDisplay, inv.Data.ContractReference)
	}
}
