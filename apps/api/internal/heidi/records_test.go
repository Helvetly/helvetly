package heidi

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestLeadsAreSentencesWithCorrectPlurals(t *testing.T) {
	for _, tc := range []struct{ got, want string }{
		{clientsLead(0, 0), "You don’t have any clients yet. Add your first one in Clients."},
		{clientsLead(1, 1), "You have 1 client so far."},
		{clientsLead(3, 3), "You have 3 clients; here they are, newest first."},
		{clientsLead(20, 45), "Here are your 20 most recent clients, out of 45."},
		{invoicesLead(true, 0, 0), "No invoices are overdue right now."},
		{invoicesLead(true, 1, 1), "1 invoice is overdue."},
		{invoicesLead(true, 4, 4), "4 invoices are overdue."},
		{invoicesLead(true, 20, 31), "31 invoices are overdue. Here are the 20 most recent."},
		{invoicesLead(false, 0, 0), "You don’t have any invoices yet."},
		{invoicesLead(false, 1, 1), "You have 1 invoice so far."},
		{invoicesLead(false, 2, 2), "Here are your 2 invoices, newest first."},
		{invoicesLead(false, 20, 22), "Here are your 20 most recent invoices, out of 22."},
		{engagementsLead(false, "", 0), "You don’t have any active engagements."},
		{engagementsLead(false, "müller", 0), "No active engagement matches “müller”."},
		{engagementsLead(true, "", 0), "Nothing is waiting to be invoiced right now."},
		{engagementsLead(false, "", 1), "Here’s where your active engagement stands this period."},
		{engagementsLead(false, "", 2), "Here’s where your 2 active engagements stand this period."},
		{engagementsLead(true, "", 1), "1 engagement has work waiting to be invoiced."},
		{engagementsLead(true, "", 3), "3 engagements have work waiting to be invoiced."},
		{documentsLead(0, 0), "You don’t have any documents yet."},
		{documentsLead(1, 1), "You have 1 document:\n"},
		{count(1, "expense", "expenses"), "1 expense"},
		{count(0, "expense", "expenses"), "0 expenses"},
		{day("2026-11-30"), "30 Nov 2026"},
		{day("soon"), "soon"},
	} {
		if tc.got != tc.want {
			t.Errorf("got %q, want %q", tc.got, tc.want)
		}
	}
}

func TestInvoiceRecordShowsThePlatformStatus(t *testing.T) {
	number := "2026-007"
	for _, tc := range []struct {
		inv            store.InvoiceListItem
		title, status  string
		detail, amount string
	}{
		{store.InvoiceListItem{Kind: "invoice", Status: "open", IsOverdue: true, Number: &number, DueDate: "2026-10-01", AmountDue: 12050, PayableTotal: 20000}, number, "overdue", "Keller AG · due 1 Oct 2026", "120.50"},
		{store.InvoiceListItem{Kind: "invoice", Status: "draft", DueDate: "2026-10-01", PayableTotal: 20000}, "Draft invoice", "draft", "Keller AG", "200.00"},
		{store.InvoiceListItem{Kind: "credit_note", Status: "draft"}, "Draft invoice", "credit_draft", "Keller AG", "0.00"},
		{store.InvoiceListItem{Kind: "credit_note", Status: "open", Number: &number}, number, "credit_applied", "Keller AG", "0.00"},
		{store.InvoiceListItem{Kind: "invoice", Status: "paid", Number: &number, DueDate: "2026-10-01", PayableTotal: 5000}, number, "paid", "Keller AG · due 1 Oct 2026", "50.00"},
	} {
		tc.inv.Client.Name = "Keller AG"
		r := invoiceRecord(tc.inv)
		if r.Kind != "invoice" || r.Title != tc.title || r.Status != tc.status || r.Detail != tc.detail || r.Amount != tc.amount {
			t.Errorf("%+v: got %+v", tc.inv, r)
		}
	}
}

func TestClientRecordStatus(t *testing.T) {
	city := "Zürich"
	for _, tc := range []struct {
		c      store.Client
		status string
	}{
		{store.Client{IsActive: true}, "active"},
		{store.Client{IsActive: false}, "inactive"},
		{store.Client{IsActive: true, IsDraft: true}, "draft"},
	} {
		tc.c.Name, tc.c.Number, tc.c.City = "John", 7, &city
		r := clientRecord(tc.c)
		if r.Status != tc.status || r.Title != "John" || r.Detail != "Client 7 · Zürich" {
			t.Errorf("got %+v, want status %s", r, tc.status)
		}
	}
}

// The screenshot that started this: "1 clients." over a bullet and an "Open John" button.
func TestRecentClientsAnswersWithASentenceAndRecordCards(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	if err := s.db.CreateClient(context.Background(), sess.Workspace.ID, "cli_john", map[string]any{"name": "John"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	w := chat(t, mux, "clients", "Show my recent clients")
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	body := w.Body.String()
	if !strings.Contains(body, `"value":"You have 1 client so far."`) || strings.Contains(body, `"type":"actions"`) {
		t.Fatalf("answer: %s", body)
	}
	if !strings.Contains(body, `"type":"records"`) || !strings.Contains(body, `{"kind":"client","id":"cli_john","title":"John"`) {
		t.Fatalf("records: %s", body)
	}
	w = call(mux, "GET", "/api/v1/heidi/conversations/clients", "", "")
	var transcript struct{ Data []Message }
	if err := json.Unmarshal(w.Body.Bytes(), &transcript); err != nil || len(transcript.Data) != 2 || len(transcript.Data[1].Records) != 1 {
		t.Fatalf("transcript keeps the records: %v %s", err, w.Body)
	}
}

func TestOverdueInvoicesWithNoneIsASentence(t *testing.T) {
	_, mux, _, _ := fixture(t)
	w := chat(t, mux, "invoices", "Which invoices are overdue?")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"value":"No invoices are overdue right now."`) || strings.Contains(w.Body.String(), `"type":"records"`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestModelInstructionsAskForReadableSentences(t *testing.T) {
	if !strings.Contains(instructions, formatting) || !strings.Contains(formatting, "correct singular and plural") {
		t.Fatal("the model instructions miss the formatting rules")
	}
}
