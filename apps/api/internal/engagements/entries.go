package engagements

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

const maxEntryQuantity = 10_000_000 // 10'000 in thousandths

var errEntryInvoiced = auth.Error(http.StatusConflict, "entry_invoiced", "This entry is on an invoice: void or delete the invoice first.", nil)

func (s *Service) registerEntries(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/engagements/{id}/entries", s.listEntries)
	handle("POST /api/v1/engagements/{id}/entries", s.createEntry)
	handle("PATCH /api/v1/engagements/{id}/entries/{entry_id}", s.updateEntry)
	handle("DELETE /api/v1/engagements/{id}/entries/{entry_id}", s.deleteEntry)
	handle("POST /api/v1/engagements/{id}/periods/{period_id}/invoice", s.invoicePeriod)
	handle("POST /api/v1/engagements/{id}/invoices", s.linkInvoice)
	handle("DELETE /api/v1/engagements/{id}/invoices/{invoice_id}", s.unlinkInvoice)
	handle("GET /api/v1/invoices/{id}/engagement", s.engagementOfInvoice)
}

func (s *Service) listEntries(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	var list []store.EngagementEntry
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.Engagement(ctx, sess.Workspace.ID, r.PathValue("id"), false)
		if err != nil {
			return err
		}
		list, err = q.Entries(ctx, e.ID, r.URL.Query().Get("period_id"))
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

// applyEntry reads the body onto en. Create requires a quantity and defaults the date and the performer; the
// date is checked against the engagement's cut periods, which also pick the entry's period.
func (s *Service) applyEntry(ctx context.Context, q store.Q, sess store.Session, v EngagementView, en *store.EngagementEntry,
	body map[string]json.RawMessage, create bool) error {
	for k := range body {
		if !slices.Contains([]string{"date", "quantity", "note", "performed_by"}, k) {
			return badRequest("Unknown field " + strconv.Quote(k) + ".")
		}
	}
	today := s.today(sess.Workspace)
	fields := map[string]string{}
	fail := func(k, msg string) { fields[k] = msg }
	if raw, set := body["date"]; set {
		if d := date("date", raw, fail); d != nil {
			en.Date = *d
		} else if fields["date"] == "" {
			fail("date", "Enter a date.")
		}
	} else if create {
		en.Date = today
	}
	if raw, set := body["quantity"]; set {
		n, ok := invoicecalc.ParseQuantity(literal(raw))
		if !ok || n <= 0 || n > maxEntryQuantity {
			fail("quantity", "Enter a quantity above 0 and up to 10'000 with at most three decimals.")
		} else {
			en.Quantity = n
		}
	} else if create {
		fail("quantity", "Enter a quantity.")
	}
	if raw, set := body["note"]; set {
		en.Note = text("note", raw, 500, nil, fail)
	}
	if raw, set := body["performed_by"]; set {
		en.PerformedBy = nil
		if string(raw) != "null" {
			var id string
			if json.Unmarshal(raw, &id) != nil {
				fail("performed_by", "Choose a member.")
			} else if _, err := q.MemberRole(ctx, sess.Workspace.ID, id); errors.Is(err, store.ErrNotFound) {
				fail("performed_by", "Choose a member of this workspace.")
			} else if err != nil {
				return err
			} else {
				en.PerformedBy = &store.UserRef{ID: id}
			}
		}
	} else if create {
		en.PerformedBy = &store.UserRef{ID: sess.User.ID}
	}
	if fields["date"] == "" && en.Date != "" {
		switch last := lastDay(v.Engagement); {
		case en.Date < v.StartDate:
			fail("date", "The date cannot be before the engagement starts.")
		case en.Date > today:
			fail("date", "The date cannot be in the future.")
		case last != "" && en.Date > last:
			fail("date", "The date is after the engagement ends.")
		default:
			i := slices.IndexFunc(v.periods, func(p PeriodSummary) bool { return p.StartsOn <= en.Date && en.Date <= p.EndsOn })
			if i < 0 {
				fail("date", "The date is outside every period.")
			} else {
				en.PeriodID = v.periods[i].ID
			}
		}
	}
	if len(fields) > 0 {
		return validationFailed(fields)
	}
	return nil
}

// entryReply is the entry with its (recomputed) period.
func (s *Service) entryReply(ctx context.Context, q store.Q, ws store.Workspace, e store.Engagement, entryID string) (map[string]any, error) {
	v, err := s.view(ctx, q, e, s.today(ws))
	if err != nil {
		return nil, err
	}
	en, err := q.Entry(ctx, e.ID, entryID, false)
	if err != nil {
		return nil, err
	}
	i := slices.IndexFunc(v.periods, func(p PeriodSummary) bool { return p.ID == en.PeriodID })
	if i < 0 {
		return nil, store.ErrNotFound
	}
	p, err := periodView(ctx, q, v.periods[i])
	return map[string]any{"entry": en, "period": p}, err
}

func (s *Service) createEntry(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx := r.Context()
	var out map[string]any
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.Engagement(ctx, sess.Workspace.ID, r.PathValue("id"), true)
		if err != nil {
			return err
		}
		v, err := s.view(ctx, q, e, s.today(sess.Workspace))
		if err != nil {
			return err
		}
		en := store.EngagementEntry{ID: auth.NewID("ent"), CreatedBy: &store.UserRef{ID: sess.User.ID}}
		if err := s.applyEntry(ctx, q, sess, v, &en, body, true); err != nil {
			return err
		}
		if err := q.CreateEntry(ctx, e.ID, en, s.now()); err != nil {
			return err
		}
		out, err = s.entryReply(ctx, q, sess.Workspace, e, en.ID)
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(out))
	return nil
}

func (s *Service) updateEntry(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx := r.Context()
	var out map[string]any
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.Engagement(ctx, sess.Workspace.ID, r.PathValue("id"), true)
		if err != nil {
			return err
		}
		en, err := q.Entry(ctx, e.ID, r.PathValue("entry_id"), true)
		if err != nil {
			return err
		}
		if en.Invoice != nil {
			return errEntryInvoiced
		}
		v, err := s.view(ctx, q, e, s.today(sess.Workspace))
		if err != nil {
			return err
		}
		if err := s.applyEntry(ctx, q, sess, v, &en, body, false); err != nil {
			return err
		}
		if err := q.SaveEntry(ctx, en); err != nil {
			return err
		}
		out, err = s.entryReply(ctx, q, sess.Workspace, e, en.ID)
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func (s *Service) deleteEntry(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.Engagement(ctx, sess.Workspace.ID, r.PathValue("id"), true)
		if err != nil {
			return err
		}
		en, err := q.Entry(ctx, e.ID, r.PathValue("entry_id"), true)
		if err != nil {
			return err
		}
		if en.Invoice != nil {
			return errEntryInvoiced
		}
		return q.DeleteEntry(ctx, en.ID)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
