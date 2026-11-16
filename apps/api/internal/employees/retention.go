package employees

import (
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// retentionItem is what erasing one former employee would do today: the documents whose retention has passed and
// would be deleted, how many stay (retention running or a legal hold), and what blocks the erasure, if anything.
// Payroll entries and pay terms are never deleted by an erasure: they are kept for the payroll books' retention.
type retentionItem struct {
	EmployeeID    string                   `json:"employee_id"`
	Name          string                   `json:"name"`
	EmploymentEnd string                   `json:"employment_end"`
	BlockedBy     *string                  `json:"blocked_by"` // legal_hold, restricted or erased; nil when it can be erased
	DocumentsDue  []store.EmployeeDocument `json:"documents_due"`
	DocumentsKept int                      `json:"documents_kept"`
	NextDue       *string                  `json:"next_due"` // the earliest retention end still to come
}

// retentionReview is the dry run of erasure after retention: it lists every former employee and changes nothing. Owner only,
// like the erasure itself.
func (s *Service) retentionReview(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if sess.Role != "owner" {
		return auth.Error(http.StatusForbidden, "forbidden", "Only an owner can review erasure after retention.", nil)
	}
	today := s.today(sess)
	list, _, err := s.db.ListEmployees(r.Context(), sess.Workspace.ID, store.EmployeeFilter{Status: "all"}, today, 100_000, 0)
	if err != nil {
		return err
	}
	out := []retentionItem{}
	for _, e := range list {
		if e.EmploymentEnd == nil || *e.EmploymentEnd >= today {
			continue
		}
		docs, err := s.db.EmployeeDocuments(r.Context(), sess.Workspace.ID, e.ID)
		if err != nil {
			return err
		}
		item := retentionItem{EmployeeID: e.ID, Name: e.FirstName + " " + e.LastName, EmploymentEnd: *e.EmploymentEnd,
			DocumentsDue: []store.EmployeeDocument{}}
		for _, d := range docs {
			if d.LegalHold || d.RetainUntil == nil || *d.RetainUntil >= today {
				item.DocumentsKept++
				if !d.LegalHold && d.RetainUntil != nil && (item.NextDue == nil || *d.RetainUntil < *item.NextDue) {
					item.NextDue = d.RetainUntil
				}
				continue
			}
			item.DocumentsDue = append(item.DocumentsDue, d)
		}
		for _, b := range []struct {
			reason  string
			blocked bool
		}{{"legal_hold", e.LegalHold}, {"erased", e.ErasedAt != nil}, {"restricted", e.Restricted}} {
			if b.blocked && item.BlockedBy == nil {
				item.BlockedBy = &b.reason
			}
		}
		out = append(out, item)
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}
