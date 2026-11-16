package store

import (
	"context"
	"errors"
	"fmt"
	"time"
)

func (q Q) CreateClient(ctx context.Context, workspaceID, id string, fields map[string]any, now time.Time) error {
	return q.admitted(ctx, workspaceID, "clients", 1, func(q Q) error { return q.createClient(ctx, workspaceID, id, fields, now) })
}

func (q Q) CreateProduct(ctx context.Context, workspaceID string, p Product) error {
	return q.admitted(ctx, workspaceID, "products", 1, func(q Q) error { return q.createProduct(ctx, workspaceID, p) })
}

// CreateExpense counts the expense's first persist in expenses_per_month, for good: editing, booking, voiding or
// deleting it gives nothing back.
func (q Q) CreateExpense(ctx context.Context, workspaceID string, e *Expense, now time.Time) error {
	return q.writeTx(ctx, func(q Q) error {
		if _, err := q.ConsumeUsage(ctx, workspaceID, UsageOp{Resource: "expenses_per_month", ID: "expense.create:" + e.ID, Amount: 1}, now); err != nil {
			return err
		}
		return q.createExpense(ctx, workspaceID, e, now)
	})
}

// CreateSignatureRequest counts the package in signatures_per_month: it is sent as it is created, whatever its
// signers, reminders or revocation.
func (q Q) CreateSignatureRequest(ctx context.Context, r SignatureRequest, userID string) error {
	return q.writeTx(ctx, func(q Q) error {
		if _, err := q.ConsumeUsage(ctx, r.WorkspaceID, UsageOp{Resource: "signatures_per_month", ID: "signature.send:" + r.ID, Amount: 1}, r.CreatedAt); err != nil {
			return err
		}
		return q.createSignatureRequest(ctx, r, userID)
	})
}

// CountIssue counts issuing the draft in invoices_per_month, in the issue's transaction, once per document: a
// refused issue rolls back and keeps the draft. A correction, credit note or debit note of an issued document counts
// nothing: whether it may be issued is its own feature's decision.
func (q Q) CountIssue(ctx context.Context, workspaceID string, inv Invoice, now time.Time) error {
	if inv.CreditedInvoice != nil && (inv.Kind == "credit_note" || inv.Kind == "debit_note" || inv.Kind == "corrected") {
		return nil
	}
	_, err := q.ConsumeUsage(ctx, workspaceID, UsageOp{Resource: "invoices_per_month", ID: "invoice.issue:" + inv.ID, Amount: 1}, now)
	return err
}

// CreateDocument files a document and counts its object in storage_bytes (ReserveObject), refused over the cap; an
// object already reserved for it (a signed result, an import's kept original) adds nothing more.
func (q Q) CreateDocument(ctx context.Context, workspaceID, userID string, d Document) error {
	return q.writeTx(ctx, func(q Q) error {
		if err := q.ReserveObject(ctx, workspaceID, d.ObjectKey, d.Size, true, d.CreatedAt); err != nil {
			return err
		}
		return q.createDocument(ctx, workspaceID, userID, d)
	})
}

func (q Q) CreateReceipt(ctx context.Context, workspaceID, expenseID, uploaderID string, f Receipt) error {
	return q.writeTx(ctx, func(q Q) error {
		if err := q.ReserveObject(ctx, workspaceID, f.ObjectKey, f.Size, true, f.CreatedAt); err != nil {
			return err
		}
		return q.createReceipt(ctx, workspaceID, expenseID, uploaderID, f)
	})
}

func (q Q) CreateClientFile(ctx context.Context, workspaceID, clientID, uploaderID string, f *ClientFile) error {
	return q.admissionTx(ctx, func(q Q) error { return q.createClientFile(ctx, workspaceID, clientID, uploaderID, f) })
}

func (q Q) SaveDraft(ctx context.Context, workspaceID string, inv Invoice, now time.Time) error {
	if q.admission == nil {
		return q.saveDraft(ctx, workspaceID, inv, now)
	}
	return q.admissionTx(ctx, func(q Q) error {
		if err := q.LockAdmission(ctx, workspaceID, "invoice_drafts"); err != nil {
			return err
		}
		var previous string
		err := q.db.QueryRow(ctx, `SELECT kind FROM invoices WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, workspaceID, inv.ID).Scan(&previous)
		switch {
		case errors.Is(err, ErrNotFound): // a new draft of any kind; issuing counts in invoices_per_month (CountIssue)
			if err := q.Admit(ctx, workspaceID, "invoice_drafts", 1); err != nil {
				return err
			}
		case err != nil:
			return err
		case previous != inv.Kind:
			return fmt.Errorf("a saved draft keeps its document kind")
		}
		return q.saveDraft(ctx, workspaceID, inv, now)
	})
}

// SaveQuote inserts the quote or writes all its fields; the caller has checked that it may change. A new quote takes
// one of quotes_retained; a revision is the same quote.
func (q Q) SaveQuote(ctx context.Context, workspaceID string, t Quote, now time.Time) error {
	if q.admission == nil {
		return q.saveQuote(ctx, workspaceID, t, now)
	}
	return q.admissionTx(ctx, func(q Q) error {
		if err := q.LockAdmission(ctx, workspaceID, "quotes_retained"); err != nil {
			return err
		}
		var exists bool
		if err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM quotes WHERE workspace_id = $1 AND id = $2)`, workspaceID, t.ID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			if err := q.Admit(ctx, workspaceID, "quotes_retained", 1); err != nil {
				return err
			}
		}
		return q.saveQuote(ctx, workspaceID, t, now)
	})
}

func (q Q) CreateInvitation(ctx context.Context, inv Invitation, tokenHash string) error {
	return q.admitted(ctx, inv.WorkspaceID, "members", 1, func(q Q) error { return q.createInvitation(ctx, inv, tokenHash) })
}

// JoinInvitedMember adds the person accepting an invitation; a new member takes a seat, so the plan must have one free.
func (q Q) JoinInvitedMember(ctx context.Context, workspaceID, userID, role string, scopes []string, now time.Time) error {
	if _, err := q.MemberRole(ctx, workspaceID, userID); err == nil {
		return q.JoinMember(ctx, workspaceID, userID, role, scopes, now)
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}
	return q.admitted(ctx, workspaceID, "members", 1, func(q Q) error { return q.JoinMember(ctx, workspaceID, userID, role, scopes, now) })
}

func (q Q) RetokenInvitation(ctx context.Context, workspaceID, id, tokenHash string, expires, now time.Time) error {
	if q.admission == nil {
		return q.retokenInvitation(ctx, workspaceID, id, tokenHash, expires, now)
	}
	return q.admissionTx(ctx, func(q Q) error {
		if err := q.LockAdmission(ctx, workspaceID, "members"); err != nil {
			return err
		}
		var expiry time.Time
		var accepted, revoked *time.Time
		if err := q.db.QueryRow(ctx, `SELECT expires_at,accepted_at,revoked_at FROM workspace_invitations WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, workspaceID, id).Scan(&expiry, &accepted, &revoked); err != nil {
			return err
		}
		if accepted == nil && revoked == nil && !expiry.After(now) && expires.After(now) {
			if err := q.Admit(ctx, workspaceID, "members", 1); err != nil {
				return err
			}
		}
		return q.retokenInvitation(ctx, workspaceID, id, tokenHash, expires, now)
	})
}

func engagementCounts(e Engagement, today string) bool {
	return (e.CancelledOn == nil || *e.CancelledOn >= today) && (e.EndDate == nil || *e.EndDate >= today)
}

func (q Q) CreateEngagement(ctx context.Context, workspaceID string, e *Engagement, now time.Time) error {
	if q.admission == nil {
		return q.createEngagement(ctx, workspaceID, e, now)
	}
	return q.admissionTx(ctx, func(q Q) error {
		ws, err := q.AdmissionWorkspace(ctx, workspaceID)
		if err != nil {
			return err
		}
		if engagementCounts(*e, ws.Today(now)) {
			if err := q.Admit(ctx, workspaceID, "engagements", 1); err != nil {
				return err
			}
		}
		return q.createEngagement(ctx, workspaceID, e, now)
	})
}

func (q Q) SaveEngagement(ctx context.Context, workspaceID string, e Engagement, now time.Time) error {
	if q.admission == nil {
		return q.saveEngagement(ctx, workspaceID, e, now)
	}
	return q.admissionTx(ctx, func(q Q) error {
		if err := q.LockAdmission(ctx, workspaceID, "engagements"); err != nil {
			return err
		}
		previous, err := q.Engagement(ctx, workspaceID, e.ID, true)
		if err != nil {
			return err
		}
		ws, err := q.AdmissionWorkspace(ctx, workspaceID)
		if err != nil {
			return err
		}
		today := ws.Today(now)
		if !engagementCounts(previous, today) && engagementCounts(e, today) {
			if err := q.Admit(ctx, workspaceID, "engagements", 1); err != nil {
				return err
			}
		}
		return q.saveEngagement(ctx, workspaceID, e, now)
	})
}
