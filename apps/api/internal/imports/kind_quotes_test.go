package imports

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// quoteData: a quote record as the engine hands it over; extra replaces (null removes) fields.
func quoteData(t *testing.T, extra string) Data {
	t.Helper()
	d := invoiceData(t, `{"number": "Q-2025-017", "due_date": null, "valid_until": "2025-10-31"}`)
	var m map[string]json.RawMessage
	if err := json.Unmarshal([]byte(extra), &m); err != nil {
		t.Fatal(err)
	}
	for k, v := range m {
		if string(v) == "null" {
			delete(d, k)
		} else {
			d[k] = v
		}
	}
	return d
}

func TestQuotesKindCheck(t *testing.T) {
	st, sess, _ := invoiceStore(t)
	ctx := context.Background()
	// Q-2025-001 is taken in workspace A; Q-2025-002 only in workspace B.
	for _, c := range []struct{ ws, client, number string }{{"wsp_a", "cli_a", "Q-2025-001"}, {"wsp_b", "cli_b", "Q-2025-002"}} {
		data := quoteData(t, `{"number": "`+c.number+`", "client_id": "`+c.client+`"}`)
		s := sess
		s.Workspace.ID = c.ws
		if c.ws == "wsp_b" { // B has no VAT settings for the Swiss-rate line: an exempt line keeps it valid
			data = quoteData(t, `{"number": "`+c.number+`", "client_id": "`+c.client+`", "total": null,
				"lines": [{"description": "x", "quantity": "1", "unit_price": "10", "vat_category": "E"}]}`)
		}
		if _, err := quotesKind.Create(ctx, st.Q, s, data, Source{}); err != nil {
			t.Fatalf("seed %s: %v", c.number, err)
		}
	}
	tests := []struct {
		name  string
		extra string
		want  []string
	}{
		{"clean, sent by its number", `{}`, nil},
		{"draft without a number", `{"number": null, "status": "draft"}`, nil},
		{"no number, no status: draft", `{"number": null}`, nil},
		{"accepted", `{"status": "accepted"}`, nil},
		{"declined", `{"status": "declined"}`, nil},
		{"unknown status", `{"status": "won"}`, []string{"status"}},
		{"status not a string", `{"status": true}`, []string{"status"}},
		{"draft with a number", `{"status": "draft"}`, []string{"status"}},
		{"sent without a number", `{"number": null, "status": "sent"}`, []string{"number"}},
		{"valid before its date", `{"valid_until": "2025-09-30"}`, []string{"valid_until"}},
		{"valid_until not a date", `{"valid_until": "31.10.2025"}`, []string{"valid_until"}},
		{"no valid_until: 30 days", `{"valid_until": null}`, nil},
		{"number used in the workspace", `{"number": "Q-2025-001"}`, []string{"number"}},
		{"number used only in another workspace", `{"number": "Q-2025-002"}`, nil},
		{"no client matches", `{"client_name": "Unbekannt GmbH"}`, []string{"client_id"}},
		{"another workspace's client", `{"client_id": "cli_b"}`, []string{"client_id"}},
		{"stated total wrong", `{"total": "999.00"}`, []string{"total"}},
		{"no lines", `{"lines": []}`, []string{"lines"}},
		{"non-Swiss rate", `{"total": null, "lines": [{"description": "x", "quantity": "1", "unit_price": "10", "vat_rate": "19"}]}`, []string{"lines.0.vat_rate"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := quotesKind.Check(ctx, st.Q, "wsp_a", quoteData(t, tt.extra))
			if err != nil {
				t.Fatal(err)
			}
			var fields []string
			for k := range got {
				fields = append(fields, k)
			}
			slices.Sort(fields)
			if !slices.Equal(fields, tt.want) {
				t.Fatalf("issues %v, want %v", got, tt.want)
			}
		})
	}
}

func TestQuotesKindCreate(t *testing.T) {
	st, sess, clientID := invoiceStore(t)
	ctx := context.Background()
	var admitted []string
	st.SetAdmission(func(_ context.Context, _ store.Q, workspaceID, resource string, _ int64) error {
		admitted = append(admitted, workspaceID+":"+resource)
		return nil
	})
	tests := []struct {
		name, extra, status string
		number              *string
		decided             bool
	}{
		{"sent", `{}`, "sent", new("Q-2025-017"), false},
		{"accepted", `{"number": "Q-2025-018", "status": "accepted"}`, "accepted", new("Q-2025-018"), true},
		{"declined", `{"number": "Q-2025-019", "status": "declined"}`, "declined", new("Q-2025-019"), true},
		{"draft", `{"number": null, "valid_until": null}`, "draft", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, err := quotesKind.Create(ctx, st.Q, sess, quoteData(t, tt.extra), Source{})
			if err != nil {
				t.Fatal(err)
			}
			q, err := st.Quote(ctx, "wsp_a", id, "2025-10-02", false)
			if err != nil {
				t.Fatal(err)
			}
			if q.Status != tt.status || q.ClientID != clientID || q.Revision != 1 {
				t.Fatalf("status %s client %s revision %d", q.Status, q.ClientID, q.Revision)
			}
			if (q.Number == nil) != (tt.number == nil) || (q.Number != nil && *q.Number != *tt.number) {
				t.Errorf("number %v, want %v", q.Number, tt.number)
			}
			if (q.SentAt != nil) != (tt.status != "draft") {
				t.Errorf("sent_at %v", q.SentAt)
			}
			if (q.DecidedAt != nil) != tt.decided || (tt.decided && (q.DecidedBy == nil || *q.DecidedBy != "staff")) {
				t.Errorf("decided %v by %v", q.DecidedAt, q.DecidedBy)
			}
			// the draft states no valid_until: 30 days from 2025-10-01
			if q.IssueDate != "2025-10-01" || q.ValidUntil != "2025-10-31" || q.Currency != "CHF" || q.Note != nil {
				t.Errorf("dates %s %s currency %s note %v", q.IssueDate, q.ValidUntil, q.Currency, q.Note)
			}
			if len(q.Lines) != 1 || q.NetTotal != 100000 || q.Total != 108100 {
				t.Errorf("lines %d net %d total %d", len(q.Lines), q.NetTotal, q.Total)
			}
		})
	}
	if n := len(slices.DeleteFunc(slices.Clone(admitted), func(s string) bool { return s != "wsp_a:quotes_retained" })); n != len(tests) {
		t.Errorf("quotes_retained admitted %d times, want %d (%v)", n, len(tests), admitted)
	}

	// The plan's quote limit refuses the import.
	st.SetAdmission(func(_ context.Context, _ store.Q, _, resource string, _ int64) error {
		if resource == "quotes_retained" {
			return store.ErrAdmissionDenied
		}
		return nil
	})
	if _, err := quotesKind.Create(ctx, st.Q, sess, quoteData(t, `{"number": "Q-2025-020"}`), Source{}); !errors.Is(err, store.ErrAdmissionDenied) {
		t.Fatalf("over the limit: %v", err)
	}
	st.SetAdmission(nil)

	// A record with issues never reaches the database.
	if _, err := quotesKind.Create(ctx, st.Q, sess, quoteData(t, `{"number": "Q-2025-017"}`), Source{}); err == nil {
		t.Fatal("a taken number was imported")
	}
	if list, err := st.Quotes(ctx, "wsp_b", "", "2025-10-02"); err != nil || len(list) != 0 {
		t.Fatalf("another workspace sees the quotes: %v %v", list, err)
	}
}

func TestQuotesKindDuplicate(t *testing.T) {
	st, sess, _ := invoiceStore(t)
	ctx := context.Background()
	if d, err := quotesKind.Duplicate(ctx, st.Q, "wsp_a", quoteData(t, `{}`)); err != nil || d != nil {
		t.Fatalf("before any import: %v %v", d, err)
	}
	id, err := quotesKind.Create(ctx, st.Q, sess, quoteData(t, `{}`), Source{})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.CreateClient(ctx, "wsp_a", "cli_other", map[string]any{"name": "Andere GmbH"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name, ws, extra string
		want            bool
	}{
		{"same number and client", "wsp_a", `{}`, true},
		{"same number, other client", "wsp_a", `{"client_id": "cli_other"}`, false},
		{"other number", "wsp_a", `{"number": "Q-2025-099"}`, false},
		{"no number", "wsp_a", `{"number": null}`, false},
		{"no client matched", "wsp_a", `{"client_name": "Unbekannt GmbH"}`, false},
		{"another workspace", "wsp_b", `{"client_id": "cli_b"}`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d, err := quotesKind.Duplicate(ctx, st.Q, tt.ws, quoteData(t, tt.extra))
			if err != nil {
				t.Fatal(err)
			}
			if !tt.want {
				if d != nil {
					t.Fatalf("want none, got %+v", d)
				}
				return
			}
			if d == nil || d.ID != id || d.Label != "Q-2025-017" || d.Reason != "same quote number" {
				t.Fatalf("got %+v, want %s", d, id)
			}
		})
	}
}
