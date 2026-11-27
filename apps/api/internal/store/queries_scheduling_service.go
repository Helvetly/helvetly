package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Reads and locks the scheduling service (internal/scheduling) needs around the tables of 00051_scheduling.sql.

// LockSchedHost serialises bookings of one host in a workspace until the transaction ends, so a slot checked under
// it cannot be taken by another booking at the same time.
func (q Q) LockSchedHost(ctx context.Context, workspaceID, hostID string) error {
	_, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('scheduling_host:' || $1 || ':' || $2, 0))`,
		workspaceID, hostID)
	return err
}

// SchedEventsByID reads the workspace's events with these ids, by id.
func (q Q) SchedEventsByID(ctx context.Context, workspaceID string, ids []string) (map[string]SchedEvent, error) {
	rows, err := q.db.Query(ctx, `SELECT `+schedEventColumns+` FROM scheduling_events WHERE workspace_id = $1 AND id = ANY ($2)`,
		workspaceID, nonNil(ids))
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (SchedEvent, error) { return scanSchedEvent(r) })
	out := make(map[string]SchedEvent, len(list))
	for _, e := range list {
		out[e.ID] = e
	}
	return out, err
}

// SchedEntryLinksOf lists the engagement entries of these occurrences, by occurrence.
func (q Q) SchedEntryLinksOf(ctx context.Context, occurrenceIDs []string) (map[string][]SchedEntryLink, error) {
	rows, err := q.db.Query(ctx, `SELECT occurrence_id, entry_id, reason FROM scheduling_occurrence_entries
		WHERE occurrence_id = ANY ($1) ORDER BY occurrence_id, reason`, nonNil(occurrenceIDs))
	if err != nil {
		return nil, err
	}
	out := map[string][]SchedEntryLink{}
	var occ string
	var l SchedEntryLink
	_, err = pgx.ForEachRow(rows, []any{&occ, &l.EntryID, &l.Reason}, func() error {
		out[occ] = append(out[occ], l)
		return nil
	})
	return out, err
}

// SchedRef is a record an occurrence points at, as its answer names it.
type SchedRef struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Number *string `json:"-"`
	Status string  `json:"-"`
	Unit   *string `json:"-"`
	Email  *string `json:"-"`
	Avatar *string `json:"-"` // a member's photo, nil without one
}

// SchedClients names the workspace's clients with these ids (deleted ones too: their past sessions stay).
func (q Q) SchedClients(ctx context.Context, workspaceID string, ids []string) (map[string]SchedRef, error) {
	return q.schedRefs(ctx, `SELECT id, name, NULL, '', NULL, email, NULL FROM clients WHERE workspace_id = $1 AND id = ANY ($2)`, workspaceID, ids)
}

// SchedParticipants: people of the workspace's clients, with their email (whatever their roles now).
func (q Q) SchedParticipants(ctx context.Context, workspaceID string, ids []string) (map[string]SchedRef, error) {
	return q.schedRefs(ctx, `SELECT id, name, NULL, '', NULL, nullif(email, '') FROM client_contacts WHERE workspace_id = $1 AND id = ANY ($2)`,
		workspaceID, ids)
}

// SchedEngagements: the engagements' number (as text), title and unit.
func (q Q) SchedEngagements(ctx context.Context, workspaceID string, ids []string) (map[string]SchedRef, error) {
	return q.schedRefs(ctx, `SELECT id, title, number::text, '', unit, NULL, NULL FROM engagements WHERE workspace_id = $1 AND id = ANY ($2)`,
		workspaceID, ids)
}

// SchedInvoices: the invoices' number and status.
func (q Q) SchedInvoices(ctx context.Context, workspaceID string, ids []string) (map[string]SchedRef, error) {
	return q.schedRefs(ctx, `SELECT id, '', number, status, NULL, NULL, NULL FROM invoices WHERE workspace_id = $1 AND id = ANY ($2)`,
		workspaceID, ids)
}

// SchedMembers names the workspace's current members (name, else email), by user id; someone who left is absent.
func (q Q) SchedMembers(ctx context.Context, workspaceID string) (map[string]SchedRef, error) {
	return q.schedRefs(ctx, `SELECT u.id, coalesce(nullif(u.name, ''), u.email), NULL, m.role, NULL, u.email, nullif(`+avatarColumn+`, '') FROM workspace_members m
		JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND (cardinality($2::text[]) = 0 OR u.id = ANY ($2))`, workspaceID, nil)
}

func (q Q) schedRefs(ctx context.Context, sql, workspaceID string, ids []string) (map[string]SchedRef, error) {
	rows, err := q.db.Query(ctx, sql, workspaceID, nonNil(ids))
	if err != nil {
		return nil, err
	}
	out := map[string]SchedRef{}
	var r SchedRef
	_, err = pgx.ForEachRow(rows, []any{&r.ID, &r.Name, &r.Number, &r.Status, &r.Unit, &r.Email, &r.Avatar}, func() error {
		out[r.ID] = r
		return nil
	})
	return out, err
}

// LiveClientByEmail is the id of the workspace's live client with this email (case-insensitive), oldest first;
// ErrNotFound for none.
func (q Q) LiveClientByEmail(ctx context.Context, workspaceID, email string) (string, error) {
	var id string
	err := q.db.QueryRow(ctx, `SELECT id FROM clients WHERE workspace_id = $1 AND deleted_at IS NULL AND lower(email) = lower($2)
		ORDER BY created_at, id LIMIT 1`, workspaceID, email).Scan(&id)
	return id, err
}

// SchedClientEngagementIDs lists the client's engagements started from the product, oldest first.
func (q Q) SchedClientEngagementIDs(ctx context.Context, workspaceID, clientID, productID string) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT id FROM engagements WHERE workspace_id = $1 AND client_id = $2 AND product_id = $3
		ORDER BY number`, workspaceID, clientID, productID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// SchedOpenCount counts the host's open occurrences starting in [from, to), for "any host" bookings.
func (q Q) SchedOpenCount(ctx context.Context, workspaceID, hostID string, from, to time.Time) (int, error) {
	var n int
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM scheduling_occurrences WHERE workspace_id = $1 AND host_user_id = $2
		AND starts_at >= $3 AND starts_at < $4 AND status IN `+openStatuses, workspaceID, hostID, from, to).Scan(&n)
	return n, err
}
