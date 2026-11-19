package engagements

import (
	"encoding/csv"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"helvetly.com/api/internal/store"
)

var engagementsHeader = []string{"number", "title", "client", "status", "billing", "recurrence", "interval", "start_date", "end_date",
	"unit", "quantity", "unit_price", "currency", "period_start", "period_end", "used", "remaining", "overage", "reference"}

var entriesHeader = []string{"date", "period_start", "period_end", "quantity", "unit", "note", "client_performance", "performed_by", "invoice_number"}

func str(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// cell keeps a spreadsheet from running a value as a formula (same rule as the products export).
func cell(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		if _, err := strconv.ParseFloat(v, 64); err != nil {
			return "'" + v
		}
	}
	return v
}

func (s *Service) writeCSV(w http.ResponseWriter, name string, header []string, rows [][]string) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte("\xEF\xBB\xBF")) // a BOM, so spreadsheet apps read UTF-8
	out := csv.NewWriter(w)
	_ = out.Write(header)
	for _, row := range rows {
		for i := range row {
			row[i] = cell(row[i])
		}
		_ = out.Write(row) // headers are sent; a write error means the client left
	}
	out.Flush()
}

// exportEngagements takes the list query without paging, or ids=a,b (then every status).
func (s *Service) exportEngagements(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	q := r.URL.Query()
	f := store.EngagementFilter{Q: q.Get("q"), ClientID: q.Get("client_id"), Today: s.today(sess.Workspace), Statuses: []string{"scheduled", "active"}}
	var ids []string
	for _, v := range q["ids"] {
		ids = append(ids, strings.Split(v, ",")...)
	}
	if v := q.Get("status"); v != "" || len(ids) > 0 {
		f.Statuses = allStatuses
		if v != "" {
			f.Statuses = strings.Split(v, ",")
			for _, st := range f.Statuses {
				if !slices.Contains(allStatuses, st) {
					return badRequest("status must be a comma list of scheduled, active, ended, cancelled.")
				}
			}
		}
	}
	att, sort := q.Get("attention"), q.Get("sort")
	if att != "" && !slices.Contains([]string{"under_pace", "ending_soon", "overage", "to_invoice"}, att) {
		return badRequest("attention must be under_pace, ending_soon, overage or to_invoice.")
	}
	if sort == "" {
		sort = "ends"
	}
	if !slices.Contains([]string{"ends", "-created_at", "title", "client"}, sort) {
		return badRequest("sort must be one of ends, -created_at, title, client.")
	}
	list, err := s.views(r.Context(), sess.Workspace.ID, f)
	if err != nil {
		return err
	}
	list = slices.DeleteFunc(list, func(v EngagementView) bool {
		return (att != "" && !slices.Contains(v.Attention, att)) || (len(ids) > 0 && !slices.Contains(ids, v.ID))
	})
	slices.SortStableFunc(list, func(a, b EngagementView) int { return compare(sort, a, b) })
	rows := make([][]string, 0, len(list))
	for _, v := range list {
		var from, to, used, remaining, overage string
		if p := v.CurrentPeriod; p != nil {
			from, to, used, remaining, overage = p.StartsOn, p.EndsOn, p.Used.String(), p.Remaining.String(), p.Overage.String()
		}
		rows = append(rows, []string{strconv.FormatInt(v.Number, 10), v.Title, v.Client.Name, v.Status, v.Billing, v.Recurrence,
			strconv.Itoa(v.Interval), v.StartDate, str(v.EndDate), str(v.Unit), v.Quantity.String(), v.UnitPrice.String(), v.Currency,
			from, to, used, remaining, overage, str(v.Reference)})
	}
	s.writeCSV(w, "engagements-"+s.today(sess.Workspace)+".csv", engagementsHeader, rows)
	return nil
}

func (s *Service) exportEntries(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, ws := r.Context(), sess.Workspace.ID
	var e store.Engagement
	var list []store.EngagementEntry
	var periods []store.EngagementPeriod
	err := s.db.Tx(ctx, func(q store.Q) (err error) {
		if e, err = q.Engagement(ctx, ws, r.PathValue("id"), false); err != nil {
			return err
		}
		if periods, err = q.EngagementPeriods(ctx, e.ID); err != nil {
			return err
		}
		list, err = q.Entries(ctx, e.ID, r.URL.Query().Get("period_id"))
		return err
	})
	if err != nil {
		return err
	}
	rows := make([][]string, 0, len(list))
	for _, en := range list {
		var from, to string
		if i := slices.IndexFunc(periods, func(p store.EngagementPeriod) bool { return p.ID == en.PeriodID }); i >= 0 {
			from, to = periods[i].StartsOn, periods[i].EndsOn
		}
		by, number := "", ""
		if en.PerformedBy != nil {
			by = en.PerformedBy.Name
		}
		if en.Invoice != nil {
			number = str(en.Invoice.Number)
		}
		rows = append(rows, []string{en.Date, from, to, en.Quantity.String(), str(e.Unit), str(en.Note), str(en.ClientPerformance), by, number})
	}
	s.writeCSV(w, "engagement-"+strconv.FormatInt(e.Number, 10)+"-entries.csv", entriesHeader, rows)
	return nil
}
