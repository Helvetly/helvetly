package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"helvetly.com/api/internal/invoicecalc"
)

// The product and service catalogue (docs/products-contract.md). The struct is the API's JSON as well.

// ErrSKUTaken: another live, active item of the workspace has this SKU.
var ErrSKUTaken = errors.New("sku taken")

type Product struct {
	ID             string              `json:"id"`
	Type           string              `json:"type"`
	Name           string              `json:"name"`
	Description    *string             `json:"description"`
	SKU            *string             `json:"sku"`
	GTIN           *string             `json:"gtin"`
	Unit           *string             `json:"unit"`
	PriceBasis     string              `json:"price_basis"`
	UnitPrice      invoicecalc.Money   `json:"unit_price"`
	UnitPriceNet   invoicecalc.Money   `json:"unit_price_net"`
	UnitPriceGross invoicecalc.Money   `json:"unit_price_gross"`
	Currency       string              `json:"currency"`
	VATCategory    string              `json:"vat_category"`
	VATRate        invoicecalc.Percent `json:"vat_rate"`
	IsArchived     bool                `json:"is_archived"`
	ArchivedAt     *time.Time          `json:"archived_at"`
	CreatedAt      time.Time           `json:"created_at"`
	UpdatedAt      time.Time           `json:"updated_at"`
}

// Derive sets both prices from the entered one, with the invoice computation for one unit. A rounded conversion
// can give a different gross amount at another quantity.
func (p *Product) Derive() {
	mode := invoicecalc.Exclusive
	if p.PriceBasis == "gross" {
		mode = invoicecalc.Inclusive
	}
	t := invoicecalc.Compute(mode, "", []invoicecalc.Line{{Quantity: 1000, UnitPrice: p.UnitPrice, Category: p.VATCategory,
		Rate: p.VATRate}}, 0)
	p.UnitPriceNet, p.UnitPriceGross = t.NetTotal, t.Total
	p.IsArchived = p.ArchivedAt != nil
}

// ProductSorts maps the list's sort keys to their SQL.
var ProductSorts = map[string]string{"name": "lower(p.name)", "sku": "lower(p.sku)", "unit_price": "p.unit_price",
	"created_at": "p.created_at", "updated_at": "p.updated_at"}

const productColumns = `p.id, p.type, p.name, p.description, p.sku, p.gtin, p.unit, p.price_basis, p.unit_price, p.currency,
	p.vat_category, p.vat_rate, p.archived_at, p.created_at, p.updated_at`

func scanProduct(row interface{ Scan(...any) error }) (Product, error) {
	var p Product
	err := row.Scan(&p.ID, &p.Type, &p.Name, &p.Description, &p.SKU, &p.GTIN, &p.Unit, &p.PriceBasis, &p.UnitPrice, &p.Currency,
		&p.VATCategory, &p.VATRate, &p.ArchivedAt, &p.CreatedAt, &p.UpdatedAt)
	p.Derive()
	return p, err
}

func skuErr(err error) error {
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" && pg.ConstraintName == "products_sku" {
		return ErrSKUTaken
	}
	return err
}

func (q Q) createProduct(ctx context.Context, workspaceID string, p Product) error {
	_, err := q.db.Exec(ctx, `INSERT INTO products (id, workspace_id, type, name, description, sku, gtin, unit, price_basis,
		unit_price, currency, vat_category, vat_rate, archived_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
		p.ID, workspaceID, p.Type, p.Name, p.Description, p.SKU, p.GTIN, p.Unit, p.PriceBasis, p.UnitPrice, p.Currency,
		p.VATCategory, p.VATRate, p.ArchivedAt, p.CreatedAt)
	return skuErr(err)
}

// SaveProduct writes every editable field of a live item.
func (q Q) SaveProduct(ctx context.Context, workspaceID string, p Product, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE products SET type = $3, name = $4, description = $5, sku = $6, gtin = $7, unit = $8,
		price_basis = $9, unit_price = $10, currency = $11, vat_category = $12, vat_rate = $13, updated_at = $14
		WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
		workspaceID, p.ID, p.Type, p.Name, p.Description, p.SKU, p.GTIN, p.Unit, p.PriceBasis, p.UnitPrice, p.Currency,
		p.VATCategory, p.VATRate, now)
	if err != nil {
		return skuErr(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (q Q) Product(ctx context.Context, workspaceID, id string) (Product, error) {
	return scanProduct(q.db.QueryRow(ctx, `SELECT `+productColumns+` FROM products p
		WHERE p.workspace_id = $1 AND p.id = $2 AND p.deleted_at IS NULL`, workspaceID, id))
}

// ProductForUpdate serializes partial edits so each applies to the preceding edit's committed fields.
func (q Q) ProductForUpdate(ctx context.Context, workspaceID, id string) (Product, error) {
	return scanProduct(q.db.QueryRow(ctx, `SELECT `+productColumns+` FROM products p
		WHERE p.workspace_id = $1 AND p.id = $2 AND p.deleted_at IS NULL FOR UPDATE`, workspaceID, id))
}

// ArchiveProducts archives or restores the live items among ids that are not already so, and returns those it
// changed. Restoring an item whose SKU an active item took meanwhile fails with ErrSKUTaken.
func (q Q) ArchiveProducts(ctx context.Context, workspaceID string, ids []string, archive bool, now time.Time) ([]string, error) {
	set, cond := "archived_at = $3", "archived_at IS NULL"
	if !archive {
		set, cond = "archived_at = NULL", "archived_at IS NOT NULL"
	}
	rows, err := q.db.Query(ctx, `UPDATE products SET `+set+`, updated_at = $3
		WHERE workspace_id = $1 AND id = ANY($2) AND deleted_at IS NULL AND `+cond+` RETURNING id`, workspaceID, ids, now)
	if err != nil {
		return nil, skuErr(err)
	}
	defer rows.Close()
	changed := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		changed = append(changed, id)
	}
	return changed, skuErr(rows.Err())
}

// SKUTaken: an active, live item other than id has this SKU (case-insensitive).
func (q Q) SKUTaken(ctx context.Context, workspaceID, id, sku string) (bool, error) {
	var taken bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM products WHERE workspace_id = $1 AND id <> $2 AND lower(sku) = lower($3)
		AND deleted_at IS NULL AND archived_at IS NULL)`, workspaceID, id, sku).Scan(&taken)
	return taken, err
}

// DeleteProducts soft-deletes the live items among ids and returns those it deleted.
func (q Q) DeleteProducts(ctx context.Context, workspaceID string, ids []string, now time.Time) ([]string, error) {
	rows, err := q.db.Query(ctx, `UPDATE products SET deleted_at = $3, updated_at = $3
		WHERE workspace_id = $1 AND id = ANY($2) AND deleted_at IS NULL RETURNING id`, workspaceID, ids, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	deleted := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		deleted = append(deleted, id)
	}
	return deleted, rows.Err()
}

// ProductFilter narrows the list and the export.
type ProductFilter struct {
	Search      string
	Type        string // "" for both
	Archived    bool
	Currencies  []string
	Units       []string
	VATRates    []int64 // in hundredths of a percent
	PriceMin    *int64  // in cents, inclusive
	PriceMax    *int64
	HasSKU      *bool
	UpdatedFrom string   // YYYY-MM-DD, inclusive, a day in Zone
	Zone        string   // IANA name the day is read in; "" is UTC
	IDs         []string // when set, the status filter is ignored (an export of a selection)
	Sort        string   // a key of ProductSorts, "-" prefixed for descending
}

func likePattern(term string) string {
	return "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(term) + "%"
}

func (f ProductFilter) where(workspaceID string) (string, []any) {
	args := []any{workspaceID}
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	conds := []string{"p.workspace_id = $1", "p.deleted_at IS NULL"}
	if term := strings.TrimSpace(f.Search); term != "" {
		p := arg(likePattern(term))
		conds = append(conds, "(p.name ILIKE "+p+" OR p.sku ILIKE "+p+" OR p.gtin ILIKE "+p+" OR p.description ILIKE "+p+")")
	}
	if f.Type != "" {
		conds = append(conds, "p.type = "+arg(f.Type))
	}
	if len(f.IDs) > 0 {
		conds = append(conds, "p.id = ANY("+arg(f.IDs)+")")
	} else if f.Archived {
		conds = append(conds, "p.archived_at IS NOT NULL")
	} else {
		conds = append(conds, "p.archived_at IS NULL")
	}
	if len(f.Currencies) > 0 {
		conds = append(conds, "p.currency = ANY("+arg(f.Currencies)+")")
	}
	if len(f.Units) > 0 {
		conds = append(conds, "p.unit = ANY("+arg(f.Units)+")")
	}
	if len(f.VATRates) > 0 {
		conds = append(conds, "p.vat_rate = ANY("+arg(f.VATRates)+")")
	}
	if f.PriceMin != nil {
		conds = append(conds, "p.unit_price >= "+arg(*f.PriceMin))
	}
	if f.PriceMax != nil {
		conds = append(conds, "p.unit_price <= "+arg(*f.PriceMax))
	}
	if f.HasSKU != nil {
		conds = append(conds, map[bool]string{true: "p.sku <> ''", false: "COALESCE(p.sku, '') = ''"}[*f.HasSKU])
	}
	if f.UpdatedFrom != "" {
		conds = append(conds, "p.updated_at >= "+dayStart(arg(f.UpdatedFrom), arg(zoneOr(f.Zone)), 0))
	}
	return strings.Join(conds, " AND "), args
}

func (f ProductFilter) orderBy() string {
	key, dir := strings.TrimPrefix(f.Sort, "-"), " ASC"
	if strings.HasPrefix(f.Sort, "-") {
		dir = " DESC"
	}
	col, ok := ProductSorts[key]
	if !ok {
		col, dir = ProductSorts["name"], " ASC"
	}
	return col + dir + " NULLS LAST, lower(p.name), p.id"
}

func (q Q) scanProducts(ctx context.Context, sql string, args ...any) ([]Product, error) {
	rows, err := q.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Product{}
	for rows.Next() {
		p, err := scanProduct(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

// ListProducts returns one page of the filtered items and how many match; limit 0 returns every match.
func (q Q) ListProducts(ctx context.Context, workspaceID string, f ProductFilter, limit, offset int) ([]Product, int, error) {
	where, args := f.where(workspaceID)
	var total int
	if err := q.db.QueryRow(ctx, `SELECT count(*) FROM products p WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	page := ""
	if limit > 0 {
		page = fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset)
	}
	list, err := q.scanProducts(ctx, `SELECT `+productColumns+` FROM products p WHERE `+where+` ORDER BY `+f.orderBy()+page, args...)
	return list, total, err
}

// SearchProducts: active items for a picker, ranked SKU/GTIN equal, name prefix, name contains, the rest; within a
// rank items in currency first, then by name. An empty term lists the most recently updated.
func (q Q) SearchProducts(ctx context.Context, workspaceID, term, currency string, limit int) ([]Product, error) {
	base := `SELECT ` + productColumns + ` FROM products p WHERE p.workspace_id = $1 AND p.deleted_at IS NULL AND p.archived_at IS NULL`
	if term = strings.TrimSpace(term); term == "" {
		return q.scanProducts(ctx, base+` ORDER BY p.updated_at DESC, p.id LIMIT $2`, workspaceID, limit)
	}
	prefix := strings.TrimSuffix(likePattern(term), "%")[1:] + "%"
	return q.scanProducts(ctx, base+` AND (p.name ILIKE $2 OR p.sku ILIKE $2 OR p.gtin ILIKE $2 OR p.description ILIKE $2)
		ORDER BY CASE WHEN lower(p.sku) = lower($3) OR p.gtin = $3 THEN 0 WHEN p.name ILIKE $4 THEN 1 WHEN p.name ILIKE $2 THEN 2 ELSE 3 END,
		p.currency = $5 DESC, lower(p.name), p.id LIMIT $6`, workspaceID, likePattern(term), term, prefix, currency, limit)
}
