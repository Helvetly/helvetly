package invoices

import (
	"net/http"
	"strconv"
	"testing"
	"time"
)

func TestNumberSuggestion(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	year := strconv.Itoa(time.Now().UTC().Year())
	suggestion := func() *suggestionJSON {
		var got struct{ Data *suggestionJSON }
		e.do(b, "GET", "/api/v1/invoice-settings/number-suggestion", nil, http.StatusOK, &got)
		return got.Data
	}
	if s := suggestion(); s != nil {
		t.Fatalf("nothing imported: %+v", s)
	}
	e.fails(b, "POST", "/api/v1/invoice-settings/number-suggestion", nil, http.StatusConflict, "no_number_suggestion")

	for _, n := range []string{"FV/7/" + year, "FV/8/" + year} {
		id := e.draft(b, clientID, nil).ID
		if _, err := e.raw.Exec(t.Context(), `INSERT INTO documents (id, workspace_id, name, size, content_type, object_key, created_at, updated_at)
			SELECT 'doc_' || $1, workspace_id, 'original.pdf', 1, 'application/pdf', 'k/' || $1, now(), now() FROM invoices WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
		if _, err := e.raw.Exec(t.Context(), `UPDATE invoices SET origin = 'imported', status = 'open', number = $2, issue_date = $3,
			source_document_id = 'doc_' || $1 WHERE id = $1`, id, n, year+"-01-10"); err != nil {
			t.Fatal(err)
		}
	}
	if s := suggestion(); s == nil || s.Format != "FV/{N}/{YYYY}" || s.Last != 8 || s.Next != "FV/9/"+year {
		t.Fatalf("suggestion: %+v", s)
	}
	var set struct{ Data Settings }
	e.do(b, "POST", "/api/v1/invoice-settings/number-suggestion", nil, http.StatusOK, &set)
	if set.Data.NumberFormat != "FV/{N}/{YYYY}" {
		t.Fatalf("applied: %q", set.Data.NumberFormat)
	}
	if s := suggestion(); s != nil {
		t.Fatalf("after applying: %+v", s)
	}
	if inv := e.issued(b, clientID, nil); *inv.Number != "FV/9/"+year {
		t.Fatalf("next issued: %s", *inv.Number)
	}
	// once an invoice of its own is issued, the workspace's numbering is settled
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"number_format": "{YYYY}-{NNN}"}, http.StatusOK, nil)
	if s := suggestion(); s != nil {
		t.Fatalf("once an invoice is issued: %+v", s)
	}
	e.fails(b, "POST", "/api/v1/invoice-settings/number-suggestion", nil, http.StatusConflict, "no_number_suggestion")
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"number_format": "{NNN}"}, http.StatusUnprocessableEntity,
		"validation_failed", "number_format")
}
