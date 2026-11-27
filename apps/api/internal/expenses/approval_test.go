package expenses

import (
	"context"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/approvals"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

func (e *env) approval(b *browser, method, id, action string, body any, want int) approvals.View {
	e.t.Helper()
	p := "/api/v1/expenses/" + id + "/approval"
	if action != "" {
		p += "/" + action
	}
	var out struct{ Data approvals.View }
	e.do(b, method, p, body, want, &out)
	return out.Data
}

func decision(v approvals.View) map[string]any {
	id := ""
	if v.RequestID != nil {
		id = *v.RequestID
	}
	return map[string]any{"request_id": id}
}

// approvalTeam: an owner on Business, a member who claims expenses and Finance (fin1, fin2) who approve them from 100.
type approvalTeam struct{ owner, claimant, fin1, fin2 *browser }

func (e *env) approvalTeam(minTotal any) approvalTeam {
	e.t.Helper()
	billingtest.Wire(e.t, e.st)
	owner := e.workspace()
	billingtest.On(e.t, e.st, owner.workspace, billing.Business)
	tm := approvalTeam{owner: owner, claimant: e.join(owner.workspace, "member"), fin1: e.join(owner.workspace, "member"),
		fin2: e.join(owner.workspace, "admin")}
	var g struct{ Data struct{ ID string } }
	e.do(owner, "POST", "/api/v1/approvals/groups", map[string]any{"name": "Finance", "member_ids": []string{tm.fin1.user, tm.fin2.user}},
		http.StatusCreated, &g)
	e.do(owner, "PUT", "/api/v1/approvals/policies/expense", map[string]any{"enabled": true, "min_total": minTotal,
		"rules": []any{map[string]any{"group_id": g.Data.ID, "min": 1}}}, http.StatusOK, nil)
	return tm
}

// claim: a complete expense that can be booked without a receipt.
func claim(categoryID string) map[string]any {
	body := complete(categoryID)
	body["receipt_missing_reason"] = "Lost on the train"
	return body
}

func (e *env) approvalState(b *browser, id string) *string {
	e.t.Helper()
	var out struct {
		Data struct {
			Status        string  `json:"status"`
			ApprovalState *string `json:"approval_state"`
		}
	}
	e.do(b, "GET", "/api/v1/expenses/"+id, nil, http.StatusOK, &out)
	return out.Data.ApprovalState
}

func TestExpenseApprovalBeforeBooking(t *testing.T) {
	e := newEnv(t)
	tm := e.approvalTeam("100")
	travel := e.categories(tm.owner)["6640"]
	x := e.create(tm.claimant, claim(travel.ID)) // 108.10
	if v := e.approval(tm.claimant, "GET", x.ID, "", nil, http.StatusOK); !v.Required || !v.CanSubmit {
		t.Fatalf("before submitting: %+v", v)
	}
	e.fails(tm.owner, "POST", "/api/v1/expenses/"+x.ID+"/book", nil, http.StatusConflict, "approval_required")
	var bulk struct {
		Data struct {
			Updated int
			Skipped []struct{ ID, Reason string }
		}
	}
	e.do(tm.owner, "POST", "/api/v1/expenses/bulk", map[string]any{"ids": []string{x.ID}, "action": "book"}, http.StatusOK, &bulk)
	if bulk.Data.Updated != 0 || len(bulk.Data.Skipped) != 1 || bulk.Data.Skipped[0].Reason != "Needs approval." {
		t.Fatalf("bulk book: %+v", bulk.Data)
	}

	v := e.approval(tm.claimant, "POST", x.ID, "", nil, http.StatusOK)
	if s := e.approvalState(tm.owner, x.ID); s == nil || *s != "pending" {
		t.Fatalf("approval_state %v", s)
	}
	// the creator never approves their own claim, even from the group
	e.fails(tm.claimant, "POST", "/api/v1/expenses/"+x.ID+"/approval/approve", decision(v), http.StatusForbidden, "approval_not_allowed")
	var inbox struct{ Data []approvals.InboxItem }
	e.do(tm.fin1, "GET", "/api/v1/approvals/inbox", nil, http.StatusOK, &inbox)
	if len(inbox.Data) != 1 || inbox.Data[0].DocType != "expense" || inbox.Data[0].ClientName != "SBB CFF FFS" ||
		inbox.Data[0].IssueDate != "2026-11-03" || inbox.Data[0].Total.String() != "108.10" {
		t.Fatalf("inbox %+v", inbox.Data)
	}
	// a rejection sends it back with the reason
	e.fails(tm.fin1, "POST", "/api/v1/expenses/"+x.ID+"/approval/reject", decision(v), http.StatusUnprocessableEntity, "validation_failed", "comment")
	if v := e.approval(tm.fin1, "POST", x.ID, "reject", map[string]any{"request_id": *v.RequestID, "comment": "Attach the ticket"},
		http.StatusOK); v.State != "rejected" || v.Comment == nil {
		t.Fatalf("rejected: %+v", v)
	}
	v = e.approval(tm.claimant, "POST", x.ID, "", nil, http.StatusOK)
	if v := e.approval(tm.fin2, "POST", x.ID, "approve", decision(v), http.StatusOK); v.State != "approved" {
		t.Fatalf("approved: %+v", v)
	}
	// a receipt added after the approval is not what was approved
	if resp := e.upload(tm.claimant, x.ID, "ticket.pdf", pdf); resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload %d", resp.StatusCode)
	}
	if s := e.approvalState(tm.owner, x.ID); s != nil {
		t.Fatalf("approval_state after a receipt %v", *s)
	}
	v = e.approval(tm.claimant, "POST", x.ID, "", nil, http.StatusOK)
	e.approval(tm.fin1, "POST", x.ID, "approve", decision(v), http.StatusOK)
	e.do(tm.owner, "POST", "/api/v1/expenses/"+x.ID+"/book", nil, http.StatusOK, nil)
	if s := e.approvalState(tm.owner, x.ID); s == nil || *s != "approved" {
		t.Fatalf("booked approval_state %v", s)
	}

	var kinds []string
	rows, err := e.raw.Query(context.Background(), `SELECT kind FROM financial_events WHERE subject_type = 'expense' AND subject_id = $1
		AND kind LIKE 'approval.%' ORDER BY seq`, x.ID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		kinds = append(kinds, k)
	}
	rows.Close()
	want := []string{"approval.submitted", "approval.rejected", "approval.submitted", "approval.approved", "approval.reset",
		"approval.submitted", "approval.approved"}
	if !slices.Equal(kinds, want) {
		t.Fatalf("audit %v", kinds)
	}
}

// The member an expense is paid back to never approves it, whoever entered it; under the minimum nothing is gated;
// deleting a draft forgets its requests; another workspace reaches nothing.
func TestExpenseApprovalPaidByThresholdDeleteIsolation(t *testing.T) {
	e := newEnv(t)
	tm := e.approvalTeam("100")
	travel := e.categories(tm.owner)["6640"]
	body := claim(travel.ID)
	body["payment_status"], body["paid_on"], body["payment_method"], body["paid_by_member_id"] = "paid", "2026-11-03", "card", tm.fin1.user
	x := e.create(tm.owner, body)
	v := e.approval(tm.owner, "POST", x.ID, "", nil, http.StatusOK)
	e.fails(tm.fin1, "POST", "/api/v1/expenses/"+x.ID+"/approval/approve", decision(v), http.StatusForbidden, "approval_not_allowed")
	var inbox struct{ Data []approvals.InboxItem }
	e.do(tm.fin1, "GET", "/api/v1/approvals/inbox", nil, http.StatusOK, &inbox)
	if len(inbox.Data) != 0 {
		t.Fatalf("the claimant's inbox %+v", inbox.Data)
	}

	other := e.workspace()
	e.fails(other, "GET", "/api/v1/expenses/"+x.ID+"/approval", nil, http.StatusNotFound, "not_found")
	e.fails(other, "POST", "/api/v1/expenses/"+x.ID+"/approval/approve", decision(v), http.StatusNotFound, "not_found")

	e.do(tm.owner, "DELETE", "/api/v1/expenses/"+x.ID, nil, http.StatusNoContent, nil)
	var left int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM approval_requests WHERE doc_id = $1`, x.ID).Scan(&left); err != nil || left != 0 {
		t.Fatalf("left after delete: %d %v", left, err)
	}

	small := claim(travel.ID)
	small["lines"] = []map[string]any{{"amount": "50.00", "vat_rate": "8.1"}}
	y := e.create(tm.claimant, small)
	if v := e.approval(tm.claimant, "GET", y.ID, "", nil, http.StatusOK); v.Required {
		t.Fatal("an expense under the minimum needs approval")
	}
	e.do(tm.owner, "POST", "/api/v1/expenses/"+y.ID+"/book", nil, http.StatusOK, nil)
}

// An approval racing an edit never leaves the edited draft approved.
func TestExpenseApprovalRacesEdit(t *testing.T) {
	e := newEnv(t)
	tm := e.approvalTeam(nil)
	travel := e.categories(tm.owner)["6640"]
	x := e.create(tm.claimant, claim(travel.ID))
	v := e.approval(tm.claimant, "POST", x.ID, "", nil, http.StatusOK)
	var wg sync.WaitGroup
	wg.Go(func() {
		_, _ = e.send(tm.fin1, "POST", "/api/v1/expenses/"+x.ID+"/approval/approve", decision(v), "application/json")
	})
	wg.Go(func() {
		_, _ = e.send(tm.claimant, "PATCH", "/api/v1/expenses/"+x.ID, map[string]any{"note": "changed"}, "application/json")
	})
	wg.Wait()
	if s := e.approvalState(tm.owner, x.ID); s != nil && *s == "approved" {
		t.Fatal("the edited expense is approved")
	}
	e.fails(tm.owner, "POST", "/api/v1/expenses/"+x.ID+"/book", nil, http.StatusConflict, "approval_required")
}

// The people an expense and its approval name carry their photo: "" (expense) or null (approval) without one.
func TestExpenseAndApprovalAvatars(t *testing.T) {
	e := newEnv(t)
	tm := e.approvalTeam("100")
	pic := "https://lh3.example.com/claimant.png"
	if err := e.st.UpdateUserProfile(context.Background(), tm.claimant.user, "Claire", &pic, time.Now()); err != nil {
		t.Fatal(err)
	}
	body := claim(e.categories(tm.owner)["6640"].ID)
	body["paid_by_member_id"] = tm.claimant.user
	x := e.create(tm.claimant, body)
	var got struct {
		Data struct {
			PaidByMember *store.Person `json:"paid_by_member"`
			CreatedBy    *store.Person `json:"created_by"`
		}
	}
	e.do(tm.owner, "GET", "/api/v1/expenses/"+x.ID, nil, http.StatusOK, &got)
	if p := got.Data.PaidByMember; p == nil || p.AvatarURL != pic {
		t.Fatalf("paid_by_member %+v", p)
	}
	if p := got.Data.CreatedBy; p == nil || p.AvatarURL != pic {
		t.Fatalf("created_by %+v", p)
	}
	e.do(tm.claimant, "PATCH", "/api/v1/expenses/"+x.ID, map[string]any{"paid_by_member_id": tm.fin1.user}, http.StatusOK, &got)
	if p := got.Data.PaidByMember; p == nil || p.ID != tm.fin1.user || p.AvatarURL != "" {
		t.Fatalf("paid_by_member without a photo %+v", p)
	}

	v := e.approval(tm.claimant, "POST", x.ID, "", nil, http.StatusOK)
	var inbox struct{ Data []approvals.InboxItem }
	e.do(tm.fin2, "GET", "/api/v1/approvals/inbox", nil, http.StatusOK, &inbox)
	if len(inbox.Data) != 1 || inbox.Data[0].SubmittedBy.AvatarURL == nil || *inbox.Data[0].SubmittedBy.AvatarURL != pic {
		t.Fatalf("inbox %+v", inbox.Data)
	}
	v = e.approval(tm.fin2, "POST", x.ID, "approve", decision(v), http.StatusOK)
	if len(v.Trail) != 2 || v.Trail[0].User.AvatarURL == nil || *v.Trail[0].User.AvatarURL != pic ||
		v.Trail[1].User.ID != tm.fin2.user || v.Trail[1].User.AvatarURL != nil {
		t.Fatalf("trail %+v", v.Trail)
	}
}
