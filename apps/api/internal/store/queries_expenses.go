package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"helvetly.com/api/internal/invoicecalc"
)

// Expenses, their lines, receipts and categories (docs/expenses-contract.md). The structs are the API's JSON.

// ErrCategoryTaken: another category of the workspace has this name.
var ErrCategoryTaken = errors.New("category name taken")

var ErrCategoryLocked = errors.New("category used by a booked expense")

// Person is someone named on a record (who created, booked, paid); null once their account is gone.
type Person = Uploader

// Receipt is a file on an expense, shaped like a client's file.
type Receipt = ClientFile

type CategoryRef struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AccountCode string `json:"account_code"`
	// Preset: the catalogue entry (CategoryPresets) the category still is; its name is translated. Renaming clears it.
	Preset *string `json:"preset"`
}

type ExpenseCategory struct {
	CategoryRef
	// VATTreatment: standard, reduced, lodging, exempt or none; the line rate it suggests is the one on the document's date.
	VATTreatment  *string `json:"vat_treatment"`
	IsArchived    bool    `json:"is_archived"`
	ExpensesCount int     `json:"expenses_count"`
}

// ExpenseLine is one amount at one VAT rate, or one item; an item's own category (null: the expense's) takes its
// share in the ledger. Quantity and unit price are only shown: Amount is the figure.
type ExpenseLine struct {
	ID          string                `json:"id"`
	Position    int                   `json:"position"`
	Description *string               `json:"description"`
	Amount      invoicecalc.Money     `json:"amount"`
	VATRate     invoicecalc.Percent   `json:"vat_rate"`
	CategoryID  *string               `json:"-"`
	Category    *CategoryRef          `json:"category"`
	Quantity    *invoicecalc.Quantity `json:"quantity"`
	UnitPrice   *invoicecalc.Money    `json:"unit_price"`
}

type ExpenseVAT struct {
	Rate             invoicecalc.Percent `json:"rate"`
	TaxableAmount    invoicecalc.Money   `json:"taxable_amount"`
	VATAmount        invoicecalc.Money   `json:"vat_amount"`
	DeductibleAmount invoicecalc.Money   `json:"deductible_amount"`
}

type ExpenseBase struct {
	Currency      string            `json:"currency"`
	NetTotal      invoicecalc.Money `json:"net_total"`
	VATTotal      invoicecalc.Money `json:"vat_total"`
	Total         invoicecalc.Money `json:"total"`
	DeductibleVAT invoicecalc.Money `json:"deductible_vat"`
}

type Expense struct {
	ID                   string              `json:"id"`
	Number               int64               `json:"number"`
	Status               string              `json:"status"`
	Source               string              `json:"source"`
	SupplierName         *string             `json:"supplier_name"`
	SupplierVATNumber    *string             `json:"supplier_vat_number"`
	SupplierCountry      string              `json:"supplier_country"` // alpha-2; outside CH/LI its VAT is not Swiss input tax
	Reference            *string             `json:"reference"`
	DuplicateOf          *DuplicateRef       `json:"duplicate_of"`
	Description          *string             `json:"description"`
	CategoryID           *string             `json:"-"`
	Category             *CategoryRef        `json:"category"`
	DocumentDate         *string             `json:"document_date"`
	DueDate              *string             `json:"due_date"`
	Currency             string              `json:"currency"`
	AmountMode           string              `json:"amount_mode"`
	EntryMode            string              `json:"entry_mode"` // single: one amount per VAT rate; itemised: items
	Lines                []ExpenseLine       `json:"lines"`
	NetTotal             invoicecalc.Money   `json:"net_total"`
	VATTotal             invoicecalc.Money   `json:"vat_total"`
	Total                invoicecalc.Money   `json:"total"`
	VATBreakdown         []ExpenseVAT        `json:"vat_breakdown"`
	InputTax             string              `json:"input_tax"`
	ReverseCharge        bool                `json:"reverse_charge"` // a service from abroad: acquisition tax (MWSTG art. 45)
	InputTaxBox          *string             `json:"input_tax_box"`  // VAT return Ziffer 400 or 405; null: from the category's account
	DeductiblePercent    invoicecalc.Percent `json:"deductible_percent"`
	DeductibleVAT        invoicecalc.Money   `json:"deductible_vat"`
	ExchangeRate         invoicecalc.Rate    `json:"exchange_rate"`
	ExchangeRateDate     *string             `json:"exchange_rate_date"`
	ExchangeRateSource   *string             `json:"exchange_rate_source"`
	Base                 ExpenseBase         `json:"base"`
	PaymentStatus        string              `json:"payment_status"`
	PaidOn               *string             `json:"paid_on"`
	PaymentMethod        *string             `json:"payment_method"`
	PaidByID             *string             `json:"-"`
	PaidByMember         *Person             `json:"paid_by_member"`
	ReimbursedOn         *string             `json:"reimbursed_on"`
	IsOverdue            bool                `json:"is_overdue"`
	Note                 *string             `json:"note"`
	ReceiptMissingReason *string             `json:"receipt_missing_reason"`
	ReceiptsCount        int                 `json:"receipts_count"`
	IsComplete           bool                `json:"is_complete"`
	MissingFields        []string            `json:"missing_fields"`
	// UnnamedItems: read with the row, for lists that do not load lines (see unnamedItems).
	UnnamedItems bool       `json:"-"`
	CreatedBy    *Person    `json:"created_by"`
	BookedAt     *time.Time `json:"booked_at"`
	BookedBy     *Person    `json:"booked_by"`
	VoidedAt     *time.Time `json:"voided_at"`
	VoidedBy     *Person    `json:"voided_by"`
	VoidReason   *string    `json:"void_reason"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	// ApprovalState: of a draft's latest approval request before booking (internal/approvals), as on Invoice.
	ApprovalState *string `json:"approval_state"`
}

// Derive sets what follows from the stored fields: completeness and whether it is overdue on `today`.
func (e *Expense) Derive(today string) {
	e.MissingFields = []string{}
	for _, f := range []struct {
		name    string
		missing bool
	}{
		{"supplier_name", e.SupplierName == nil},
		{"document_date", e.DocumentDate == nil},
		{"category", e.CategoryID == nil},
		{"total", e.Total == 0},
		{"items", e.UnnamedItems || unnamedItems(e.EntryMode, e.Lines)},
		{"exchange_rate", e.Currency != e.Base.Currency && (e.ExchangeRateDate == nil || e.ExchangeRateSource == nil)},
		{"receipt", e.ReceiptsCount == 0 && e.ReceiptMissingReason == nil},
	} {
		if f.missing {
			e.MissingFields = append(e.MissingFields, f.name)
		}
	}
	e.IsComplete = len(e.MissingFields) == 0
	e.IsOverdue = e.Status != "void" && e.PaymentStatus == "unpaid" && e.DueDate != nil && *e.DueDate < today
}

// unnamedItems: an item, or one of several lines (one per VAT rate), has no description; a single line is described
// by the expense's own description. Keep in step with unnamedItemsSQL.
func unnamedItems(entryMode string, lines []ExpenseLine) bool {
	if entryMode != "itemised" && len(lines) < 2 {
		return false
	}
	for _, l := range lines {
		if l.Description == nil || strings.TrimSpace(*l.Description) == "" {
			return true
		}
	}
	return false
}

const unnamedItemsSQL = `(e.entry_mode = 'itemised' OR (SELECT count(*) FROM expense_lines m WHERE m.expense_id = e.id) > 1)
	AND EXISTS (SELECT 1 FROM expense_lines l WHERE l.expense_id = e.id AND btrim(coalesce(l.description, '')) = '')`

// CategoryPreset is an entry of the category catalogue: an account of the KMU-Kontenrahmen and its usual VAT.
type CategoryPreset struct{ Key, Name, Account, VAT string }

// CategoryPresets: the catalogue a new workspace starts with (migrations 00046 and 00047 add it to older ones). Name is the
// stored English name; the first sixteen keep the names workspaces had before the catalogue.
var CategoryPresets = []CategoryPreset{
	{"materials", "Materials & goods", "4000", "standard"},
	{"goods_resale", "Goods for resale", "4200", "standard"},
	{"subcontractors", "Subcontractors", "4400", "standard"},
	{"staff_other", "Other staff costs", "5800", "standard"},
	{"training", "Training", "5810", "standard"},
	{"staff_expenses", "Expense allowances", "5820", "standard"},
	{"rent", "Rent & premises", "6000", "exempt"},
	{"premises_ancillary", "Ancillary premises costs", "6030", "standard"},
	{"cleaning", "Cleaning", "6040", "standard"},
	{"repairs", "Repairs & maintenance", "6100", "standard"},
	{"equipment_leasing", "Equipment leasing", "6105", "standard"},
	{"vehicles", "Vehicles & transport", "6200", "standard"},
	{"fuel", "Fuel", "6210", "standard"},
	{"vehicle_insurance", "Vehicle insurance", "6220", "none"},
	{"vehicle_tax", "Vehicle tax & fees", "6230", "none"},
	{"vehicle_leasing", "Vehicle leasing", "6260", "standard"},
	{"freight", "Freight & delivery", "6280", "standard"},
	{"insurance", "Insurance & fees", "6300", "none"},
	{"duties_permits", "Duties, fees & permits", "6360", "none"},
	{"energy", "Energy & waste", "6400", "standard"},
	{"waste", "Waste disposal", "6460", "standard"},
	{"office", "Office & administration", "6500", "standard"},
	{"telecom", "Phone & internet", "6510", "standard"},
	{"postage", "Postage", "6513", "standard"},
	{"memberships", "Memberships", "6520", "none"},
	{"donations", "Donations", "6520", "none"},
	{"professional_fees", "Legal & accounting fees", "6530", "standard"},
	{"software_saas", "IT & software", "6570", "standard"},
	{"it_services", "IT services", "6570", "standard"},
	{"hardware_small", "Small hardware", "6570", "standard"},
	{"marketing", "Marketing & advertising", "6600", "standard"},
	{"gifts", "Business gifts", "6620", "standard"},
	{"trade_fairs", "Trade fairs & events", "6660", "standard"},
	{"travel", "Travel", "6640", "standard"},
	{"lodging", "Lodging", "6640", "lodging"},
	{"meals_entertainment", "Meals & entertainment", "6641", "standard"},
	{"other_operating", "Other operating costs", "6700", "standard"},
	{"interest", "Interest", "6900", "none"},
	{"bank_fees", "Bank charges", "6940", "none"},
	{"direct_taxes", "Direct taxes", "8900", "none"},
	{"wages", "Wages & salaries", "5000", "none"},
	{"temp_staff", "Temporary staff", "5900", "standard"},
	{"social_security", "Social security (AHV/IV/EO/ALV)", "5700", "none"},
	{"family_allowances", "Family allowance fund (FAK)", "5710", "none"},
	{"pension_bvg", "Pension fund (BVG)", "5720", "none"},
	{"accident_insurance", "Accident insurance (UVG)", "5730", "none"},
	{"sickness_insurance", "Sickness benefit insurance (KTG)", "5740", "none"},
	{"recruiting", "Recruiting", "5800", "standard"},
	{"staff_meals", "Staff meals & events", "5840", "standard"},
	{"customs", "Customs & import duties", "4070", "none"},
	{"tools", "Tools & small equipment", "6100", "standard"},
	{"home_office", "Home office share", "6000", "none"},
	{"vehicle_repairs", "Vehicle repairs & service", "6200", "standard"},
	{"property_insurance", "Property insurance", "6300", "none"},
	{"liability_insurance", "Liability insurance", "6300", "none"},
	{"office_supplies", "Office supplies", "6500", "standard"},
	{"books_subscriptions", "Books & subscriptions", "6500", "reduced"},
	{"consulting", "Consulting", "6530", "standard"},
	{"audit", "Audit & board", "6540", "standard"},
	{"web_hosting", "Web hosting & domains", "6570", "standard"},
	{"public_transport", "Public transport & taxis", "6640", "standard"},
	{"entertainment", "Client entertainment", "6642", "standard"},
	{"licences", "Licences & royalties", "6700", "standard"},
	{"depreciation", "Depreciation", "6800", "none"},
	{"payment_fees", "Payment provider fees", "6940", "none"},
}

// ---- categories ----

// SeedExpenseCategories adds the catalogue to a workspace that has no categories yet (safe to race: the
// unique name index drops the second insert).
func (q Q) SeedExpenseCategories(ctx context.Context, workspaceID string, newID func() string, now time.Time) error {
	n := len(CategoryPresets)
	ids, keys, names, codes, vats := make([]string, n), make([]string, n), make([]string, n), make([]string, n), make([]string, n)
	for i, p := range CategoryPresets {
		ids[i], keys[i], names[i], codes[i], vats[i] = newID(), p.Key, p.Name, p.Account, p.VAT
	}
	_, err := q.db.Exec(ctx, `INSERT INTO expense_categories (id, workspace_id, name, account_code, preset, vat_treatment, created_at, updated_at)
		SELECT id, $1, name, code, key, vat, $7, $7 FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) AS d(id, key, name, code, vat)
		WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE workspace_id = $1)
		ON CONFLICT DO NOTHING`, workspaceID, ids, keys, names, codes, vats, now)
	return err
}

const categoryColumns = `c.id, c.name, c.account_code, c.preset, c.vat_treatment, c.archived_at IS NOT NULL,
	(SELECT count(*) FROM expenses e WHERE e.category_id = c.id AND e.deleted_at IS NULL)`

func scanCategory(row interface{ Scan(...any) error }) (ExpenseCategory, error) {
	var c ExpenseCategory
	err := row.Scan(&c.ID, &c.Name, &c.AccountCode, &c.Preset, &c.VATTreatment, &c.IsArchived, &c.ExpensesCount)
	return c, err
}

// ExpenseCategories by account code, then name.
func (q Q) ExpenseCategories(ctx context.Context, workspaceID string, includeArchived bool) ([]ExpenseCategory, error) {
	rows, err := q.db.Query(ctx, `SELECT `+categoryColumns+` FROM expense_categories c
		WHERE c.workspace_id = $1 AND ($2 OR c.archived_at IS NULL) ORDER BY c.account_code, lower(c.name)`, workspaceID, includeArchived)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []ExpenseCategory{}
	for rows.Next() {
		c, err := scanCategory(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, rows.Err()
}

func (q Q) ExpenseCategory(ctx context.Context, workspaceID, id string) (ExpenseCategory, error) {
	return scanCategory(q.db.QueryRow(ctx, `SELECT `+categoryColumns+` FROM expense_categories c WHERE c.workspace_id = $1 AND c.id = $2`,
		workspaceID, id))
}

func categoryErr(err error) error {
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" && pg.ConstraintName == "expense_categories_name" {
		return ErrCategoryTaken
	}
	return err
}

// CreateExpenseCategory: vat is the treatment it suggests (nil: none).
func (q Q) CreateExpenseCategory(ctx context.Context, workspaceID, id, name, code string, vat *string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO expense_categories (id, workspace_id, name, account_code, vat_treatment, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6)`, id, workspaceID, name, code, vat, now)
	return categoryErr(err)
}

// UpdateExpenseCategory runs in a transaction; booked categories keep their name and account. A new name ends the preset.
// Nil leaves a field alone; false means there is no such category.
func (q Q) UpdateExpenseCategory(ctx context.Context, workspaceID, id string, name, code, vat *string, archived *bool, now time.Time) (bool, error) {
	var currentName, currentCode string
	if err := q.db.QueryRow(ctx, `SELECT name, account_code FROM expense_categories
		WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, workspaceID, id).Scan(&currentName, &currentCode); err != nil {
		if errors.Is(err, ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	if (name != nil && *name != currentName) || (code != nil && *code != currentCode) {
		var booked bool
		if err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM expenses
			WHERE category_id = $1 AND status <> 'draft') OR EXISTS (SELECT 1 FROM expense_lines l JOIN expenses e ON e.id = l.expense_id
			WHERE l.category_id = $1 AND e.status <> 'draft')`, id).Scan(&booked); err != nil {
			return false, err
		}
		if booked {
			return false, ErrCategoryLocked
		}
	}
	tag, err := q.db.Exec(ctx, `UPDATE expense_categories SET name = COALESCE($3, name), account_code = COALESCE($4, account_code),
		preset = CASE WHEN $3::text IS NULL OR $3 = name THEN preset END,
		archived_at = CASE WHEN $5::boolean IS NULL THEN archived_at WHEN $5 THEN COALESCE(archived_at, $6) END, updated_at = $6,
		vat_treatment = COALESCE($7, vat_treatment)
		WHERE workspace_id = $1 AND id = $2`, workspaceID, id, name, code, archived, now, vat)
	return tag.RowsAffected() == 1, categoryErr(err)
}

// MemberPerson: the person when they are a member of the workspace.
func (q Q) MemberPerson(ctx context.Context, workspaceID, userID string) (Person, error) {
	p := Person{ID: userID}
	err := q.db.QueryRow(ctx, `SELECT u.name, `+avatarColumn+` FROM workspace_members m JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = $1 AND m.user_id = $2`, workspaceID, userID).Scan(&p.Name, &p.AvatarURL)
	return p, err
}

// ---- expenses ----

var expenseColumns = `e.id, e.number, e.status, e.source, e.supplier_name, e.supplier_vat_number, e.supplier_country, e.reference, e.description,
	e.category_id, c.name, c.account_code, c.preset, e.document_date::text, e.due_date::text, e.currency, e.amount_mode, e.input_tax,
	e.deductible_percent, e.net_total, e.vat_total, e.total, e.deductible_vat, e.vat_breakdown, e.exchange_rate,
	e.exchange_rate_date::text, e.exchange_rate_source, e.base_currency, e.base_net_total, e.base_vat_total, e.base_total,
	e.base_deductible_vat, e.payment_status, e.paid_on::text, e.payment_method, e.paid_by, pb.name, ` + avatarOf("pb") + `, e.reimbursed_on::text, e.note,
	e.receipt_missing_reason, (SELECT count(*) FROM expense_receipts r WHERE r.expense_id = e.id), e.created_by, cb.name, ` + avatarOf("cb") + `,
	e.booked_at, e.booked_by, bb.name, ` + avatarOf("bb") + `, e.voided_at, e.voided_by, vb.name, ` + avatarOf("vb") + `, e.void_reason, e.created_at, e.updated_at,
	e.reverse_charge, e.input_tax_box, e.entry_mode, ` + unnamedItemsSQL + `, ` + approvalStateOf("e")

const expenseFrom = ` FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
	LEFT JOIN users pb ON pb.id = e.paid_by LEFT JOIN users cb ON cb.id = e.created_by
	LEFT JOIN users bb ON bb.id = e.booked_by LEFT JOIN users vb ON vb.id = e.voided_by`

func scanExpense(row interface{ Scan(...any) error }, today string) (Expense, error) {
	var e Expense
	var catName, catCode, catPreset, paidByName, createdBy, createdByName, bookedBy, bookedByName, voidedBy, voidedByName *string
	var paidByAvatar, createdByAvatar, bookedByAvatar, voidedByAvatar *string
	var breakdown []byte
	err := row.Scan(&e.ID, &e.Number, &e.Status, &e.Source, &e.SupplierName, &e.SupplierVATNumber, &e.SupplierCountry, &e.Reference, &e.Description,
		&e.CategoryID, &catName, &catCode, &catPreset, &e.DocumentDate, &e.DueDate, &e.Currency, &e.AmountMode, &e.InputTax,
		&e.DeductiblePercent, &e.NetTotal, &e.VATTotal, &e.Total, &e.DeductibleVAT, &breakdown, &e.ExchangeRate,
		&e.ExchangeRateDate, &e.ExchangeRateSource, &e.Base.Currency, &e.Base.NetTotal, &e.Base.VATTotal, &e.Base.Total,
		&e.Base.DeductibleVAT, &e.PaymentStatus, &e.PaidOn, &e.PaymentMethod, &e.PaidByID, &paidByName, &paidByAvatar, &e.ReimbursedOn, &e.Note,
		&e.ReceiptMissingReason, &e.ReceiptsCount, &createdBy, &createdByName, &createdByAvatar,
		&e.BookedAt, &bookedBy, &bookedByName, &bookedByAvatar, &e.VoidedAt, &voidedBy, &voidedByName, &voidedByAvatar, &e.VoidReason, &e.CreatedAt, &e.UpdatedAt,
		&e.ReverseCharge, &e.InputTaxBox, &e.EntryMode, &e.UnnamedItems, &e.ApprovalState)
	if err != nil {
		return e, err
	}
	if e.CategoryID != nil && catName != nil {
		e.Category = &CategoryRef{ID: *e.CategoryID, Name: *catName, AccountCode: *catCode, Preset: catPreset}
	}
	e.PaidByMember, e.CreatedBy, e.BookedBy, e.VoidedBy = uploader(e.PaidByID, paidByName, paidByAvatar),
		uploader(createdBy, createdByName, createdByAvatar), uploader(bookedBy, bookedByName, bookedByAvatar),
		uploader(voidedBy, voidedByName, voidedByAvatar)
	if err := json.Unmarshal(breakdown, &e.VATBreakdown); err != nil {
		return e, fmt.Errorf("expense %s breakdown: %w", e.ID, err)
	}
	e.Lines = []ExpenseLine{}
	e.Derive(today)
	return e, nil
}

// Expense reads a live expense with its lines; forUpdate locks it until the transaction ends.
func (q Q) Expense(ctx context.Context, workspaceID, id, today string, forUpdate bool) (Expense, error) {
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE OF e"
	}
	e, err := scanExpense(q.db.QueryRow(ctx, `SELECT `+expenseColumns+expenseFrom+`
		WHERE e.workspace_id = $1 AND e.id = $2 AND e.deleted_at IS NULL`+lock, workspaceID, id), today)
	if err != nil {
		return e, err
	}
	rows, err := q.db.Query(ctx, `SELECT l.id, l.position, l.description, l.amount, l.vat_rate, l.category_id, c.name, c.account_code,
			l.quantity, l.unit_price
		FROM expense_lines l LEFT JOIN expense_categories c ON c.id = l.category_id
		WHERE l.expense_id = $1 ORDER BY l.position`, id)
	if err != nil {
		return e, err
	}
	defer rows.Close()
	for rows.Next() {
		var l ExpenseLine
		var catName, catCode *string
		if err := rows.Scan(&l.ID, &l.Position, &l.Description, &l.Amount, &l.VATRate, &l.CategoryID, &catName, &catCode,
			&l.Quantity, &l.UnitPrice); err != nil {
			return e, err
		}
		if l.CategoryID != nil && catName != nil {
			l.Category = &CategoryRef{ID: *l.CategoryID, Name: *catName, AccountCode: *catCode}
		}
		e.Lines = append(e.Lines, l)
	}
	return e, rows.Err()
}

// CreateExpense inserts a draft with the workspace's next number (set on e) and its lines.
func (q Q) createExpense(ctx context.Context, workspaceID string, e *Expense, now time.Time) error {
	err := q.db.QueryRow(ctx, `INSERT INTO workspace_counters (workspace_id, expenses_seq) VALUES ($1, 1)
		ON CONFLICT (workspace_id) DO UPDATE SET expenses_seq = workspace_counters.expenses_seq + 1 RETURNING expenses_seq`,
		workspaceID).Scan(&e.Number)
	if err != nil {
		return err
	}
	_, err = q.db.Exec(ctx, `INSERT INTO expenses (id, workspace_id, number, status, source, currency, amount_mode, input_tax,
		deductible_percent, net_total, vat_total, total, deductible_vat, vat_breakdown, exchange_rate, base_currency, base_net_total,
		base_vat_total, base_total, base_deductible_vat, payment_status, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, 'draft', $4, $5, 'gross', 'none', 0, 0, 0, 0, 0, '[]', 1000000, $5, 0, 0, 0, 0, 'unpaid', $6, $7, $7)`,
		e.ID, workspaceID, e.Number, e.Source, e.Currency, e.CreatedBy.ID, now)
	if err != nil {
		return err
	}
	return q.SaveExpense(ctx, workspaceID, *e, now)
}

// SaveExpense writes every editable field and the computed totals, and replaces the lines.
func (q Q) SaveExpense(ctx context.Context, workspaceID string, e Expense, now time.Time) error {
	breakdown, err := json.Marshal(e.VATBreakdown)
	if err != nil {
		return fmt.Errorf("expense breakdown: %w", err)
	}
	_, err = q.db.Exec(ctx, `UPDATE expenses SET supplier_name = $3, supplier_vat_number = $4, reference = $5, description = $6,
		category_id = $7, document_date = $8, due_date = $9, currency = $10, amount_mode = $11, input_tax = $12,
		deductible_percent = $13, net_total = $14, vat_total = $15, total = $16, deductible_vat = $17, vat_breakdown = $18,
		exchange_rate = $19, exchange_rate_date = $20, exchange_rate_source = $21, base_currency = $22, base_net_total = $23,
		base_vat_total = $24, base_total = $25, base_deductible_vat = $26, payment_status = $27, paid_on = $28,
		payment_method = $29, paid_by = $30, reimbursed_on = $31, note = $32, receipt_missing_reason = $33, updated_at = $34,
		supplier_country = $35, reverse_charge = $36, input_tax_box = $37, entry_mode = COALESCE(NULLIF($38, ''), 'single')
		WHERE workspace_id = $1 AND id = $2`,
		workspaceID, e.ID, e.SupplierName, e.SupplierVATNumber, e.Reference, e.Description, e.CategoryID, e.DocumentDate, e.DueDate,
		e.Currency, e.AmountMode, e.InputTax, e.DeductiblePercent, e.NetTotal, e.VATTotal, e.Total, e.DeductibleVAT, breakdown,
		e.ExchangeRate, e.ExchangeRateDate, e.ExchangeRateSource, e.Base.Currency, e.Base.NetTotal, e.Base.VATTotal, e.Base.Total,
		e.Base.DeductibleVAT, e.PaymentStatus, e.PaidOn, e.PaymentMethod, e.PaidByID, e.ReimbursedOn, e.Note, e.ReceiptMissingReason, now, e.SupplierCountry,
		e.ReverseCharge, e.InputTaxBox, e.EntryMode)
	if err != nil {
		return err
	}
	if _, err := q.db.Exec(ctx, `DELETE FROM expense_lines WHERE expense_id = $1`, e.ID); err != nil {
		return err
	}
	for _, l := range e.Lines {
		if _, err := q.db.Exec(ctx, `INSERT INTO expense_lines (id, expense_id, position, description, amount, vat_rate, category_id,
			quantity, unit_price) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			l.ID, e.ID, l.Position, l.Description, l.Amount, l.VATRate, l.CategoryID, l.Quantity, l.UnitPrice); err != nil {
			return err
		}
	}
	return nil
}

// BookExpense marks a draft booked by userID.
func (q Q) BookExpense(ctx context.Context, id, userID string, now time.Time) error {
	// Category edits take the same locks, so a booked record's accounts cannot change behind it.
	if _, err := q.db.Exec(ctx, `SELECT id FROM expense_categories WHERE id IN (SELECT category_id FROM expenses WHERE id = $1
		UNION SELECT category_id FROM expense_lines WHERE expense_id = $1) ORDER BY id FOR UPDATE`, id); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `UPDATE expenses SET status = 'booked', booked_at = $2, booked_by = $3, updated_at = $2
		WHERE id = $1 AND status = 'draft'`, id, now, userID)
	return err
}

// LockExpenseBatch takes all expense locks before category locks, in one order for overlapping batches.
func (q Q) LockExpenseBatch(ctx context.Context, workspaceID string, ids []string, booking bool) error {
	if _, err := q.db.Exec(ctx, `SELECT id FROM expenses
		WHERE workspace_id = $1 AND id = ANY($2) AND deleted_at IS NULL ORDER BY id FOR UPDATE`, workspaceID, ids); err != nil {
		return err
	}
	if booking {
		_, err := q.db.Exec(ctx, `SELECT id FROM expense_categories WHERE workspace_id = $1 AND id IN
			(SELECT category_id FROM expenses WHERE workspace_id = $1 AND id = ANY($2) AND deleted_at IS NULL
				UNION SELECT l.category_id FROM expense_lines l JOIN expenses e ON e.id = l.expense_id
				WHERE e.workspace_id = $1 AND e.id = ANY($2) AND e.deleted_at IS NULL)
			ORDER BY id FOR UPDATE`, workspaceID, ids)
		return err
	}
	return nil
}

func (q Q) VoidExpense(ctx context.Context, id, userID, reason string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE expenses SET status = 'void', voided_at = $2, voided_by = $3, void_reason = $4, updated_at = $2
		WHERE id = $1 AND status = 'booked'`, id, now, userID, reason)
	return err
}

// DeleteDraftExpense soft-deletes a draft; false when there is no such live draft.
func (q Q) DeleteDraftExpense(ctx context.Context, workspaceID, id string, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE expenses SET deleted_at = $3, updated_at = $3
		WHERE workspace_id = $1 AND id = $2 AND status = 'draft' AND deleted_at IS NULL`, workspaceID, id, now)
	return tag.RowsAffected() == 1, err
}

// ExpenseFilter narrows the list and the export; zero values do not narrow.
type ExpenseFilter struct {
	Search      string
	Statuses    []string // empty: all but void
	Payment     string   // unpaid | paid | overdue | to_reimburse
	CategoryIDs []string
	Currencies  []string
	From, To    string
	TotalMin    *int64 // in cents of the expense's own currency, inclusive
	TotalMax    *int64
	Receipt     string // attached | missing
	Incomplete  bool
	IDs         []string
	Sort        string // a key of ExpenseSorts, "-" prefixed for descending
}

// ExpenseSorts maps the list's sort keys to their SQL.
var ExpenseSorts = map[string]string{"number": "e.number", "document_date": "e.document_date", "supplier": "lower(e.supplier_name)",
	"total": "e.base_total", "created_at": "e.created_at"}

var expenseNumber = regexp.MustCompile(`^#?(\d{1,18})$`)

// incompleteSQL mirrors Expense.Derive's missing fields for drafts.
const incompleteSQL = `(e.status = 'draft' AND (e.supplier_name IS NULL OR e.document_date IS NULL OR e.category_id IS NULL OR e.total = 0
	OR (e.currency <> e.base_currency AND (e.exchange_rate_date IS NULL OR e.exchange_rate_source IS NULL))
	OR (e.receipt_missing_reason IS NULL AND NOT EXISTS (SELECT 1 FROM expense_receipts r WHERE r.expense_id = e.id))
	OR (` + unnamedItemsSQL + `)))`

func (f ExpenseFilter) where(workspaceID, today string) (string, []any) {
	args := []any{workspaceID}
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	conds := []string{"e.workspace_id = $1", "e.deleted_at IS NULL"}
	if term := strings.TrimSpace(f.Search); term != "" {
		p := arg("%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(term) + "%")
		or := []string{}
		for _, col := range []string{"e.supplier_name", "e.description", "e.reference", "e.supplier_vat_number"} {
			or = append(or, col+" ILIKE "+p)
		}
		if m := expenseNumber.FindStringSubmatch(term); m != nil {
			n, _ := strconv.ParseInt(m[1], 10, 64)
			or = append(or, "e.number = "+arg(n))
		}
		conds = append(conds, "("+strings.Join(or, " OR ")+")")
	}
	if len(f.Statuses) > 0 {
		conds = append(conds, "e.status = ANY("+arg(f.Statuses)+")")
	} else if len(f.IDs) == 0 {
		conds = append(conds, "e.status <> 'void'")
	}
	switch f.Payment {
	case "unpaid", "paid":
		conds = append(conds, "e.payment_status = "+arg(f.Payment))
	case "overdue":
		conds = append(conds, "e.status <> 'void' AND e.payment_status = 'unpaid' AND e.due_date < "+arg(today)+"::date")
	case "to_reimburse":
		conds = append(conds, "e.paid_by IS NOT NULL AND e.reimbursed_on IS NULL")
	}
	if len(f.CategoryIDs) > 0 {
		conds = append(conds, "e.category_id = ANY("+arg(f.CategoryIDs)+")")
	}
	if len(f.Currencies) > 0 {
		conds = append(conds, "e.currency = ANY("+arg(f.Currencies)+")")
	}
	if f.From != "" {
		conds = append(conds, "e.document_date >= "+arg(f.From)+"::date")
	}
	if f.To != "" {
		conds = append(conds, "e.document_date <= "+arg(f.To)+"::date")
	}
	if f.TotalMin != nil {
		conds = append(conds, "e.total >= "+arg(*f.TotalMin))
	}
	if f.TotalMax != nil {
		conds = append(conds, "e.total <= "+arg(*f.TotalMax))
	}
	switch f.Receipt {
	case "attached":
		conds = append(conds, "EXISTS (SELECT 1 FROM expense_receipts r WHERE r.expense_id = e.id)")
	case "missing":
		conds = append(conds, "NOT EXISTS (SELECT 1 FROM expense_receipts r WHERE r.expense_id = e.id)")
	}
	if f.Incomplete {
		conds = append(conds, incompleteSQL)
	}
	if len(f.IDs) > 0 {
		conds = append(conds, "e.id = ANY("+arg(f.IDs)+")")
	}
	return strings.Join(conds, " AND "), args
}

func (f ExpenseFilter) orderBy() string {
	key, dir := strings.TrimPrefix(f.Sort, "-"), " ASC"
	if strings.HasPrefix(f.Sort, "-") {
		dir = " DESC"
	}
	col, ok := ExpenseSorts[key]
	if !ok {
		col, dir = ExpenseSorts["document_date"], " DESC"
	}
	return col + dir + " NULLS LAST, e.number" + dir
}

// ListExpenses returns one page (without lines) and how many match in all; limit 0 returns every match.
func (q Q) ListExpenses(ctx context.Context, workspaceID, today string, f ExpenseFilter, limit, offset int) ([]Expense, int, error) {
	where, args := f.where(workspaceID, today)
	var total int
	if err := q.db.QueryRow(ctx, `SELECT count(*) FROM expenses e WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	list := []Expense{}
	err := q.EachExpense(ctx, workspaceID, today, f, limit, offset, func(e Expense) error { list = append(list, e); return nil })
	return list, total, err
}

// EachExpense streams the filtered expenses (without lines) in order to fn (limit 0: every match).
func (q Q) EachExpense(ctx context.Context, workspaceID, today string, f ExpenseFilter, limit, offset int, fn func(Expense) error) error {
	where, args := f.where(workspaceID, today)
	page := ""
	if limit > 0 {
		page = fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset)
	}
	rows, err := q.db.Query(ctx, `SELECT `+expenseColumns+expenseFrom+` WHERE `+where+` ORDER BY `+f.orderBy()+page, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		e, err := scanExpense(rows, today)
		if err != nil {
			return err
		}
		if err := fn(e); err != nil {
			return err
		}
	}
	return rows.Err()
}

// ---- summary ----

type AmountCount struct {
	Amount invoicecalc.Money `json:"amount"`
	Count  int               `json:"count"`
}

type CategoryAmount struct {
	Category *CategoryRef      `json:"category"`
	Amount   invoicecalc.Money `json:"amount"`
}

type MonthAmount struct {
	Month  string            `json:"month"`
	Amount invoicecalc.Money `json:"amount"`
}

type ExpenseSummary struct {
	Currency    string      `json:"currency"`
	ThisMonth   AmountCount `json:"this_month"`
	LastMonth   AmountCount `json:"last_month"`
	Unpaid      AmountCount `json:"unpaid"`
	Overdue     AmountCount `json:"overdue"`
	ToReimburse AmountCount `json:"to_reimburse"`
	InputVAT    struct {
		Period string            `json:"period"`
		Amount invoicecalc.Money `json:"amount"`
	} `json:"input_vat"`
	Incomplete struct {
		Count int `json:"count"`
	} `json:"incomplete"`
	ByCategory []CategoryAmount `json:"by_category"`
	Monthly    []MonthAmount    `json:"monthly"`
	// Views counts what the list's tabs show: every currency, unlike the amounts above.
	Views struct {
		Review    int `json:"review"`
		Unpaid    int `json:"unpaid"`
		Reimburse int `json:"reimburse"`
	} `json:"views"`
}

// ExpenseSummary: the KPIs in the workspace currency (base amounts), void excluded, by document date.
func (q Q) ExpenseSummary(ctx context.Context, workspaceID, currency, today string) (ExpenseSummary, error) {
	s := ExpenseSummary{Currency: currency, ByCategory: []CategoryAmount{}, Monthly: []MonthAmount{}}
	const live = `e.workspace_id = $1 AND e.deleted_at IS NULL AND e.status <> 'void' AND e.base_currency = $2`
	err := q.db.QueryRow(ctx, `SELECT
		COALESCE(sum(e.base_total) FILTER (WHERE date_trunc('month', e.document_date) = date_trunc('month', $3::date)), 0),
		count(*) FILTER (WHERE date_trunc('month', e.document_date) = date_trunc('month', $3::date)),
		COALESCE(sum(e.base_total) FILTER (WHERE date_trunc('month', e.document_date) = date_trunc('month', $3::date - interval '1 month')), 0),
		count(*) FILTER (WHERE date_trunc('month', e.document_date) = date_trunc('month', $3::date - interval '1 month')),
		COALESCE(sum(e.base_total) FILTER (WHERE e.payment_status = 'unpaid'), 0), count(*) FILTER (WHERE e.payment_status = 'unpaid'),
		COALESCE(sum(e.base_total) FILTER (WHERE e.payment_status = 'unpaid' AND e.due_date < $3::date), 0),
		count(*) FILTER (WHERE e.payment_status = 'unpaid' AND e.due_date < $3::date),
		COALESCE(sum(e.base_total) FILTER (WHERE e.paid_by IS NOT NULL AND e.reimbursed_on IS NULL), 0),
		count(*) FILTER (WHERE e.paid_by IS NOT NULL AND e.reimbursed_on IS NULL),
		COALESCE(sum(e.base_deductible_vat) FILTER (WHERE e.status = 'booked'
			AND date_trunc('quarter', e.document_date) = date_trunc('quarter', $3::date)), 0),
		to_char($3::date, 'YYYY-"Q"Q'),
		count(*) FILTER (WHERE `+incompleteSQL+`)
		FROM expenses e WHERE `+live, workspaceID, currency, today).Scan(
		&s.ThisMonth.Amount, &s.ThisMonth.Count, &s.LastMonth.Amount, &s.LastMonth.Count, &s.Unpaid.Amount, &s.Unpaid.Count,
		&s.Overdue.Amount, &s.Overdue.Count, &s.ToReimburse.Amount, &s.ToReimburse.Count, &s.InputVAT.Amount, &s.InputVAT.Period,
		&s.Incomplete.Count)
	if err != nil {
		return s, err
	}

	err = q.db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE e.status = 'draft'),
		count(*) FILTER (WHERE e.status <> 'void' AND e.payment_status = 'unpaid'),
		count(*) FILTER (WHERE e.status <> 'void' AND e.paid_by IS NOT NULL AND e.reimbursed_on IS NULL)
		FROM expenses e WHERE e.workspace_id = $1 AND e.deleted_at IS NULL`, workspaceID).Scan(
		&s.Views.Review, &s.Views.Unpaid, &s.Views.Reimburse)
	if err != nil {
		return s, err
	}

	rows, err := q.db.Query(ctx, `SELECT c.id, c.name, c.account_code, c.preset, sum(e.base_total) FROM expenses e
		LEFT JOIN expense_categories c ON c.id = e.category_id
		WHERE `+live+` AND date_trunc('month', e.document_date) = date_trunc('month', $3::date)
		GROUP BY c.id, c.name, c.account_code, c.preset ORDER BY sum(e.base_total) DESC, c.account_code`, workspaceID, currency, today)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, name, code, preset *string
		var c CategoryAmount
		if err := rows.Scan(&id, &name, &code, &preset, &c.Amount); err != nil {
			return s, err
		}
		if id != nil {
			c.Category = &CategoryRef{ID: *id, Name: *name, AccountCode: *code, Preset: preset}
		}
		s.ByCategory = append(s.ByCategory, c)
	}
	if err := rows.Err(); err != nil {
		return s, err
	}

	months, err := q.db.Query(ctx, `SELECT to_char(m, 'YYYY-MM'), COALESCE((SELECT sum(e.base_total) FROM expenses e
			WHERE `+live+` AND date_trunc('month', e.document_date) = m), 0)
		FROM generate_series(date_trunc('month', $3::date) - interval '11 months', date_trunc('month', $3::date), interval '1 month') m
		ORDER BY m`, workspaceID, currency, today)
	if err != nil {
		return s, err
	}
	defer months.Close()
	for months.Next() {
		var m MonthAmount
		if err := months.Scan(&m.Month, &m.Amount); err != nil {
			return s, err
		}
		s.Monthly = append(s.Monthly, m)
	}
	return s, months.Err()
}

// ---- receipts ----

func (q Q) createReceipt(ctx context.Context, workspaceID, expenseID, uploaderID string, f Receipt) error {
	_, err := q.db.Exec(ctx, `INSERT INTO expense_receipts (id, expense_id, workspace_id, object_key, name, size, content_type,
		uploaded_by, created_at, sha256) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, nullif($10, ''))`,
		f.ID, expenseID, workspaceID, f.ObjectKey, f.Name, f.Size, f.ContentType, uploaderID, f.CreatedAt, f.SHA256)
	return err
}

// Receipts of an expense, newest first.
func (q Q) Receipts(ctx context.Context, expenseID string) ([]Receipt, error) {
	rows, err := q.db.Query(ctx, `SELECT `+clientFileColumns+` FROM expense_receipts f LEFT JOIN users u ON u.id = f.uploaded_by
		WHERE f.expense_id = $1 ORDER BY f.created_at DESC, f.id DESC`, expenseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Receipt{}
	for rows.Next() {
		f, err := scanClientFile(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, f)
	}
	return list, rows.Err()
}

func (q Q) Receipt(ctx context.Context, expenseID, id string) (Receipt, error) {
	return scanClientFile(q.db.QueryRow(ctx, `SELECT `+clientFileColumns+` FROM expense_receipts f
		LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.expense_id = $1 AND f.id = $2`, expenseID, id))
}

func (q Q) DeleteReceipt(ctx context.Context, expenseID, id string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM expense_receipts WHERE expense_id = $1 AND id = $2`, expenseID, id)
	return err
}

// DuplicateRef points at an earlier expense that may be the same receipt (a warning, never a block).
type DuplicateRef struct {
	ID     string  `json:"id"`
	Number int64   `json:"number"`
	Date   *string `json:"date"`
}

// DuplicateOf finds the oldest other live, non-void expense of the workspace with e's supplier and reference;
// nil when either is empty or there is none.
func (q Q) DuplicateOf(ctx context.Context, workspaceID string, e Expense) (*DuplicateRef, error) {
	if e.SupplierName == nil || e.Reference == nil {
		return nil, nil
	}
	var d DuplicateRef
	err := q.db.QueryRow(ctx, `SELECT id, number, document_date::text FROM expenses
		WHERE workspace_id = $1 AND id <> $2 AND deleted_at IS NULL AND status <> 'void'
		AND lower(supplier_name) = lower($3) AND lower(reference) = lower($4)
		ORDER BY number LIMIT 1`, workspaceID, e.ID, *e.SupplierName, *e.Reference).Scan(&d.ID, &d.Number, &d.Date)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("duplicate of %s: %w", e.ID, err)
	}
	return &d, nil
}

// CurrencyLocked: the workspace's base currency can no longer change once an invoice is issued or an expense booked.
func (q Q) CurrencyLocked(ctx context.Context, workspaceID string) (bool, error) {
	var locked bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM invoices WHERE workspace_id = $1 AND status <> 'draft')
		OR EXISTS (SELECT 1 FROM expenses WHERE workspace_id = $1 AND status <> 'draft')`, workspaceID).Scan(&locked)
	if err != nil {
		return false, fmt.Errorf("currency locked: %w", err)
	}
	return locked, nil
}

// TwoDecimalCurrency: an active ISO 4217 code with exactly 2 minor units, the only kind new input accepts
// (amounts are stored in hundredths).
func TwoDecimalCurrency(code string) bool { return twoDecimalCurrencies[code] }

var twoDecimalCurrencies = func() map[string]bool {
	set := map[string]bool{}
	for _, c := range strings.Fields(twoDecimalCodes) {
		set[c] = true
	}
	return set
}()

// ISO 4217 active codes with 2 minor units (the 0- and 3-decimal ones such as JPY and KWD are left out).
const twoDecimalCodes = "AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CNY COP " +
	"CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HTG HUF IDR ILS " +
	"INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN " +
	"MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE " +
	"SOS SRD SSP STN SVC SYP SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD UYU UZS VES WST XCD XCG YER ZAR ZMW " +
	"ZWG"
