package invoices

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"helvetly.com/api/internal/approvals"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
)

func (e *env) userID(b *browser) string {
	e.t.Helper()
	var id string
	if err := e.raw.QueryRow(context.Background(), `SELECT user_id FROM sessions WHERE csrf_token = $1`, b.csrf).Scan(&id); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *env) group(b *browser, name string, members ...*browser) string {
	e.t.Helper()
	ids := []string{}
	for _, m := range members {
		ids = append(ids, e.userID(m))
	}
	var out struct{ Data struct{ ID string } }
	e.do(b, "POST", "/api/v1/approvals/groups", map[string]any{"name": name, "member_ids": ids}, http.StatusCreated, &out)
	return out.Data.ID
}

func rule(group string, n int) map[string]any {
	if group == "" {
		return map[string]any{"group_id": nil, "min": n}
	}
	return map[string]any{"group_id": group, "min": n}
}

func (e *env) policy(b *browser, docType string, minTotal any, rules ...map[string]any) {
	e.t.Helper()
	e.do(b, "PUT", "/api/v1/approvals/policies/"+docType, map[string]any{"enabled": true, "min_total": minTotal, "rules": rules},
		http.StatusOK, nil)
}

func (e *env) approval(b *browser, method, p string, body any, want int) approvals.View {
	e.t.Helper()
	var out struct{ Data approvals.View }
	e.do(b, method, p, body, want, &out)
	return out.Data
}

func (e *env) auditKinds(ws, id string) []string {
	e.t.Helper()
	rows, err := e.raw.Query(context.Background(), `SELECT kind FROM financial_events WHERE workspace_id = $1 AND subject_id = $2
		AND kind LIKE 'approval.%' ORDER BY seq`, ws, id)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	var kinds []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			e.t.Fatal(err)
		}
		kinds = append(kinds, k)
	}
	return kinds
}

func (e *env) notified(ws, event string) []string {
	e.t.Helper()
	rows, err := e.raw.Query(context.Background(), `SELECT user_id FROM notifications WHERE workspace_id = $1 AND event = $2 ORDER BY user_id`, ws, event)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			e.t.Fatal(err)
		}
		ids = append(ids, id)
	}
	return ids
}

// team: an author (the owner) and three members on Business; Accountants are acc1 and acc2, Management mgr and the author.
type team struct{ author, acc1, acc2, mgr *browser }

func (e *env) team() (team, string, string, string) {
	b, clientID := e.readyOn(billing.Business)
	t := team{author: b, acc1: e.join(b.workspace, "member"), acc2: e.join(b.workspace, "member"), mgr: e.join(b.workspace, "admin")}
	acc := e.group(b, "Accountants", t.acc1, t.acc2)
	mgmt := e.group(b, "Management", t.mgr, t.author)
	return t, clientID, acc, mgmt
}

func TestApprovalOffLeavesIssuingAsIs(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	d := e.draft(b, clientID, nil)
	if v := e.approval(b, "GET", path(d.ID, "approval"), nil, http.StatusOK); v.Required || v.State != "none" || v.CanSubmit {
		t.Fatalf("approval of a workspace without policies: %+v", v)
	}
	e.fails(b, "POST", path(d.ID, "approval"), nil, http.StatusConflict, "approval_not_required")
	if got := e.invoice(b, "POST", path(d.ID, "issue"), nil, http.StatusOK); got.Number == nil {
		t.Fatal("not issued")
	}
}

func TestApprovalTwoGroupsWithMinimums(t *testing.T) {
	e := newEnv(t)
	tm, clientID, acc, mgmt := e.team()
	e.policy(tm.author, "invoice", nil, rule(acc, 2), rule(mgmt, 1))
	d := e.draft(tm.author, clientID, nil)
	if v := e.approval(tm.author, "GET", path(d.ID, "approval"), nil, http.StatusOK); !v.Required || !v.CanSubmit || len(v.Rules) != 2 {
		t.Fatalf("before submitting: %+v", v)
	}
	e.fails(tm.author, "POST", path(d.ID, "issue"), nil, http.StatusConflict, "approval_required")

	v := e.approval(tm.author, "POST", path(d.ID, "approval"), nil, http.StatusOK)
	if v.State != "pending" || v.CanSubmit || !v.CanWithdraw || v.CanDecide {
		t.Fatalf("after submitting: %+v", v)
	}
	want := []string{e.userID(tm.acc1), e.userID(tm.acc2), e.userID(tm.mgr)}
	slices.Sort(want)
	if got := e.notified(tm.author.workspace, "approval.requested"); !slices.Equal(got, want) {
		t.Fatalf("asked %v, want %v", got, want)
	}
	if got := e.invoice(tm.author, "GET", path(d.ID), nil, http.StatusOK); got.Status != "draft" {
		t.Fatalf("status %s", got.Status)
	}
	// the author is in Management but never approves their own request
	e.fails(tm.author, "POST", path(d.ID, "approval/approve"), nil, http.StatusForbidden, "approval_not_allowed")

	e.approval(tm.acc1, "POST", path(d.ID, "approval/approve"), map[string]any{"comment": "Fine"}, http.StatusOK)
	e.fails(tm.acc1, "POST", path(d.ID, "approval/approve"), nil, http.StatusForbidden, "approval_not_allowed") // once
	v = e.approval(tm.mgr, "POST", path(d.ID, "approval/approve"), nil, http.StatusOK)
	if v.State != "pending" || v.Rules[0].Approved != 1 || v.Rules[1].Approved != 1 {
		t.Fatalf("one accountant short: %+v", v)
	}
	e.fails(tm.author, "POST", path(d.ID, "issue"), nil, http.StatusConflict, "approval_required")

	if v = e.approval(tm.acc2, "POST", path(d.ID, "approval/approve"), nil, http.StatusOK); v.State != "approved" {
		t.Fatalf("all rules hold: %+v", v)
	}
	if got := e.notified(tm.author.workspace, "approval.approved"); !slices.Equal(got, []string{e.userID(tm.author)}) {
		t.Fatalf("told %v", got)
	}
	got := e.invoice(tm.author, "POST", path(d.ID, "issue"), nil, http.StatusOK)
	if got.Number == nil || got.Status != "open" {
		t.Fatalf("issued: %+v", got)
	}
	if kinds := e.auditKinds(tm.author.workspace, d.ID); !slices.Equal(kinds,
		[]string{"approval.submitted", "approval.approved", "approval.approved", "approval.approved"}) {
		t.Fatalf("audit %v", kinds)
	}
	v = e.approval(tm.author, "GET", path(d.ID, "approval"), nil, http.StatusOK)
	if len(v.Trail) != 4 || v.Trail[1].Comment == nil || *v.Trail[1].Comment != "Fine" || v.Trail[1].User.Name == "" {
		t.Fatalf("trail %+v", v.Trail)
	}
}

func TestApprovalRejectEditAndResubmit(t *testing.T) {
	e := newEnv(t)
	tm, clientID, acc, _ := e.team()
	e.policy(tm.author, "invoice", nil, rule(acc, 1))
	d := e.draft(tm.author, clientID, nil)
	e.approval(tm.author, "POST", path(d.ID, "approval"), nil, http.StatusOK)

	e.fails(tm.acc1, "POST", path(d.ID, "approval/reject"), map[string]any{"comment": "  "}, http.StatusUnprocessableEntity,
		"validation_failed", "comment")
	v := e.approval(tm.acc1, "POST", path(d.ID, "approval/reject"), map[string]any{"comment": "Wrong rate"}, http.StatusOK)
	if v.State != "rejected" || v.Comment == nil || *v.Comment != "Wrong rate" {
		t.Fatalf("rejected: %+v", v)
	}
	if got := e.notified(tm.author.workspace, "approval.rejected"); !slices.Equal(got, []string{e.userID(tm.author)}) {
		t.Fatalf("told %v", got)
	}
	e.fails(tm.acc2, "POST", path(d.ID, "approval/approve"), nil, http.StatusConflict, "invalid_state")
	e.fails(tm.author, "POST", path(d.ID, "issue"), nil, http.StatusConflict, "approval_required")

	e.invoice(tm.author, "PATCH", path(d.ID), map[string]any{"lines": []any{line("3", "100.00")}}, http.StatusOK)
	if v = e.approval(tm.author, "POST", path(d.ID, "approval"), nil, http.StatusOK); v.State != "pending" {
		t.Fatalf("resubmitted: %+v", v)
	}
	e.approval(tm.acc2, "POST", path(d.ID, "approval/approve"), nil, http.StatusOK)
	e.invoice(tm.author, "POST", path(d.ID, "issue"), nil, http.StatusOK)
}

func TestApprovalEditResetsIt(t *testing.T) {
	e := newEnv(t)
	tm, clientID, acc, _ := e.team()
	e.policy(tm.author, "invoice", nil, rule(acc, 1))
	d := e.draft(tm.author, clientID, nil)
	e.approval(tm.author, "POST", path(d.ID, "approval"), nil, http.StatusOK)
	if v := e.approval(tm.acc1, "POST", path(d.ID, "approval/approve"), nil, http.StatusOK); v.State != "approved" {
		t.Fatalf("approved: %+v", v)
	}
	if got := e.invoice(tm.author, "GET", path(d.ID), nil, http.StatusOK); got.ApprovalState == nil || *got.ApprovalState != "approved" {
		t.Fatalf("approval_state %v", got.ApprovalState)
	}

	got := e.invoice(tm.acc1, "PATCH", path(d.ID), map[string]any{"lines": []any{line("9", "100.00")}}, http.StatusOK)
	if got.ApprovalState != nil {
		t.Fatalf("approval_state after the edit %v", *got.ApprovalState)
	}
	v := e.approval(tm.author, "GET", path(d.ID, "approval"), nil, http.StatusOK)
	if v.State != "none" || !v.CanSubmit || v.Trail[len(v.Trail)-1].Kind != "reset" {
		t.Fatalf("after the edit: %+v", v)
	}
	e.fails(tm.author, "POST", path(d.ID, "issue"), nil, http.StatusConflict, "approval_required")
	if kinds := e.auditKinds(tm.author.workspace, d.ID); kinds[len(kinds)-1] != "approval.reset" {
		t.Fatalf("audit %v", kinds)
	}
}

func TestApprovalWithdrawAndInbox(t *testing.T) {
	e := newEnv(t)
	tm, clientID, acc, _ := e.team()
	e.policy(tm.author, "invoice", nil, rule(acc, 1))
	d := e.draft(tm.author, clientID, nil)
	e.approval(tm.author, "POST", path(d.ID, "approval"), nil, http.StatusOK)

	inbox := func(b *browser) []approvals.InboxItem {
		var out struct{ Data []approvals.InboxItem }
		e.do(b, "GET", "/api/v1/approvals/inbox", nil, http.StatusOK, &out)
		return out.Data
	}
	if got := inbox(tm.acc1); len(got) != 1 || got[0].ID != d.ID || got[0].SubmittedBy.Name == "" || got[0].Total.String() == "0.00" {
		t.Fatalf("acc1's inbox %+v", got)
	}
	if got := inbox(tm.author); len(got) != 0 {
		t.Fatalf("the author's inbox %+v", got)
	}
	if got := inbox(tm.mgr); len(got) != 0 { // not in Accountants
		t.Fatalf("mgr's inbox %+v", got)
	}
	e.fails(tm.acc1, "POST", path(d.ID, "approval/withdraw"), nil, http.StatusForbidden, "approval_not_allowed")
	if v := e.approval(tm.author, "POST", path(d.ID, "approval/withdraw"), nil, http.StatusOK); v.State != "none" {
		t.Fatalf("withdrawn: %+v", v)
	}
	if got := inbox(tm.acc1); len(got) != 0 {
		t.Fatalf("inbox after withdrawing %+v", got)
	}
}

func TestApprovalOnePersonCountsOnce(t *testing.T) {
	e := newEnv(t)
	tm, clientID, acc, mgmt := e.team()
	both := e.join(tm.author.workspace, "member")
	e.do(tm.author, "PATCH", "/api/v1/approvals/groups/"+acc, map[string]any{"member_ids": []string{e.userID(both)}}, http.StatusOK, nil)
	e.do(tm.author, "PATCH", "/api/v1/approvals/groups/"+mgmt, map[string]any{"member_ids": []string{e.userID(both), e.userID(tm.mgr)}},
		http.StatusOK, nil)
	e.policy(tm.author, "invoice", nil, rule(acc, 1), rule(mgmt, 1))
	d := e.draft(tm.author, clientID, nil)
	e.approval(tm.author, "POST", path(d.ID, "approval"), nil, http.StatusOK)
	if v := e.approval(both, "POST", path(d.ID, "approval/approve"), nil, http.StatusOK); v.State != "pending" {
		t.Fatalf("one person filled both groups: %+v", v)
	}
	if v := e.approval(tm.mgr, "POST", path(d.ID, "approval/approve"), nil, http.StatusOK); v.State != "approved" {
		t.Fatalf("second person: %+v", v)
	}
}

func TestApprovalAnyoneThresholdAndTypes(t *testing.T) {
	e := newEnv(t)
	tm, clientID, _, _ := e.team()
	e.policy(tm.author, "invoice", "1000", rule("", 1))
	small := e.draft(tm.author, clientID, nil) // 200.00
	e.invoice(tm.author, "POST", path(small.ID, "issue"), nil, http.StatusOK)

	big := e.draft(tm.author, clientID, map[string]any{"lines": []any{line("10", "100.00")}})
	e.fails(tm.author, "POST", path(big.ID, "issue"), nil, http.StatusConflict, "approval_required")
	e.approval(tm.author, "POST", path(big.ID, "approval"), nil, http.StatusOK)
	// anyone who can read invoices, a plain member outside every group too
	outsider := e.join(tm.author.workspace, "member")
	if v := e.approval(outsider, "POST", path(big.ID, "approval/approve"), nil, http.StatusOK); v.State != "approved" {
		t.Fatalf("anyone: %+v", v)
	}
	src := e.invoice(tm.author, "POST", path(big.ID, "issue"), nil, http.StatusOK)
	// credit notes follow their own policy, off here
	cn := e.invoice(tm.author, "POST", path(src.ID, "credit-note"), map[string]any{"lines": []any{line("1", "10")}}, http.StatusCreated)
	e.invoice(tm.author, "POST", path(cn.ID, "issue"), nil, http.StatusOK)
}

func TestApprovalSettingsRules(t *testing.T) {
	e := newEnv(t)
	tm, _, acc, _ := e.team()
	put := func(body map[string]any, status int, code string, fields ...string) {
		t.Helper()
		e.fails(tm.author, "PUT", "/api/v1/approvals/policies/invoice", body, status, code, fields...)
	}
	put(map[string]any{"enabled": true, "rules": []any{}}, http.StatusUnprocessableEntity, "validation_failed", "rules")
	put(map[string]any{"enabled": true, "rules": []any{rule(acc, 0)}}, http.StatusUnprocessableEntity, "validation_failed", "rules")
	put(map[string]any{"enabled": true, "rules": []any{rule("agr_unknown", 1)}}, http.StatusUnprocessableEntity, "validation_failed", "rules")
	put(map[string]any{"enabled": true, "rules": []any{rule(acc, 1), rule(acc, 1)}}, http.StatusUnprocessableEntity, "validation_failed", "rules")
	put(map[string]any{"enabled": true, "min_total": "abc", "rules": []any{rule(acc, 1)}}, http.StatusUnprocessableEntity, "validation_failed", "min_total")
	e.fails(tm.author, "PUT", "/api/v1/approvals/policies/payslip", map[string]any{"enabled": false}, http.StatusNotFound, "not_found")

	e.fails(tm.author, "POST", "/api/v1/approvals/groups", map[string]any{"name": "accountants"}, http.StatusUnprocessableEntity,
		"validation_failed", "name")
	e.fails(tm.author, "POST", "/api/v1/approvals/groups", map[string]any{"name": "X", "member_ids": []string{"usr_stranger"}},
		http.StatusUnprocessableEntity, "validation_failed", "member_ids")
	e.fails(tm.acc1, "GET", "/api/v1/approvals/settings", nil, http.StatusForbidden, "forbidden")

	e.policy(tm.author, "invoice", nil, rule(acc, 1))
	e.fails(tm.author, "DELETE", "/api/v1/approvals/groups/"+acc, nil, http.StatusConflict, "group_in_use")
	var s struct {
		Data struct {
			Groups   []struct{ ID string }
			Policies []struct {
				DocType string `json:"doc_type"`
				Enabled bool
			}
		}
	}
	e.do(tm.author, "GET", "/api/v1/approvals/settings", nil, http.StatusOK, &s)
	if len(s.Data.Groups) != 2 || len(s.Data.Policies) != 4 || !s.Data.Policies[0].Enabled || s.Data.Policies[1].Enabled {
		t.Fatalf("settings %+v", s.Data)
	}
}

// The submitter alone cannot satisfy a group: submitting is refused rather than left waiting forever.
func TestApprovalUnsatisfiableSubmit(t *testing.T) {
	e := newEnv(t)
	tm, clientID, _, _ := e.team()
	solo := e.group(tm.author, "Owners", tm.author)
	e.policy(tm.author, "invoice", nil, rule(solo, 1))
	d := e.draft(tm.author, clientID, nil)
	e.fails(tm.author, "POST", path(d.ID, "approval"), nil, http.StatusConflict, "approval_unsatisfiable")
}

// Approvals at once from different people all count; one person's double click counts once.
func TestApprovalConcurrentDecisions(t *testing.T) {
	e := newEnv(t)
	tm, clientID, acc, mgmt := e.team()
	e.policy(tm.author, "invoice", nil, rule(acc, 2), rule(mgmt, 1))
	d := e.draft(tm.author, clientID, nil)
	e.approval(tm.author, "POST", path(d.ID, "approval"), nil, http.StatusOK)

	if got := e.statuses(tm.acc1, 6, "POST", path(d.ID, "approval/approve"), none); got[http.StatusOK] != 1 || got[http.StatusForbidden] != 5 {
		t.Fatalf("double click: %v", got)
	}
	done := make(chan int, 2)
	for _, b := range []*browser{tm.acc2, tm.mgr} {
		go func() { resp, _ := e.send(b, "POST", path(d.ID, "approval/approve"), nil); done <- resp.StatusCode }()
	}
	if a, b := <-done, <-done; a != http.StatusOK || b != http.StatusOK {
		t.Fatalf("statuses %d %d", a, b)
	}
	if v := e.approval(tm.author, "GET", path(d.ID, "approval"), nil, http.StatusOK); v.State != "approved" {
		t.Fatalf("after both: %+v", v)
	}
}

// Configuring and submitting need Business; a downgrade stops the gate instead of locking drafts.
func TestApprovalPlanGate(t *testing.T) {
	e := newEnv(t)
	tm, clientID, acc, _ := e.team()
	e.policy(tm.author, "invoice", nil, rule(acc, 1))
	d := e.draft(tm.author, clientID, nil)
	e.fails(tm.author, "POST", path(d.ID, "issue"), nil, http.StatusConflict, "approval_required")

	billingtest.On(t, e.st, tm.author.workspace, billing.Pro)
	e.fails(tm.author, "POST", "/api/v1/approvals/groups", map[string]any{"name": "HR"}, http.StatusForbidden, "feature_not_in_plan")
	e.fails(tm.author, "POST", path(d.ID, "approval"), nil, http.StatusForbidden, "feature_not_in_plan")
	e.invoice(tm.author, "POST", path(d.ID, "issue"), nil, http.StatusOK)
}
