package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- audit log ----

// FinancialEvent is one entry of a workspace's audit log; Seq, PrevHash and Hash are set by LogEvent.
type FinancialEvent struct {
	WorkspaceID string          `json:"-"`
	Seq         int64           `json:"seq"`
	Kind        string          `json:"kind"`
	SubjectType string          `json:"subject_type"`
	SubjectID   string          `json:"subject_id"`
	ActorID     *string         `json:"actor_id"`
	At          time.Time       `json:"at"`
	Payload     json.RawMessage `json:"payload"`
	PrevHash    string          `json:"prev_hash"` // hex; "" on the first event
	Hash        string          `json:"hash"`      // hex
}

// canonicalEvent fixes the field order of the hashed JSON; never reorder or rename its fields.
type canonicalEvent struct {
	WorkspaceID string          `json:"workspace_id"`
	Seq         int64           `json:"seq"`
	Kind        string          `json:"kind"`
	SubjectType string          `json:"subject_type"`
	SubjectID   string          `json:"subject_id"`
	ActorID     *string         `json:"actor_id"`
	At          string          `json:"at"`
	Payload     json.RawMessage `json:"payload"` // as Postgres prints the stored jsonb, so a re-read hashes the same
}

func eventHash(prev []byte, e FinancialEvent) ([]byte, error) {
	b, err := json.Marshal(canonicalEvent{e.WorkspaceID, e.Seq, e.Kind, e.SubjectType, e.SubjectID, e.ActorID,
		e.At.UTC().Format(time.RFC3339Nano), e.Payload})
	if err != nil {
		return nil, fmt.Errorf("event hash: %w", err)
	}
	h := sha256.Sum256(append(append([]byte{}, prev...), b...))
	return h[:], nil
}

// LogEvent appends e to its workspace's chain. Called on a transaction it commits or rolls back with it; the
// advisory lock on the workspace's chain head keeps concurrent writers gapless.
func (q Q) LogEvent(ctx context.Context, e FinancialEvent) error {
	if err := checkAuditKind(e.Kind); err != nil {
		return err
	}
	if len(e.Payload) == 0 {
		e.Payload = json.RawMessage(`{}`)
	}
	e.At = e.At.UTC().Truncate(time.Microsecond) // what timestamptz keeps
	err := q.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('financial_events:' || $1, 0))`,
			e.WorkspaceID); err != nil {
			return err
		}
		var prev []byte
		var payload string
		err := tx.QueryRow(ctx, `SELECT coalesce(max(seq), 0) + 1,
			coalesce((SELECT hash FROM financial_events WHERE workspace_id = $1 ORDER BY seq DESC LIMIT 1), ''::bytea),
			$2::jsonb::text FROM financial_events WHERE workspace_id = $1`, e.WorkspaceID, string(e.Payload)).
			Scan(&e.Seq, &prev, &payload)
		if err != nil {
			return err
		}
		e.Payload = json.RawMessage(payload)
		hash, err := eventHash(prev, e)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO financial_events (workspace_id, seq, kind, subject_type, subject_id, actor_id,
			at, payload, prev_hash, hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
			e.WorkspaceID, e.Seq, e.Kind, e.SubjectType, e.SubjectID, e.ActorID, e.At, payload, prev, hash)
		return err
	})
	if err != nil {
		return fmt.Errorf("log event %s: %w", e.Kind, err)
	}
	return nil
}

const eventColumns = `workspace_id, seq, kind, subject_type, subject_id, actor_id, at, payload::text, prev_hash, hash`

func scanEvent(row pgx.Row) (FinancialEvent, []byte, []byte, error) {
	var e FinancialEvent
	var payload string
	var prev, hash []byte
	err := row.Scan(&e.WorkspaceID, &e.Seq, &e.Kind, &e.SubjectType, &e.SubjectID, &e.ActorID, &e.At, &payload,
		&prev, &hash)
	e.Payload = json.RawMessage(payload)
	e.PrevHash, e.Hash = hex.EncodeToString(prev), hex.EncodeToString(hash)
	return e, prev, hash, err
}

// Events: a page of the workspace's log, oldest first, after the given seq.
func (q Q) Events(ctx context.Context, workspaceID string, after int64, limit int) ([]FinancialEvent, error) {
	rows, err := q.db.Query(ctx, `SELECT `+eventColumns+` FROM financial_events
		WHERE workspace_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`, workspaceID, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []FinancialEvent{}
	for rows.Next() {
		e, _, _, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// AuditCategories are the groups the audit log is filtered by, in the order eventCategory tests them.
var AuditCategories = []string{"payments", "invoices", "expenses", "approvals", "books", "portal", "employees", "settings"}

// eventCategory groups a kind for the reader: payments before invoices (a payment's subject is an invoice), and
// whatever is not named (approver groups, policies, other workspace settings) is settings.
const eventCategory = `CASE
	WHEN e.kind LIKE 'payment.%' OR e.kind LIKE 'refund.%' THEN 'payments'
	WHEN e.kind LIKE 'invoice.%' OR e.kind LIKE 'credit.%' OR e.kind LIKE 'plan.%' THEN 'invoices'
	WHEN e.kind LIKE 'expense.%' THEN 'expenses'
	WHEN e.kind LIKE 'approval.%' THEN 'approvals'
	WHEN e.kind LIKE 'period.%' THEN 'books'
	WHEN e.kind LIKE 'workspace.portal%' OR e.kind LIKE 'portal.%' THEN 'portal'
	WHEN e.kind LIKE 'employee.%' OR e.kind LIKE 'payroll.%' THEN 'employees'
	ELSE 'settings' END`

// AuditFilter narrows a page of the log; zero values filter nothing. After is the cursor: the last seq read.
type AuditFilter struct {
	After    int64
	Newest   bool // newest first; After then means "older than"
	Category string
	ActorID  string
	Since    *time.Time
	Before   *time.Time
	Search   string // number, client or supplier, person, kind or any payload text
	Origin   string // "imported": only entries an import made
}

// eventOrigin is where an entry came from when not from a person's own step: the payload's origin, else (for
// payments an invoice import recorded before payments carried it) "imported" when the payment was written in the
// same instant as its imported invoice.
const eventOrigin = `coalesce(e.payload->>'origin', CASE WHEN e.kind = 'payment.added' AND s.origin = 'imported'
	AND s.issued_at = e.at THEN 'imported' END)`

// AuditEntry is an event with what a reader needs to make a sentence of it, read from the records as they are now:
// the record's number, its client or supplier and currency (nil when the record is gone or is not one of these).
type AuditEntry struct {
	FinancialEvent
	Category string
	Number   *string
	Party    *string
	Currency *string
	Origin   *string
}

// AuditEntries reads a filtered page of the log. Read-only: the chained rows are only joined, never touched.
func (q Q) AuditEntries(ctx context.Context, workspaceID string, f AuditFilter, limit int) ([]AuditEntry, error) {
	args := []any{workspaceID}
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	where := []string{"e.workspace_id = $1"}
	order := "e.seq"
	if f.Newest {
		order = "e.seq DESC"
		if f.After > 0 {
			where = append(where, "e.seq < "+arg(f.After))
		}
	} else {
		where = append(where, "e.seq > "+arg(f.After))
	}
	if f.Category != "" {
		where = append(where, eventCategory+" = "+arg(f.Category))
	}
	if f.ActorID != "" {
		where = append(where, "e.actor_id = "+arg(f.ActorID))
	}
	if f.Since != nil {
		where = append(where, "e.at >= "+arg(*f.Since))
	}
	if f.Before != nil {
		where = append(where, "e.at < "+arg(*f.Before))
	}
	if f.Origin != "" {
		where = append(where, eventOrigin+" = "+arg(f.Origin))
	}
	if f.Search != "" {
		like := arg("%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(f.Search) + "%")
		where = append(where, fmt.Sprintf(`(s.number ILIKE %[1]s OR s.party ILIKE %[1]s OR u.name ILIKE %[1]s
			OR e.kind ILIKE %[1]s OR e.payload::text ILIKE %[1]s)`, like))
	}
	rows, err := q.db.Query(ctx, `SELECT e.workspace_id, e.seq, e.kind, e.subject_type, e.subject_id, e.actor_id, e.at,
		e.payload::text, e.prev_hash, e.hash, `+eventCategory+`, s.number, s.party, s.currency, `+eventOrigin+`
		FROM financial_events e
		LEFT JOIN users u ON u.id = e.actor_id
		LEFT JOIN LATERAL (
			SELECT i.number, c.name AS party, i.currency, i.origin, i.issued_at FROM invoices i JOIN clients c ON c.id = i.client_id
			WHERE e.subject_type = 'invoice' AND i.workspace_id = e.workspace_id AND i.id = e.subject_id
			UNION ALL
			SELECT t.number, c.name, t.currency, NULL, NULL FROM quotes t JOIN clients c ON c.id = t.client_id
			WHERE e.subject_type = 'quote' AND t.workspace_id = e.workspace_id AND t.id = e.subject_id
			UNION ALL
			SELECT x.number::text, x.supplier_name, x.currency, NULL, NULL FROM expenses x
			WHERE e.subject_type = 'expense' AND x.workspace_id = e.workspace_id AND x.id = e.subject_id
			LIMIT 1
		) s ON true
		WHERE `+strings.Join(where, " AND ")+` ORDER BY `+order+` LIMIT `+arg(limit), args...)
	if err != nil {
		return nil, fmt.Errorf("audit entries: %w", err)
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var a AuditEntry
		var payload string
		var prev, hash []byte
		if err := rows.Scan(&a.WorkspaceID, &a.Seq, &a.Kind, &a.SubjectType, &a.SubjectID, &a.ActorID, &a.At, &payload,
			&prev, &hash, &a.Category, &a.Number, &a.Party, &a.Currency, &a.Origin); err != nil {
			return nil, fmt.Errorf("audit entries: %w", err)
		}
		a.Payload = json.RawMessage(payload)
		a.PrevHash, a.Hash = hex.EncodeToString(prev), hex.EncodeToString(hash)
		out = append(out, a)
	}
	return out, rows.Err()
}

// AuditActors: every user who has an entry in the workspace's log and still has an account, by name.
func (q Q) AuditActors(ctx context.Context, workspaceID string) ([]User, error) {
	rows, err := q.db.Query(ctx, `SELECT u.id, u.name FROM users u WHERE u.id IN
		(SELECT DISTINCT actor_id FROM financial_events WHERE workspace_id = $1 AND actor_id IS NOT NULL)
		ORDER BY lower(u.name), u.id`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("audit actors: %w", err)
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Name); err != nil {
			return nil, fmt.Errorf("audit actors: %w", err)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// EventCount: how many entries the workspace's log has.
func (q Q) EventCount(ctx context.Context, workspaceID string) (int64, error) {
	var n int64
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM financial_events WHERE workspace_id = $1`, workspaceID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("event count: %w", err)
	}
	return n, nil
}

// VerifyChain recomputes every hash; brokenAt is the first seq that is missing, out of order or changed.
func (q Q) VerifyChain(ctx context.Context, workspaceID string) (ok bool, brokenAt int64, err error) {
	rows, err := q.db.Query(ctx, `SELECT `+eventColumns+` FROM financial_events WHERE workspace_id = $1 ORDER BY seq`,
		workspaceID)
	if err != nil {
		return false, 0, err
	}
	defer rows.Close()
	want, last := int64(1), []byte{}
	for rows.Next() {
		e, prev, hash, err := scanEvent(rows)
		if err != nil {
			return false, 0, err
		}
		if e.Seq != want || !bytes.Equal(prev, last) {
			return false, want, nil
		}
		got, err := eventHash(prev, e)
		if err != nil {
			return false, 0, err
		}
		if !bytes.Equal(got, hash) {
			return false, e.Seq, nil
		}
		want, last = want+1, hash
	}
	return rows.Err() == nil, 0, rows.Err()
}

// ---- closed periods ----

// ErrPeriodClosed: the date falls in a closed month (HTTP 409 period_closed).
var ErrPeriodClosed = errors.New("store: period closed")

type ClosedPeriod struct {
	Month    string    `json:"month"` // YYYY-MM
	ClosedAt time.Time `json:"closed_at"`
	ClosedBy *string   `json:"closed_by"`
}

// inTx runs fn in a transaction, or in a savepoint when q already is one, so xact locks last until the
// outermost commit.
func (q Q) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	db, ok := q.db.(interface {
		Begin(context.Context) (pgx.Tx, error)
	})
	if !ok {
		return errors.New("the database handle cannot begin a transaction")
	}
	return pgx.BeginFunc(ctx, db, fn)
}

const periodsLock = `hashtextextended('closed_periods:' || $1, 0)`

// CheckOpen returns ErrPeriodClosed when the civil date (YYYY-MM-DD) is in a closed month.
// It must run inside the caller's transaction: its shared lock keeps the month open until that commits.
func (q Q) CheckOpen(ctx context.Context, workspaceID, date string) error {
	d, err := time.Parse(time.DateOnly, date)
	if err != nil {
		return fmt.Errorf("check open period: %w", err)
	}
	if _, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock_shared(`+periodsLock+`)`, workspaceID); err != nil {
		return fmt.Errorf("check open period: %w", err)
	}
	var closed bool
	if err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM closed_periods WHERE workspace_id = $1 AND month = $2)`,
		workspaceID, d.Format("2006-01")).Scan(&closed); err != nil {
		return fmt.Errorf("check open period: %w", err)
	}
	if closed {
		return ErrPeriodClosed
	}
	return nil
}

// ClosePeriod closes the month; closed is false when it already was.
// It waits for transactions that passed CheckOpen and blocks new ones until it commits.
func (q Q) ClosePeriod(ctx context.Context, workspaceID, month string, by *string, at time.Time) (closed bool, err error) {
	return q.changePeriod(ctx, workspaceID, `INSERT INTO closed_periods (workspace_id, month, closed_at, closed_by)
		VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, month, at, by)
}

// ReopenPeriod opens the month again; reopened is false when it was not closed.
func (q Q) ReopenPeriod(ctx context.Context, workspaceID, month string) (reopened bool, err error) {
	return q.changePeriod(ctx, workspaceID, `DELETE FROM closed_periods WHERE workspace_id = $1 AND month = $2`, month)
}

func (q Q) changePeriod(ctx context.Context, workspaceID, sql string, args ...any) (changed bool, err error) {
	err = q.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(`+periodsLock+`)`, workspaceID); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, sql, append([]any{workspaceID}, args...)...)
		changed = tag.RowsAffected() == 1
		return err
	})
	if err != nil {
		return false, fmt.Errorf("change period: %w", err)
	}
	return changed, nil
}

// Periods: the closed months, newest first.
func (q Q) Periods(ctx context.Context, workspaceID string) ([]ClosedPeriod, error) {
	rows, err := q.db.Query(ctx, `SELECT month, closed_at, closed_by FROM closed_periods
		WHERE workspace_id = $1 ORDER BY month DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	periods := []ClosedPeriod{}
	for rows.Next() {
		var p ClosedPeriod
		if err := rows.Scan(&p.Month, &p.ClosedAt, &p.ClosedBy); err != nil {
			return nil, err
		}
		periods = append(periods, p)
	}
	return periods, rows.Err()
}

// ---- self-billing agreements ----

// ErrAgreementUsed: a self-billed invoice already relied on the agreement, so it stays.
var ErrAgreementUsed = errors.New("store: self-billing agreement already used")

type SelfBillingAgreement struct {
	ID          string     `json:"id"`
	WorkspaceID string     `json:"-"`
	ClientID    string     `json:"client_id"`
	StartsOn    string     `json:"starts_on"` // YYYY-MM-DD
	EndsOn      *string    `json:"ends_on"`   // inclusive; nil = open-ended
	AcceptedAt  *time.Time `json:"accepted_at"`
	AcceptedBy  *string    `json:"accepted_by"`
	Note        *string    `json:"note"`
	FirstUsedAt *time.Time `json:"first_used_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

const agreementColumns = `id, workspace_id, client_id, starts_on::text, ends_on::text, accepted_at, accepted_by, note,
	first_used_at, created_at`

func scanAgreement(row pgx.Row) (SelfBillingAgreement, error) {
	var a SelfBillingAgreement
	err := row.Scan(&a.ID, &a.WorkspaceID, &a.ClientID, &a.StartsOn, &a.EndsOn, &a.AcceptedAt, &a.AcceptedBy, &a.Note,
		&a.FirstUsedAt, &a.CreatedAt)
	return a, err
}

// Agreements: the client's agreements, latest start first.
func (q Q) Agreements(ctx context.Context, workspaceID, clientID string) ([]SelfBillingAgreement, error) {
	rows, err := q.db.Query(ctx, `SELECT `+agreementColumns+` FROM self_billing_agreements
		WHERE workspace_id = $1 AND client_id = $2 ORDER BY starts_on DESC, created_at DESC`, workspaceID, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []SelfBillingAgreement{}
	for rows.Next() {
		a, err := scanAgreement(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

func (q Q) CreateAgreement(ctx context.Context, a SelfBillingAgreement) error {
	_, err := q.db.Exec(ctx, `INSERT INTO self_billing_agreements (id, workspace_id, client_id, starts_on, ends_on,
		accepted_at, accepted_by, note, created_at) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9)`,
		a.ID, a.WorkspaceID, a.ClientID, a.StartsOn, a.EndsOn, a.AcceptedAt, a.AcceptedBy, a.Note, a.CreatedAt)
	return err
}

// DeleteAgreement removes an unused agreement: ErrAgreementUsed once used, ErrNotFound if not in the workspace.
func (q Q) DeleteAgreement(ctx context.Context, workspaceID, id string) error {
	var used bool
	err := q.db.QueryRow(ctx, `WITH a AS (SELECT first_used_at IS NOT NULL AS used FROM self_billing_agreements
			WHERE workspace_id = $1 AND id = $2),
		d AS (DELETE FROM self_billing_agreements WHERE workspace_id = $1 AND id = $2 AND first_used_at IS NULL)
		SELECT used FROM a`, workspaceID, id).Scan(&used)
	if err != nil {
		return err
	}
	if used {
		return ErrAgreementUsed
	}
	return nil
}

// AgreementCovering: the accepted agreement in force on the civil date (YYYY-MM-DD), nil when none; an
// unaccepted one never covers (EU VAT Directive Art. 224: prior agreement and an acceptance procedure). It locks the
// row FOR SHARE, so run it in the issuing transaction: the agreement cannot be deleted or changed until it commits.
func (q Q) AgreementCovering(ctx context.Context, workspaceID, clientID, date string, at time.Time) (*SelfBillingAgreement, error) {
	a, err := scanAgreement(q.db.QueryRow(ctx, `SELECT `+agreementColumns+` FROM self_billing_agreements
		WHERE workspace_id = $1 AND client_id = $2 AND accepted_at <= $4
		AND starts_on <= $3::date AND (ends_on IS NULL OR ends_on >= $3::date)
		ORDER BY starts_on DESC LIMIT 1 FOR SHARE`, workspaceID, clientID, date, at))
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// MarkAgreementUsed records the first self-billed invoice relying on it; later calls keep the first time.
// ErrNotFound when the agreement is gone.
func (q Q) MarkAgreementUsed(ctx context.Context, workspaceID, id string, at time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE self_billing_agreements SET first_used_at = coalesce(first_used_at, $3)
		WHERE workspace_id = $1 AND id = $2`, workspaceID, id, at)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// PeriodActivityRow is one month's invoices or expenses in one currency: what a month-end close checks.
type PeriodActivityRow struct {
	Month    string // YYYY-MM
	Source   string // "invoices" or "expenses"
	Currency string
	// Recorded: invoices issued (any status but draft) or expenses booked, by issue or document date.
	Recorded int
	// Drafts dated in the month: issuing or booking them later is refused once it is closed.
	Drafts int
	// Total: receivable invoices that are open or paid, or booked expenses.
	Total Money
}

// PeriodActivity lists the activity of the months from..to (YYYY-MM, both included), oldest first; a source the
// caller may not read is left out.
func (q Q) PeriodActivity(ctx context.Context, workspaceID, from, to string, invoices, expenses bool) ([]PeriodActivityRow, error) {
	rows, err := q.db.Query(ctx, `SELECT to_char(date_trunc('month', d), 'YYYY-MM'), src, currency,
		count(*) FILTER (WHERE recorded), count(*) FILTER (WHERE draft), coalesce(sum(total) FILTER (WHERE summed), 0)
		FROM (
			SELECT issue_date AS d, 'invoices' AS src, currency, status <> 'draft' AS recorded, status = 'draft' AS draft,
				kind IN `+receivableKinds+` AND status IN ('open', 'paid') AS summed, total
			FROM invoices WHERE $4 AND workspace_id = $1
				AND issue_date >= ($2 || '-01')::date AND issue_date < ($3 || '-01')::date + interval '1 month'
			UNION ALL
			SELECT document_date, 'expenses', currency, status = 'booked', status = 'draft', status = 'booked', total
			FROM expenses WHERE $5 AND workspace_id = $1 AND deleted_at IS NULL
				AND document_date >= ($2 || '-01')::date AND document_date < ($3 || '-01')::date + interval '1 month'
		) activity GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, workspaceID, from, to, invoices, expenses)
	if err != nil {
		return nil, fmt.Errorf("period activity: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PeriodActivityRow, error) {
		var a PeriodActivityRow
		err := r.Scan(&a.Month, &a.Source, &a.Currency, &a.Recorded, &a.Drafts, &a.Total)
		return a, err
	})
}
