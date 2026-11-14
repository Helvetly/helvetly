package instalments

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/store"
)

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	plans, err := s.db.Plans(r.Context(), sess.Workspace.ID, r.URL.Query().Get("client_id"))
	if err != nil {
		return err
	}
	out := make([]invoices.PlanView, len(plans))
	for i, p := range plans {
		out[i] = invoices.PresentPlan(p)
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	p, err := s.db.Plan(r.Context(), sess.Workspace.ID, r.PathValue("id"), false)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(invoices.PresentPlan(p)))
	return nil
}

// transition moves a plan from one of from to to under its row lock, the lock IssuePlanItem takes too, so a cancel
// and an issue of the same plan never interleave. Cancelling writes the plan.cancelled audit event.
func (s *Service) transition(to string, from ...string) handler {
	return func(w http.ResponseWriter, r *http.Request, sess store.Session) error {
		ctx, ws, id := r.Context(), sess.Workspace.ID, r.PathValue("id")
		var plan store.Plan
		err := s.db.Tx(ctx, func(q store.Q) error {
			p, err := q.Plan(ctx, ws, id, true)
			if err != nil {
				return err
			}
			if !slices.Contains(from, p.Status) {
				return auth.Error(http.StatusConflict, "invalid_state", fmt.Sprintf("The plan is %s.", p.Status), nil)
			}
			if _, err := q.SetPlanStatus(ctx, ws, id, to, from); err != nil {
				return err
			}
			if to == "cancelled" {
				payload, err := json.Marshal(map[string]any{"source_invoice_id": p.SourceInvoiceID, "previous_status": p.Status})
				if err != nil {
					return err
				}
				if err := q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: ws, Kind: "plan.cancelled", SubjectType: "plan",
					SubjectID: id, ActorID: &sess.User.ID, At: s.now(), Payload: payload}); err != nil {
					return err
				}
			}
			plan, err = q.Plan(ctx, ws, id, false)
			return err
		})
		if err != nil {
			return err
		}
		auth.WriteJSON(w, http.StatusOK, data(invoices.PresentPlan(plan)))
		return nil
	}
}
