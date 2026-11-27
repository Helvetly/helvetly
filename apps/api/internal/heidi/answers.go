package heidi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/imports"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

func md(s string) string {
	return strings.NewReplacer("\\", "\\\\", "|", "\\|", "\n", " ", "\r", " ", "*", "\\*", "[", "\\[", "]", "\\]", "`", "\\`").Replace(s)
}
func textValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// Only explicit import commands skip the model. Other languages and ambiguous requests use the classifier.
var importCommand = regexp.MustCompile(`^(?:(?:please|bitte|prosz[eę]|veuillez|per favore)[, ]+)?(?:import|importe|importa|importez|importieren|importiere|zaimportuj|importuj)(?:[[:space:][:punct:]]|$)`)

func importForm(sess store.Session) *Form {
	kinds := imports.Offered(func(resource string) bool { return permissions.Allows(sess.Role, sess.Scopes, "write:"+resource) })
	if len(kinds) == 0 {
		return nil
	}
	return &Form{ID: auth.NewID("frm"), Question: "What do the files contain?", Intent: "import", Fields: []Field{{Kind: "choice", Name: "kind", Label: "Import as", Options: kinds}}}
}

// The offline shortcuts answer only a whole known request; narrower filters, comparisons and multi-step tasks need the planner.
var localQuestion = regexp.MustCompile(`(?i)^(?:which invoices are overdue|(?:show |list )?(?:my |the )?(?:overdue|recent) invoices|how many hours (?:are )?left|what needs invoicing)[?!.]*$`)
var otherLocalQuestion = regexp.MustCompile(`(?i)^(?:(?:show |list )?(?:my |the )?recent (?:clients|documents)|which documents were added recently|summari[sz]e (?:this|the current) month(?:['’]s)? expenses|(?:help me )?create (?:a new|an) invoice|new invoice)[?!.]*$`)
var simpleScheduleQuestion = regexp.MustCompile(`(?i)^(?:what(?:'s|’s| is) on my schedule today|who cancel(?:l)?ed late this month)[?!.]*$`)
var compoundQuestion = regexp.MustCompile(`(?i)[;\n]|\b(?:and (?:then|show|email|send|create|list|delete|mark|add|tell|how|compare|what)|then|und dann)\b`)

func (s *Service) answer(ctx context.Context, q store.Q, sess store.Session, conversation, message string, hasFiles bool) (turn, error) {
	if pending, err := q.HeidiConfirmation(ctx, sess.Workspace.ID, sess.User.ID, conversation); err == nil && pending.ExpiresAt.After(s.now()) {
		current := true
		if pending.Kind == "workspace_operation" {
			var change proposedChange
			if err := json.Unmarshal(pending.Payload, &change); err != nil {
				return turn{}, err
			}
			current = change.available(sess)
		} else {
			current = permissions.Allows(sess.Role, sess.Scopes, "write:engagements")
		}
		if current {
			if pending.Kind == "select_engagement" {
				return s.chooseEngagement(ctx, q, sess, pending, message)
			}
			return turn{}, auth.Error(409, "confirmation_pending", "Answer the pending confirmation before sending another message.", nil)
		}
		// A proposal made with old permissions is no longer reviewable. Let the member start a fresh turn.
		if err := q.DeleteHeidiConfirmation(ctx, sess.Workspace.ID, sess.User.ID, conversation, pending.ID); err != nil {
			return turn{}, err
		}
	} else if err != nil && !errors.Is(err, store.ErrNotFound) {
		return turn{}, err
	}
	if localVerdict(message) == offTopic {
		return refusal(sess, message), nil
	}
	lower := strings.ToLower(message)
	if hasFiles && importCommand.MatchString(lower) {
		if form := importForm(sess); form != nil {
			return turn{Text: "I can import records from your files. Choose what they contain: the import opens on that page with the files, the AI model reads them there, and nothing is created until you review the records and choose Import.", Form: form}, nil
		}
	}
	if hasFiles {
		return turn{Provider: true}, nil
	}
	if strings.HasPrefix(lower, "import as:") {
		return turn{Text: "Review the records in the import on that page. Nothing is created until you choose Import."}, nil
	}
	if lang := latestInvoiceLanguage(message); lang != "" {
		return s.latestInvoice(ctx, q, sess, lang)
	}
	livePlanner := s.api != nil && s.provider != nil
	if livePlanner {
		consent, err := q.AIConsent(ctx, sess.Workspace.ID, sess.User.ID)
		if err != nil {
			return turn{}, err
		}
		livePlanner = consent.Granted
	}
	if compoundQuestion.MatchString(message) {
		return turn{Provider: true}, nil
	}
	if log, ok := parseLog(message); ok {
		return s.logAnswer(ctx, q, sess, log)
	}
	if kind, query, ok := sessionQuestion(message); ok && (!livePlanner || simpleScheduleQuestion.MatchString(message)) {
		return s.sessionAnswer(ctx, q, sess, kind, query)
	}
	if livePlanner && !localQuestion.MatchString(message) && !otherLocalQuestion.MatchString(message) {
		return turn{Provider: true}, nil
	}
	if strings.Contains(lower, "hours") && strings.Contains(lower, "left") || strings.Contains(lower, "stunden") && strings.Contains(lower, "übrig") || strings.Contains(lower, "needs invoicing") {
		if err := need(sess, "read:engagements"); err != nil {
			return turn{}, err
		}
		if s.engagements == nil {
			return turn{}, auth.Error(503, "unavailable", "Engagement assistance is unavailable.", nil)
		}
		query := ""
		if parts := strings.SplitN(lower, " for ", 2); len(parts) == 2 {
			query = strings.Trim(parts[1], " ?.!")
		}
		list, err := s.engagements.AssistantList(ctx, q, sess, query, strings.Contains(lower, "needs invoicing"))
		if err != nil {
			return turn{}, err
		}
		out := turn{memoryTopic: "list_engagements", Text: engagementsLead(strings.Contains(lower, "needs invoicing"), query, len(list)), Statuses: []string{"Looking up engagements"}}
		if strings.Contains(lower, "needs invoicing") {
			out.memoryTopic = "get_engagements_summary"
		}
		for i, e := range list {
			if i == maxRecords {
				out.Text += fmt.Sprintf(" Here are the first %d; open Engagements for the rest.", maxRecords)
				break
			}
			out.Records = append(out.Records, engagementRecord(e))
		}
		return out, nil
	}
	if strings.Contains(lower, "invoice") && (strings.Contains(lower, "overdue") || strings.Contains(lower, "recent")) {
		if err := need(sess, "read:invoices"); err != nil {
			return turn{}, err
		}
		f := store.InvoiceFilter{Sort: "-created_at"}
		if _, client, ok := strings.Cut(message, " for "); ok {
			f.Search = strings.Trim(client, " ?.!")
		}
		if strings.Contains(lower, "overdue") {
			f.Statuses = []string{"overdue"}
		}
		list, total, err := q.ListInvoices(ctx, sess.Workspace.ID, sess.Workspace.Today(s.now()), f, 20, 0)
		if err != nil {
			return turn{}, err
		}
		overdue := len(f.Statuses) > 0
		out := turn{memoryTopic: "list_invoices", Text: invoicesLead(overdue, len(list), total), Statuses: []string{invoiceLookup(f)}}
		if overdue {
			out.memoryTopic = "overdue_invoices"
		}
		if f.Search != "" && total == 0 {
			out.Text = "No invoices match " + md(f.Search) + "."
			if overdue {
				out.Text = "No overdue invoices match " + md(f.Search) + "."
			}
		}
		for _, inv := range list {
			out.Records = append(out.Records, invoiceRecord(inv))
		}
		if overdue && total > len(list) {
			out.Actions = []Action{{ID: "list_overdue_invoices", Label: "See all overdue invoices"}}
		}
		return out, nil
	}
	if strings.Contains(lower, "expense") && (strings.Contains(lower, "month") || strings.Contains(lower, "summari")) {
		if err := need(sess, "read:expenses"); err != nil {
			return turn{}, err
		}
		settings := struct {
			Currency string `json:"currency"`
		}{Currency: "CHF"}
		if _, err := q.InvoiceSettings(ctx, sess.Workspace.ID, &settings); err != nil {
			return turn{}, err
		}
		summary, err := q.ExpenseSummary(ctx, sess.Workspace.ID, settings.Currency, sess.Workspace.Today(s.now()))
		if err != nil {
			return turn{}, err
		}
		return turn{memoryTopic: "get_expense_summary", Statuses: []string{"Totalling this month’s expenses"}, Text: fmt.Sprintf("This month you recorded **%s %s** across %s, with **%s %s** of deductible input VAT booked. This reflects the tax treatment you recorded; it doesn’t establish a legal right to deduct.", summary.ThisMonth.Amount.String(), summary.Currency, count(summary.ThisMonth.Count, "expense", "expenses"), summary.InputVAT.Amount.String(), summary.Currency)}, nil
	}
	if strings.Contains(lower, "recent") && strings.Contains(lower, "client") {
		if err := need(sess, "read:clients"); err != nil {
			return turn{}, err
		}
		list, total, err := q.ListClients(ctx, sess.Workspace.ID, store.ClientFilter{Sort: "-created_at"}, 20, 0)
		if err != nil {
			return turn{}, err
		}
		out := turn{memoryTopic: "list_clients", Text: clientsLead(len(list), total), Statuses: []string{"Looking up recent clients"}}
		for _, client := range list {
			out.Records = append(out.Records, clientRecord(client))
		}
		return out, nil
	}
	if strings.Contains(lower, "document") && strings.Contains(lower, "recent") {
		if err := need(sess, "read:documents"); err != nil {
			return turn{}, err
		}
		list, total, err := q.ListDocuments(ctx, sess.Workspace.ID, store.DocumentFilter{Sort: "created_at", Desc: true}, 20, 0)
		if err != nil {
			return turn{}, err
		}
		out := turn{memoryTopic: "list_documents", Text: documentsLead(len(list), total), Statuses: []string{"Looking up recent documents"}}
		for _, doc := range list {
			out.Text += "\n- " + md(doc.Name)
		}
		return out, nil
	}
	if strings.Contains(lower, "new invoice") || strings.Contains(lower, "create an invoice") {
		if err := need(sess, "write:invoices"); err != nil {
			return turn{}, err
		}
		return turn{Text: "Open a draft invoice to choose the client, items and transaction’s tax treatment. Review it before issuing.", Actions: []Action{{ID: "create_invoice", Label: "New invoice"}}}, nil
	}
	return turn{Provider: true}, nil
}

func invoiceLookup(f store.InvoiceFilter) string {
	if len(f.Statuses) > 0 {
		return "Looking up overdue invoices"
	}
	return "Looking up recent invoices"
}

var logPattern = regexp.MustCompile(`(?i)^\s*(?:please\s+)?(?:log|book|add|trag(?:e)?|buche?|erfasse?)\s+(\d+(?:[.,]\d+)?)\s*(h|hrs?|hours?|stunden?|std\.?|days?|tage?n?|d)?\s+(?:for|to|on|für|fuer|bei)\s+(.+?)(?:\s+ein)?\s*(?::\s*(.+))?$`)

type logRequest struct {
	Quantity       string      `json:"quantity"`
	Query          string      `json:"query"`
	Note           *string     `json:"note"`
	Unit           string      `json:"unit"`
	Date           string      `json:"date"`
	EngagementID   string      `json:"engagement_id"`
	EngagementUnit string      `json:"engagement_unit"`
	Title          string      `json:"title"`
	Client         string      `json:"client"`
	Choices        []logChoice `json:"choices,omitempty"`
}
type logChoice struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

func parseLog(message string) (logRequest, bool) {
	m := logPattern.FindStringSubmatch(message)
	if m == nil {
		return logRequest{}, false
	}
	l := logRequest{Quantity: strings.ReplaceAll(m[1], ",", "."), Query: strings.TrimSpace(m[3])}
	if m[4] != "" {
		note := strings.TrimSpace(m[4])
		l.Note = &note
	}
	if m[2] != "" {
		l.Unit = "hour"
		if strings.HasPrefix(strings.ToLower(m[2]), "d") || strings.HasPrefix(strings.ToLower(m[2]), "tag") {
			l.Unit = "day"
		}
	}
	return l, true
}
func (s *Service) logAnswer(ctx context.Context, q store.Q, sess store.Session, request logRequest) (turn, error) {
	if err := need(sess, "write:engagements"); err != nil {
		return turn{}, err
	}
	quantity, ok := invoicecalc.ParseQuantity(request.Quantity)
	if !ok || quantity <= 0 || quantity > 10_000_000 {
		return turn{}, invalid("Log a quantity above zero and up to 10,000 with at most three decimal places.")
	}
	if request.Note != nil && utf8.RuneCountInString(*request.Note) > 500 {
		return turn{}, invalid("The work note must have at most 500 characters.")
	}
	if s.engagements == nil {
		return turn{}, auth.Error(503, "unavailable", "Engagement assistance is unavailable.", nil)
	}
	list, err := s.engagements.AssistantList(ctx, q, sess, request.Query, false)
	if err != nil {
		return turn{}, err
	}
	if len(list) == 0 {
		return turn{Text: "No active engagement matches that client or title. Create one in Engagements before recording work."}, nil
	}
	request.Date = sess.Workspace.Today(s.now())
	if len(list) > 1 {
		options := []string{}
		for _, e := range list {
			label := fmt.Sprintf("%s (#%d)", e.Title, e.Number)
			options = append(options, label)
			request.Choices = append(request.Choices, logChoice{ID: e.ID, Label: label})
		}
		id := auth.NewID("cnf")
		payload, err := json.Marshal(request)
		if err != nil {
			return turn{}, err
		}
		return turn{Text: "Choose the engagement before I ask you to confirm the entry.", Form: &Form{ID: id, Question: "Which engagement should receive this work?", Fields: []Field{{Kind: "choice", Name: "Engagement", Label: "Engagement", Options: options}}}, Pending: &store.HeidiConfirmation{ID: id, Kind: "select_engagement", Payload: payload, ExpiresAt: s.now().Add(5 * time.Minute)}}, nil
	}
	return s.prepareLog(list[0], request)
}
func (s *Service) prepareLog(e engagements.EngagementView, request logRequest) (turn, error) {
	if request.Unit != "" && textValue(e.Unit) != request.Unit {
		return turn{Text: fmt.Sprintf("%s is tracked in %s. Send the quantity in that unit.", md(e.Title), md(textValue(e.Unit)))}, nil
	}
	request.EngagementID = e.ID
	request.EngagementUnit = textValue(e.Unit)
	request.Title = e.Title
	request.Client = e.Client.Name
	request.Choices = nil
	payload, err := json.Marshal(request)
	if err != nil {
		return turn{}, err
	}
	id := auth.NewID("cnf")
	return turn{Text: "I need your approval before recording this work.", Confirmation: confirmationFor(id, request), Pending: &store.HeidiConfirmation{ID: id, Kind: "log_entry", Payload: payload, ExpiresAt: s.now().Add(5 * time.Minute)}}, nil
}
func confirmationFor(id string, r logRequest) *Confirmation {
	return &Confirmation{Type: "confirmation", ID: id, Title: fmt.Sprintf("Log %s %s for %s?", r.Quantity, r.EngagementUnit, r.Client), Body: fmt.Sprintf("Add this quantity to %s, dated %s. Note: %s", r.Title, r.Date, textValue(r.Note)), ConfirmLabel: "Log it", Tone: "default"}
}
func (s *Service) chooseEngagement(ctx context.Context, q store.Q, sess store.Session, pending store.HeidiConfirmation, message string) (turn, error) {
	if err := need(sess, "write:engagements"); err != nil {
		return turn{}, err
	}
	if strings.EqualFold(strings.TrimSpace(message), "cancel") {
		return turn{Text: "Cancelled. No work was recorded.", ConsumePendingID: pending.ID}, nil
	}
	var request logRequest
	if err := json.Unmarshal(pending.Payload, &request); err != nil {
		return turn{}, err
	}
	choice := strings.TrimSpace(strings.TrimPrefix(message, "Engagement:"))
	for _, c := range request.Choices {
		if choice == c.Label {
			list, err := s.engagements.AssistantList(ctx, q, sess, "", false)
			if err != nil {
				return turn{}, err
			}
			for _, e := range list {
				if e.ID == c.ID {
					out, err := s.prepareLog(e, request)
					out.ConsumePendingID = pending.ID
					return out, err
				}
			}
			return turn{}, auth.Error(409, "engagement_inactive", "That engagement is no longer active.", nil)
		}
	}
	return turn{}, invalid("Choose one of the offered engagements, or send cancel.")
}
