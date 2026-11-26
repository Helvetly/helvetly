package store

import (
	"context"
	"strconv"
	"strings"
)

// Virtual groups of Documents: every live file has a type, a year and maybe a client, computed from what it is
// (the record it belongs to, the system folder it sits in, its tags, its name) and never stored. Grouping moves
// nothing; a group is a filter (DocumentFilter.Type, Year, Client).

// DocumentTypes: the type groups' keys, in the order they are shown.
var DocumentTypes = []string{"invoices", "quotes", "credit_notes", "receipts", "contracts", "engagements",
	"payment_confirmations", "consents", "powers_of_attorney", "other"}

// NoClient: the client key of files that belong to no client.
const NoClient = "none"

// GroupDims: what files are grouped by.
var GroupDims = []string{"type", "year", "client"}

// DocumentGroup: one virtual folder, with its files counted.
type DocumentGroup struct {
	Key   string `json:"key"`
	Label string `json:"label"` // the client's name for a client group; "" otherwise (the app names types and years)
	Count int    `json:"count"`
	Size  int64  `json:"size"`
}

func (f DocumentFilter) grouped() bool { return f.Type != "" || f.Year != 0 || f.Client != "" }

// classCTE: for every live folder of workspace $1, what its system ancestors say about the files in it: the client
// (Clients/<client>), the record type (Invoices, Quotes, …, or Expenses) and the year, each from the nearest one.
const classCTE = `WITH RECURSIVE fwalk AS (
		SELECT f.id, f.parent_id AS up, 0 AS depth,
			CASE WHEN f.system_kind = 'client' THEN f.system_ref END AS client,
			CASE WHEN f.system_kind IN ('invoices', 'quotes', 'engagements', 'signatures', 'contracts', 'expenses') THEN f.system_kind END AS kind,
			CASE WHEN f.system_kind = 'year' THEN f.name END AS year
		FROM document_folders f WHERE f.workspace_id = $1 AND f.deleted_at IS NULL
		UNION ALL
		SELECT w.id, p.parent_id, w.depth + 1,
			coalesce(w.client, CASE WHEN p.system_kind = 'client' THEN p.system_ref END),
			coalesce(w.kind, CASE WHEN p.system_kind IN ('invoices', 'quotes', 'engagements', 'signatures', 'contracts', 'expenses') THEN p.system_kind END),
			coalesce(w.year, CASE WHEN p.system_kind = 'year' THEN p.name END)
		FROM fwalk w JOIN document_folders p ON p.id = w.up AND p.workspace_id = $1 AND p.deleted_at IS NULL
		WHERE w.depth < 32),
	fctx AS (SELECT DISTINCT ON (id) id, client, kind, year FROM fwalk ORDER BY id, depth DESC)
`

// classJoins joins g (type, year, client) to documents d, after classCTE; zone is the parameter of the workspace's
// time zone, in which a timestamp's year is read. The record a file belongs to decides first (an invoice or quote
// whose PDF it is, an imported invoice's original, a receipt's expense, a signature's PDF), then its system folder,
// then its tags (AI filing's), then its name; the year is the record's, the year folder's, else the upload's. Each
// way a record matches is its own branch, so every one is an index lookup per file, never a scan of the table (audit
// A06; indexes of 00060).
func classJoins(zone string) string {
	return `LEFT JOIN fctx fx ON fx.id = d.folder_id
	LEFT JOIN LATERAL (
		SELECT c.kind, c.year, c.client FROM (
			SELECT 1 AS p, CASE WHEN i.kind = 'credit_note' THEN 'credit_notes' ELSE 'invoices' END AS kind,
				extract(year FROM i.issue_date)::int AS year, i.client_id AS client
			FROM invoices i WHERE i.workspace_id = d.workspace_id AND i.pdf_key = d.object_key
			UNION ALL
			SELECT 1, CASE WHEN i.kind = 'credit_note' THEN 'credit_notes' ELSE 'invoices' END, extract(year FROM i.issue_date)::int, i.client_id
			FROM invoices i WHERE i.workspace_id = d.workspace_id AND i.source_document_id = d.id
			UNION ALL
			SELECT 1, CASE WHEN i.kind = 'credit_note' THEN 'credit_notes' ELSE 'invoices' END, extract(year FROM i.issue_date)::int, i.client_id
			FROM document_links l JOIN invoices i ON i.id = l.target_id AND i.workspace_id = d.workspace_id
			WHERE l.document_id = d.id AND l.target_type = 'invoice'
			UNION ALL
			SELECT 2, 'quotes', extract(year FROM t.issue_date)::int, t.client_id
			FROM quotes t WHERE t.workspace_id = d.workspace_id AND t.pdf_key = d.object_key
			UNION ALL
			SELECT 2, 'quotes', extract(year FROM t.issue_date)::int, t.client_id
			FROM quote_revisions qr JOIN quotes t ON t.id = qr.quote_id AND t.workspace_id = d.workspace_id
			WHERE qr.pdf_key = d.object_key
			UNION ALL
			SELECT 3, 'receipts', extract(year FROM coalesce(e.document_date, (e.created_at AT TIME ZONE ` + zone + `::text)::date))::int, NULL
			FROM document_links l JOIN expenses e ON e.id = l.target_id AND e.workspace_id = d.workspace_id
			WHERE l.document_id = d.id AND l.target_type = 'expense'
			UNION ALL
			SELECT 4, 'contracts', extract(year FROM coalesce(s.completed_at, s.created_at) AT TIME ZONE ` + zone + `::text)::int, NULL
			FROM signature_requests s WHERE s.workspace_id = d.workspace_id AND s.document_id = d.id
			UNION ALL
			SELECT 4, 'contracts', extract(year FROM coalesce(s.completed_at, s.created_at) AT TIME ZONE ` + zone + `::text)::int, NULL
			FROM signature_requests s WHERE s.workspace_id = d.workspace_id AND s.signed_document_id = d.id
			UNION ALL
			SELECT 4, 'contracts', extract(year FROM coalesce(s.completed_at, s.created_at) AT TIME ZONE ` + zone + `::text)::int, NULL
			FROM document_links l JOIN signature_requests s ON s.id = l.target_id AND s.workspace_id = d.workspace_id
			WHERE l.document_id = d.id AND l.target_type = 'signature'
		) c ORDER BY c.p, c.year DESC NULLS LAST LIMIT 1) rec ON true
	CROSS JOIN LATERAL (SELECT
		coalesce(rec.kind, CASE fx.kind WHEN 'invoices' THEN 'invoices' WHEN 'quotes' THEN 'quotes' WHEN 'engagements' THEN 'engagements'
				WHEN 'signatures' THEN 'contracts' WHEN 'contracts' THEN 'contracts' WHEN 'expenses' THEN 'receipts' END,
			CASE WHEN d.auto_tags && '{payment-confirmation}' THEN 'payment_confirmations'
				WHEN d.auto_tags && '{consent}' THEN 'consents'
				WHEN d.auto_tags && '{power-of-attorney}' THEN 'powers_of_attorney' END,
			CASE WHEN d.tags && '{credit-note,credit-notes,gutschrift,avoir,nota-di-credito}' THEN 'credit_notes'
				WHEN d.tags && '{invoice,invoices,rechnung,facture,fattura,partial-invoice,prepayment-invoice,corrected-invoice,proforma-invoice,self-billed-invoice,debit-note}' THEN 'invoices'
				WHEN d.tags && '{quote,quotes,offer,offerte,angebot,devis,preventivo}' THEN 'quotes'
				WHEN d.tags && '{receipt,receipts,expense,quittung,beleg,quittance,ricevuta}' THEN 'receipts'
				WHEN d.tags && '{contract,contracts,agreement,signature,vertrag,contrat,contratto}' THEN 'contracts'
				WHEN d.tags && '{engagement,engagements,mandate,mandat}' THEN 'engagements' END,
			CASE WHEN lower(d.name) ~ '^(credit[-_ ]?note|gutschrift)' THEN 'credit_notes'
				WHEN lower(d.name) ~ '^(invoice|rechnung|facture|fattura)' THEN 'invoices'
				WHEN lower(d.name) ~ '^(quote|offerte|angebot|devis)' THEN 'quotes'
				WHEN lower(d.name) ~ '^(receipt|quittung|beleg)' THEN 'receipts'
				WHEN lower(d.name) ~ '^(contract|vertrag|contrat)' THEN 'contracts' END,
			'other') AS type,
		coalesce(rec.year, CASE WHEN fx.year ~ '^[0-9]{4}$' THEN fx.year::int END,
			extract(year FROM d.created_at AT TIME ZONE ` + zone + `::text)::int) AS year,
		coalesce(rec.client, fx.client, (SELECT min(l.target_id) FROM document_links l
			WHERE l.document_id = d.id AND l.target_type = 'client'), '` + NoClient + `') AS client) g `
}

// documentWhere: the conditions of f on live general files d of workspace $1 (HR files are never documents here).
func documentWhere(f DocumentFilter, arg func(any) string) []string {
	where := []string{"d.workspace_id = $1", "d.deleted_at IS NULL", "NOT d.hr_private"}
	switch f.Folder {
	case "":
	case "root":
		where = append(where, "d.folder_id IS NULL")
	default:
		where = append(where, "d.folder_id = "+arg(f.Folder))
	}
	if f.Search != "" {
		escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(f.Search)
		where = append(where, "d.name ILIKE "+arg("%"+escaped+"%"))
	}
	if len(f.ContentTypes) > 0 {
		where = append(where, "d.content_type = ANY("+arg(f.ContentTypes)+")")
	}
	if f.UploadedBy != "" {
		where = append(where, "d.uploaded_by = "+arg(f.UploadedBy))
	}
	if f.From != "" {
		where = append(where, "d.created_at >= "+dayStart(arg(f.From), arg(zoneOr(f.Zone)), 0))
	}
	if f.To != "" {
		where = append(where, "d.created_at < "+dayStart(arg(f.To), arg(zoneOr(f.Zone)), 1))
	}
	if f.ClientID != "" {
		where = append(where, "EXISTS (SELECT 1 FROM document_links l WHERE l.document_id = d.id AND l.target_type = 'client' AND l.target_id = "+
			arg(f.ClientID)+")")
	}
	if f.Tag != "" {
		tag := arg(f.Tag)
		match := tag + " = ANY(d.tags)"
		// Bookmarks filtering by the former year tag include the more precise automatic month tags.
		if len(f.Tag) == len("year-2000") && strings.HasPrefix(f.Tag, "year-") {
			match = "(" + match + " OR EXISTS (SELECT 1 FROM unnest(d.auto_tags) t WHERE left(t, 9) = " + tag + " AND t ~ '^year-[0-9]{4}-(0[1-9]|1[0-2])$'))"
		}
		where = append(where, match)
	}
	if f.Type != "" {
		where = append(where, "g.type = "+arg(f.Type))
	}
	if f.Year != 0 {
		where = append(where, "g.year = "+arg(f.Year))
	}
	if f.Client != "" {
		where = append(where, "g.client = "+arg(f.Client))
	}
	return where
}

// groupedFrom: the classified files of f, for a query over g; its arguments start with the workspace.
func groupedFrom(workspaceID string, f DocumentFilter) (string, []any) {
	args := []any{workspaceID}
	arg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	where := documentWhere(f, arg)
	return classCTE + ` %s FROM documents d ` + classJoins(arg(zoneOr(f.Zone))) + ` LEFT JOIN clients gc ON gc.id = g.client AND gc.workspace_id = $1
		WHERE ` + strings.Join(where, " AND "), args
}

// DocumentGroups: the groups of the files matching f by one of GroupDims, each with its files counted, by key.
func (q Q) DocumentGroups(ctx context.Context, workspaceID string, f DocumentFilter, by string) ([]DocumentGroup, error) {
	from, args := groupedFrom(workspaceID, f)
	col := map[string]string{"type": "g.type", "year": "g.year::text", "client": "g.client"}[by]
	label := "''"
	if by == "client" {
		label = "coalesce(min(gc.name), '')"
	}
	rows, err := q.db.Query(ctx, strings.Replace(from, "%s", "SELECT "+col+", "+label+", count(*), coalesce(sum(d.size), 0)", 1)+
		" GROUP BY 1 ORDER BY 1", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []DocumentGroup{}
	for rows.Next() {
		var g DocumentGroup
		if err := rows.Scan(&g.Key, &g.Label, &g.Count, &g.Size); err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

// GroupedFile: a file to put in a group's ZIP, with its group keys and its client's name.
type GroupedFile struct {
	ID, Name, ObjectKey, ContentType string
	Size                             int64
	Type, Client, ClientName         string
	Year                             int
}

// GroupedFiles: up to limit files matching f, oldest first.
func (q Q) GroupedFiles(ctx context.Context, workspaceID string, f DocumentFilter, limit int) ([]GroupedFile, error) {
	from, args := groupedFrom(workspaceID, f)
	args = append(args, limit)
	rows, err := q.db.Query(ctx, strings.Replace(from, "%s", `SELECT d.id, d.name, d.object_key, d.content_type, d.size,
		g.type, g.year, g.client, coalesce(gc.name, '')`, 1)+" ORDER BY d.created_at, d.id LIMIT $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GroupedFile
	for rows.Next() {
		var g GroupedFile
		if err := rows.Scan(&g.ID, &g.Name, &g.ObjectKey, &g.ContentType, &g.Size, &g.Type, &g.Year, &g.Client, &g.ClientName); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}
