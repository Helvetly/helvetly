package approvals

import (
	"context"
	"slices"
	"time"

	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

// View is a document's approval as the document drawer shows it.
type View struct {
	Required    bool           `json:"required"`
	State       string         `json:"state"` // none, pending, approved, rejected
	RequestID   *string        `json:"request_id"`
	Rules       []RuleProgress `json:"rules"`
	CanSubmit   bool           `json:"can_submit"`
	CanDecide   bool           `json:"can_decide"`
	CanWithdraw bool           `json:"can_withdraw"`
	Comment     *string        `json:"comment"` // the rejection's reason
	Trail       []Step         `json:"trail"`
}

type RuleProgress struct {
	GroupID   *string `json:"group_id"`
	GroupName *string `json:"group_name"`
	Min       int     `json:"min"`
	Approved  int     `json:"approved"`
}

type Person struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Step is one entry of the trail: submitted, approved, rejected, withdrawn or reset.
type Step struct {
	Kind    string    `json:"kind"`
	User    *Person   `json:"user"`
	At      time.Time `json:"at"`
	Comment *string   `json:"comment"`
}

// View reads the document's approval for the session's person.
func (s *Service) View(ctx context.Context, q store.Q, sess store.Session, doc Doc) (View, error) {
	v := View{State: "none", Rules: []RuleProgress{}, Trail: []Step{}}
	if s == nil {
		return v, nil
	}
	p, req, err := required(ctx, q, sess.Workspace.ID, doc)
	if err != nil {
		return v, err
	}
	v.Required = req
	requests, err := q.ApprovalRequests(ctx, sess.Workspace.ID, doc.ID)
	if err != nil {
		return v, err
	}
	groups, err := q.ApprovalGroups(ctx, sess.Workspace.ID)
	if err != nil {
		return v, err
	}
	var people []string
	for _, r := range requests {
		people = append(people, r.SubmittedBy)
		for _, d := range r.Decisions {
			people = append(people, d.UserID)
		}
	}
	names, err := q.UserNames(ctx, people)
	if err != nil {
		return v, err
	}
	person := func(id string) *Person { return &Person{ID: id, Name: names[id]} }
	for _, r := range requests {
		v.Trail = append(v.Trail, Step{Kind: "submitted", User: person(r.SubmittedBy), At: r.SubmittedAt})
		for _, d := range r.Decisions {
			if d.Decision == "approve" {
				v.Trail = append(v.Trail, Step{Kind: "approved", User: person(d.UserID), At: d.At, Comment: d.Comment})
			}
		}
		if r.EndedAt != nil {
			step := Step{Kind: r.Status, At: *r.EndedAt, Comment: r.Comment}
			if r.EndedBy != nil {
				step.User = person(*r.EndedBy)
			}
			v.Trail = append(v.Trail, step)
		}
	}
	rules := p.Rules
	var latest *store.ApprovalRequest
	if n := len(requests); n > 0 {
		latest = &requests[n-1]
		switch latest.Status {
		case "pending", "approved", "rejected":
			v.State, v.RequestID = latest.Status, &latest.ID
		}
		if latest.Status == "rejected" {
			v.Comment = latest.Comment
		}
	}
	open := latest != nil && (latest.Status == "pending" || latest.Status == "approved")
	var approvers [][]string
	if open {
		rules = latest.Rules
		for _, d := range latest.Decisions {
			if d.Decision == "approve" {
				approvers = append(approvers, d.GroupIDs)
			}
		}
	}
	if open || req {
		filled := match(rules, approvers)
		for i, r := range rules {
			rp := RuleProgress{GroupID: r.GroupID, Min: r.Min, Approved: filled[i]}
			if r.GroupID != nil {
				if g := slices.IndexFunc(groups, func(g store.ApprovalGroup) bool { return g.ID == *r.GroupID }); g >= 0 {
					rp.GroupName = &groups[g].Name
				}
			}
			v.Rules = append(v.Rules, rp)
		}
	}
	v.CanSubmit = doc.Draft && req && !open && permissions.Allows(sess.Role, sess.Scopes, "write:"+doc.Resource)
	if open && doc.Draft {
		v.CanWithdraw = latest.SubmittedBy == sess.User.ID || manager(sess)
		mine, err := q.ApprovalGroupsOf(ctx, sess.Workspace.ID, sess.User.ID)
		if err != nil {
			return v, err
		}
		not, err := excluded(ctx, q, sess.Workspace.ID, doc.ID, latest.SubmittedBy)
		if err != nil {
			return v, err
		}
		v.CanDecide = latest.Status == "pending" && mayDecide(sess, doc, latest, mine, not)
	}
	return v, nil
}

// InboxItem is a document waiting for the session's person's decision.
type InboxItem struct {
	DocType string `json:"doc_type"`
	store.ApprovalItem
	SubmittedBy Person    `json:"submitted_by"`
	SubmittedAt time.Time `json:"submitted_at"`
}

// inbox: the drafts whose pending request the person may decide on, oldest first.
func inbox(ctx context.Context, q store.Q, sess store.Session) ([]InboxItem, error) {
	pending, err := q.PendingApprovals(ctx, sess.Workspace.ID)
	if err != nil || len(pending) == 0 {
		return []InboxItem{}, err
	}
	mine, err := q.ApprovalGroupsOf(ctx, sess.Workspace.ID, sess.User.ID)
	if err != nil {
		return nil, err
	}
	all := make([]string, len(pending))
	for i, r := range pending {
		all[i] = r.DocID
	}
	authors, err := q.ApprovalAuthors(ctx, sess.Workspace.ID, all)
	if err != nil {
		return nil, err
	}
	var ids, people []string
	var mayI []store.ApprovalRequest
	for _, r := range pending {
		if mayDecide(sess, Doc{Resource: resource(r.DocType)}, &r, mine, authors[r.DocID]) {
			mayI = append(mayI, r)
			ids, people = append(ids, r.DocID), append(people, r.SubmittedBy)
		}
	}
	if len(mayI) == 0 {
		return []InboxItem{}, nil
	}
	docs, err := q.ApprovalDraftsByID(ctx, sess.Workspace.ID, ids)
	if err != nil {
		return nil, err
	}
	names, err := q.UserNames(ctx, people)
	if err != nil {
		return nil, err
	}
	out := []InboxItem{}
	for _, r := range mayI {
		if d, ok := docs[r.DocID]; ok {
			out = append(out, InboxItem{DocType: r.DocType, ApprovalItem: d,
				SubmittedBy: Person{ID: r.SubmittedBy, Name: names[r.SubmittedBy]}, SubmittedAt: r.SubmittedAt})
		}
	}
	return out, nil
}
