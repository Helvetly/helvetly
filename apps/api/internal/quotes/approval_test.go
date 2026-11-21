package quotes

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/approvals"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

// member adds a person with the role to the workspace and signs them in.
func (e *env) member(ws, role string) (*browser, string) {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Ben " + role}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws}
	sum := sha256.Sum256([]byte(b.token))
	for _, err := range []error{
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, role, now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), b.csrf, u.ID, ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	return b, u.ID
}

func (e *env) approval(b *browser, method, id, action string, body any, want int) approvals.View {
	e.t.Helper()
	p := "/api/v1/quotes/" + id + "/approval"
	if action != "" {
		p += "/" + action
	}
	var out struct{ Data approvals.View }
	e.do(b, method, p, body, want, &out)
	return out.Data
}

// decision: the body of a decision on the request the person saw.
func decision(v approvals.View) map[string]any {
	id := ""
	if v.RequestID != nil {
		id = *v.RequestID
	}
	return map[string]any{"request_id": id}
}

// approvalTeam: an owner who writes quotes on Business, and Sales leads (lead1, lead2) who approve them from 100.
type approvalTeam struct{ author, lead1, lead2 *browser }

func (e *env) approvalTeam(minTotal any, min int) (approvalTeam, string) {
	e.t.Helper()
	billingtest.Wire(e.t, e.st)
	author := e.workspace()
	billingtest.On(e.t, e.st, author.workspace, billing.Business)
	lead1, id1 := e.member(author.workspace, "member")
	lead2, id2 := e.member(author.workspace, "admin")
	var g struct{ Data struct{ ID string } }
	e.do(author, "POST", "/api/v1/approvals/groups", map[string]any{"name": "Sales leads", "member_ids": []string{id1, id2}},
		http.StatusCreated, &g)
	e.do(author, "PUT", "/api/v1/approvals/policies/quote", map[string]any{"enabled": true, "min_total": minTotal,
		"rules": []any{map[string]any{"group_id": g.Data.ID, "min": min}}}, http.StatusOK, nil)
	return approvalTeam{author, lead1, lead2}, e.client(author)
}

var noEmail = map[string]any{"email": false}

func TestQuoteApprovalBeforeSending(t *testing.T) {
	e := newEnv(t)
	tm, c := e.approvalTeam("100", 1)
	q := e.draft(tm.author, c) // 216.20
	if v := e.approval(tm.author, "GET", q.ID, "", nil, http.StatusOK); !v.Required || !v.CanSubmit || v.State != "none" {
		t.Fatalf("before submitting: %+v", v)
	}
	e.fails(tm.author, "POST", "/api/v1/quotes/"+q.ID+"/send", noEmail, http.StatusConflict, "approval_required", "")

	v := e.approval(tm.author, "POST", q.ID, "", nil, http.StatusOK)
	if v.State != "pending" || v.CanDecide {
		t.Fatalf("submitted: %+v", v)
	}
	if got := e.quote(tm.author, "GET", "/api/v1/quotes/"+q.ID, nil, http.StatusOK); got.ApprovalState == nil || *got.ApprovalState != "pending" {
		t.Fatalf("quote approval_state %v", got.ApprovalState)
	}
	// the author never approves their own quote
	e.fails(tm.author, "POST", "/api/v1/quotes/"+q.ID+"/approval/approve", decision(v), http.StatusForbidden, "approval_not_allowed", "")
	// a decision names the request it saw
	e.fails(tm.lead1, "POST", "/api/v1/quotes/"+q.ID+"/approval/approve", map[string]any{"request_id": "apr_old"},
		http.StatusConflict, "approval_changed", "")
	var inbox struct{ Data []approvals.InboxItem }
	e.do(tm.lead1, "GET", "/api/v1/approvals/inbox", nil, http.StatusOK, &inbox)
	if len(inbox.Data) != 1 || inbox.Data[0].DocType != "quote" || inbox.Data[0].Kind != "quote" || inbox.Data[0].ClientName != "Kunde AG" ||
		inbox.Data[0].Total.String() != "216.20" {
		t.Fatalf("inbox %+v", inbox.Data)
	}

	if v := e.approval(tm.lead1, "POST", q.ID, "approve", decision(v), http.StatusOK); v.State != "approved" {
		t.Fatalf("approved: %+v", v)
	}
	sent := e.quote(tm.author, "POST", "/api/v1/quotes/"+q.ID+"/send", noEmail, http.StatusOK)
	if sent.Status != "sent" || sent.ApprovalState == nil || *sent.ApprovalState != "approved" {
		t.Fatalf("sent: %+v", sent)
	}
	// sending again is not gated: the content is what was approved
	e.quote(tm.author, "POST", "/api/v1/quotes/"+q.ID+"/send", noEmail, http.StatusOK)

	// a revision is a new draft: approved again before it is sent
	rev := e.quote(tm.author, "POST", "/api/v1/quotes/"+q.ID+"/revise", nil, http.StatusOK)
	if rev.ApprovalState != nil {
		t.Fatalf("revision approval_state %v", *rev.ApprovalState)
	}
	e.fails(tm.author, "POST", "/api/v1/quotes/"+q.ID+"/send", noEmail, http.StatusConflict, "approval_required", "")

	var kinds []string
	rows, err := e.pool.Query(context.Background(), `SELECT kind FROM financial_events WHERE subject_type = 'quote' AND subject_id = $1
		AND kind LIKE 'approval.%' ORDER BY seq`, q.ID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		kinds = append(kinds, k)
	}
	rows.Close()
	if !slices.Equal(kinds, []string{"approval.submitted", "approval.approved", "approval.reset"}) {
		t.Fatalf("audit %v", kinds)
	}
	var notified int
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE workspace_id = $1
		AND event IN ('approval.requested', 'approval.approved') AND data->>'doc_type' = 'quote' AND data->>'doc_id' = $2`,
		tm.author.workspace, q.ID).Scan(&notified); err != nil || notified != 3 { // both leads, then the author
		t.Fatalf("notifications %d %v", notified, err)
	}
}

func TestQuoteApprovalThresholdEditDeleteAndIsolation(t *testing.T) {
	e := newEnv(t)
	tm, c := e.approvalTeam("1000", 1)
	small := e.draft(tm.author, c)
	if v := e.approval(tm.author, "GET", small.ID, "", nil, http.StatusOK); v.Required {
		t.Fatal("a quote under the minimum needs approval")
	}
	e.fails(tm.author, "POST", "/api/v1/quotes/"+small.ID+"/approval", nil, http.StatusConflict, "approval_not_required", "")
	e.quote(tm.author, "POST", "/api/v1/quotes/"+small.ID+"/send", noEmail, http.StatusOK)

	big := e.quote(tm.author, "POST", "/api/v1/quotes", map[string]any{"client_id": c, "lines": []any{line("20", "100.00")}}, http.StatusCreated)
	v := e.approval(tm.author, "POST", big.ID, "", nil, http.StatusOK)
	e.approval(tm.lead1, "POST", big.ID, "approve", decision(v), http.StatusOK)
	// an edit ends the approval; the person who edited it becomes an author
	e.quote(tm.lead2, "PATCH", "/api/v1/quotes/"+big.ID, map[string]any{"note": "cheaper"}, http.StatusOK)
	if v := e.approval(tm.author, "GET", big.ID, "", nil, http.StatusOK); v.State != "none" || !v.CanSubmit {
		t.Fatalf("after an edit: %+v", v)
	}
	v = e.approval(tm.author, "POST", big.ID, "", nil, http.StatusOK)
	e.fails(tm.lead2, "POST", "/api/v1/quotes/"+big.ID+"/approval/approve", decision(v), http.StatusForbidden, "approval_not_allowed", "")

	// another workspace reaches nothing
	other := e.workspace()
	e.fails(other, "GET", "/api/v1/quotes/"+big.ID+"/approval", nil, http.StatusNotFound, "not_found", "")
	e.fails(other, "POST", "/api/v1/quotes/"+big.ID+"/approval/approve", decision(v), http.StatusNotFound, "not_found", "")
	var inbox struct{ Data []approvals.InboxItem }
	e.do(other, "GET", "/api/v1/approvals/inbox", nil, http.StatusOK, &inbox)
	if len(inbox.Data) != 0 {
		t.Fatalf("other workspace's inbox %+v", inbox.Data)
	}
	// a member who cannot see quotes neither approves nor reads them
	viewer, viewerID := e.member(tm.author.workspace, "member")
	if err := e.st.SetMemberRole(context.Background(), tm.author.workspace, viewerID, "member", []string{"read:clients"}); err != nil {
		t.Fatal(err)
	}
	e.fails(viewer, "POST", "/api/v1/quotes/"+big.ID+"/approval/approve", decision(v), http.StatusForbidden, "approval_not_allowed", "")

	e.do(tm.author, "DELETE", "/api/v1/quotes/"+big.ID, nil, http.StatusNoContent, nil)
	var left int
	if err := e.pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM approval_requests WHERE doc_id = $1)
		+ (SELECT count(*) FROM approval_authors WHERE doc_id = $1)`, big.ID).Scan(&left); err != nil || left != 0 {
		t.Fatalf("left after delete: %d %v", left, err)
	}
}

// An approval racing an edit never leaves the edited quote approved; two approvals of one person count once.
func TestQuoteApprovalConcurrency(t *testing.T) {
	e := newEnv(t)
	tm, c := e.approvalTeam(nil, 2)
	q := e.draft(tm.author, c)
	v := e.approval(tm.author, "POST", q.ID, "", nil, http.StatusOK)

	var wg sync.WaitGroup
	codes := make([]int, 2)
	for i := range codes {
		wg.Go(func() {
			resp, _ := e.raw(tm.lead1, "POST", "/api/v1/quotes/"+q.ID+"/approval/approve", decision(v))
			codes[i] = resp
		})
	}
	wg.Wait()
	slices.Sort(codes)
	if codes[0] != http.StatusOK || codes[1] != http.StatusForbidden {
		t.Fatalf("double approve: %v", codes)
	}
	if v := e.approval(tm.author, "GET", q.ID, "", nil, http.StatusOK); v.State != "pending" || v.Rules[0].Approved != 1 {
		t.Fatalf("one person counted twice: %+v", v)
	}

	wg.Go(func() { _, _ = e.raw(tm.lead2, "POST", "/api/v1/quotes/"+q.ID+"/approval/approve", decision(v)) })
	wg.Go(func() { _, _ = e.raw(tm.author, "PATCH", "/api/v1/quotes/"+q.ID, map[string]any{"note": "changed"}) })
	wg.Wait()
	if v := e.approval(tm.author, "GET", q.ID, "", nil, http.StatusOK); v.State == "approved" {
		t.Fatalf("the edited quote is approved: %+v", v)
	}
	e.fails(tm.author, "POST", "/api/v1/quotes/"+q.ID+"/send", noEmail, http.StatusConflict, "approval_required", "")
}

// Without the plan's feature (a downgrade) nothing is gated.
func TestQuoteApprovalAfterDowngrade(t *testing.T) {
	e := newEnv(t)
	tm, c := e.approvalTeam(nil, 1)
	q := e.draft(tm.author, c)
	billingtest.On(t, e.st, tm.author.workspace, billing.Pro)
	if v := e.approval(tm.author, "GET", q.ID, "", nil, http.StatusOK); v.Required {
		t.Fatal("required after a downgrade")
	}
	e.quote(tm.author, "POST", "/api/v1/quotes/"+q.ID+"/send", noEmail, http.StatusOK)
}

// raw calls the API from a goroutine: only the status, no test failure.
func (e *env) raw(b *browser, method, path string, body any) (int, error) {
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(method, e.srv.URL+path, bytes.NewReader(raw))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	_ = resp.Body.Close()
	return resp.StatusCode, nil
}
