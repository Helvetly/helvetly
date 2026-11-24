// Package mcp is the remote MCP server (docs/mcp-contract.md): Streamable HTTP at POST /api/mcp, stateless JSON
// responses, authenticated by an API token. Its tools are the public API's operations (internal/openapi); a call
// runs in process through the same guarded handler chain as the REST request would, so permissions, the billing
// guard, plan limits, validation and audit logging are exactly the REST ones.
package mcp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

// Auth is what the server uses of internal/auth.
type Auth interface {
	SignedInMCP(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	AllowTokenRequest(*http.Request, string, bool) error
	WriteError(http.ResponseWriter, *http.Request, error)
}

// versions this server speaks, newest first; an unknown client version gets the newest.
var versions = []string{"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"}

const instructions = `Helvetly is Swiss business software: clients, invoices (QR bill), quotes, instalment plans, payments, ` +
	`expenses, documents, engagements, products, the books (periods, VAT return, ledger) and key figures of one ` +
	`workspace. Tools act as the token's person with their permissions. Amounts are exact decimal strings. Tools ` +
	`marked [write] change data; destructive ones (issue, void, send, delete, close a period) cannot be undone. List ` +
	`tools are paged (page, page_size; the answer's meta has the totals). Upload tools take files as {filename, ` +
	`content_base64}; downloads answer a short-lived download_url or the file itself.`

type Service struct {
	auth Auth
	ops  []openapi.Operation
	api  http.Handler // the whole guarded API, set by main once it is built
}

func New(a Auth, ops []openapi.Operation) *Service { return &Service{auth: a, ops: ops} }

// SetAPI gives the handler chain tool calls run through (main's server handler, guards included).
func (s *Service) SetAPI(h http.Handler) { s.api = h }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/mcp", s.post)
	mux.HandleFunc("/api/mcp", func(w http.ResponseWriter, _ *http.Request) {
		// No server-initiated stream (GET) and no sessions to end (DELETE): the server is stateless.
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
	})
}

type request struct {
	JSONRPC   string          `json:"jsonrpc"`
	ID        json.RawMessage `json:"id"`
	Method    string          `json:"method"`
	Params    json.RawMessage `json:"params"`
	tool      *openapi.Operation
	arguments map[string]any
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (s *Service) post(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		w.Header().Set("WWW-Authenticate", `Bearer realm="helvetly"`)
		s.auth.WriteError(w, r, auth.Error(http.StatusUnauthorized, "unauthenticated",
			"Send an API token: Authorization: Bearer hvt_… (Settings → API & MCP).", nil))
		return
	}
	if v := r.Header.Get("MCP-Protocol-Version"); v != "" && !slices.Contains(versions, v) {
		s.auth.WriteError(w, r, auth.Error(http.StatusBadRequest, "invalid_request", "Unsupported MCP-Protocol-Version.", nil))
		return
	}
	s.auth.SignedInMCP(s.serve)(w, r)
}

func (s *Service) read(w http.ResponseWriter, r *http.Request) (request, *rpcError) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequest))
	if err != nil {
		return request{}, &rpcError{-32700, "Request body too large or unreadable."}
	}
	var req request
	if err := json.Unmarshal(raw, &req); err != nil {
		return request{}, &rpcError{-32700, "Parse error: send one JSON-RPC message (batches are not supported)."}
	}
	if req.JSONRPC != "2.0" || req.Method == "" {
		return req, &rpcError{-32600, "Invalid request: jsonrpc must be 2.0 and method set."}
	}
	if req.ID != nil && req.Method == "tools/call" {
		var p struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return req, &rpcError{-32602, "Invalid params: want {name, arguments}."}
		}
		i := slices.IndexFunc(s.ops, func(op openapi.Operation) bool { return op.ID == p.Name })
		if i < 0 {
			return req, &rpcError{-32602, fmt.Sprintf("Unknown tool %q.", p.Name)}
		}
		req.tool, req.arguments = &s.ops[i], p.Arguments
	}
	return req, nil
}

func (s *Service) serve(w http.ResponseWriter, r *http.Request, sess store.Session) {
	req, rpcErr := s.read(w, r)
	if err := s.auth.AllowTokenRequest(r, sess.Workspace.ID, req.tool != nil && req.tool.Write); err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	if rpcErr != nil {
		reply(w, req.ID, nil, rpcErr)
		return
	}
	if req.ID == nil { // a notification (notifications/initialized, cancelled): nothing to answer
		w.WriteHeader(http.StatusAccepted)
		return
	}
	switch req.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &p)
		version := versions[0]
		if slices.Contains(versions, p.ProtocolVersion) {
			version = p.ProtocolVersion
		}
		reply(w, req.ID, map[string]any{"protocolVersion": version,
			"capabilities": map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":   map[string]any{"name": "helvetly", "title": "Helvetly", "version": "1.0.0"},
			"instructions": instructions}, nil)
	case "ping":
		reply(w, req.ID, map[string]any{}, nil)
	case "tools/list":
		tools := []map[string]any{}
		for _, op := range s.ops {
			if s.visible(r, sess, op) {
				tools = append(tools, tool(op))
			}
		}
		reply(w, req.ID, map[string]any{"tools": tools}, nil)
	case "tools/call":
		if !s.visible(r, sess, *req.tool) {
			reply(w, req.ID, nil, &rpcError{-32602, fmt.Sprintf("Unknown tool %q.", req.tool.ID)})
			return
		}
		reply(w, req.ID, s.call(r, *req.tool, req.arguments), nil)
	default:
		reply(w, req.ID, nil, &rpcError{-32601, "Method not found: " + req.Method})
	}
}

// visible: a tool the token's scope and the member's permissions allow; the call is still checked like any request.
func (s *Service) visible(r *http.Request, sess store.Session, op openapi.Operation) bool {
	if !auth.TokenAllows(r, op.Resource, op.Write) {
		return false
	}
	for _, need := range permissions.Required(op.Method, op.Path) {
		if !permissions.Allows(sess.Role, sess.Scopes, need) {
			return false
		}
	}
	return true
}

// tool describes an operation: path and query parameters as arguments, the JSON body as `body`.
func tool(op openapi.Operation) map[string]any {
	props := map[string]any{}
	required := []string{}
	for _, p := range op.Params {
		var schema map[string]any
		_ = json.Unmarshal(p.Schema, &schema)
		if p.Description != "" {
			schema["description"] = p.Description
		}
		props[p.Name] = schema
		if p.Required {
			required = append(required, p.Name)
		}
	}
	if op.Body != nil {
		props["body"] = op.Body
		if op.Upload {
			props["body"] = uploadSchema(op.Body)
		}
		if op.BodyRequired {
			required = append(required, "body")
		}
	}
	description := op.Summary + ". " + op.Description
	if op.Write {
		description = "[write] " + description
	}
	return map[string]any{
		"name": op.ID, "title": op.Summary, "description": description,
		"inputSchema": map[string]any{"type": "object", "properties": props, "required": required, "additionalProperties": false},
		"annotations": map[string]any{"title": op.Summary, "readOnlyHint": !op.Write, "destructiveHint": op.Destructive,
			"idempotentHint": !op.Write, "openWorldHint": false},
	}
}

// call runs the operation in process through the guarded API, as the same token, and wraps the JSON answer.
func (s *Service) call(r *http.Request, op openapi.Operation, args map[string]any) map[string]any {
	path, query := op.Path, url.Values{}
	known := map[string]bool{"body": op.Body != nil}
	for _, p := range op.Params {
		known[p.Name] = true
		v, ok := args[p.Name]
		if !ok || v == nil {
			if p.Required {
				return toolError("Missing argument " + p.Name + ".")
			}
			continue
		}
		text := fmt.Sprint(v)
		if f, isNum := v.(float64); isNum {
			text = strconv.FormatFloat(f, 'f', -1, 64)
		}
		if p.In == "path" {
			path = strings.Replace(path, "{"+p.Name+"}", url.PathEscape(text), 1)
		} else {
			query.Set(p.Name, text)
		}
	}
	for k := range args {
		if !known[k] {
			return toolError("Unknown argument " + k + ".")
		}
	}
	var body io.Reader
	contentType := "application/json"
	if b, ok := args["body"]; ok && op.Upload {
		form, ok := b.(map[string]any)
		if !ok {
			return toolError("The body must be an object.")
		}
		buf, ct, err := multipartBody(form)
		if err != nil {
			return toolError(err.Error())
		}
		body, contentType = buf, ct
	} else if ok && op.Body != nil {
		raw, err := json.Marshal(b)
		if err != nil {
			return toolError("The body is not valid JSON.")
		}
		body = bytes.NewReader(raw)
	} else if op.Write && op.Body != nil && !op.Upload {
		body = strings.NewReader("{}")
	}
	target := path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	inner, err := http.NewRequestWithContext(r.Context(), op.Method, target, body)
	if err != nil {
		return toolError("Invalid arguments: " + err.Error())
	}
	inner.Header.Set("Authorization", r.Header.Get("Authorization"))
	if body != nil {
		inner.Header.Set("Content-Type", contentType)
	}
	inner.RemoteAddr, inner.Host = r.RemoteAddr, r.Host
	rec := httptest.NewRecorder()
	s.api.ServeHTTP(rec, inner)
	return result(rec, target)
}

func toolError(msg string) map[string]any {
	return map[string]any{"content": []map[string]any{{"type": "text", "text": msg}}, "isError": true}
}

func reply(w http.ResponseWriter, id json.RawMessage, result any, e *rpcError) {
	if id == nil {
		id = json.RawMessage("null")
	}
	msg := map[string]any{"jsonrpc": "2.0", "id": id}
	if e != nil {
		msg["error"] = e
	} else {
		msg["result"] = result
	}
	auth.WriteJSON(w, http.StatusOK, msg)
}
