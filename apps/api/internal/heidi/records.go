package heidi

import (
	"fmt"
	"strings"
	"time"

	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/store"
)

// Record is one workspace record shown as a card under an answer; the platform opens it in place.
type Record struct {
	Kind     string    `json:"kind"` // client | invoice | engagement | session
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Detail   string    `json:"detail,omitempty"`
	Status   string    `json:"status,omitempty"` // client: active | inactive | draft; invoice: the platform's display status; session: its status
	Amount   string    `json:"amount,omitempty"` // invoice: what is still due, exact decimal
	Currency string    `json:"currency,omitempty"`
	Progress *Progress `json:"progress,omitempty"` // engagement: the current period
}

// Progress is how much of an engagement's current period is used.
type Progress struct {
	Used      string `json:"used"`
	Available string `json:"available"`
	Unit      string `json:"unit"`
}

// maxRecords bounds the cards of one answer, as the lists it answers are bounded.
const maxRecords = 20

// count is "1 client", "3 clients".
func count(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

// day is "30 Nov 2026" for an ISO date; anything else stays as it is.
func day(iso string) string {
	t, err := time.Parse(time.DateOnly, iso)
	if err != nil {
		return iso
	}
	return t.Format("2 Jan 2006")
}

func joinDetail(parts ...string) string {
	kept := parts[:0]
	for _, p := range parts {
		if p != "" {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, " · ")
}

func clientsLead(shown, total int) string {
	switch {
	case total == 0:
		return "You don’t have any clients yet. Add your first one in Clients."
	case shown < total:
		return fmt.Sprintf("Here are your %d most recent clients, out of %d.", shown, total)
	case total == 1:
		return "You have 1 client so far."
	default:
		return fmt.Sprintf("You have %d clients; here they are, newest first.", total)
	}
}

func clientRecord(c store.Client) Record {
	status := "active"
	if c.IsDraft {
		status = "draft"
	} else if !c.IsActive {
		status = "inactive"
	}
	return Record{Kind: "client", ID: c.ID, Title: c.Name, Status: status, Detail: joinDetail(fmt.Sprintf("Client %d", c.Number), textValue(c.City), textValue(c.Email))}
}

func invoicesLead(overdue bool, shown, total int) string {
	more := ""
	if shown < total {
		more = fmt.Sprintf(" Here are the %d most recent.", shown)
	}
	switch {
	case overdue && total == 0:
		return "No invoices are overdue right now."
	case overdue && total == 1:
		return "1 invoice is overdue."
	case overdue:
		return fmt.Sprintf("%d invoices are overdue.", total) + more
	case total == 0:
		return "You don’t have any invoices yet."
	case shown < total:
		return fmt.Sprintf("Here are your %d most recent invoices, out of %d.", shown, total)
	case total == 1:
		return "You have 1 invoice so far."
	default:
		return fmt.Sprintf("Here are your %d invoices, newest first.", total)
	}
}

// invoiceStatus is the status the platform shows for an invoice (displayStatus in src/lib/invoices.ts).
func invoiceStatus(inv store.InvoiceListItem) string {
	switch {
	case inv.Kind == "credit_note" && inv.Status == "draft":
		return "credit_draft"
	case inv.Kind == "credit_note":
		return "credit_applied"
	case inv.Status == "open" && inv.IsOverdue:
		return "overdue"
	}
	return inv.Status
}

func invoiceRecord(inv store.InvoiceListItem) Record {
	title, due := "Draft invoice", ""
	if inv.Number != nil {
		title = *inv.Number
	}
	if inv.DueDate != "" && inv.Status != "draft" {
		due = "due " + day(inv.DueDate)
	}
	amount := inv.AmountDue
	if inv.Status == "draft" || inv.Status == "paid" {
		amount = inv.PayableTotal
	}
	return Record{Kind: "invoice", ID: inv.ID, Title: title, Status: invoiceStatus(inv), Amount: amount.String(), Currency: inv.Currency, Detail: joinDetail(inv.Client.Name, due)}
}

func engagementsLead(toInvoice bool, query string, shown int) string {
	switch {
	case shown == 0 && toInvoice:
		return "Nothing is waiting to be invoiced right now."
	case shown == 0 && query != "":
		return fmt.Sprintf("No active engagement matches “%s”.", query)
	case shown == 0:
		return "You don’t have any active engagements."
	case toInvoice && shown == 1:
		return "1 engagement has work waiting to be invoiced."
	case toInvoice:
		return fmt.Sprintf("%d engagements have work waiting to be invoiced.", shown)
	case shown == 1:
		return "Here’s where your active engagement stands this period."
	default:
		return fmt.Sprintf("Here’s where your %d active engagements stand this period.", shown)
	}
}

func engagementRecord(e engagements.EngagementView) Record {
	r := Record{Kind: "engagement", ID: e.ID, Title: e.Title, Detail: e.Client.Name}
	if p := e.CurrentPeriod; p != nil {
		r.Detail = joinDetail(e.Client.Name, "period ends "+day(p.EndsOn))
		r.Progress = &Progress{Used: p.Used.String(), Available: p.Available.String(), Unit: textValue(e.Unit)}
	}
	return r
}

func documentsLead(shown, total int) string {
	switch {
	case total == 0:
		return "You don’t have any documents yet."
	case shown < total:
		return fmt.Sprintf("Here are your %d most recent documents, out of %d:\n", shown, total)
	case total == 1:
		return "You have 1 document:\n"
	default:
		return fmt.Sprintf("Here are your %d documents, newest first:\n", total)
	}
}
