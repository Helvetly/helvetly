package heidi

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// TestEmployeeDataNeverReachesHeidi: Heidi has no branch, card or tool over employees or payroll, and the AI consent
// does not cover them, so neither the model nor the answer ever carries a name, figure or file of an employee, even
// for an owner (who holds every HR scope) asking for them directly.
func TestEmployeeDataNeverReachesHeidi(t *testing.T) {
	s, mux, p, _ := modelFixture(t)
	var mu sync.Mutex
	var seen []string
	p.answer = func(_ context.Context, r ProviderRequest) (ProviderReply, error) {
		mu.Lock()
		seen = append(seen, fmt.Sprintf("%+v", r))
		mu.Unlock()
		n := int64(5)
		return ProviderReply{Text: "Explanation.", Tokens: &n}, nil
	}
	ctx, wsID := context.Background(), "ws_heidi" // modelFixture's workspace
	number, gross := "E-77", invoicecalc.Money(987654)
	if err := s.db.CreateEmployee(ctx, wsID, "usr_heidi", store.Employee{ID: "emp_heidi", FirstName: "Zoltan", LastName: "Quarkmeier",
		EmployeeNumber: &number, EmploymentType: "permanent", EmploymentStart: "2024-01-01", EmployingEntity: "Acme",
		EmployerCountry: "CH", WorkCountry: "CH", CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	if err := s.db.CreatePayrollEntry(ctx, wsID, "", store.PayrollEntry{ID: "pay_heidi", EmployeeID: "emp_heidi", EmployingEntity: "Acme",
		PeriodStart: "2026-10-01", PeriodEnd: "2026-10-31", Currency: "CHF", Gross: &gross, Source: "manual", CreatedAt: time.Now(),
		Components: []store.PayrollComponent{}}); err != nil {
		t.Fatal(err)
	}
	for i, message := range []string{"List my employees", "What is Zoltan Quarkmeier's salary?", "Show the payroll for October",
		"Show my recent documents", "Which payroll entries are not approved?"} {
		w := chat(t, mux, fmt.Sprintf("hr%d", i), message)
		for _, secret := range []string{"Quarkmeier", "9876.54", "9'876.54", "emp_heidi", "pay_heidi"} {
			if strings.Contains(w.Body.String(), secret) && !strings.Contains(message, secret) {
				t.Fatalf("%q: the answer carries %q: %s", message, secret, w.Body)
			}
		}
	}
	mu.Lock()
	defer mu.Unlock()
	for _, req := range seen {
		for _, secret := range []string{"9876.54", "emp_heidi", "pay_heidi", "E-77"} {
			if strings.Contains(req, secret) {
				t.Fatalf("the model was sent %q", secret)
			}
		}
	}
}
