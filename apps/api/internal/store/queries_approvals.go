package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Approval before issuing (internal/approvals): groups of approvers, a policy per document type and the requests.

// ErrApprovalGroupTaken: another group of the workspace has the name (case-insensitive).
var ErrApprovalGroupTaken = errors.New("approval group name taken")

// ErrApprovalOpen: the document already has a pending or approved request.
var ErrApprovalOpen = errors.New("approval request already open")

// ErrApprovalDecided: the person already decided on the request.
var ErrApprovalDecided = errors.New("approval already decided")

type ApprovalGroup struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	MemberIDs []string `json:"member_ids"`
}

// ApprovalRule: at least Min approvals from the group, or from anyone eligible when GroupID is nil.
type ApprovalRule struct {
	GroupID *string `json:"group_id"`
	Min     int     `json:"min"`
}

type ApprovalPolicy struct {
	DocType  string         `json:"doc_type"`
	Enabled  bool           `json:"enabled"`
	MinTotal *Money         `json:"min_total"`
	Rules    []ApprovalRule `json:"rules"`
}

type ApprovalDecision struct {
	UserID   string    `json:"user_id"`
	Decision string    `json:"decision"`
	GroupIDs []string  `json:"group_ids"`
	Comment  *string   `json:"comment"`
	At       time.Time `json:"at"`
}

type ApprovalRequest struct {
	ID, DocType, DocID, Status string
	Rules                      []ApprovalRule
	SubmittedBy                string
	SubmittedAt                time.Time
	EndedBy                    *string
	EndedAt                    *time.Time
	Comment                    *string
	Decisions                  []ApprovalDecision
}

func (q Q) ApprovalGroups(ctx context.Context, workspaceID string) ([]ApprovalGroup, error) {
	rows, err := q.db.Query(ctx, `SELECT g.id, g.name,
			COALESCE((SELECT array_agg(m.user_id ORDER BY m.user_id) FROM approval_group_members m WHERE m.group_id = g.id), '{}')
		FROM approval_groups g WHERE g.workspace_id = $1 ORDER BY lower(g.name)`, workspaceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ApprovalGroup, error) {
		var g ApprovalGroup
		return g, r.Scan(&g.ID, &g.Name, &g.MemberIDs)
	})
}

// SaveApprovalGroup creates the group or renames it and replaces its members; members must belong to the workspace
// (the foreign key refuses others). ErrNotFound for an unknown id, ErrApprovalGroupTaken for a taken name.
func (q Q) SaveApprovalGroup(ctx context.Context, workspaceID string, g ApprovalGroup, create bool, now time.Time) error {
	err := q.inTx(ctx, func(tx pgx.Tx) error {
		if create {
			if _, err := tx.Exec(ctx, `INSERT INTO approval_groups (id, workspace_id, name, created_at, updated_at)
				VALUES ($1, $2, $3, $4, $4)`, g.ID, workspaceID, g.Name, now); err != nil {
				return err
			}
		} else {
			tag, err := tx.Exec(ctx, `UPDATE approval_groups SET name = $3, updated_at = $4 WHERE workspace_id = $1 AND id = $2`,
				workspaceID, g.ID, g.Name, now)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return ErrNotFound
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM approval_group_members WHERE group_id = $1`, g.ID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO approval_group_members (group_id, workspace_id, user_id)
			SELECT $1, $2, unnest($3::text[]) ON CONFLICT DO NOTHING`, g.ID, workspaceID, g.MemberIDs)
		return err
	})
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" && pg.ConstraintName == "approval_groups_name" {
		return ErrApprovalGroupTaken
	}
	return err
}

func (q Q) DeleteApprovalGroup(ctx context.Context, workspaceID, id string) error {
	tag, err := q.db.Exec(ctx, `DELETE FROM approval_groups WHERE workspace_id = $1 AND id = $2`, workspaceID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// ApprovalGroupsOf: the groups the person belongs to in the workspace.
func (q Q) ApprovalGroupsOf(ctx context.Context, workspaceID, userID string) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT group_id FROM approval_group_members WHERE workspace_id = $1 AND user_id = $2
		ORDER BY group_id`, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// ApprovalPolicies: the workspace's stored policies; a type without a row has none.
func (q Q) ApprovalPolicies(ctx context.Context, workspaceID string) ([]ApprovalPolicy, error) {
	rows, err := q.db.Query(ctx, `SELECT doc_type, enabled, min_total, rules FROM approval_policies WHERE workspace_id = $1`,
		workspaceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ApprovalPolicy, error) {
		var p ApprovalPolicy
		return p, r.Scan(&p.DocType, &p.Enabled, &p.MinTotal, &p.Rules)
	})
}

// ApprovalPolicy: the type's policy, disabled when none was saved.
func (q Q) ApprovalPolicy(ctx context.Context, workspaceID, docType string) (ApprovalPolicy, error) {
	p := ApprovalPolicy{DocType: docType, Rules: []ApprovalRule{}}
	err := q.db.QueryRow(ctx, `SELECT enabled, min_total, rules FROM approval_policies WHERE workspace_id = $1 AND doc_type = $2`,
		workspaceID, docType).Scan(&p.Enabled, &p.MinTotal, &p.Rules)
	if errors.Is(err, ErrNotFound) {
		return p, nil
	}
	return p, err
}

func (q Q) SaveApprovalPolicy(ctx context.Context, workspaceID string, p ApprovalPolicy, by string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO approval_policies (workspace_id, doc_type, enabled, min_total, rules, updated_by, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (workspace_id, doc_type) DO UPDATE SET enabled = $3, min_total = $4, rules = $5, updated_by = $6, updated_at = $7`,
		workspaceID, p.DocType, p.Enabled, p.MinTotal, p.Rules, by, now)
	return err
}

const approvalRequestColumns = `r.id, r.doc_type, r.doc_id, r.status, r.rules, r.submitted_by, r.submitted_at, r.ended_by, r.ended_at,
	r.comment, COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', d.user_id, 'decision', d.decision, 'group_ids', d.group_ids,
		'comment', d.comment, 'at', d.at) ORDER BY d.at) FROM approval_decisions d WHERE d.request_id = r.id), '[]')`

func scanApprovalRequest(row pgx.Row) (ApprovalRequest, error) {
	var r ApprovalRequest
	return r, row.Scan(&r.ID, &r.DocType, &r.DocID, &r.Status, &r.Rules, &r.SubmittedBy, &r.SubmittedAt, &r.EndedBy, &r.EndedAt,
		&r.Comment, &r.Decisions)
}

// ApprovalRequests: every request of the document, oldest first (its trail).
func (q Q) ApprovalRequests(ctx context.Context, workspaceID, docID string) ([]ApprovalRequest, error) {
	rows, err := q.db.Query(ctx, `SELECT `+approvalRequestColumns+` FROM approval_requests r
		WHERE r.workspace_id = $1 AND r.doc_id = $2 ORDER BY r.submitted_at, r.id`, workspaceID, docID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ApprovalRequest, error) { return scanApprovalRequest(r) })
}

// PendingApprovals: the workspace's pending requests, oldest first.
func (q Q) PendingApprovals(ctx context.Context, workspaceID string) ([]ApprovalRequest, error) {
	rows, err := q.db.Query(ctx, `SELECT `+approvalRequestColumns+` FROM approval_requests r
		WHERE r.workspace_id = $1 AND r.status = 'pending' ORDER BY r.submitted_at, r.id`, workspaceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ApprovalRequest, error) { return scanApprovalRequest(r) })
}

// OpenApprovalRequest: the document's pending or approved request, nil when it has none.
func (q Q) OpenApprovalRequest(ctx context.Context, workspaceID, docID string) (*ApprovalRequest, error) {
	r, err := scanApprovalRequest(q.db.QueryRow(ctx, `SELECT `+approvalRequestColumns+` FROM approval_requests r
		WHERE r.workspace_id = $1 AND r.doc_id = $2 AND r.status IN ('pending', 'approved')`, workspaceID, docID))
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	return &r, err
}

func (q Q) CreateApprovalRequest(ctx context.Context, workspaceID string, r ApprovalRequest) error {
	_, err := q.db.Exec(ctx, `INSERT INTO approval_requests (id, workspace_id, doc_type, doc_id, status, rules, submitted_by, submitted_at)
		VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)`, r.ID, workspaceID, r.DocType, r.DocID, r.Rules, r.SubmittedBy, r.SubmittedAt)
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" {
		return ErrApprovalOpen
	}
	return err
}

func (q Q) AddApprovalDecision(ctx context.Context, requestID string, d ApprovalDecision) error {
	_, err := q.db.Exec(ctx, `INSERT INTO approval_decisions (request_id, user_id, decision, group_ids, comment, at)
		VALUES ($1, $2, $3, $4, $5, $6)`, requestID, d.UserID, d.Decision, d.GroupIDs, d.Comment, d.At)
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23505" {
		return ErrApprovalDecided
	}
	return err
}

// SetApprovalStatus moves a request to approved, or ends it (rejected, withdrawn, reset) by whom, with a comment.
func (q Q) SetApprovalStatus(ctx context.Context, requestID, status string, by *string, comment *string, now time.Time) error {
	ended := status != "approved"
	_, err := q.db.Exec(ctx, `UPDATE approval_requests SET status = $2,
			ended_by = CASE WHEN $5 THEN $3 END, ended_at = CASE WHEN $5 THEN $6::timestamptz END, comment = $4
		WHERE id = $1`, requestID, status, by, comment, ended, now)
	return err
}

// DeleteApprovalRequests removes a deleted draft's requests, their decisions and its authors.
func (q Q) DeleteApprovalRequests(ctx context.Context, workspaceID, docID string) error {
	if _, err := q.db.Exec(ctx, `DELETE FROM approval_authors WHERE workspace_id = $1 AND doc_id = $2`, workspaceID, docID); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `DELETE FROM approval_requests WHERE workspace_id = $1 AND doc_id = $2`, workspaceID, docID)
	return err
}

// AddApprovalAuthor records that the person wrote the draft (created or changed it).
func (q Q) AddApprovalAuthor(ctx context.Context, workspaceID, docID, userID string) error {
	_, err := q.db.Exec(ctx, `INSERT INTO approval_authors (workspace_id, doc_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
		workspaceID, docID, userID)
	return err
}

// ApprovalAuthors: the people who wrote each of the drafts, by draft; for an expense also whoever created it (an
// import too) and the member it is paid back to, who never approve their own claim.
func (q Q) ApprovalAuthors(ctx context.Context, workspaceID string, docIDs []string) (map[string][]string, error) {
	rows, err := q.db.Query(ctx, `SELECT doc_id, user_id FROM approval_authors WHERE workspace_id = $1 AND doc_id = ANY($2)
		UNION SELECT id, created_by FROM expenses WHERE workspace_id = $1 AND id = ANY($2) AND created_by IS NOT NULL
		UNION SELECT id, paid_by FROM expenses WHERE workspace_id = $1 AND id = ANY($2) AND paid_by IS NOT NULL`,
		workspaceID, docIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var doc, user string
		if err := rows.Scan(&doc, &user); err != nil {
			return nil, err
		}
		out[doc] = append(out[doc], user)
	}
	return out, rows.Err()
}

// OpenInvoiceApprovalDrafts: open approvals that can still be reset by a settings change.
func (q Q) OpenInvoiceApprovalDrafts(ctx context.Context, workspaceID string) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT r.doc_id FROM approval_requests r
		JOIN invoices i ON i.workspace_id = r.workspace_id AND i.id = r.doc_id
		WHERE r.workspace_id = $1 AND r.status IN ('pending', 'approved') AND i.status = 'draft'
		AND NOT EXISTS (SELECT 1 FROM instalment_plans p WHERE p.source_invoice_id = i.id)
		ORDER BY r.doc_id`, workspaceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// UserNames: each person's name, else their email, by id (people who left a workspace too).
func (q Q) UserNames(ctx context.Context, ids []string) (map[string]string, error) {
	rows, err := q.db.Query(ctx, `SELECT id, COALESCE(NULLIF(name, ''), email) FROM users WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[id] = name
	}
	return out, rows.Err()
}

// ApprovalItem: what the "Needs my approval" list shows of a draft waiting for approval. ClientName is an expense's
// supplier (else its description), IssueDate its document date ("" without one).
type ApprovalItem struct {
	ID         string `json:"doc_id"`
	Kind       string `json:"kind"`
	ClientName string `json:"client_name"`
	Total      Money  `json:"total"`
	Currency   string `json:"currency"`
	IssueDate  string `json:"issue_date"`
}

// ApprovalDraftsByID: the draft invoices, quotes and expenses among ids, by id.
func (q Q) ApprovalDraftsByID(ctx context.Context, workspaceID string, ids []string) (map[string]ApprovalItem, error) {
	rows, err := q.db.Query(ctx, `SELECT i.id, i.kind, `+invoiceClientName+`, i.total + i.rounding_amount, i.currency, i.issue_date::text
		FROM invoices i JOIN clients c ON c.id = i.client_id
		WHERE i.workspace_id = $1 AND i.id = ANY($2) AND i.status = 'draft'
		UNION ALL
		SELECT t.id, 'quote', c.name, t.total + t.rounding_amount, t.currency, t.issue_date::text
		FROM quotes t JOIN clients c ON c.id = t.client_id
		WHERE t.workspace_id = $1 AND t.id = ANY($2) AND t.status = 'draft'
		UNION ALL
		SELECT e.id, 'expense', COALESCE(e.supplier_name, e.description, ''), e.total, e.currency, COALESCE(e.document_date::text, '')
		FROM expenses e
		WHERE e.workspace_id = $1 AND e.id = ANY($2) AND e.status = 'draft' AND e.deleted_at IS NULL`, workspaceID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]ApprovalItem{}
	for rows.Next() {
		var i ApprovalItem
		if err := rows.Scan(&i.ID, &i.Kind, &i.ClientName, &i.Total, &i.Currency, &i.IssueDate); err != nil {
			return nil, err
		}
		out[i.ID] = i
	}
	return out, rows.Err()
}

// ApprovalGroupOpen: a pending or approved request's rules need the group.
func (q Q) ApprovalGroupOpen(ctx context.Context, workspaceID, groupID string) (bool, error) {
	var used bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM approval_requests WHERE workspace_id = $1 AND status IN ('pending', 'approved')
		AND rules @> jsonb_build_array(jsonb_build_object('group_id', $2::text)))`, workspaceID, groupID).Scan(&used)
	return used, err
}
