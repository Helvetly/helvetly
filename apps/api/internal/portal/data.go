package portal

import (
	"mime"
	"net/http"
	"slices"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
)

func (s *Service) registerData(handle func(string, handler)) {
	handle("GET /api/v1/public/portal/invoices", s.invoices)
	handle("GET /api/v1/public/portal/invoices/{id}/pdf", s.invoicePDF)
	handle("GET /api/v1/public/portal/engagements", s.engagements)
	handle("GET /api/v1/public/portal/documents", s.documents)
	handle("GET /api/v1/public/portal/documents/{id}/download", s.downloadDocument)
}

func (s *Service) today(sess store.PortalSession) string { return sess.Workspace.Today(s.now()) }

func (s *Service) invoices(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	// Limit 0 returns every match: the list is never cut off by a page size.
	list, _, err := s.db.Q.ListInvoices(r.Context(), sess.Workspace.ID, s.today(sess), store.InvoiceFilter{ClientID: sess.ClientID}, 0, 0)
	if err != nil {
		return err
	}
	type item struct {
		ID        string      `json:"id"`
		Kind      string      `json:"kind"`
		Number    *string     `json:"number"`
		Status    string      `json:"status"`
		IsOverdue bool        `json:"is_overdue"`
		IssueDate string      `json:"issue_date"`
		DueDate   string      `json:"due_date"`
		Currency  string      `json:"currency"`
		Total     store.Money `json:"total"`
		AmountDue store.Money `json:"amount_due"`
	}
	out := []item{}
	for _, i := range list {
		if i.Status != "draft" {
			out = append(out, item{i.ID, i.Kind, i.Number, i.Status, i.IsOverdue, i.IssueDate, i.DueDate, i.Currency, i.Total, i.AmountDue})
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func (s *Service) invoicePDF(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	inv, err := s.db.Q.Invoice(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess), false)
	if err != nil {
		return err
	}
	if inv.ClientID != sess.ClientID || inv.Status == "draft" || inv.PDFKey == nil {
		return auth.ErrNotFound
	}
	pdf, err := s.files.Get(r.Context(), *inv.PDFKey)
	if err != nil {
		return err
	}
	name := inv.ID
	if inv.Number != nil {
		name = *inv.Number
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name + ".pdf"}))
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = w.Write(pdf)
	return nil
}

type periodView struct {
	StartsOn  string               `json:"starts_on"`
	EndsOn    string               `json:"ends_on"`
	Used      invoicecalc.Quantity `json:"used"`
	Remaining invoicecalc.Quantity `json:"remaining"`
	Overage   invoicecalc.Quantity `json:"overage"`
}

// currentPeriod follows engagements' rule: the open period, else the newest one that has started.
// Periods are newest first; the quantity includes what rollover carries in.
func currentPeriod(e store.Engagement, periods []store.EngagementPeriod, today string) *periodView {
	asc := slices.Clone(periods)
	slices.Reverse(asc)
	in := make([]engagements.CarryPeriod, len(asc))
	for i, p := range asc {
		in[i] = engagements.CarryPeriod{Quantity: p.Quantity, Used: p.Used}
	}
	carried := engagements.CarryIn(in)
	var picked *periodView
	for i, p := range asc {
		quantity := p.Quantity
		if e.Rollover {
			quantity += carried[i]
		}
		st := engagements.Measure(quantity, p.Used, p.StartsOn, p.EndsOn, today)
		if st.State == "upcoming" {
			continue
		}
		picked = &periodView{p.StartsOn, p.EndsOn, p.Used, st.Remaining, st.Overage}
		if st.State == "open" {
			break
		}
	}
	return picked
}

func (s *Service) engagements(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	today := s.today(sess)
	list, err := s.db.Q.ListEngagements(r.Context(), sess.Workspace.ID, store.EngagementFilter{ClientID: sess.ClientID, Statuses: []string{"active"}, Today: today})
	if err != nil {
		return err
	}
	ids := make([]string, len(list))
	for i, e := range list {
		ids[i] = e.ID
	}
	periods, err := s.db.Q.EngagementPeriodsOf(r.Context(), ids)
	if err != nil {
		return err
	}
	type item struct {
		ID            string               `json:"id"`
		Name          string               `json:"name"`
		Unit          *string              `json:"unit"`
		Quantity      invoicecalc.Quantity `json:"quantity"`
		Recurrence    string               `json:"recurrence"`
		CurrentPeriod *periodView          `json:"current_period"`
	}
	out := []item{}
	for _, e := range list {
		out = append(out, item{e.ID, e.Title, e.Unit, e.Quantity, e.Recurrence, currentPeriod(e, periods[e.ID], today)})
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func (s *Service) documents(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	docs, err := s.db.Q.SharedDocuments(r.Context(), sess.Workspace.ID, sess.ClientID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(docs))
	return nil
}

func (s *Service) downloadDocument(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	d, err := s.db.Q.SharedDocument(r.Context(), sess.Workspace.ID, sess.ClientID, r.PathValue("id"))
	if err != nil {
		return err
	}
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		sharer, err := q.DocumentSharer(r.Context(), d.ID, sess.ClientID)
		if err != nil {
			return err
		}
		to := store.NotifyTo{Roles: notifications.Managers, Once: "portal.document_viewed:" + d.ID + ":" + sess.Email}
		if sharer != "" {
			to = store.NotifyTo{UserIDs: []string{sharer}, Once: to.Once}
		}
		return notifications.Notify(r.Context(), q, sess.Workspace.ID, "portal.document_viewed", map[string]any{"client_id": sess.ClientID,
			"client_name": sess.ClientName, "contact_name": sess.Email, "document_id": d.ID, "document_name": d.Name}, to, s.now())
	})
	if err != nil {
		return err
	}
	return storage.Serve(w, r, s.files, d.ObjectKey, d.Name, d.ContentType)
}
