package approvals

import (
	"errors"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

const (
	maxRules = 10
	maxMin   = 50
)

var (
	errForbidden = auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can do this.", nil)
	errGroupUsed = auth.Error(http.StatusConflict, "group_in_use",
		"A policy or a document waiting for approval uses this group: remove it from the policy first, and decide or withdraw the waiting documents.", nil)
)

func validation(field, msg string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", msg, map[string]any{"fields": map[string]string{field: msg}})
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler, managers bool) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			err := errForbidden
			if !managers || manager(sess) {
				err = h(w, r, sess)
			}
			if errors.Is(err, store.ErrNotFound) {
				err = auth.ErrNotFound
			}
			if err != nil {
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/approvals/settings", s.settings, true)
	handle("POST /api/v1/approvals/groups", s.saveGroup, true)
	handle("PATCH /api/v1/approvals/groups/{id}", s.saveGroup, true)
	handle("DELETE /api/v1/approvals/groups/{id}", s.deleteGroup, true)
	handle("PUT /api/v1/approvals/policies/{doc_type}", s.savePolicy, true)
	handle("GET /api/v1/approvals/inbox", s.inbox, false)
}

func writeJSON(w http.ResponseWriter, status int, v any) error {
	auth.WriteJSON(w, status, map[string]any{"data": v})
	return nil
}

type settings struct {
	Groups   []store.ApprovalGroup  `json:"groups"`
	Policies []store.ApprovalPolicy `json:"policies"`
}

func (s *Service) settings(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	groups, err := s.db.ApprovalGroups(ctx, sess.Workspace.ID)
	if err != nil {
		return err
	}
	stored, err := s.db.ApprovalPolicies(ctx, sess.Workspace.ID)
	if err != nil {
		return err
	}
	policies := make([]store.ApprovalPolicy, len(DocTypes))
	for i, t := range DocTypes {
		policies[i] = store.ApprovalPolicy{DocType: t, Rules: []store.ApprovalRule{}}
		if j := slices.IndexFunc(stored, func(p store.ApprovalPolicy) bool { return p.DocType == t }); j >= 0 {
			policies[i] = stored[j]
		}
	}
	return writeJSON(w, http.StatusOK, settings{Groups: groups, Policies: policies})
}

func (s *Service) saveGroup(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Name      *string   `json:"name"`
		MemberIDs *[]string `json:"member_ids"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx, id := r.Context(), r.PathValue("id")
	create := id == ""
	var g store.ApprovalGroup
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureDocumentApprovals); err != nil {
			return err
		}
		if create {
			g = store.ApprovalGroup{ID: auth.NewID("agr"), MemberIDs: []string{}}
		} else {
			groups, err := q.ApprovalGroups(ctx, sess.Workspace.ID)
			if err != nil {
				return err
			}
			i := slices.IndexFunc(groups, func(g store.ApprovalGroup) bool { return g.ID == id })
			if i < 0 {
				return store.ErrNotFound
			}
			g = groups[i]
		}
		if body.Name != nil {
			g.Name = strings.TrimSpace(*body.Name)
		}
		if g.Name == "" || utf8.RuneCountInString(g.Name) > 60 {
			return validation("name", "Name the group (at most 60 characters).")
		}
		if body.MemberIDs != nil {
			g.MemberIDs = *body.MemberIDs
		}
		err := q.SaveApprovalGroup(ctx, sess.Workspace.ID, g, create, s.now())
		if errors.Is(err, store.ErrApprovalGroupTaken) {
			return validation("name", "Another group has this name.")
		}
		if pg, ok := errors.AsType[*pgconn.PgError](err); ok && pg.Code == "23503" {
			return validation("member_ids", "Pick members of this workspace.")
		}
		if err != nil {
			return err
		}
		return logEvent(ctx, q, sess, s.now(), "workspace", sess.Workspace.ID, "approvals.group_saved",
			map[string]any{"group_id": g.ID, "name": g.Name, "member_ids": g.MemberIDs})
	})
	if err != nil {
		return err
	}
	status := http.StatusOK
	if create {
		status = http.StatusCreated
	}
	return writeJSON(w, status, g)
}

func (s *Service) deleteGroup(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, id := r.Context(), r.PathValue("id")
	err := s.db.Tx(ctx, func(q store.Q) error {
		policies, err := q.ApprovalPolicies(ctx, sess.Workspace.ID)
		if err != nil {
			return err
		}
		for _, p := range policies {
			if slices.ContainsFunc(p.Rules, func(r store.ApprovalRule) bool { return r.GroupID != nil && *r.GroupID == id }) {
				return errGroupUsed
			}
		}
		if used, err := q.ApprovalGroupOpen(ctx, sess.Workspace.ID, id); err != nil {
			return err
		} else if used {
			return errGroupUsed
		}
		if err := q.DeleteApprovalGroup(ctx, sess.Workspace.ID, id); err != nil {
			return err
		}
		return logEvent(ctx, q, sess, s.now(), "workspace", sess.Workspace.ID, "approvals.group_deleted", map[string]any{"group_id": id})
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Service) savePolicy(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Enabled  bool                 `json:"enabled"`
		MinTotal *string              `json:"min_total"`
		Rules    []store.ApprovalRule `json:"rules"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx, docType := r.Context(), r.PathValue("doc_type")
	if !slices.Contains(DocTypes, docType) {
		return store.ErrNotFound
	}
	p := store.ApprovalPolicy{DocType: docType, Enabled: body.Enabled, Rules: body.Rules}
	if p.Rules == nil {
		p.Rules = []store.ApprovalRule{}
	}
	if body.MinTotal != nil && strings.TrimSpace(*body.MinTotal) != "" {
		m, ok := invoicecalc.ParseMoney(strings.TrimSpace(*body.MinTotal))
		if !ok || m < 0 {
			return validation("min_total", "Enter an amount such as 1000 or 1000.50.")
		}
		p.MinTotal = &m
	}
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureDocumentApprovals); err != nil {
			return err
		}
		groups, err := q.ApprovalGroups(ctx, sess.Workspace.ID)
		if err != nil {
			return err
		}
		if err := checkRules(p, groups); err != nil {
			return err
		}
		if err := q.SaveApprovalPolicy(ctx, sess.Workspace.ID, p, sess.User.ID, s.now()); err != nil {
			return err
		}
		return logEvent(ctx, q, sess, s.now(), "workspace", sess.Workspace.ID, "approvals.policy_saved",
			map[string]any{"doc_type": p.DocType, "enabled": p.Enabled, "min_total": p.MinTotal, "rules": p.Rules})
	})
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, p)
}

// checkRules: an enabled policy has a rule; each rule asks 1 to 50 approvals of a group of the workspace (each
// group once) or of anyone.
func checkRules(p store.ApprovalPolicy, groups []store.ApprovalGroup) error {
	if p.Enabled && len(p.Rules) == 0 {
		return validation("rules", "Add who must approve.")
	}
	if len(p.Rules) > maxRules {
		return validation("rules", "Use at most 10 rules.")
	}
	var seen []string
	anyone := false
	for _, r := range p.Rules {
		if r.Min < 1 || r.Min > maxMin {
			return validation("rules", "Ask for 1 to 50 approvals.")
		}
		if r.GroupID == nil {
			if anyone {
				return validation("rules", "Ask for approvals from anyone once.")
			}
			anyone = true
			continue
		}
		if !slices.ContainsFunc(groups, func(g store.ApprovalGroup) bool { return g.ID == *r.GroupID }) {
			return validation("rules", "Pick a group of this workspace.")
		}
		if slices.Contains(seen, *r.GroupID) {
			return validation("rules", "Use each group once.")
		}
		seen = append(seen, *r.GroupID)
	}
	return nil
}

func (s *Service) inbox(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	items, err := inbox(r.Context(), s.db.Q, sess)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, items)
}
