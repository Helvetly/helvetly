package store

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/eaddress"
)

// Clients, their contacts and files (docs/clients-contract.md). The structs are the API's JSON as well.

// DraftFields: the postal address a client needs before it can be billed, in form order. Both the
// is_draft flag and the draft/complete list filters derive from this list.
var DraftFields = []string{"street", "street_number", "zip", "city", "country"}

type Client struct {
	ID                 string            `json:"id"`
	Number             int64             `json:"number"`
	Name               string            `json:"name"`
	PreferredName      *string           `json:"preferred_name"`
	IsCompany          bool              `json:"is_company"`
	IsActive           bool              `json:"is_active"`
	Email              *string           `json:"email"`
	BillingEmail       *string           `json:"billing_email"`
	Phone              *string           `json:"phone"`
	Website            *string           `json:"website"`
	Street             *string           `json:"street"`
	StreetNumber       *string           `json:"street_number"`
	Apt                *string           `json:"apt"`
	Zip                *string           `json:"zip"`
	City               *string           `json:"city"`
	Country            *string           `json:"country"`
	VATNumber          *string           `json:"vat_number"`
	ElectronicAddress  *eaddress.Address `json:"electronic_address,omitempty"`
	RegistrationNumber *string           `json:"registration_number,omitempty"`
	Region             *string           `json:"region"`
	Language           *string           `json:"language"`
	Currency           *string           `json:"currency"`
	PaymentTermsDays   *int              `json:"payment_terms_days"`
	InternalID         *string           `json:"internal_id"`
	Note               *string           `json:"note"`
	Tags               []string          `json:"tags"`
	DunningEnabled     bool              `json:"dunning_enabled"`
	EInvoiceFormat     string            `json:"einvoice_format"`
	LeitwegID          *string           `json:"leitweg_id"`
	PortalEnabled      bool              `json:"portal_enabled"`
	PortalInvitedAt    *time.Time        `json:"portal_invited_at"`   // when the portal invitation last went out
	PortalSignedInAt   *time.Time        `json:"portal_signed_in_at"` // the client's first portal sign-in
	VerifiedUID        *string           `json:"verified_uid"`        // the UID the Swiss UID register knows the client under
	UIDVerifiedAt      *time.Time        `json:"uid_verified_at"`     // when the register last confirmed it
	Contacts           []Contact         `json:"contacts"`
	IsDraft            bool              `json:"is_draft"`
	MissingFields      []string          `json:"missing_fields"`
	FilesCount         int               `json:"files_count"`
	PendingChange      bool              `json:"pending_change_request"` // the client asked for a change in the portal
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
}

type Contact struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Role      *string `json:"role"`
	Email     *string `json:"email"`
	Phone     *string `json:"phone"`
	IsPrimary bool    `json:"is_primary"`
}

type ClientFile struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Size        int64     `json:"size"`
	ContentType string    `json:"content_type"`
	CreatedAt   time.Time `json:"created_at"`
	UploadedBy  *Uploader `json:"uploaded_by"` // null once the person's account is gone
	ObjectKey   string    `json:"-"`
	SHA256      string    `json:"-"` // hex, "" when not computed
}

type Uploader struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type TagCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// ClientColumns: the columns a client write may set; the keys of a write's fields map must be among them.
var ClientColumns = []string{"name", "preferred_name", "is_company", "is_active", "email", "billing_email", "phone", "website",
	"street", "street_number", "apt", "zip", "city", "country", "vat_number", "language", "currency", "payment_terms_days",
	"internal_id", "note", "tags", "electronic_address", "registration_number", "dunning_enabled", "einvoice_format", "leitweg_id", "region", "portal_enabled"}

// ContactColumns: the same for a contact (is_primary is set through its own queries).
var ContactColumns = []string{"name", "role", "email", "phone"}

// ClientSorts maps the list's sort keys to their SQL.
var ClientSorts = map[string]string{"number": "c.number", "name": "lower(c.name)", "email": "c.email", "city": "lower(c.city)",
	"created_at": "c.created_at", "updated_at": "c.updated_at"}

const clientColumns = `c.id, c.number, c.name, c.preferred_name, c.is_company, c.is_active, c.email, c.billing_email, c.phone,
	c.website, c.street, c.street_number, c.apt, c.zip, c.city, c.country, c.vat_number, c.language, c.currency,
	c.payment_terms_days, c.internal_id, c.note, c.tags, c.created_at, c.updated_at, c.electronic_address, c.registration_number, c.dunning_enabled, c.einvoice_format, c.leitweg_id, c.region, c.portal_enabled, c.portal_invited_at, c.portal_signed_in_at, c.verified_uid, c.uid_verified_at,
	(SELECT count(*) FROM document_links l JOIN documents d ON d.id = l.document_id AND d.deleted_at IS NULL
		WHERE l.target_type = 'client' AND l.target_id = c.id),
	EXISTS (SELECT 1 FROM client_change_requests r WHERE r.client_id = c.id AND r.status = 'pending'),
	COALESCE((SELECT json_agg(json_build_object('id', k.id, 'name', k.name, 'role', k.role, 'email', k.email, 'phone', k.phone,
		'is_primary', k.is_primary) ORDER BY k.is_primary DESC, k.created_at, k.id) FROM client_contacts k WHERE k.client_id = c.id), '[]')`

func scanClient(row interface{ Scan(...any) error }) (Client, error) {
	var c Client
	err := row.Scan(&c.ID, &c.Number, &c.Name, &c.PreferredName, &c.IsCompany, &c.IsActive, &c.Email, &c.BillingEmail, &c.Phone,
		&c.Website, &c.Street, &c.StreetNumber, &c.Apt, &c.Zip, &c.City, &c.Country, &c.VATNumber, &c.Language, &c.Currency,
		&c.PaymentTermsDays, &c.InternalID, &c.Note, &c.Tags, &c.CreatedAt, &c.UpdatedAt, &c.ElectronicAddress, &c.RegistrationNumber, &c.DunningEnabled, &c.EInvoiceFormat, &c.LeitwegID, &c.Region, &c.PortalEnabled, &c.PortalInvitedAt, &c.PortalSignedInAt, &c.VerifiedUID, &c.UIDVerifiedAt, &c.FilesCount, &c.PendingChange, &c.Contacts)
	address := map[string]*string{"street": c.Street, "street_number": c.StreetNumber, "zip": c.Zip, "city": c.City, "country": c.Country}
	c.MissingFields = []string{}
	for _, f := range DraftFields {
		if address[f] == nil {
			c.MissingFields = append(c.MissingFields, f)
		}
	}
	c.IsDraft = len(c.MissingFields) > 0
	return c, err
}

// assignments splits a write's fields into columns and values in a fixed order, refusing a column not in allowed.
func assignments(fields map[string]any, allowed []string) (cols []string, args []any, err error) {
	for _, col := range allowed { // a fixed order keeps the SQL stable
		v, ok := fields[col]
		if !ok {
			continue
		}
		cols, args = append(cols, col), append(args, v)
	}
	if len(cols) != len(fields) {
		return nil, nil, fmt.Errorf("client write: unknown column in %v", fields)
	}
	return cols, args, nil
}

func placeholders(from, n int) string {
	p := make([]string, n)
	for i := range p {
		p[i] = "$" + strconv.Itoa(from+i)
	}
	return strings.Join(p, ", ")
}

// CreateClient inserts a client with the workspace's next number; the counter moves in the same statement.
func (q Q) createClient(ctx context.Context, workspaceID, id string, fields map[string]any, now time.Time) error {
	cols, args, err := assignments(fields, ClientColumns)
	if err != nil {
		return err
	}
	_, err = q.db.Exec(ctx, `WITH seq AS (
			INSERT INTO workspace_counters (workspace_id, clients_seq) VALUES ($2, 1)
			ON CONFLICT (workspace_id) DO UPDATE SET clients_seq = workspace_counters.clients_seq + 1 RETURNING clients_seq)
		INSERT INTO clients (id, workspace_id, number, created_at, updated_at, `+strings.Join(cols, ", ")+`)
		SELECT $1, $2, seq.clients_seq, $3, $3, `+placeholders(4, len(cols))+` FROM seq`, append([]any{id, workspaceID, now}, args...)...)
	return err
}

// SetClientUIDVerification records the UID the register confirmed and when, or clears both (uid nil).
func (q Q) SetClientUIDVerification(ctx context.Context, workspaceID, id string, uid *string, at *time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE clients SET verified_uid = $3, uid_verified_at = $4
		WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`, workspaceID, id, uid, at)
	return err
}

func (q Q) Client(ctx context.Context, workspaceID, id string) (Client, error) {
	return scanClient(q.db.QueryRow(ctx, `SELECT `+clientColumns+` FROM clients c
		WHERE c.workspace_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`, workspaceID, id))
}

// LockClient: the live client exists (locked until the transaction ends, when called inside one).
func (q Q) LockClient(ctx context.Context, workspaceID, id string) (bool, error) {
	tag, err := q.db.Exec(ctx, `SELECT 1 FROM clients WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
		workspaceID, id)
	return tag.RowsAffected() == 1, err
}

// UpdateClient sets the given fields; false when there is no such live client.
func (q Q) UpdateClient(ctx context.Context, workspaceID, id string, fields map[string]any, now time.Time) (bool, error) {
	cols, args, err := assignments(fields, ClientColumns)
	if err != nil {
		return false, err
	}
	set := "updated_at = $3"
	for i, col := range cols {
		set += ", " + col + " = $" + strconv.Itoa(4+i)
	}
	tag, err := q.db.Exec(ctx, `UPDATE clients SET `+set+` WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
		append([]any{workspaceID, id, now}, args...)...)
	return tag.RowsAffected() == 1, err
}

// BulkClients applies activate, deactivate or delete to the live clients among ids and counts them.
func (q Q) BulkClients(ctx context.Context, workspaceID string, ids []string, action string, now time.Time) (int64, error) {
	set, ok := map[string]string{"activate": "is_active = true", "deactivate": "is_active = false", "delete": "deleted_at = $3"}[action]
	if !ok {
		return 0, fmt.Errorf("bulk clients: unknown action %q", action)
	}
	tag, err := q.db.Exec(ctx, `UPDATE clients SET `+set+`, updated_at = $3
		WHERE workspace_id = $1 AND id = ANY($2) AND deleted_at IS NULL`, workspaceID, ids, now)
	return tag.RowsAffected(), err
}

// ClientFilter narrows the list and the export; a nil pointer does not narrow.
type ClientFilter struct {
	Search    string
	Active    *bool
	Draft     *bool
	Company   *bool
	Tags      []string // lowercase; a client must have all of them
	Countries []string
	IDs       []string
	Sort      string // a key of ClientSorts, "-" prefixed for descending
}

var clientNumber = regexp.MustCompile(`^#?(\d{1,18})$`)

func (f ClientFilter) where(workspaceID string) (string, []any) {
	args := []any{workspaceID}
	arg := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	conds := []string{"c.workspace_id = $1", "c.deleted_at IS NULL"}
	if term := strings.TrimSpace(f.Search); term != "" {
		p := arg("%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(term) + "%")
		var or []string
		for _, col := range []string{"c.name", "c.preferred_name", "c.email", "c.city", "c.internal_id", "c.vat_number"} {
			or = append(or, col+" ILIKE "+p)
		}
		or = append(or, "EXISTS (SELECT 1 FROM client_contacts k WHERE k.client_id = c.id AND (k.name ILIKE "+p+" OR k.email ILIKE "+p+"))")
		if m := clientNumber.FindStringSubmatch(term); m != nil {
			n, _ := strconv.ParseInt(m[1], 10, 64)
			or = append(or, "c.number = "+arg(n))
		}
		conds = append(conds, "("+strings.Join(or, " OR ")+")")
	}
	if f.Active != nil {
		conds = append(conds, "c.is_active = "+arg(*f.Active))
	}
	if f.Company != nil {
		conds = append(conds, "c.is_company = "+arg(*f.Company))
	}
	if f.Draft != nil {
		missing := make([]string, len(DraftFields))
		for i, col := range DraftFields {
			missing[i] = "c." + col + " IS NULL"
		}
		draft := "(" + strings.Join(missing, " OR ") + ")"
		if !*f.Draft {
			draft = "NOT " + draft
		}
		conds = append(conds, draft)
	}
	if len(f.Tags) > 0 {
		// shortcut: no index serves this case-insensitive match; add a lowercased tag column with GIN at ~10k clients per workspace.
		conds = append(conds, "ARRAY(SELECT lower(t) FROM unnest(c.tags) t) @> "+arg(f.Tags))
	}
	if len(f.Countries) > 0 {
		conds = append(conds, "c.country = ANY("+arg(f.Countries)+")")
	}
	if len(f.IDs) > 0 {
		conds = append(conds, "c.id = ANY("+arg(f.IDs)+")")
	}
	return strings.Join(conds, " AND "), args
}

func (f ClientFilter) orderBy() string {
	key, dir := strings.TrimPrefix(f.Sort, "-"), " ASC"
	if strings.HasPrefix(f.Sort, "-") {
		dir = " DESC"
	}
	col, ok := ClientSorts[key]
	if !ok {
		col, dir = ClientSorts["created_at"], " DESC"
	}
	return col + dir + " NULLS LAST, c.number" + dir
}

// ListClients returns one page of the filtered clients and how many match in all; limit 0 returns every match.
func (q Q) ListClients(ctx context.Context, workspaceID string, f ClientFilter, limit, offset int) ([]Client, int, error) {
	where, args := f.where(workspaceID)
	var total int
	if err := q.db.QueryRow(ctx, `SELECT count(*) FROM clients c WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	list := []Client{}
	err := q.EachClient(ctx, workspaceID, f, limit, offset, func(c Client) error { list = append(list, c); return nil })
	return list, total, err
}

// EachClient streams the filtered clients in order to fn (limit 0: every match), so an export holds one row at a time.
func (q Q) EachClient(ctx context.Context, workspaceID string, f ClientFilter, limit, offset int, fn func(Client) error) error {
	where, args := f.where(workspaceID)
	page := ""
	if limit > 0 {
		page = fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset)
	}
	rows, err := q.db.Query(ctx, `SELECT `+clientColumns+` FROM clients c WHERE `+where+` ORDER BY `+f.orderBy()+page, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		c, err := scanClient(rows)
		if err != nil {
			return err
		}
		if err := fn(c); err != nil {
			return err
		}
	}
	return rows.Err()
}

// ClientTags: every tag on the workspace's live clients, case-insensitively merged, most used first.
func (q Q) ClientTags(ctx context.Context, workspaceID string) ([]TagCount, error) {
	rows, err := q.db.Query(ctx, `SELECT min(t), count(*) FROM clients c, unnest(c.tags) t
		WHERE c.workspace_id = $1 AND c.deleted_at IS NULL GROUP BY lower(t) ORDER BY count(*) DESC, lower(t)`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tags := []TagCount{}
	for rows.Next() {
		var t TagCount
		if err := rows.Scan(&t.Name, &t.Count); err != nil {
			return nil, err
		}
		tags = append(tags, t)
	}
	return tags, rows.Err()
}

// ---- contacts (call inside a transaction holding LockClient, so the one-primary rule holds) ----

const contactColumns = `id, name, role, email, phone, is_primary`

func scanContact(row interface{ Scan(...any) error }) (Contact, error) {
	var c Contact
	err := row.Scan(&c.ID, &c.Name, &c.Role, &c.Email, &c.Phone, &c.IsPrimary)
	return c, err
}

func (q Q) Contact(ctx context.Context, clientID, id string) (Contact, error) {
	return scanContact(q.db.QueryRow(ctx, `SELECT `+contactColumns+` FROM client_contacts WHERE client_id = $1 AND id = $2`, clientID, id))
}

// CreateContact inserts a contact; it is primary when asked or when it is the client's first.
func (q Q) CreateContact(ctx context.Context, workspaceID, clientID, id string, fields map[string]any, primary bool, now time.Time) error {
	cols, args, err := assignments(fields, ContactColumns)
	if err != nil {
		return err
	}
	if primary {
		if err := q.clearPrimaryContact(ctx, clientID); err != nil {
			return err
		}
	}
	_, err = q.db.Exec(ctx, `INSERT INTO client_contacts (id, workspace_id, client_id, is_primary, created_at, updated_at, `+
		strings.Join(cols, ", ")+`) VALUES ($1, $2, $3, $4 OR NOT EXISTS (SELECT 1 FROM client_contacts WHERE client_id = $3), $5, $5, `+
		placeholders(6, len(cols))+`)`, append([]any{id, workspaceID, clientID, primary, now}, args...)...)
	return err
}

// UpdateContact sets the given fields and, when makePrimary, makes it the client's primary contact.
func (q Q) UpdateContact(ctx context.Context, clientID, id string, fields map[string]any, makePrimary bool, now time.Time) error {
	cols, args, err := assignments(fields, ContactColumns)
	if err != nil {
		return err
	}
	if makePrimary {
		if err := q.clearPrimaryContact(ctx, clientID); err != nil {
			return err
		}
		cols, args = append(cols, "is_primary"), append(args, true)
	}
	set := "updated_at = $3"
	for i, col := range cols {
		set += ", " + col + " = $" + strconv.Itoa(4+i)
	}
	_, err = q.db.Exec(ctx, `UPDATE client_contacts SET `+set+` WHERE client_id = $1 AND id = $2`, append([]any{clientID, id, now}, args...)...)
	return err
}

func (q Q) clearPrimaryContact(ctx context.Context, clientID string) error {
	_, err := q.db.Exec(ctx, `UPDATE client_contacts SET is_primary = false WHERE client_id = $1 AND is_primary`, clientID)
	return err
}

// DeleteContact removes a contact; when it was primary, the oldest remaining one becomes primary.
func (q Q) DeleteContact(ctx context.Context, clientID, id string) error {
	var wasPrimary bool
	err := q.db.QueryRow(ctx, `DELETE FROM client_contacts WHERE client_id = $1 AND id = $2 RETURNING is_primary`, clientID, id).Scan(&wasPrimary)
	if err != nil {
		return err
	}
	if wasPrimary {
		_, err = q.db.Exec(ctx, `UPDATE client_contacts SET is_primary = true WHERE id = (
			SELECT id FROM client_contacts WHERE client_id = $1 ORDER BY created_at, id LIMIT 1)`, clientID)
	}
	return err
}

// ---- files ----
// A client's files are documents (internal/documents) linked to the client.

// clientFileColumns: also read by the expense receipts (alias f, users u).
const clientFileColumns = `f.id, f.name, f.size, f.content_type, f.created_at, f.object_key, u.id, u.name, coalesce(f.sha256, '')`

const clientFileFrom = ` FROM documents f JOIN document_links l ON l.document_id = f.id AND l.target_type = 'client'
	LEFT JOIN users u ON u.id = f.uploaded_by WHERE l.target_id = $1 AND f.deleted_at IS NULL`

func scanClientFile(row interface{ Scan(...any) error }) (ClientFile, error) {
	var f ClientFile
	var uid, uname *string
	err := row.Scan(&f.ID, &f.Name, &f.Size, &f.ContentType, &f.CreatedAt, &f.ObjectKey, &uid, &uname, &f.SHA256)
	if uid != nil {
		f.UploadedBy = &Uploader{ID: *uid, Name: *uname}
	}
	return f, err
}

// CreateClientFile files the upload in the top-level "Clients" folder, under a free name (f.Name is updated), and
// links it to the client. Run it in a transaction.
func (q Q) createClientFile(ctx context.Context, workspaceID, clientID, uploaderID string, f *ClientFile) error {
	folder, err := q.ClientsFolder(ctx, workspaceID, uploaderID, f.CreatedAt)
	if err != nil {
		return err
	}
	if err := q.LockContainer(ctx, workspaceID, &folder); err != nil {
		return err
	}
	if f.Name, err = q.FreeFileName(ctx, workspaceID, &folder, f.Name); err != nil {
		return err
	}
	var sum *string
	if f.SHA256 != "" {
		sum = &f.SHA256
	}
	if err := q.CreateDocument(ctx, workspaceID, uploaderID, Document{ID: f.ID, FolderID: &folder, Name: f.Name, Size: f.Size,
		ContentType: f.ContentType, SHA256: sum, ObjectKey: f.ObjectKey, CreatedAt: f.CreatedAt}); err != nil {
		return err
	}
	return q.AddDocumentLink(ctx, workspaceID, f.ID, "client", clientID, uploaderID, f.CreatedAt)
}

// ClientFiles: the client's live files, newest first.
func (q Q) ClientFiles(ctx context.Context, clientID string) ([]ClientFile, error) {
	rows, err := q.db.Query(ctx, `SELECT `+clientFileColumns+clientFileFrom+` ORDER BY f.created_at DESC, f.id DESC`, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	files := []ClientFile{}
	for rows.Next() {
		f, err := scanClientFile(rows)
		if err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, rows.Err()
}

func (q Q) ClientFile(ctx context.Context, clientID, id string) (ClientFile, error) {
	return scanClientFile(q.db.QueryRow(ctx, `SELECT `+clientFileColumns+clientFileFrom+` AND f.id = $2`, clientID, id))
}
