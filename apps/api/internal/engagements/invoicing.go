package engagements

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

var (
	errAlreadyInvoiced  = auth.Error(http.StatusConflict, "already_invoiced", "This period already has an advance invoice.", nil)
	errNothingToInvoice = auth.Error(http.StatusConflict, "nothing_to_invoice", "There is nothing to invoice for this period.", nil)
)

// swiss formats a civil date as dd.mm.yyyy for invoice text.
func swiss(d string) string {
	t, ok := parseDate(d)
	if !ok {
		return d
	}
	return t.Format("02.01.2006")
}

// linePrice is a period price (in the engagement's basis) as the draft wants it: net in exclusive and none mode,
// gross in inclusive mode.
func linePrice(e store.Engagement, price invoicecalc.Money, mode string) invoicecalc.Money {
	p := store.Product{PriceBasis: e.PriceBasis, UnitPrice: price, VATCategory: e.VATCategory, VATRate: e.VATRate}
	p.Derive()
	if mode == invoicecalc.Inclusive {
		return p.UnitPriceGross
	}
	return p.UnitPriceNet
}

// billable picks the uninvoiced entries a usage invoice covers and the quantity billed for each: all of them for
// arrears, for advance only what exceeds the commitment, latest entries first (the last one taken may be part of it).
func billable(e store.Engagement, p PeriodSummary, entries []store.EngagementEntry) (picked []store.EngagementEntry, qty []invoicecalc.Quantity) {
	var open []store.EngagementEntry // newest first, as listed
	var total invoicecalc.Quantity
	for _, en := range entries {
		if en.Invoice == nil {
			open = append(open, en)
			total += en.Quantity
		}
	}
	limit := total
	if e.Billing == "advance" {
		limit = min(total, max(0, p.Overage-p.InvoicedQuantity))
	}
	for _, en := range open {
		if limit <= 0 {
			break
		}
		take := min(en.Quantity, limit)
		picked, qty = append(picked, en), append(qty, take)
		limit -= take
	}
	return picked, qty
}

func (s *Service) invoicePeriod(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	for k := range body {
		if k != "kind" && k != "detail" {
			return badRequest("Unknown field " + strconv.Quote(k) + ".")
		}
	}
	var kind, detail string
	_ = json.Unmarshal(body["kind"], &kind)
	if raw, set := body["detail"]; set {
		_ = json.Unmarshal(raw, &detail)
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	var invoiceID string
	var out Period
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.Engagement(ctx, ws, r.PathValue("id"), true) // serialises concurrent invoicing of this engagement
		if err != nil {
			return err
		}
		if invoiceID, err = s.InvoicePeriod(ctx, q, sess, e, r.PathValue("period_id"), kind, detail); err != nil {
			return err
		}
		v, err := s.view(ctx, q, e, s.today(sess.Workspace))
		if err != nil {
			return err
		}
		out, err = periodView(ctx, q, v.periods[slices.IndexFunc(v.periods, func(x PeriodSummary) bool { return x.ID == r.PathValue("period_id") })])
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(map[string]any{"invoice_id": invoiceID, "period": out}))
	return nil
}

// InvoicePeriod makes the draft for a period inside the caller's transaction, which must hold the engagement's row
// lock. An empty detail means the engagement's own. Errors are the contract's (already_invoiced, nothing_to_invoice,
// validation_failed, store.ErrNotFound); the HTTP edge and the background job map them.
func (s *Service) InvoicePeriod(ctx context.Context, q store.Q, sess store.Session, e store.Engagement, periodID, kind, detail string) (string, error) {
	if detail == "" {
		detail = e.InvoiceDetail
	}
	if detail == "" {
		detail = "summary"
	}
	fields := map[string]string{}
	if kind != "advance" && kind != "usage" {
		fields["kind"] = "Choose advance or usage."
	}
	if detail != "summary" && detail != "per_entry" {
		fields["detail"] = "Choose summary or per_entry."
	}
	if len(fields) > 0 {
		return "", validationFailed(fields)
	}
	v, err := s.view(ctx, q, e, s.today(sess.Workspace))
	if err != nil {
		return "", err
	}
	i := slices.IndexFunc(v.periods, func(p PeriodSummary) bool { return p.ID == periodID })
	if i < 0 {
		return "", store.ErrNotFound
	}
	p := v.periods[i]
	title := e.Title + " · " + swiss(p.StartsOn) + " – " + swiss(p.EndsOn)
	var lines func(mode string) []store.InvoiceLine
	var covered []store.EngagementEntry
	if kind == "advance" {
		if e.Billing != "advance" {
			return "", validationFailed(map[string]string{"kind": "Only advance engagements have an advance invoice."})
		}
		if p.AdvanceInvoice != nil {
			return "", errAlreadyInvoiced
		}
		lines = func(mode string) []store.InvoiceLine {
			return []store.InvoiceLine{line(e, title, p.Quantity, linePrice(e, p.UnitPrice, mode))}
		}
	} else {
		all, err := q.Entries(ctx, e.ID, p.ID)
		if err != nil {
			return "", err
		}
		picked, qty := billable(e, p, all)
		if len(picked) == 0 {
			return "", errNothingToInvoice
		}
		covered = picked
		price := p.UnitPrice
		if e.Billing == "advance" {
			price = p.OverageUnitPrice
		}
		lines = func(mode string) []store.InvoiceLine {
			unit := linePrice(e, price, mode)
			if detail == "summary" {
				var sum invoicecalc.Quantity
				for _, n := range qty {
					sum += n
				}
				return []store.InvoiceLine{line(e, title, sum, unit)}
			}
			out := make([]store.InvoiceLine, 0, len(picked))
			for j := len(picked) - 1; j >= 0; j-- { // oldest first on the invoice
				d := swiss(picked[j].Date)
				if picked[j].Note != nil {
					d += " · " + *picked[j].Note
				}
				out = append(out, line(e, d, qty[j], unit))
			}
			if len(out) > 0 {
				out[0].Description = e.Title + " · " + out[0].Description
			}
			return out
		}
	}
	invoiceID, err := s.inv.CreateDraft(ctx, q, sess, e.ClientID, func(inv *store.Invoice) {
		inv.Reference = e.Reference
		inv.ServiceDate, inv.ServiceDateEnd = &p.StartsOn, &p.EndsOn
		inv.Lines = lines(inv.VATMode)
	})
	if err != nil {
		return "", err
	}
	if err := q.LinkPeriodInvoice(ctx, p.ID, invoiceID, kind); err != nil {
		return "", err
	}
	if len(covered) > 0 {
		ids := make([]string, len(covered))
		for j, en := range covered {
			ids[j] = en.ID
		}
		if err := q.LinkEntries(ctx, ids, invoiceID); err != nil {
			return "", err
		}
	}
	return invoiceID, nil
}

func line(e store.Engagement, description string, qty invoicecalc.Quantity, price invoicecalc.Money) store.InvoiceLine {
	return store.InvoiceLine{Description: strings.TrimSpace(description), Quantity: qty, Unit: e.Unit, UnitPrice: price,
		VATCategory: e.VATCategory, VATRate: e.VATRate}
}
