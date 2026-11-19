// Package clients is a workspace's clients, their contacts and files (docs/clients-contract.md).
package clients

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/sitecheck"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth: the session, and its error and JSON conventions.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Storage keeps the files' bytes (internal/storage in production, a fake in tests).
type Storage interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType, filename string) error
	storage.Source // Open, PresignDownload, ProxyDownloads
	Delete(ctx context.Context, key string) error
}

type Service struct {
	db    *store.Store
	auth  Auth
	files Storage
	log   *slog.Logger
	now   func() time.Time

	mail       Mailer // nil: no portal invitations
	portalURLs PortalURLs
	register   Register // nil: no UID register checks
	site       siteResolver
}

// siteResolver finds the URL a typed website answers on (sitecheck.Checker; a stub in tests).
type siteResolver interface {
	Resolve(ctx context.Context, text string) (string, error)
}

func New(db *store.Store, a Auth, files Storage, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, files: files, log: log, now: func() time.Time { return time.Now().UTC() },
		site: sitecheck.New()}
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/clients", s.list)
	handle("POST /api/v1/clients", s.create)
	handle("GET /api/v1/clients/export", s.export)
	handle("GET /api/v1/clients/tags", s.tags)
	handle("POST /api/v1/clients/bulk", s.bulk)
	handle("POST /api/v1/clients/website-check", s.checkWebsite)
	handle("GET /api/v1/clients/{id}", s.get)
	handle("PATCH /api/v1/clients/{id}", s.update)
	handle("DELETE /api/v1/clients/{id}", s.delete)
	handle("POST /api/v1/clients/{id}/contacts", s.createContact)
	handle("PATCH /api/v1/clients/{id}/contacts/{contact_id}", s.updateContact)
	handle("DELETE /api/v1/clients/{id}/contacts/{contact_id}", s.deleteContact)
	handle("GET /api/v1/clients/{id}/files", s.listFiles)
	handle("POST /api/v1/clients/{id}/files", s.uploadFiles)
	handle("GET /api/v1/clients/{id}/files/{file_id}", s.downloadFile)
	handle("DELETE /api/v1/clients/{id}/files/{file_id}", s.deleteFile)
	handle("POST /api/v1/clients/{id}/portal-invitation", s.resendPortalInvite)
	s.registerRequests(handle)
}

var errForbidden = auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can delete clients.", nil)

func canDelete(sess store.Session) bool { return sess.Role == "owner" || sess.Role == "admin" }

func data(v any) map[string]any { return map[string]any{"data": v} }

func badQuery(msg string) error {
	return auth.Error(http.StatusBadRequest, "invalid_request", msg, nil)
}

// ---- clients ----

// checkWebsite answers the URL a typed website really answers on, so the page saves a working address.
func (s *Service) checkWebsite(w http.ResponseWriter, r *http.Request, _ store.Session) error {
	var body struct {
		Website string `json:"website"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	final, err := s.site.Resolve(r.Context(), body.Website)
	var refused *sitecheck.Error
	if errors.As(err, &refused) {
		return validationFailed(map[string]string{"website": refused.Message})
	}
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]string{"website": final}))
	return nil
}

func (s *Service) create(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	fields, err := parseFields(body, clientFields, true)
	if err != nil {
		return err
	}
	if fields["portal_enabled"] == true {
		if err := s.db.RequireFeature(r.Context(), sess.Workspace.ID, store.FeatureClientPortal); err != nil {
			return err
		}
	}
	if format, ok := fields["einvoice_format"].(string); ok && format != "none" {
		if err := s.db.RequireFeature(r.Context(), sess.Workspace.ID, store.FeatureEInvoiceXML); err != nil {
			return err
		}
	}
	id := auth.NewID("cli")
	if err := s.db.CreateClient(r.Context(), sess.Workspace.ID, id, fields, s.now()); err != nil {
		return err
	}
	c, err := s.db.Client(r.Context(), sess.Workspace.ID, id)
	if err != nil {
		return err
	}
	s.verifyUID(r.Context(), sess.Workspace.ID, &c)
	auth.WriteJSON(w, http.StatusCreated, data(c))
	return nil
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	c, err := s.db.Client(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(c))
	return nil
}

func (s *Service) update(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	fields, err := parseFields(body, clientFields, false)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	var before, after store.Client
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if before, err = q.Client(r.Context(), sess.Workspace.ID, id); err != nil {
			return err
		}
		if _, err := q.UpdateClient(r.Context(), sess.Workspace.ID, id, fields, s.now()); err != nil {
			return err
		}
		if after, err = q.Client(r.Context(), sess.Workspace.ID, id); err != nil {
			return err
		}
		// Opening the portal, or sending its link to a new address, needs a plan with it; turning it off never does.
		if after.PortalEnabled && (!before.PortalEnabled || PortalLogin(before) != PortalLogin(after)) {
			if err := q.RequireFeature(r.Context(), sess.Workspace.ID, store.FeatureClientPortal); err != nil {
				return err
			}
		}
		// Asking for XML needs a plan with it; a client that asked before keeps its choice until changed.
		if after.EInvoiceFormat != "none" && after.EInvoiceFormat != before.EInvoiceFormat {
			if err := q.RequireFeature(r.Context(), sess.Workspace.ID, store.FeatureEInvoiceXML); err != nil {
				return err
			}
		}
		// Turning the portal off or changing its address ends the sessions at once.
		if before.PortalEnabled && (!after.PortalEnabled || PortalLogin(before) != PortalLogin(after)) {
			return q.DeletePortalSessionsForClient(r.Context(), id)
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.verifyUID(r.Context(), sess.Workspace.ID, &after)
	// The portal turned on, or its address changed while on: the address gets the link.
	if after.PortalEnabled && PortalLogin(after) != "" && (!before.PortalEnabled || PortalLogin(before) != PortalLogin(after)) {
		s.invitePortal(r.Context(), sess, after)
	}
	return s.get(w, r, sess)
}

func (s *Service) delete(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canDelete(sess) {
		return errForbidden
	}
	n, err := s.bulkClients(r.Context(), sess.Workspace.ID, []string{r.PathValue("id")}, "delete")
	if err != nil {
		return err
	}
	if n == 0 {
		return store.ErrNotFound
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Service) bulk(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		IDs    []string `json:"ids"`
		Action string   `json:"action"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	invalid := map[string]string{}
	if len(body.IDs) < 1 || len(body.IDs) > 500 {
		invalid["ids"] = "Choose 1 to 500 clients."
	}
	if body.Action != "activate" && body.Action != "deactivate" && body.Action != "delete" {
		invalid["action"] = "Choose activate, deactivate or delete."
	}
	if len(invalid) > 0 {
		return validationFailed(invalid)
	}
	if body.Action == "delete" && !canDelete(sess) {
		return errForbidden
	}
	n, err := s.bulkClients(r.Context(), sess.Workspace.ID, body.IDs, body.Action)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]int64{"updated": n}))
	return nil
}

// bulkClients applies the action; a deleted client's portal sessions end with it.
func (s *Service) bulkClients(ctx context.Context, workspaceID string, ids []string, action string) (n int64, err error) {
	err = s.db.Tx(ctx, func(q store.Q) error {
		if n, err = q.BulkClients(ctx, workspaceID, ids, action, s.now()); err != nil || action != "delete" {
			return err
		}
		for _, id := range ids {
			if err := q.DeletePortalSessionsForClient(ctx, id); err != nil {
				return err
			}
		}
		return nil
	})
	return n, err
}

func (s *Service) tags(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	t, err := s.db.ClientTags(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(t))
	return nil
}

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	q := r.URL.Query()
	f, err := parseFilter(q)
	if err != nil {
		return err
	}
	page, err := intParam(q, "page", 1, 1, 1_000_000)
	if err != nil {
		return err
	}
	size, err := intParam(q, "page_size", 50, 1, 200)
	if err != nil {
		return err
	}
	list, total, err := s.db.ListClients(r.Context(), sess.Workspace.ID, f, size, (page-1)*size)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": list,
		"meta": map[string]int{"page": page, "page_size": size, "total": total, "total_pages": (total + size - 1) / size}})
	return nil
}

func intParam(q url.Values, key string, fallback, lo, hi int) (int, error) {
	v := q.Get(key)
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < lo || n > hi {
		return 0, badQuery(key + " must be a whole number from " + strconv.Itoa(lo) + " to " + strconv.Itoa(hi) + ".")
	}
	return n, nil
}

// listParam: a repeatable parameter, also accepting comma-separated values.
func listParam(q url.Values, key string) []string {
	var out []string
	for _, v := range q[key] {
		for part := range strings.SplitSeq(v, ",") {
			if part = strings.TrimSpace(part); part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}

// parseFilter reads the list query shared by the list and the export.
func parseFilter(q url.Values) (store.ClientFilter, error) {
	f := store.ClientFilter{Search: q.Get("search"), Sort: q.Get("sort"), IDs: listParam(q, "ids")}
	status := map[string]bool{}
	for _, v := range listParam(q, "status") {
		if v != "active" && v != "inactive" && v != "draft" && v != "complete" {
			return f, badQuery("status must be active, inactive, draft or complete.")
		}
		status[v] = true
	}
	f.Active, f.Draft = either(status["active"], status["inactive"]), either(status["draft"], status["complete"])
	switch q.Get("type") {
	case "":
	case "company", "person":
		company := q.Get("type") == "company"
		f.Company = &company
	default:
		return f, badQuery("type must be company or person.")
	}
	for _, t := range q["tag"] {
		if t = strings.ToLower(strings.TrimSpace(t)); t != "" {
			f.Tags = append(f.Tags, t)
		}
	}
	for _, c := range listParam(q, "country") {
		if c = strings.ToUpper(c); !countries[c] {
			return f, badQuery("country must be two-letter ISO codes such as CH.")
		}
		f.Countries = append(f.Countries, c)
	}
	if f.Sort == "" {
		f.Sort = "-created_at"
	}
	if _, ok := store.ClientSorts[strings.TrimPrefix(f.Sort, "-")]; !ok {
		return f, badQuery("sort must be one of number, name, email, city, created_at, updated_at, optionally prefixed with -.")
	}
	return f, nil
}

// either: a filter for yes or for no, or none when both or neither are asked for.
func either(yes, no bool) *bool {
	if yes == no {
		return nil
	}
	return &yes
}

var csvHeader = []string{"number", "name", "preferred_name", "type", "active", "draft", "email", "billing_email", "phone", "website",
	"street", "street_number", "apt", "zip", "city", "country", "vat_number", "language", "currency", "payment_terms_days", "tags",
	"primary_contact", "internal_id", "note", "created_at", "updated_at"}

func (s *Service) export(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	f, err := parseFilter(r.URL.Query())
	if err != nil {
		return err
	}
	out := csv.NewWriter(w)
	started := false
	start := func() {
		if started {
			return
		}
		started = true
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="clients-`+s.now().Format(time.DateOnly)+`.csv"`)
		w.Header().Set("Cache-Control", "no-store")
		_ = out.Write(csvHeader)
	}

	err = s.db.EachClient(r.Context(), sess.Workspace.ID, f, 0, 0, func(c store.Client) error {
		start()
		kind, primary, terms := "person", "", ""
		if c.IsCompany {
			kind = "company"
		}
		if len(c.Contacts) > 0 && c.Contacts[0].IsPrimary {
			primary = c.Contacts[0].Name
		}
		if c.PaymentTermsDays != nil {
			terms = strconv.Itoa(*c.PaymentTermsDays)
		}
		row := []string{strconv.FormatInt(c.Number, 10), c.Name, str(c.PreferredName), kind, strconv.FormatBool(c.IsActive),
			strconv.FormatBool(c.IsDraft), str(c.Email), str(c.BillingEmail), str(c.Phone), str(c.Website), str(c.Street),
			str(c.StreetNumber), str(c.Apt), str(c.Zip), str(c.City), str(c.Country), str(c.VATNumber), str(c.Language),
			str(c.Currency), terms, strings.Join(c.Tags, ";"), primary, str(c.InternalID), str(c.Note),
			c.CreatedAt.Format(time.RFC3339), c.UpdatedAt.Format(time.RFC3339)}
		for i := range row {
			row[i] = cell(row[i])
		}
		return out.Write(row) // a write error means the client left
	})
	if err != nil && started {
		panic(http.ErrAbortHandler) // the CSV is half sent: cut the connection, so it does not look complete
	}
	if err != nil {
		return err
	}
	start()
	out.Flush()
	return nil
}

func str(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// cell keeps a spreadsheet from running a value as a formula: text starting with = + - @ tab or CR gets a
// leading apostrophe, unless it is just a number (a phone number in E.164, say).
func cell(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		if _, err := strconv.ParseFloat(v, 64); err != nil {
			return "'" + v
		}
	}
	return v
}
