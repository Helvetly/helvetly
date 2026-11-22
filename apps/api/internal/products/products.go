// Package products is a workspace's catalogue of products and services, picked into invoice lines
// (docs/products-contract.md).
package products

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth: the session, and its error and JSON conventions.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

type Service struct {
	db   *store.Store
	auth Auth
	log  *slog.Logger
	now  func() time.Time
}

func New(db *store.Store, a Auth, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, log: log, now: func() time.Time { return time.Now().UTC() }}
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

var errSKUTaken = validationFailed(map[string]string{"sku": "Another active item already uses this SKU."})

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				switch {
				case errors.Is(err, store.ErrNotFound):
					err = auth.ErrNotFound
				case errors.Is(err, store.ErrSKUTaken):
					err = errSKUTaken
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/products", s.list)
	handle("POST /api/v1/products", s.create)
	handle("GET /api/v1/products/search", s.search)
	handle("GET /api/v1/products/export", s.export)
	handle("POST /api/v1/products/bulk", s.bulk)
	handle("GET /api/v1/products/{id}", s.get)
	handle("PATCH /api/v1/products/{id}", s.update)
	handle("DELETE /api/v1/products/{id}", s.delete)
	handle("POST /api/v1/products/{id}/archive", s.archive)
	handle("POST /api/v1/products/{id}/unarchive", s.unarchive)
	handle("POST /api/v1/products/{id}/duplicate", s.duplicate)
}

var errForbidden = auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can archive or delete items.", nil)

func canManage(sess store.Session) bool { return sess.Role == "owner" || sess.Role == "admin" }

func data(v any) map[string]any { return map[string]any{"data": v} }

func (s *Service) respond(w http.ResponseWriter, r *http.Request, sess store.Session, status int, id string) error {
	p, err := s.db.Product(r.Context(), sess.Workspace.ID, id)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, status, data(p))
	return nil
}

func (s *Service) create(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	d, err := s.db.Defaults(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	p := newProduct(d)
	if err := apply(&p, body, d, true); err != nil {
		return err
	}
	p.ID, p.CreatedAt = auth.NewID("prd"), s.now()
	if err := s.db.CreateProduct(r.Context(), sess.Workspace.ID, p); err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, p.ID)
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.respond(w, r, sess, http.StatusOK, r.PathValue("id"))
}

func (s *Service) update(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	d, err := s.db.Defaults(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := s.db.Tx(r.Context(), func(q store.Q) error {
		p, err := q.ProductForUpdate(r.Context(), sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		if err := apply(&p, body, d, false); err != nil {
			return err
		}
		return q.SaveProduct(r.Context(), sess.Workspace.ID, p, s.now())
	}); err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

func (s *Service) duplicate(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	p, err := s.db.Product(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	p.ID, p.CreatedAt, p.SKU, p.GTIN, p.ArchivedAt = auth.NewID("prd"), s.now(), nil, nil, nil
	if runes := []rune(p.Name); len(runes) > 193 {
		p.Name = string(runes[:193])
	}
	p.Name += " (copy)"
	if err := s.db.CreateProduct(r.Context(), sess.Workspace.ID, p); err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, p.ID)
}

func (s *Service) delete(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	deleted, err := s.db.DeleteProducts(r.Context(), sess.Workspace.ID, []string{r.PathValue("id")}, s.now())
	if err != nil {
		return err
	}
	if len(deleted) == 0 {
		return store.ErrNotFound
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Service) archive(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.setArchived(w, r, sess, true)
}

func (s *Service) unarchive(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.setArchived(w, r, sess, false)
}

// setArchived archives or restores one item; doing it twice is not an error.
func (s *Service) setArchived(w http.ResponseWriter, r *http.Request, sess store.Session, archive bool) error {
	if !canManage(sess) {
		return errForbidden
	}
	id := r.PathValue("id")
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		_, reason, err := s.archiveOne(r, q, sess, id, archive)
		if err == nil && reason == skuReason {
			return store.ErrSKUTaken
		}
		return err
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

const skuReason = "Another active item already uses its SKU."

// archiveOne changes one item, or says why it did not.
func (s *Service) archiveOne(r *http.Request, q store.Q, sess store.Session, id string, archive bool) (bool, string, error) {
	p, err := q.Product(r.Context(), sess.Workspace.ID, id)
	if errors.Is(err, store.ErrNotFound) {
		return false, "Not found.", nil
	}
	if err != nil {
		return false, "", err
	}
	if p.IsArchived == archive {
		return false, map[bool]string{true: "Already archived.", false: "Not archived."}[archive], nil
	}
	if !archive && p.SKU != nil {
		taken, err := q.SKUTaken(r.Context(), sess.Workspace.ID, id, *p.SKU)
		if err != nil || taken {
			return false, skuReason, err
		}
	}
	changed, err := q.ArchiveProducts(r.Context(), sess.Workspace.ID, []string{id}, archive, s.now())
	return len(changed) == 1, "", err
}

type skipped struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
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
		invalid["ids"] = "Choose 1 to 500 items."
	}
	if !slices.Contains([]string{"archive", "unarchive", "delete"}, body.Action) {
		invalid["action"] = "Choose archive, unarchive or delete."
	}
	if len(invalid) > 0 {
		return validationFailed(invalid)
	}
	if !canManage(sess) {
		return errForbidden
	}
	ids := slices.Compact(slices.Sorted(slices.Values(body.IDs)))
	updated, skips := 0, []skipped{}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		updated, skips = 0, []skipped{}
		if body.Action == "delete" {
			deleted, err := q.DeleteProducts(r.Context(), sess.Workspace.ID, ids, s.now())
			for _, id := range ids {
				if !slices.Contains(deleted, id) {
					skips = append(skips, skipped{id, "Not found."})
				}
			}
			updated = len(deleted)
			return err
		}
		for _, id := range ids { // one by one, so a restored SKU is seen by the next one
			ok, reason, err := s.archiveOne(r, q, sess, id, body.Action == "archive")
			if err != nil {
				return err
			}
			if ok {
				updated++
			} else {
				skips = append(skips, skipped{id, reason})
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"updated": updated, "skipped": skips}))
	return nil
}

func (s *Service) search(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	q := r.URL.Query()
	limit, err := intParam(q, "limit", 10, 1, 25)
	if err != nil {
		return err
	}
	currency := q.Get("currency")
	if currency != "" {
		var msg string
		if currency, msg = clients.NormaliseCurrency(currency); msg != "" {
			return badRequest("currency must be a three-letter ISO code such as CHF.")
		}
	}
	list, err := s.db.SearchProducts(r.Context(), sess.Workspace.ID, q.Get("q"), currency, limit)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	q := r.URL.Query()
	f, err := parseFilter(q, sess.Workspace.Zone())
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
	list, total, err := s.db.ListProducts(r.Context(), sess.Workspace.ID, f, size, (page-1)*size)
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
		return 0, badRequest(key + " must be a whole number from " + strconv.Itoa(lo) + " to " + strconv.Itoa(hi) + ".")
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
func parseFilter(q url.Values, zone string) (store.ProductFilter, error) {
	f := store.ProductFilter{Search: q.Get("search"), Type: q.Get("type"), Sort: q.Get("sort"), IDs: listParam(q, "ids"), Zone: zone}
	if f.Type != "" && f.Type != "product" && f.Type != "service" {
		return f, badRequest("type must be product or service.")
	}
	switch q.Get("status") {
	case "", "active":
	case "archived":
		f.Archived = true
	default:
		return f, badRequest("status must be active or archived.")
	}
	for _, c := range listParam(q, "currency") {
		c, msg := clients.NormaliseCurrency(c)
		if msg != "" {
			return f, badRequest("currency must be three-letter ISO codes such as CHF.")
		}
		f.Currencies = append(f.Currencies, c)
	}
	for _, u := range listParam(q, "unit") {
		if !slices.Contains(units, u) {
			return f, badRequest("unit must be one of " + strings.Join(units, ", ") + ".")
		}
		f.Units = append(f.Units, u)
	}
	for _, v := range listParam(q, "vat_rate") {
		r, ok := invoicecalc.ParsePercent(v)
		if !ok {
			return f, badRequest("vat_rate must be percentages from 0 to 100 such as 8.1.")
		}
		f.VATRates = append(f.VATRates, int64(r))
	}
	for key, dst := range map[string]**int64{"price_min": &f.PriceMin, "price_max": &f.PriceMax} {
		if v := q.Get(key); v != "" {
			n, ok := invoicecalc.ParseMoney(v)
			if !ok {
				return f, badRequest(key + " must be an amount such as 100 or 99.50.")
			}
			*dst = new(int64(n))
		}
	}
	switch q.Get("sku") {
	case "":
	case "with", "without":
		f.HasSKU = new(q.Get("sku") == "with")
	default:
		return f, badRequest("sku must be with or without.")
	}
	if f.UpdatedFrom = q.Get("updated_from"); f.UpdatedFrom != "" {
		if _, err := time.Parse(time.DateOnly, f.UpdatedFrom); err != nil {
			return f, badRequest("updated_from must be a date as YYYY-MM-DD.")
		}
	}
	if f.Sort == "" {
		f.Sort = "name"
	}
	if _, ok := store.ProductSorts[strings.TrimPrefix(f.Sort, "-")]; !ok {
		return f, badRequest("sort must be one of name, sku, unit_price, created_at, updated_at, optionally prefixed with -.")
	}
	return f, nil
}

var csvHeader = []string{"type", "name", "sku", "gtin", "unit", "price_basis", "unit_price", "unit_price_net", "unit_price_gross",
	"currency", "vat_category", "vat_rate", "status", "description", "created_at", "updated_at"}

func (s *Service) export(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	f, err := parseFilter(r.URL.Query(), sess.Workspace.Zone())
	if err != nil {
		return err
	}
	// shortcut: the whole export is read into memory; stream rows from the query past ~50k items per workspace.
	list, _, err := s.db.ListProducts(r.Context(), sess.Workspace.ID, f, 0, 0)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="products-`+s.now().Format(time.DateOnly)+`.csv"`)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte("\uFEFF")) // a BOM, so spreadsheet apps read UTF-8
	out := csv.NewWriter(w)
	_ = out.Write(csvHeader)
	for _, p := range list {
		status := "active"
		if p.IsArchived {
			status = "archived"
		}
		row := []string{p.Type, p.Name, str(p.SKU), str(p.GTIN), str(p.Unit), p.PriceBasis, p.UnitPrice.String(),
			p.UnitPriceNet.String(), p.UnitPriceGross.String(), p.Currency, p.VATCategory, p.VATRate.String(), status,
			str(p.Description), p.CreatedAt.Format(time.RFC3339), p.UpdatedAt.Format(time.RFC3339)}
		for i := range row {
			row[i] = cell(row[i])
		}
		_ = out.Write(row) // headers are sent; a write error means the client left
	}
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
// leading apostrophe, unless it is just a number.
func cell(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		if _, err := strconv.ParseFloat(v, 64); err != nil {
			return "'" + v
		}
	}
	return v
}
