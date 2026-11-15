package billing

import (
	"context"
	"net/http"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// Employees are not members: adding them changes no seat count, no Stripe quantity and no member limit, and the
// employees limit (seeded unlimited) is its own.
func TestEmployeesTakeNoSeat(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	e.stripe.setPerSeat()
	owner := e.workspace()
	e.subscribe(owner.workspace, "price_pm")
	path := "POST /v1/subscriptions/sub_" + owner.workspace
	before := seatsOf(e, owner.workspace)
	var userID string
	if err := e.st.Tx(ctx, func(q store.Q) error {
		list, err := q.ListMembers(ctx, owner.workspace)
		if err == nil && len(list) > 0 {
			userID = list[0].UserID
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for i, name := range []string{"Anna", "Ben", "Cleo", "Dora", "Emil"} {
		err := e.st.CreateEmployee(ctx, owner.workspace, userID, store.Employee{ID: "emp_" + name, FirstName: name, LastName: "Muster",
			EmploymentType: "permanent", EmploymentStart: "2024-01-0" + string(rune('1'+i)), EmployingEntity: "Acme", EmployerCountry: "CH",
			WorkCountry: "CH", CreatedAt: time.Now()})
		if err != nil {
			t.Fatalf("employee %s: %v", name, err)
		}
	}
	e.svc.SyncSeats(ctx, owner.workspace)
	if n := e.stripe.called(path); n != 0 {
		t.Fatalf("adding employees changed the Stripe quantity: %d calls", n)
	}
	if seats, err := e.st.Seats(ctx, owner.workspace); err != nil || seats != 1 || seatsOf(e, owner.workspace) != before {
		t.Fatalf("seats %d (%v), want 1", seats, err)
	}
	_, body := e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	data, _ := body["data"].(map[string]any)
	usage, _ := data["usage"].([]any)
	found := false
	for _, u := range usage {
		m, _ := u.(map[string]any)
		switch m["limit"] {
		case "members":
			if m["used"] != 0.0 {
				t.Fatalf("employees counted as members: %v", m)
			}
		case "employees":
			found = true
			if m["used"] != 5.0 || m["max"] != nil {
				t.Fatalf("employees limit: %v", m)
			}
		}
	}
	if !found {
		t.Fatalf("the employees limit is not reported: %v", usage)
	}
}
