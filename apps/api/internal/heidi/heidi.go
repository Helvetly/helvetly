// Package heidi serves workspace assistance. Business operations are deterministic;
// an optional text-only provider can explain current user messages and attachments.
package heidi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

type Auth interface {
	CookieSession(context.Context, store.Q, *http.Request) (store.Session, error)
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}
type Storage interface {
	Put(context.Context, string, io.Reader, int64, string, string) error
	Open(context.Context, string) (io.ReadSeekCloser, error)
	Delete(context.Context, string) error
}
type Engagements interface {
	AssistantList(context.Context, store.Q, store.Session, string, bool) ([]engagements.EngagementView, error)
	AssistantLog(context.Context, store.Q, store.Session, string, string, string, string, *string) (store.EngagementEntry, error)
}
type Options struct {
	Provider Provider
	// Allowance is the plan's monthly token allowance; nil is unlimited.
	Allowance aimodel.Allowance
	// CostAllowance is the plan's monthly model cost guard in micro-USD, shared with the import; nil applies none.
	CostAllowance aimodel.Allowance
	AllowStorage  func(context.Context, store.Q, store.Session, int64) error
	// File queues a stored attachment for AI filing in Documents; nil files nothing.
	File func(context.Context, store.Session, string)
}
type Service struct {
	api           http.Handler
	db            *store.Store
	auth          Auth
	files         Storage
	engagements   Engagements
	sessions      Sessions // nil: no Scheduling answers
	provider      Provider
	allowance     aimodel.Allowance
	costAllowance aimodel.Allowance
	now           func() time.Time
	limit         *auth.RateLimiter
	keepAlive     time.Duration
	allowStorage  func(context.Context, store.Q, store.Session, int64) error
	file          func(context.Context, store.Session, string)
}

func New(db *store.Store, a Auth, files Storage, e Engagements, options Options) *Service {
	return &Service{db: db, auth: a, files: files, engagements: e, provider: options.Provider, allowance: options.Allowance, costAllowance: options.CostAllowance, allowStorage: options.AllowStorage, file: options.File, now: func() time.Time { return time.Now().UTC() }, limit: auth.NewRateLimiter(30, time.Minute), keepAlive: 25 * time.Second}
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, fn handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := fn(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/heidi/suggestions", s.suggestions)
	handle("GET /api/v1/heidi/memory", s.memory)
	handle("PATCH /api/v1/heidi/memory", s.setMemory)
	handle("DELETE /api/v1/heidi/memory", s.setMemory)
	handle("GET /api/v1/heidi/usage", s.usage)
	handle("GET /api/v1/heidi/conversations", s.conversations)
	handle("GET /api/v1/heidi/conversations/{id}", s.conversation)
	handle("POST /api/v1/heidi/chat", s.chat)
	handle("POST /api/v1/heidi/chat/confirm", s.confirm)
	handle("GET /api/v1/heidi/consent", s.consent)
	handle("PUT /api/v1/heidi/consent", s.setConsent)
}

var conversationID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)
var pages = []string{"dashboard", "books", "quotes", "scheduling", "clients", "invoices", "expenses", "engagements", "documents", "products", "members", "billing", "settings", "help"}

func invalid(message string) error { return auth.Error(400, "invalid_request", message, nil) }
func need(sess store.Session, scope string) error {
	if !permissions.Allows(sess.Role, sess.Scopes, scope) {
		return auth.Error(403, "forbidden", "This action needs permission to "+strings.ReplaceAll(scope, ":", " ")+".", map[string]any{"scope": scope})
	}
	return nil
}
func (s *Service) conversations(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	rows, err := s.db.HeidiConversations(r.Context(), sess.Workspace.ID, sess.User.ID, accessKey(sess), sess.Role == "owner", 100)
	if err != nil {
		return err
	}
	list := make([]map[string]any, len(rows))
	for i, c := range rows {
		list[i] = map[string]any{
			"id": c.ID, "title": c.Title, "snippet": c.Snippet, "messages": c.Messages, "updated_at": c.UpdatedAt,
		}
	}
	auth.WriteJSON(w, 200, map[string]any{"data": list})
	return nil
}

func (s *Service) conversation(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	id := r.PathValue("id")
	if !conversationID.MatchString(id) {
		return invalid("The conversation identifier is invalid.")
	}
	list := []Message{}
	proposals := map[string]int{}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockHeidiConversation(r.Context(), sess.Workspace.ID, sess.User.ID, id, false, s.now()); err != nil {
			return err
		}
		rows, err := q.HeidiMessages(r.Context(), sess.Workspace.ID, sess.User.ID, id)
		if err != nil {
			return err
		}
		for _, raw := range rows {
			var m Message
			if err := json.Unmarshal(raw, &m); err != nil {
				return err
			}
			if m.Role == "assistant" && (m.Access != "" || sess.Role != "owner") && m.Access != accessKey(sess) {
				m = Message{ID: m.ID, Role: m.Role, Text: "Access to this earlier answer cannot be verified. Ask again with your current permissions.", CreatedAt: m.CreatedAt, GeneratedBy: "helvetly"}
			}
			m.Access = ""
			if m.ProposalID != "" {
				proposals[m.ProposalID] = len(list)
				m.ProposalID = ""
			}
			list = append(list, m)
		}
		pending, err := q.HeidiConfirmation(r.Context(), sess.Workspace.ID, sess.User.ID, id)
		if err == nil && pending.ExpiresAt.After(s.now()) && len(list) > 0 {
			at, ok := proposals[pending.ID]
			if !ok {
				at = len(list) - 1
			} // A confirmation saved by an older version has no proposal ID.
			switch pending.Kind {
			case "log_entry":
				if need(sess, "write:engagements") != nil {
					break
				}
				var request logRequest
				if err := json.Unmarshal(pending.Payload, &request); err != nil {
					return err
				}
				list[at].Confirmation = confirmationFor(pending.ID, request)
			case "workspace_operation":
				var change proposedChange
				if e := json.Unmarshal(pending.Payload, &change); e != nil {
					return e
				}
				if change.available(sess) {
					list[at].Confirmation = change.confirmation(pending.ID)
				}
			}
		}
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, 200, map[string]any{"data": list})
	return nil
}

type suggestion struct {
	Title       string `json:"title"`
	Prompt      string `json:"prompt"`
	Page, Scope string `json:"-"`
}

// topics: what to ask, per page. Each prompt is answered by a local command (answers.go) or a guide section
// (guide.md), so it works without a model; TestSuggestionsAreAnswerable keeps it that way.
var topics = []suggestion{
	{"Overdue invoices", "Which invoices are overdue?", "dashboard", "read:invoices"},
	{"This month’s expenses", "Summarize this month’s expenses", "dashboard", "read:expenses"},
	{"To invoice", "What needs invoicing?", "dashboard", "read:engagements"},
	{"Recent invoices", "Show recent invoices", "dashboard", "read:invoices"},
	{"Close a month", "How do I close a month?", "books", "read:periods"},
	{"VAT return", "How do I prepare a Swiss VAT return?", "books", "read:vat-return"},
	{"Create a quote", "How do I make a quote and turn it into an invoice?", "quotes", "read:invoices"},
	{"Schedule a session", "How do I schedule a session with a client?", "scheduling", "read:scheduling"},
	{"Recent clients", "Show recent clients", "clients", "read:clients"},
	{"Client portal", "How do I give a client access to the client portal?", "clients", ""},
	{"Contact persons", "How do I add contact persons to a client?", "clients", ""},
	{"Import clients", "How do I import my clients from files?", "clients", ""},
	{"Overdue invoices", "Which invoices are overdue?", "invoices", "read:invoices"},
	{"Recent invoices", "Show recent invoices", "invoices", "read:invoices"},
	{"New invoice", "Help me create a new invoice", "invoices", "write:invoices"},
	{"Reminders", "How do I send payment reminders?", "invoices", ""},
	{"This month’s expenses", "Summarize this month’s expenses", "expenses", "read:expenses"},
	{"Receipts", "How do I turn receipts into expenses automatically?", "expenses", ""},
	{"Paid expenses", "How do I mark expenses paid or reimbursed?", "expenses", ""},
	{"Hours left", "How many hours are left?", "engagements", "read:engagements"},
	{"To invoice", "What needs invoicing?", "engagements", "read:engagements"},
	{"Log work", "How do I log work on an engagement?", "engagements", ""},
	{"Recent documents", "Which documents were added recently?", "documents", "read:documents"},
	{"Signatures", "How do I send a PDF for signature?", "documents", ""},
	{"Share a document", "How do I share a document with a client?", "documents", ""},
	{"Templates", "How do I make a template and fill it for a client?", "documents", ""},
	{"Products", "How do I add products and services to my catalogue?", "products", ""},
	{"Import products", "How do I import my products from files?", "products", ""},
	{"Invite a colleague", "How do I invite a colleague?", "members", ""},
	{"Roles", "How do I change a member's role or access?", "members", ""},
	{"Change plan", "How do I choose or change my plan?", "billing", ""},
	{"Limits", "What happens when I reach a plan limit?", "billing", ""},
	{"Card or cancel", "How do I update my card or cancel my subscription?", "billing", ""},
	{"QR bill", "How do I set up the Swiss QR bill?", "settings", ""},
	{"Close a month", "How do I close a month?", "settings", ""},
	{"VAT return", "How do I prepare the Swiss VAT return?", "settings", ""},
	{"Two-factor", "How do I turn on two-factor authentication?", "settings", ""},
	{"First invoice", "How do I create and send my first invoice?", "help", ""},
	{"QR bill", "How do I set up the Swiss QR bill?", "help", ""},
	{"Invite a colleague", "How do I invite a colleague?", "help", ""},
	{"Import data", "How do I import my clients or invoices from files?", "help", ""},
}

// clientTopics: what to ask about the client open in its drawer (%s is its name).
var clientTopics = []suggestion{
	{"Overdue invoices", "Which invoices are overdue for %s?", "clients", "read:invoices"},
	{"Recent invoices", "Show recent invoices for %s", "clients", "read:invoices"},
	{"Hours left", "How many hours are left for %s?", "clients", "read:engagements"},
}

// suggestions: the page's topics (the open client's first), then general how-tos to fill up.
func (s *Service) suggestions(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	page := r.URL.Query().Get("page")
	if page != "" && !slices.Contains(pages, page) {
		return invalid("Unknown page.")
	}
	allowed := func(t suggestion) bool { return t.Scope == "" || permissions.Allows(sess.Role, sess.Scopes, t.Scope) }
	out := []suggestion{}
	if id := r.URL.Query().Get("client"); page == "clients" && id != "" && permissions.Allows(sess.Role, sess.Scopes, "read:clients") {
		client, err := s.db.Client(r.Context(), sess.Workspace.ID, id)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		if err == nil {
			for _, t := range clientTopics {
				if allowed(t) {
					out = append(out, suggestion{Title: t.Title, Prompt: fmt.Sprintf(t.Prompt, client.Name)})
				}
			}
		}
	}
	personal, err := s.memorySuggestions(r.Context(), sess, page)
	if err != nil {
		return err
	}
	out = append(out, personal...)
	for _, want := range []string{page, "help"} {
		for _, t := range topics {
			if t.Page == want && allowed(t) && !slices.ContainsFunc(out, func(o suggestion) bool { return o.Prompt == t.Prompt }) {
				out = append(out, t)
			}
		}
	}
	auth.WriteJSON(w, 200, map[string]any{"data": out[:min(len(out), 8)]})
	return nil
}
func (s *Service) usage(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	period := store.UsagePeriod(s.now())
	u, err := s.db.HeidiUsage(r.Context(), sess.Workspace.ID, aimodel.PoolHeidi, period)
	if err != nil {
		return err
	}
	consent, err := s.db.AIConsent(r.Context(), sess.Workspace.ID, sess.User.ID)
	if err != nil {
		return err
	}
	mode, included, remaining := "local", new(int64(0)), new(int64(0))
	if s.provider != nil && consent.Granted {
		mode, included, remaining = "openai", nil, nil // nil: unlimited
		if s.allowance != nil {
			n, err := s.allowance(r.Context(), s.db.Q, sess.Workspace.ID)
			if err != nil {
				return err
			}
			if n >= 0 {
				included, remaining = &n, new(max(0, n-u.TokensUsed-u.TokensReserved))
			}
		}
	}
	auth.WriteJSON(w, 200, map[string]any{"period": period, "tokens_used": u.TokensUsed, "tokens_included": included, "tokens_purchased": 0, "tokens_remaining": remaining, "mode": mode, "usage_uncertain": u.Uncertain, "can_purchase": false,
		"provider_available": s.provider != nil, "consent": consent})
	return nil
}

type Message struct {
	ProposalID   string        `json:"proposal_id,omitempty"` // Matches a pending decision to its own message even if another tab posts later.
	Access       string        `json:"access,omitempty"`      // Membership when this answer was read; never sent to the platform.
	ID           string        `json:"id"`
	Role         string        `json:"role"`
	Text         string        `json:"text"`
	Attachments  []string      `json:"attachments,omitempty"`
	Actions      []Action      `json:"actions,omitempty"`
	Records      []Record      `json:"records,omitempty"`
	Form         *Form         `json:"form,omitempty"`
	Confirmation *Confirmation `json:"confirmation,omitempty"`
	// ImportID is the import this answer reports on: the chat shows its progress and review.
	ImportID string `json:"import_id,omitempty"`
	// GeneratedBy marks an assistant message machine-readably (AI Act Art. 50(2)): "model" for the AI model's text,
	// "helvetly" for Helvetly's own answers; empty on the user's messages.
	GeneratedBy string `json:"generated_by,omitempty"`
	// CreatedAt is read from heidi_messages.created_at, never stored in the payload.
	CreatedAt time.Time `json:"created_at,omitzero"`
}
type Action struct {
	Control      string `json:"control,omitempty"`
	Value        string `json:"value,omitempty"`
	Row          string `json:"row,omitempty"`
	ID           string `json:"id"`
	Label        string `json:"label"`
	ClientID     string `json:"client_id,omitempty"`
	InvoiceID    string `json:"invoice_id,omitempty"`
	EngagementID string `json:"engagement_id,omitempty"`
	OccurrenceID string `json:"occurrence_id,omitempty"`
}
type Form struct {
	ID       string  `json:"id"`
	Question string  `json:"question"`
	Intent   string  `json:"intent,omitempty"` // "import": the platform opens the chosen page's import with the turn's files
	Fields   []Field `json:"fields"`
}
type Field struct {
	Kind    string   `json:"kind"`
	Name    string   `json:"name"`
	Label   string   `json:"label"`
	Options []string `json:"options"`
}
type Confirmation struct {
	Type         string `json:"type"`
	ID           string `json:"id"`
	Title        string `json:"title"`
	Body         string `json:"body"`
	ConfirmLabel string `json:"confirm_label"`
	Tone         string `json:"tone"`
}
type turn struct {
	memoryTopic      string // catalogue identifier, never an argument or record name
	Text             string
	Actions          []Action
	Records          []Record
	Form             *Form
	Confirmation     *Confirmation
	Pending          *store.HeidiConfirmation
	Tokens           int64
	Provider         bool
	Model            bool // the text is the AI model's (generated_by "model")
	ConsumePendingID string
	Statuses         []string
	ImportID         string
	importFiles      []string // the import's file names, shown as the question's attachments
}

// stream writes Server-Sent Events; the headers go out with the first event, so an error before it is still a
// normal JSON error and one after it an error frame.
type stream struct {
	mu      sync.Mutex // serialises event frames with keep-alive comments
	w       http.ResponseWriter
	started bool
}

// keepAlive writes an SSE comment every interval once the stream has started, so a proxy that cuts a response idle
// for 100 s (Cloudflare) keeps it open while the model works. stop waits for the writer to exit, so call it before
// the handler returns.
func (st *stream) keepAlive(every time.Duration) (stop func()) {
	done, exited := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(exited)
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				st.ping()
			}
		}
	}()
	return func() { close(done); <-exited }
}

func (st *stream) ping() {
	st.mu.Lock()
	defer st.mu.Unlock()
	if !st.started {
		return
	}
	if _, err := io.WriteString(st.w, ": ping\n\n"); err != nil {
		return
	}
	if f, ok := st.w.(http.Flusher); ok {
		f.Flush()
	}
}

func (st *stream) send(v any) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	if !st.started {
		st.started = true
		st.w.Header().Set("Content-Type", "text/event-stream")
		st.w.Header().Set("Cache-Control", "private, no-store")
		st.w.Header().Set("X-Accel-Buffering", "no")
	}
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if _, err = io.WriteString(st.w, "data: "+string(b)+"\n\n"); err != nil {
		return err
	}
	if f, ok := st.w.(http.Flusher); ok {
		f.Flush()
	}
	return nil
}

func (st *stream) status(label string) error {
	return st.send(map[string]string{"type": "status", "label": label})
}

// fail ends a started stream with an error frame: an answered error's message, a generic one (logged) otherwise.
func (st *stream) fail(ctx context.Context, err error) {
	_, code, message, ok := auth.Describe(err)
	if !ok {
		slog.ErrorContext(ctx, "heidi turn failed", "error", err)
		code, message = "internal_error", "Something went wrong: try again."
	}
	_ = st.send(map[string]string{"type": "error", "code": code, "message": message})
}

func (t turn) generatedBy() string {
	if t.Model {
		return "model"
	}
	return "helvetly"
}

func writeEvents(st *stream, t turn) error {
	for _, label := range t.Statuses {
		if err := st.status(label); err != nil {
			return err
		}
	}
	send := st.send
	if err := send(map[string]any{"type": "text", "value": t.Text, "generated_by": t.generatedBy()}); err != nil {
		return err
	}
	if len(t.Records) > 0 {
		if err := send(map[string]any{"type": "records", "records": t.Records}); err != nil {
			return err
		}
	}
	if len(t.Actions) > 0 {
		if err := send(map[string]any{"type": "actions", "actions": t.Actions}); err != nil {
			return err
		}
	}
	if t.Form != nil {
		if err := send(map[string]any{"type": "form", "form": t.Form}); err != nil {
			return err
		}
	}
	if t.ImportID != "" {
		if err := send(map[string]any{"type": "import", "import_id": t.ImportID}); err != nil {
			return err
		}
	}
	if t.Confirmation != nil {
		return send(t.Confirmation)
	}
	return send(map[string]any{"type": "done", "usage": map[string]int64{"tokens": t.Tokens}})
}
