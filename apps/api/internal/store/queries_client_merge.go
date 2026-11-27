package store

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"
)

// A person client made a participant of a company client ("Make participant of…"): its records move onto the
// company with the participant set, and the emptied person client is deleted as client deletion does. Issued and
// imported invoices keep their buyer snapshot, number and PDF: only their client link changes, never an amount, a date
// or a financial event (the move is logged as a new one by the caller).

// MergeCounts says what moves (or moved) from the person client to the company.
type MergeCounts struct {
	Invoices      int  `json:"invoices"`
	Quotes        int  `json:"quotes"`
	Plans         int  `json:"instalment_plans"`
	Engagements   int  `json:"engagements"`
	Sessions      int  `json:"sessions"`
	Documents     int  `json:"documents"`
	Folders       int  `json:"folders"`
	Shares        int  `json:"shares"`
	PersonBuyer   int  `json:"invoices_addressed_to_person"` // moved invoices whose buyer is the person (a hint for participants mode)
	PortalEnabled bool `json:"portal_enabled"`
}

// ClientMergeCounts counts what would move from client source.
func (q Q) ClientMergeCounts(ctx context.Context, workspaceID, source string) (MergeCounts, error) {
	var c MergeCounts
	err := q.db.QueryRow(ctx, `SELECT
			(SELECT count(*) FROM invoices WHERE workspace_id = $1 AND client_id = $2),
			(SELECT count(*) FROM quotes WHERE workspace_id = $1 AND client_id = $2),
			(SELECT count(*) FROM instalment_plans WHERE workspace_id = $1 AND client_id = $2),
			(SELECT count(*) FROM engagements WHERE workspace_id = $1 AND client_id = $2 AND deleted_at IS NULL),
			(SELECT count(*) FROM scheduling_occurrences WHERE workspace_id = $1 AND client_id = $2),
			(SELECT count(DISTINCT d.id) FROM documents d WHERE d.workspace_id = $1 AND d.deleted_at IS NULL AND (
				EXISTS (SELECT 1 FROM document_links l WHERE l.document_id = d.id AND l.target_type = 'client' AND l.target_id = $2)
				OR d.folder_id IN (`+clientTree+`))),
			(SELECT count(*) FROM (`+clientTree+`) t),
			(SELECT count(*) FROM document_shares WHERE workspace_id = $1 AND client_id = $2),
			(SELECT count(*) FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.workspace_id = $1 AND i.client_id = $2
				AND lower(coalesce(i.buyer->>'name', c.name)) = lower(c.name)),
			(SELECT portal_enabled FROM clients WHERE workspace_id = $1 AND id = $2)`, workspaceID, source).
		Scan(&c.Invoices, &c.Quotes, &c.Plans, &c.Engagements, &c.Sessions, &c.Documents, &c.Folders, &c.Shares, &c.PersonBuyer,
			&c.PortalEnabled)
	return c, err
}

// clientTree: the live folders of client $2's system folder tree in workspace $1.
const clientTree = `WITH RECURSIVE t AS (
		SELECT id FROM document_folders WHERE workspace_id = $1 AND system_kind = 'client' AND system_ref = $2 AND deleted_at IS NULL
		UNION ALL SELECT f.id FROM document_folders f JOIN t ON f.parent_id = t.id WHERE f.deleted_at IS NULL)
	SELECT id FROM t`

// MergeClientIntoParticipant moves every record of person client source onto company client target with participant
// set (both locked by the caller), files its folders into the company's, and deletes source. Run it in a transaction.
func (q Q) MergeClientIntoParticipant(ctx context.Context, workspaceID, source, target, participant, userID string, now time.Time) error {
	steps := []string{
		`UPDATE invoices SET client_id = $3, participant_contact_id = coalesce(participant_contact_id, $4) WHERE workspace_id = $1 AND client_id = $2`,
		`UPDATE quotes SET client_id = $3 WHERE workspace_id = $1 AND client_id = $2`,
		`UPDATE instalment_plans SET client_id = $3 WHERE workspace_id = $1 AND client_id = $2`,
		`UPDATE engagement_entries SET participant_contact_id = $4 WHERE participant_contact_id IS NULL AND engagement_id IN (
			SELECT id FROM engagements WHERE workspace_id = $1 AND client_id = $2 AND $3 <> '')`,
		`UPDATE engagements SET client_id = $3, participant_contact_id = coalesce(participant_contact_id, $4) WHERE workspace_id = $1 AND client_id = $2`,
		`UPDATE scheduling_events SET client_id = $3, participant_contact_id = coalesce(participant_contact_id, $4) WHERE workspace_id = $1 AND client_id = $2`,
		`UPDATE scheduling_occurrences SET client_id = $3 WHERE workspace_id = $1 AND client_id = $2`,
		`UPDATE scheduling_requests SET client_id = $3 WHERE workspace_id = $1 AND client_id = $2`,
		`UPDATE import_batches SET client_id = $3 WHERE workspace_id = $1 AND client_id = $2`,
		// links: the company's where it has none of its own already
		`UPDATE document_links l SET target_id = $3 WHERE l.workspace_id = $1 AND l.target_type = 'client' AND l.target_id = $2
			AND NOT EXISTS (SELECT 1 FROM document_links o WHERE o.document_id = l.document_id AND o.target_type = 'client' AND o.target_id = $3)`,
		`DELETE FROM document_links WHERE workspace_id = $1 AND target_type = 'client' AND target_id = $2`,
		// what was shared with the person is shared with the participant
		`INSERT INTO document_participant_shares (document_id, contact_id, client_id, workspace_id, shared_by, created_at)
			SELECT document_id, $4, $3, $1, shared_by, created_at FROM document_shares WHERE workspace_id = $1 AND client_id = $2
				AND (expires_at IS NULL OR expires_at > now())
			ON CONFLICT (document_id, contact_id) DO NOTHING`,
		`DELETE FROM document_shares WHERE workspace_id = $1 AND client_id = $2`,
		`DELETE FROM portal_sessions WHERE workspace_id = $1 AND client_id = $2`,
	}
	args := []any{workspaceID, source, target, participant}
	for _, sql := range steps {
		n := 2 // each step names $1 and $2, and $3 and $4 when it uses them
		for strings.Contains(sql, "$"+strconv.Itoa(n+1)) {
			n++
		}
		if _, err := q.db.Exec(ctx, sql, args[:n]...); err != nil {
			return err
		}
	}
	if err := q.mergeClientFolders(ctx, workspaceID, source, target, userID, now); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `UPDATE clients SET deleted_at = $3, merged_into = $4, merged_participant = $5, updated_at = $3
		WHERE workspace_id = $1 AND id = $2`, workspaceID, source, now, target, participant)
	return err
}

// mergeClientFolders files the person's Clients/<person> tree into the company's Clients/<company>: a folder whose
// twin (same system kind and year, or same name) exists merges into it, any other moves over; the emptied person
// folders are deleted.
func (q Q) mergeClientFolders(ctx context.Context, workspaceID, source, target, userID string, now time.Time) error {
	var from string
	err := q.db.QueryRow(ctx, `SELECT id FROM document_folders WHERE workspace_id = $1 AND system_kind = 'client' AND system_ref = $2
		AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`, workspaceID, source).Scan(&from)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	var name string
	if err := q.db.QueryRow(ctx, `SELECT name FROM clients WHERE workspace_id = $1 AND id = $2`, workspaceID, target).Scan(&name); err != nil {
		return err
	}
	root, err := q.ClientsFolder(ctx, workspaceID, userID, now)
	if err != nil {
		return err
	}
	to, err := q.systemFolder(ctx, workspaceID, &root, "client", target, clientFolderName(name), userID, now)
	if err != nil {
		return err
	}
	return q.mergeFolder(ctx, workspaceID, from, to, now, 0)
}

func (q Q) mergeFolder(ctx context.Context, workspaceID, from, to string, now time.Time, depth int) error {
	if depth > 32 {
		return errors.New("merge folders: too deep")
	}
	if _, err := q.db.Exec(ctx, `UPDATE documents SET folder_id = $3, updated_at = $4 WHERE workspace_id = $1 AND folder_id = $2`,
		workspaceID, from, to, now); err != nil {
		return err
	}
	type child struct{ id, name, kind string }
	rows, err := q.db.Query(ctx, `SELECT id, name, coalesce(system_kind, '') FROM document_folders WHERE workspace_id = $1 AND parent_id = $2
		AND deleted_at IS NULL ORDER BY created_at, id`, workspaceID, from)
	if err != nil {
		return err
	}
	var children []child
	for rows.Next() {
		var c child
		if err := rows.Scan(&c.id, &c.name, &c.kind); err != nil {
			rows.Close()
			return err
		}
		children = append(children, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, c := range children {
		var twin string
		err := q.db.QueryRow(ctx, `SELECT id FROM document_folders WHERE workspace_id = $1 AND parent_id = $2 AND deleted_at IS NULL
			AND (lower(name) = lower($3) OR $4 <> '' AND $4 <> 'year' AND system_kind = $4) ORDER BY created_at, id LIMIT 1`,
			workspaceID, to, c.name, c.kind).Scan(&twin)
		switch {
		case err == nil:
			if err := q.mergeFolder(ctx, workspaceID, c.id, twin, now, depth+1); err != nil {
				return err
			}
		case errors.Is(err, ErrNotFound):
			if _, err := q.db.Exec(ctx, `UPDATE document_folders SET parent_id = $2, updated_at = $3 WHERE id = $1`, c.id, to, now); err != nil {
				return err
			}
		default:
			return err
		}
	}
	_, err = q.db.Exec(ctx, `DELETE FROM document_folders WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM documents WHERE folder_id = $1)
		AND NOT EXISTS (SELECT 1 FROM document_folders WHERE parent_id = $1)`, from)
	return err
}

// MergedInto: the company and participant a deleted person client was merged into ("" when it was not).
func (q Q) MergedInto(ctx context.Context, workspaceID, id string) (target, participant string, err error) {
	var t, p *string
	err = q.db.QueryRow(ctx, `SELECT merged_into, merged_participant FROM clients WHERE workspace_id = $1 AND id = $2`, workspaceID, id).Scan(&t, &p)
	return deref(t), deref(p), err
}

// MatchParticipant finds a person of the company for a name and email: the email exactly, else the whole name
// (ignoring case and spacing); "" when none or several match by name.
func (q Q) MatchParticipant(ctx context.Context, workspaceID, company, name, email string) (string, error) {
	var id string
	if email = strings.TrimSpace(email); email != "" {
		err := q.db.QueryRow(ctx, `SELECT id FROM client_contacts WHERE workspace_id = $1 AND client_id = $2 AND lower(email) = lower($3)
			ORDER BY created_at, id LIMIT 1`, workspaceID, company, email).Scan(&id)
		if err == nil || !errors.Is(err, ErrNotFound) {
			return id, err
		}
	}
	rows, err := q.db.Query(ctx, `SELECT id FROM client_contacts WHERE workspace_id = $1 AND client_id = $2
		AND lower(regexp_replace(trim(name), '\s+', ' ', 'g')) = lower(regexp_replace(trim($3), '\s+', ' ', 'g')) LIMIT 2`,
		workspaceID, company, name)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		if err := rows.Scan(&id); err != nil {
			return "", err
		}
		ids = append(ids, id)
	}
	if len(ids) != 1 {
		return "", rows.Err()
	}
	return ids[0], rows.Err()
}

// ImportParticipant finds the participant of a live company client an imported invoice's buyer is: the email exactly,
// else the whole name with the same email domain as the person or their company, else the name alone when only one
// participant has it. Empty ids when none (or several) match.
func (q Q) ImportParticipant(ctx context.Context, workspaceID, name, email string) (company, participant string, err error) {
	name, email = strings.TrimSpace(name), strings.ToLower(strings.TrimSpace(email))
	domain := ""
	if at := strings.LastIndexByte(email, '@'); at >= 0 {
		domain = email[at+1:]
	}
	const people = `SELECT c.id, k.id FROM client_contacts k JOIN clients c ON c.id = k.client_id AND c.workspace_id = k.workspace_id
		WHERE k.workspace_id = $1 AND 'participant' = ANY (k.roles) AND c.is_company AND c.deleted_at IS NULL AND `
	const sameName = `lower(regexp_replace(trim(k.name), '\s+', ' ', 'g')) = lower(regexp_replace($2, '\s+', ' ', 'g'))`
	tries := []struct {
		sql  string
		args []any
		ok   bool
	}{
		{people + `lower(k.email) = $2`, []any{workspaceID, email}, email != ""},
		{people + sameName + ` AND $3 IN (split_part(lower(k.email), '@', 2), split_part(lower(c.email), '@', 2),
			split_part(lower(c.billing_email), '@', 2), regexp_replace(lower(coalesce(c.website, '')), '^https?://(www\.)?([^/]+).*$', '\2'))`,
			[]any{workspaceID, name, domain}, name != "" && domain != ""},
		{people + sameName, []any{workspaceID, name}, name != ""},
	}
	for _, t := range tries {
		if !t.ok {
			continue
		}
		rows, err := q.db.Query(ctx, t.sql+` LIMIT 2`, t.args...)
		if err != nil {
			return "", "", err
		}
		var found [][2]string
		for rows.Next() {
			var m [2]string
			if err := rows.Scan(&m[0], &m[1]); err != nil {
				rows.Close()
				return "", "", err
			}
			found = append(found, m)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return "", "", err
		}
		if len(found) == 1 {
			return found[0][0], found[0][1], nil
		}
	}
	return "", "", nil
}
