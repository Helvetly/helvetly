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
	handle("GET /api/v1/public/portal/engagements/{id}/entries", s.engagementEntries)
	handle("GET /api/v1/public/portal/documents", s.documents)
	handle("GET /api/v1/public/portal/documents/{id}/download", s.downloadDocument)
	handle("GET /api/v1/public/portal/signatures", s.signatures)
	handle("GET /api/v1/public/portal/signatures/{id}/download", s.downloadSignature)
}

func (s *Service) today(sess store.PortalSession) string { return sess.Workspace.Today(s.now()) }

func (s *Service) invoices(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	// Limit 0 returns every match: the list is never cut off by a page size.
	today := s.today(sess)
	// A participant (participants mode only, see participantAllows) sees the invoices addressed to them.
	list, _, err := s.db.Q.ListInvoices(r.Context(), sess.Workspace.ID, today, store.InvoiceFilter{ClientID: sess.ClientID, ParticipantID: sess.ParticipantID}, 0, 0)
	if err != nil {
		return err
	}
	paid, err := s.db.PortalPaymentsByCurrency(r.Context(), sess.Workspace.ID, sess.ClientID, sess.ParticipantID, today)
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
		// AmountPaid tells a void invoice that took payments (fully credited, then refunded) from one voided unpaid.
		AmountPaid store.Money `json:"amount_paid"`
		CurrentQR  bool        `json:"current_qr"`
		HasPDF     bool        `json:"has_pdf"`
	}
	out := []item{}
	for _, i := range list {
		if i.Status != "draft" {
			currentQR := i.HasPDF && i.ArchivedQR && i.Status == "open" && i.AmountDue > 0 && i.AmountDue == i.PayableTotal
			out = append(out, item{i.ID, i.Kind, i.Number, i.Status, i.IsOverdue, i.IssueDate, i.DueDate, i.Currency, i.Total, i.AmountDue, i.Paid,
				currentQR, i.HasPDF})
		}
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": out, "paid_in": map[string]any{"year": today[:4], "totals": paid}})
	return nil
}

func (s *Service) invoicePDF(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	inv, err := s.db.Q.Invoice(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess), false)
	if err != nil {
		return err
	}
	if inv.ClientID != sess.ClientID || inv.Status == "draft" || inv.PDFKey == nil ||
		sess.ParticipantID != "" && (inv.ParticipantContactID == nil || *inv.ParticipantContactID != sess.ParticipantID) {
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

// portalStatus says whether the client still has the engagement to draw on: "active", or why it is past ("ended",
// "cancelled", and for a one-off "expired" once its period is over or "used_up" once nothing is left). A recurring
// engagement's next period may not be opened yet, so only its dates end it.
func portalStatus(e store.Engagement, period *periodView, today string) string {
	if st := engagements.Status(e, today); st != "active" || e.Recurrence != "none" || period == nil {
		return st
	}
	switch {
	case period.EndsOn < today:
		return "expired"
	case period.Remaining == 0:
		return "used_up"
	}
	return "active"
}

func (s *Service) engagements(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	today := s.today(sess)
	list, err := s.db.Q.ListEngagements(r.Context(), sess.Workspace.ID, store.EngagementFilter{ClientID: sess.ClientID, Statuses: []string{"active", "ended", "cancelled"}, Today: today})
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
		Status        string               `json:"status"`
		CurrentPeriod *periodView          `json:"current_period"`
	}
	out := []item{}
	for _, e := range list {
		period := currentPeriod(e, periods[e.ID], today)
		out = append(out, item{e.ID, e.Title, e.Unit, e.Quantity, e.Recurrence, portalStatus(e, period, today), period})
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

// engagementEntries is the client's history of one of their engagements: each period with logged deliveries, newest
// first. Only what the client may see: no member, invoice or audit fields.
func (s *Service) engagementEntries(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	e, err := s.db.Q.Engagement(r.Context(), sess.Workspace.ID, r.PathValue("id"), false)
	if err != nil {
		return err
	}
	if e.ClientID != sess.ClientID {
		return auth.ErrNotFound
	}
	entries, err := s.db.Q.Entries(r.Context(), e.ID, "")
	if err != nil {
		return err
	}
	periods, err := s.db.Q.EngagementPeriodsOf(r.Context(), []string{e.ID})
	if err != nil {
		return err
	}
	type entry struct {
		ID                string               `json:"id"`
		Date              string               `json:"date"`
		Quantity          invoicecalc.Quantity `json:"quantity"`
		Note              *string              `json:"note"`
		ClientPerformance *string              `json:"client_performance"`
	}
	type period struct {
		StartsOn string  `json:"starts_on"`
		EndsOn   string  `json:"ends_on"`
		Entries  []entry `json:"entries"`
	}
	out := []period{}
	for _, p := range periods[e.ID] { // newest first, as the entries
		var list []entry
		for _, en := range entries {
			if en.PeriodID == p.ID {
				list = append(list, entry{en.ID, en.Date, en.Quantity, en.Note, en.ClientPerformance})
			}
		}
		if len(list) > 0 {
			out = append(out, period{p.StartsOn, p.EndsOn, list})
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func (s *Service) documents(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	if sess.ParticipantID != "" {
		docs, err := s.db.Q.ParticipantSharedDocuments(r.Context(), sess.Workspace.ID, sess.ClientID, sess.ParticipantID)
		if err != nil {
			return err
		}
		auth.WriteJSON(w, http.StatusOK, data(docs))
		return nil
	}
	docs, err := s.db.Q.SharedDocuments(r.Context(), sess.Workspace.ID, sess.ClientID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(docs))
	return nil
}

func (s *Service) downloadDocument(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	d, err := s.db.Q.SharedDocument(r.Context(), sess.Workspace.ID, sess.ClientID, r.PathValue("id"))
	if sess.ParticipantID != "" {
		d, err = s.db.Q.ParticipantSharedDocument(r.Context(), sess.Workspace.ID, sess.ClientID, sess.ParticipantID, r.PathValue("id"))
	}
	if err != nil {
		return err
	}
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if sess.PreviewBy != "" {
			return nil // a member's preview tells nobody the client opened it
		}
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
	if d.ExpiresAt != nil {
		if !d.ExpiresAt.After(s.now()) {
			return store.ErrNotFound
		}
		return storage.ServeDirect(w, r, s.files, d.ObjectKey, d.Name, d.ContentType)
	}
	return storage.Serve(w, r, s.files, sess.Workspace.ID, d.ObjectKey, d.Name, d.ContentType)
}

func (s *Service) signatures(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	list, err := s.db.Q.PortalSignatures(r.Context(), sess.Workspace.ID, sess.ClientID, sess.Email, "", participantSigner(sess), s.now())
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

// downloadSignature serves a completed request's signed PDF; 404 for another client's, an unfinished one or one
// whose signed copy is trashed.
func (s *Service) downloadSignature(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	id := r.PathValue("id")
	if id == "" {
		return store.ErrNotFound
	}
	list, err := s.db.Q.PortalSignatures(r.Context(), sess.Workspace.ID, sess.ClientID, sess.Email, id, participantSigner(sess), s.now())
	if err != nil {
		return err
	}
	if len(list) == 0 || list[0].SignedFile == nil {
		return store.ErrNotFound
	}
	d, err := s.db.Q.Document(r.Context(), sess.Workspace.ID, list[0].SignedDocumentID)
	if err != nil {
		return err
	}
	return storage.Serve(w, r, s.files, sess.Workspace.ID, d.ObjectKey, d.Name, d.ContentType)
}

// participantSigner: a participant sees only the signature requests they sign (by their address); "" for the client.
func participantSigner(sess store.PortalSession) string {
	if sess.ParticipantID == "" {
		return ""
	}
	return sess.Email
}
