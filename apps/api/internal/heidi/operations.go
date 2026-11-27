// Workspace operations are selected by name and dispatched to the same guarded handlers as the platform.
package heidi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/imports"
	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

// SetAPI wires the authenticated platform API, including its permission and billing middleware.
func (s *Service) SetAPI(api http.Handler) { s.api = api }

var workspaceOps = func() map[string]openapi.Operation {
	ops := map[string]openapi.Operation{}
	for _, op := range openapi.Operations {
		// HR, raw audit payloads, binary files and exports never enter chat.
		if !slices.Contains([]string{"Clients", "Invoices", "Quotes", "Documents", "Engagements", "Expenses", "Products", "Books", "Reports", "Scheduling", "Instalments"}, op.Tag) ||
			(!op.JSONOnly && op.ID != "get_document_content") || op.Upload || strings.Contains(op.ID, "audit_log") || strings.HasPrefix(op.ID, "preview_") {
			continue
		}
		ops[op.ID] = op
	}
	// Session-only reads run through their normal platform handlers.
	for _, read := range []struct {
		id, path, summary string
		query             []string
	}{
		{"get_invoice_settings", "/api/v1/invoice-settings", "Read the seller, tax profile, numbering and invoice defaults", nil},
		{"list_document_templates", "/api/v1/templates", "List document templates", nil},
		{"get_document_template", "/api/v1/templates/{id}", "Read the selected template's fields and signers", nil},
		{"get_quote_contracts", "/api/v1/quotes/{id}/contracts", "List contracts generated for one quote", nil},
		{"get_document_usage", "/api/v1/documents/usage", "Read file counts and storage by document kind and trash", nil},
		{"get_vat_settings", "/api/v1/vat-return/settings", "Read VAT settlement method, period, basis and rates", nil},
		{"get_engagement_settings", "/api/v1/engagement-settings", "Read the engagement digest setting", nil},
		{"list_booking_links", "/api/v1/scheduling/booking-links", "Read booking link status, hosts and expiry", nil},
		{"get_workspace_portal", "/api/v1/workspace/portal", "Read client portal settings", nil},
		{"get_workspace_reply_to", "/api/v1/workspace/reply-to", "Read the reply address for workspace mail", nil},
		{"get_workspace_plan", "/api/v1/billing", "Read this workspace's current subscription, features and renewal", nil},
		{"list_workspace_members", "/api/v1/members", "List members, roles and contact details", nil},
		{"get_scheduling_settings", "/api/v1/scheduling/settings", "Read booking and cancellation policies", nil},
		{"get_scheduling_holidays", "/api/v1/scheduling/holidays", "List configured non-working days", nil},
		{"list_approval_inbox", "/api/v1/approvals/inbox", "Read invoice, quote and expense approvals awaiting my decision", nil},
		{"list_notifications", "/api/v1/notifications", "Read my business notifications", []string{"limit", "before", "unread", "category"}},
		{"list_signature_requests", "/api/v1/signatures", "List signature request statuses", []string{"status", "document_id"}},
		{"latest_issued_invoice", "/api/v1/invoices", "Read the latest issued sales invoice by issue date", nil},
	} {
		op := openapi.Operation{ID: read.id, Path: read.path, Summary: read.summary, Method: http.MethodGet, JSONOnly: true}
		if strings.Contains(op.Path, "{id}") {
			op.Params = []openapi.Param{{Name: "id", In: "path", Required: true, Schema: json.RawMessage(`{"type":"string"}`)}}
		}
		for _, key := range read.query {
			op.Params = append(op.Params, openapi.Param{Name: key, In: "query", Schema: json.RawMessage(`{"type":"string"}`)})
		}
		ops[op.ID] = op
	}
	style := heidiStyleOperation()
	ops[style.ID] = style
	return ops
}()

// An answer prepared for a different set of permissions must not be sent to the provider.
func accessKey(sess store.Session) string {
	scopes := slices.Clone(sess.Scopes)
	slices.Sort(scopes)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(sess.Role+"|"+strings.Join(scopes, "|"))))
}

func (s *Service) requireCurrentAccess(ctx context.Context, q store.Q, r *http.Request, sess store.Session) error {
	current, err := s.auth.CookieSession(ctx, q, r)
	if err != nil {
		return err
	}
	if current.ID != sess.ID || current.User.ID != sess.User.ID || current.Workspace.ID != sess.Workspace.ID || accessKey(current) != accessKey(sess) {
		return auth.Error(403, "forbidden", "Your workspace permissions have changed. Ask again.", nil)
	}
	return nil
}

func canOperate(sess store.Session, op openapi.Operation) bool {
	for _, scope := range permissions.Required(op.Method, op.Path) {
		if !permissions.AllowsAny(sess.Role, sess.Scopes, scope) {
			return false
		}
	}
	return true
}

func operationNames(sess store.Session) []string {
	var ids []string
	for id, op := range workspaceOps {
		if canOperate(sess, op) {
			ids = append(ids, id)
		}
	}
	slices.Sort(ids)
	return ids
}

// A model may supply values, never a URL, method, credential, or a second operation.
type workspaceCommand struct {
	Operation string            `json:"operation"`
	Params    map[string]string `json:"params,omitempty"`
	Body      json.RawMessage   `json:"body,omitempty"`
}

var segment = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func (c workspaceCommand) target(op openapi.Operation) (string, error) {
	if op.ID == "set_heidi_reply_style" {
		if err := validateHeidiStyleBody(c.Body); err != nil {
			return "", err
		}
	}
	route := op.Path
	query := url.Values{}
	for key, value := range c.Params {
		i := slices.IndexFunc(op.Params, func(p openapi.Param) bool { return p.Name == key })
		if i < 0 {
			return "", errors.New("unknown parameter: " + key)
		}
		if op.Params[i].In == "path" {
			if !segment.MatchString(value) {
				return "", errors.New("invalid record identifier")
			}
			route = strings.ReplaceAll(route, "{"+key+"}", value)
		} else {
			query.Set(key, value)
		}
	}
	for _, p := range op.Params {
		if p.Required && c.Params[p.Name] == "" {
			return "", errors.New("missing parameter: " + p.Name)
		}
	}
	if len(c.Body) > 0 {
		if len(op.Body) == 0 || len(c.Body) > 4096 || !json.Valid(c.Body) || c.Body[0] != '{' {
			return "", errors.New("invalid operation body")
		}
	} else if op.BodyRequired {
		return "", errors.New("missing operation body")
	}
	// Keep list queries inside the same bounded window as chat's record cards.
	for _, p := range op.Params {
		if p.In == "query" && (p.Name == "page_size" || p.Name == "limit") {
			n, err := strconv.Atoi(query.Get(p.Name))
			if err != nil || n < 1 || n > 20 {
				query.Set(p.Name, "20")
			}
		}
	}
	if len(query) > 0 {
		route += "?" + query.Encode()
	}
	return route, nil
}

// Read only a bounded JSON response. Even a large page or misconfigured handler cannot fill chat memory.
type operationResponse struct {
	header   http.Header
	status   int
	body     bytes.Buffer
	limit    int
	tooLarge bool
}

func (r *operationResponse) Header() http.Header { return r.header }
func (r *operationResponse) WriteHeader(code int) {
	if r.status == 0 {
		r.status = code
	}
}
func (r *operationResponse) Write(data []byte) (int, error) {
	if r.status == 0 {
		r.status = 200
	}
	if r.body.Len()+len(data) > r.limit {
		r.tooLarge = true
		return 0, errors.New("operation response too large")
	}
	return r.body.Write(data)
}

func (s *Service) dispatch(r *http.Request, sess store.Session, c workspaceCommand, limit int) (*operationResponse, error) {
	op, ok := workspaceOps[c.Operation]
	if !ok || !canOperate(sess, op) || s.api == nil {
		return nil, auth.Error(403, "forbidden", "This operation is unavailable.", nil)
	}
	if err := s.requireCurrentAccess(r.Context(), s.db.Q, r, sess); err != nil {
		return nil, err
	}
	target, err := c.target(op)
	if err != nil {
		return nil, invalid(err.Error())
	}
	inner, err := http.NewRequestWithContext(r.Context(), op.Method, target, bytes.NewReader(c.Body))
	if err != nil {
		return nil, err
	}
	if ck, err := r.Cookie("helvetly_session"); err == nil {
		inner.AddCookie(ck)
	}
	inner.Header.Set("X-CSRF-Token", r.Header.Get("X-CSRF-Token"))
	inner.Header.Set("Content-Type", "application/json")
	inner.Header.Set("Accept", "application/json")
	inner.Host, inner.RemoteAddr = r.Host, r.RemoteAddr
	result := &operationResponse{header: make(http.Header), limit: limit}
	s.api.ServeHTTP(result, inner)
	if result.status == 0 {
		result.status = http.StatusOK
	}
	if result.status < 200 || result.status >= 300 {
		var problem struct {
			Error struct{ Code, Message string }
		}
		if json.Unmarshal(result.body.Bytes(), &problem) == nil && problem.Error.Code != "" {
			return nil, auth.Error(result.status, problem.Error.Code, problem.Error.Message, nil)
		}
		return nil, auth.Error(409, "operation_unavailable", "The application could not complete this operation.", nil)
	}
	return result, nil
}

func (s *Service) execute(r *http.Request, sess store.Session, c workspaceCommand) (json.RawMessage, error) {
	op := workspaceOps[c.Operation]
	if op.ID == "latest_issued_invoice" {
		if err := s.requireCurrentAccess(r.Context(), s.db.Q, r, sess); err != nil {
			return nil, err
		}
		t, err := s.latestInvoice(r.Context(), s.db.Q, sess, "en")
		if err != nil {
			return nil, err
		}
		return json.Marshal(map[string]any{"summary": t.Text, "records": t.Records})
	}
	result, err := s.dispatch(r, sess, c, 256<<10)
	if err != nil {
		return nil, err
	}
	if op.Write {
		// Only bulk actions can partially succeed with HTTP 200. Keep those item outcomes for the receipt.
		if op.ID == "bulk_documents" || op.ID == "bulk_expenses" {
			return result.body.Bytes(), nil
		}
		return nil, nil
	}
	if result.tooLarge {
		return nil, auth.Error(413, "result_too_large", "Narrow your search to fewer records.", nil)
	}
	if !json.Valid(result.body.Bytes()) {
		return nil, fmt.Errorf("workspace operation %s returned invalid JSON", op.ID)
	}
	return result.body.Bytes(), nil
}

func (s *Service) readDocument(r *http.Request, sess store.Session, c workspaceCommand, textBudget int) (ProviderFile, error) {
	response, err := s.dispatch(r, sess, c, maxFileBytes)
	if err != nil {
		return ProviderFile{}, err
	}
	if response.tooLarge {
		return ProviderFile{}, auth.Error(413, "file_too_large", "Heidi can read files up to 8 MB.", nil)
	}
	_, info, _ := mime.ParseMediaType(response.header.Get("Content-Disposition"))
	name := path.Base(info["filename"])
	if name == "." {
		name = c.Params["id"]
	}
	kind, file, err := imports.ChatAttachment(name, response.body.Bytes(), textBudget)
	if err != nil {
		return ProviderFile{}, auth.Error(422, "unsupported_file", err.Error(), nil)
	}
	if name == c.Params["id"] && kind == "application/pdf" {
		file.Name += ".pdf"
	}
	return file, nil
}
