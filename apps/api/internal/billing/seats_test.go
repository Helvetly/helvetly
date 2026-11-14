package billing

import (
	"context"
	"errors"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// A seat is taken when an invitation is accepted, not when it is sent.
func TestSeatsCountAcceptedMembersOnly(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	e.subscribe(owner.workspace, "price_bm")
	setAdmissionLimit(t, e, Members, 1)
	e.exec(`INSERT INTO workspace_invitations (id, workspace_id, email, role, token_hash, created_at, expires_at)
		VALUES ('inv_1', $1, 'b@example.com', 'member', 'h1', now(), now() + interval '1 day'),
		       ('inv_2', $1, 'c@example.com', 'member', 'h2', now(), now() + interval '1 day')`, owner.workspace)
	ctx, now := context.Background(), time.Now()
	userOf := func(b *browser) string {
		var id string
		if err := e.raw.QueryRow(ctx, `SELECT user_id FROM workspace_members WHERE workspace_id = $1`, b.workspace).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	usage := func() int64 {
		u, err := e.st.WorkspaceUsage(ctx, owner.workspace, now.AddDate(0, -1, 0), now)
		if err != nil {
			t.Fatal(err)
		}
		return u.Members
	}
	join := func(userID string) error {
		return e.st.Tx(ctx, func(q store.Q) error {
			return q.JoinInvitedMember(ctx, owner.workspace, userID, "member", nil, now)
		})
	}

	if n := usage(); n != 0 {
		t.Fatalf("open invitations take %d seats, want 0", n)
	}
	first, second := userOf(e.workspace()), userOf(e.workspace())
	if err := join(first); err != nil {
		t.Fatalf("first acceptance: %v", err)
	}
	if n := usage(); n != 1 {
		t.Fatalf("after one acceptance: %d seats, want 1", n)
	}
	if err := join(second); !errors.Is(err, store.ErrAdmissionDenied) {
		t.Fatalf("acceptance without a free seat: %v, want admission denied", err)
	}
	if err := join(first); err != nil {
		t.Fatalf("a member accepting again takes no new seat: %v", err)
	}
	if n := usage(); n != 1 {
		t.Fatalf("after the refusal: %d seats, want 1", n)
	}
}
