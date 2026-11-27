// Package approvals is the optional approval before a document is issued: groups of approvers, a policy per
// document type and the approval requests of drafts. A document package (internal/invoices) calls it inside its own
// transaction with the document row locked, so approvals, edits and issuing serialise.
package approvals

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

type Service struct {
	db   *store.Store
	auth Auth
	now  func() time.Time
}

func New(db *store.Store, a Auth) *Service {
	return &Service{db: db, auth: a, now: func() time.Time { return time.Now().UTC() }}
}

// DocTypes: the document types a policy can be set for, in the order the settings list them: invoices are approved
// before they are issued, quotes before they are sent, expenses before they are booked.
var DocTypes = []string{"invoice", "credit_note", "debit_note", "corrected", "quote", "expense"}

// invoiceTypes: the types that are invoice kinds.
var invoiceTypes = DocTypes[:4]

// InvoiceType: the policy type of an invoice kind; partial, prepayment, proforma and self-billed invoices follow
// the invoices' policy.
func InvoiceType(kind string) string {
	if slices.Contains(invoiceTypes, kind) {
		return kind
	}
	return "invoice"
}

// resource: the permission resource whose read lets a member see documents of the type (quotes are under invoices).
func resource(docType string) string {
	if docType == "expense" {
		return "expenses"
	}
	return "invoices"
}

// Doc is what approvals needs of a locked document.
type Doc struct {
	Type     string // a DocTypes value
	Subject  string // the audit log's subject type ("invoice", "quote", "expense")
	Resource string // the permission resource whose read lets a member see it ("invoices", "expenses")
	ID       string
	Draft    bool // it can still be submitted and decided
	Kind     string
	Client   string // the client, or an expense's supplier
	Currency string
	Total    store.Money
}

var (
	ErrRequired     = auth.Error(http.StatusConflict, "approval_required", "This document needs approval first.", nil)
	errNotRequired  = auth.Error(http.StatusConflict, "approval_not_required", "This document does not need approval.", nil)
	errNotAllowed   = auth.Error(http.StatusForbidden, "approval_not_allowed", "You cannot approve or reject this document.", nil)
	errUnsatisfied  = auth.Error(http.StatusConflict, "approval_unsatisfiable", "Not enough team members can approve this document: add approvers to the groups in Settings → Approvals.", nil)
	errChanged      = auth.Error(http.StatusConflict, "approval_changed", "This document was changed and submitted again: review it again.", nil)
	errCommentEmpty = auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Say why the document is rejected.",
		map[string]any{"fields": map[string]string{"comment": "Say why the document is rejected."}})
)

func invalidState(msg string) error {
	return auth.Error(http.StatusConflict, "invalid_state", msg, nil)
}

// required: the document's policy applies to it now (the plan has the feature, the policy is on, has rules and
// the total reaches its minimum).
func required(ctx context.Context, q store.Q, workspaceID string, doc Doc) (store.ApprovalPolicy, bool, error) {
	p, err := q.ApprovalPolicy(ctx, workspaceID, doc.Type)
	if err != nil || !p.Enabled || len(p.Rules) == 0 {
		return p, false, err
	}
	if ok, err := q.FeatureAllowed(ctx, workspaceID, store.FeatureDocumentApprovals); err != nil || !ok {
		return p, false, err
	}
	total := doc.Total
	if total < 0 {
		total = -total
	}
	return p, p.MinTotal == nil || total >= *p.MinTotal, nil
}

// Gate refuses issuing a document whose required approval is missing. A document no policy applies to issues as
// before, without anything else read.
func (s *Service) Gate(ctx context.Context, q store.Q, workspaceID string, doc Doc) error {
	if s == nil {
		return nil
	}
	_, req, err := required(ctx, q, workspaceID, doc)
	if err != nil || !req {
		return err
	}
	open, err := q.OpenApprovalRequest(ctx, workspaceID, doc.ID)
	if err != nil {
		return err
	}
	if open == nil || open.Status != "approved" {
		return ErrRequired
	}
	return nil
}

// Reset ends the open request of a draft that was just changed: the author submits it again.
func (s *Service) Reset(ctx context.Context, q store.Q, sess store.Session, doc Doc) error {
	if s == nil {
		return nil
	}
	open, err := q.OpenApprovalRequest(ctx, sess.Workspace.ID, doc.ID)
	if err != nil || open == nil {
		return err
	}
	return s.end(ctx, q, sess, doc, open, "reset", nil)
}

// ResetAll ends every open request of the workspace: what issuing prints changed under them (the seller or the
// account in the invoice settings). subject is the documents' audit subject type.
func (s *Service) ResetAll(ctx context.Context, q store.Q, sess store.Session, subject string) error {
	if s == nil {
		return nil
	}
	ids, err := q.OpenInvoiceApprovalDrafts(ctx, sess.Workspace.ID)
	if err != nil {
		return err
	}
	for _, id := range ids {
		open, err := q.OpenApprovalRequest(ctx, sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		reason := "The invoice settings changed."
		if err := s.end(ctx, q, sess, Doc{Subject: subject, ID: id}, open, "reset", &reason); err != nil {
			return err
		}
	}
	return nil
}

// Forget removes a deleted draft's requests.
func (s *Service) Forget(ctx context.Context, q store.Q, workspaceID, docID string) error {
	if s == nil {
		return nil
	}
	return q.DeleteApprovalRequests(ctx, workspaceID, docID)
}

func (s *Service) end(ctx context.Context, q store.Q, sess store.Session, doc Doc, r *store.ApprovalRequest, status string, comment *string) error {
	if err := q.SetApprovalStatus(ctx, r.ID, status, &sess.User.ID, comment, s.now()); err != nil {
		return err
	}
	return s.audit(ctx, q, sess, doc, "approval."+status, map[string]any{"request_id": r.ID, "comment": comment})
}

func (s *Service) audit(ctx context.Context, q store.Q, sess store.Session, doc Doc, kind string, payload map[string]any) error {
	return logEvent(ctx, q, sess, s.now(), doc.Subject, doc.ID, kind, payload)
}

func logEvent(ctx context.Context, q store.Q, sess store.Session, at time.Time, subject, id, kind string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("log %s: %w", kind, err)
	}
	return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: kind, SubjectType: subject,
		SubjectID: id, ActorID: &sess.User.ID, At: at, Payload: raw})
}

// candidate: a member who may decide on documents of the resource, with their groups.
type candidate struct {
	id     string
	groups []string
}

// candidates: the members who can read the resource, with their approver groups.
func candidates(ctx context.Context, q store.Q, workspaceID, resource string) ([]candidate, error) {
	members, err := q.ListMembers(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	groups, err := q.ApprovalGroups(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	var out []candidate
	for _, m := range members {
		if !permissions.Allows(m.Role, m.Scopes, "read:"+resource) {
			continue
		}
		c := candidate{id: m.UserID}
		for _, g := range groups {
			if slices.Contains(g.MemberIDs, m.UserID) {
				c.groups = append(c.groups, g.ID)
			}
		}
		out = append(out, c)
	}
	return out, nil
}

// excluded: who never approves the document: the people who wrote it and the submitter.
func excluded(ctx context.Context, q store.Q, workspaceID, docID, submitter string) ([]string, error) {
	authors, err := q.ApprovalAuthors(ctx, workspaceID, []string{docID})
	if err != nil {
		return nil, err
	}
	return append(authors[docID], submitter), nil
}

// eligible: the candidates, other than the excluded, who fit at least one rule.
func eligible(cands []candidate, rules []store.ApprovalRule, not []string) []candidate {
	var out []candidate
	for _, c := range cands {
		if !slices.Contains(not, c.id) && slices.ContainsFunc(rules, func(r store.ApprovalRule) bool { return fits(r, c.groups) }) {
			out = append(out, c)
		}
	}
	return out
}

// Submit asks for approval of a draft its policy applies to, and tells the people who can approve it.
func (s *Service) Submit(ctx context.Context, q store.Q, sess store.Session, doc Doc) error {
	if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureDocumentApprovals); err != nil {
		return err
	}
	if !doc.Draft {
		return invalidState("Only drafts can be submitted for approval.")
	}
	p, req, err := required(ctx, q, sess.Workspace.ID, doc)
	if err != nil {
		return err
	}
	if !req {
		return errNotRequired
	}
	cands, err := candidates(ctx, q, sess.Workspace.ID, doc.Resource)
	if err != nil {
		return err
	}
	not, err := excluded(ctx, q, sess.Workspace.ID, doc.ID, sess.User.ID)
	if err != nil {
		return err
	}
	approvers := eligible(cands, p.Rules, not)
	groups := make([][]string, len(approvers))
	ids := make([]string, len(approvers))
	for i, c := range approvers {
		groups[i], ids[i] = c.groups, c.id
	}
	if !satisfied(p.Rules, groups) {
		return errUnsatisfied
	}
	r := store.ApprovalRequest{ID: auth.NewID("apr"), DocType: doc.Type, DocID: doc.ID, Rules: p.Rules, SubmittedBy: sess.User.ID,
		SubmittedAt: s.now()}
	if err := q.CreateApprovalRequest(ctx, sess.Workspace.ID, r); err == store.ErrApprovalOpen {
		return invalidState("This document is already waiting for approval or approved.")
	} else if err != nil {
		return err
	}
	if err := s.audit(ctx, q, sess, doc, "approval.submitted", map[string]any{"request_id": r.ID, "rules": p.Rules}); err != nil {
		return err
	}
	return notifications.Notify(ctx, q, sess.Workspace.ID, "approval.requested", s.notice(sess, doc, nil),
		store.NotifyTo{UserIDs: ids, Except: sess.User.ID}, s.now())
}

func (s *Service) notice(sess store.Session, doc Doc, comment *string) map[string]any {
	d := map[string]any{"doc_type": doc.Type, "doc_id": doc.ID, "kind": doc.Kind, "client": doc.Client, "currency": doc.Currency,
		"amount": doc.Total.String(), "actor": notifications.Actor(sess.User), "actor_id": sess.User.ID}
	if slices.Contains(invoiceTypes, doc.Type) {
		d["invoice_id"] = doc.ID // the invoice's link, as notifications from before quotes and expenses have it
	}
	if comment != nil {
		d["comment"] = *comment
	}
	return d
}

// Withdraw ends a pending or approved request: by its submitter, or an owner or admin.
func (s *Service) Withdraw(ctx context.Context, q store.Q, sess store.Session, doc Doc) error {
	open, err := q.OpenApprovalRequest(ctx, sess.Workspace.ID, doc.ID)
	if err != nil {
		return err
	}
	if open == nil || !doc.Draft {
		return invalidState("Nothing to withdraw: this document is not waiting for approval.")
	}
	if open.SubmittedBy != sess.User.ID && !manager(sess) {
		return errNotAllowed
	}
	return s.end(ctx, q, sess, doc, open, "withdrawn", nil)
}

func manager(sess store.Session) bool { return sess.Role == "owner" || sess.Role == "admin" }

// decider: the open request the session's person may decide on, with their groups among the rules'. requestID is
// the request the person saw: a decision never lands on content submitted again since.
func decider(ctx context.Context, q store.Q, sess store.Session, doc Doc, requestID string) (*store.ApprovalRequest, []string, error) {
	open, err := q.OpenApprovalRequest(ctx, sess.Workspace.ID, doc.ID)
	if err != nil {
		return nil, nil, err
	}
	if open == nil || open.Status != "pending" || !doc.Draft {
		return nil, nil, invalidState("This document is not waiting for approval.")
	}
	if requestID != open.ID {
		return nil, nil, errChanged
	}
	groups, err := q.ApprovalGroupsOf(ctx, sess.Workspace.ID, sess.User.ID)
	if err != nil {
		return nil, nil, err
	}
	not, err := excluded(ctx, q, sess.Workspace.ID, doc.ID, open.SubmittedBy)
	if err != nil {
		return nil, nil, err
	}
	if !mayDecide(sess, doc, open, groups, not) {
		return nil, nil, errNotAllowed
	}
	used := []string{}
	for _, r := range open.Rules {
		if r.GroupID != nil && slices.Contains(groups, *r.GroupID) && !slices.Contains(used, *r.GroupID) {
			used = append(used, *r.GroupID)
		}
	}
	return open, used, nil
}

// mayDecide: not excluded (an author or the submitter), not decided yet, can read the document and fits a rule of
// the request.
func mayDecide(sess store.Session, doc Doc, r *store.ApprovalRequest, groups, not []string) bool {
	return r.SubmittedBy != sess.User.ID && !slices.Contains(not, sess.User.ID) &&
		!slices.ContainsFunc(r.Decisions, func(d store.ApprovalDecision) bool { return d.UserID == sess.User.ID }) &&
		permissions.Allows(sess.Role, sess.Scopes, "read:"+doc.Resource) &&
		slices.ContainsFunc(r.Rules, func(rule store.ApprovalRule) bool { return fits(rule, groups) })
}

// Approve records the person's approval; the request is approved once its rules hold, and its submitter is told.
func (s *Service) Approve(ctx context.Context, q store.Q, sess store.Session, doc Doc, requestID string, comment *string) error {
	open, groups, err := decider(ctx, q, sess, doc, requestID)
	if err != nil {
		return err
	}
	d := store.ApprovalDecision{UserID: sess.User.ID, Decision: "approve", GroupIDs: groups, Comment: comment, At: s.now()}
	if err := q.AddApprovalDecision(ctx, open.ID, d); err == store.ErrApprovalDecided {
		return errNotAllowed
	} else if err != nil {
		return err
	}
	var approvers [][]string
	for _, d := range append(open.Decisions, d) {
		if d.Decision == "approve" {
			approvers = append(approvers, d.GroupIDs)
		}
	}
	complete := satisfied(open.Rules, approvers)
	if err := s.audit(ctx, q, sess, doc, "approval.approved", map[string]any{"request_id": open.ID, "comment": comment,
		"complete": complete}); err != nil {
		return err
	}
	if !complete {
		return nil
	}
	if err := q.SetApprovalStatus(ctx, open.ID, "approved", nil, nil, s.now()); err != nil {
		return err
	}
	return notifications.Notify(ctx, q, sess.Workspace.ID, "approval.approved", s.notice(sess, doc, nil),
		store.NotifyTo{UserIDs: []string{open.SubmittedBy}}, s.now())
}

// Reject sends the draft back to its author with the reason.
func (s *Service) Reject(ctx context.Context, q store.Q, sess store.Session, doc Doc, requestID string, comment *string) error {
	if comment == nil {
		return errCommentEmpty
	}
	open, groups, err := decider(ctx, q, sess, doc, requestID)
	if err != nil {
		return err
	}
	d := store.ApprovalDecision{UserID: sess.User.ID, Decision: "reject", GroupIDs: groups, Comment: comment, At: s.now()}
	if err := q.AddApprovalDecision(ctx, open.ID, d); err == store.ErrApprovalDecided {
		return errNotAllowed
	} else if err != nil {
		return err
	}
	if err := s.end(ctx, q, sess, doc, open, "rejected", comment); err != nil {
		return err
	}
	return notifications.Notify(ctx, q, sess.Workspace.ID, "approval.rejected", s.notice(sess, doc, comment),
		store.NotifyTo{UserIDs: []string{open.SubmittedBy}}, s.now())
}
