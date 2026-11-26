// Package dashboard exposes live, scope-filtered workspace cash flow.
package dashboard

import (
	"context"
	"net/http"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
}

type Service struct {
	db   *store.Store
	auth Auth
	now  func() time.Time
}

func New(db *store.Store, a Auth) *Service { return &Service{db: db, auth: a, now: time.Now} }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/reports/key-figures", s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
		result, err := s.read(r.Context(), sess, r.URL.Query().Get("currency"))
		if err != nil {
			s.auth.WriteError(w, r, err)
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		auth.WriteJSON(w, http.StatusOK, result)
	}))
}

type point struct {
	Date     string  `json:"date"`
	Income   float64 `json:"income"`
	Expenses float64 `json:"expenses"`
}
type response struct {
	Currency        string   `json:"currency"`
	Currencies      []string `json:"currencies"`
	Outstanding     float64  `json:"outstanding"`
	OpenCount       int      `json:"open_count"`
	PaidThisMonth   float64  `json:"paid_this_month"`
	PaidChange      float64  `json:"paid_change"`
	OverdueCount    int      `json:"overdue_count"`
	InvoiceCount    int      `json:"invoice_count"`
	AvgDaysToPay    float64  `json:"avg_days_to_pay"`
	CollectionRate  float64  `json:"collection_rate"`
	SpentThisMonth  float64  `json:"spent_this_month"`
	VATToReclaim    float64  `json:"vat_to_reclaim"`
	PendingCount    int      `json:"pending_count"`
	ExpenseCount    int      `json:"expense_count"`
	ReceiptsMatched float64  `json:"receipts_matched"`
	Trends          struct {
		Outstanding []float64 `json:"outstanding"`
		Paid        []float64 `json:"paid"`
		Spent       []float64 `json:"spent"`
		VAT         []float64 `json:"vat"`
	} `json:"trends"`
	CashFlow map[string][]point `json:"cash_flow"`
	Unread   struct {
		Notifications int `json:"notifications"`
		Inbox         int `json:"inbox"`
	} `json:"unread"`
}

func major(amount store.Money) float64 { return float64(amount) / 100 }

func (s *Service) read(ctx context.Context, sess store.Session, currency string) (response, error) {
	var out response
	if currency != "" && (len(currency) != 3 || currency[0] < 'A' || currency[0] > 'Z' || currency[1] < 'A' || currency[1] > 'Z' || currency[2] < 'A' || currency[2] > 'Z') {
		return out, auth.Error(http.StatusBadRequest, "invalid_request", "currency must be a three-letter uppercase currency code.", nil)
	}
	canInvoices := permissions.Allows(sess.Role, sess.Scopes, "read:invoices")
	canExpenses := permissions.Allows(sess.Role, sess.Scopes, "read:expenses")
	today := sess.Workspace.Today(s.now())
	date, _ := time.Parse(time.DateOnly, today)
	month := time.Date(date.Year(), date.Month(), 1, 0, 0, 0, 0, time.UTC)
	// The years view compares this year with up to four before it, month by month.
	firstMonth := time.Date(month.Year()-4, time.January, 1, 0, 0, 0, 0, time.UTC)
	err := s.db.DashboardRead(ctx, func(q store.Q) error {
		if currency == "" {
			var settings struct {
				Currency string `json:"currency"`
			}
			_, err := q.InvoiceSettings(ctx, sess.Workspace.ID, &settings)
			if err != nil {
				return err
			}
			currency = settings.Currency
			if currency == "" {
				currency = "CHF"
			}
		}
		out.Currency = currency
		var err error
		out.Currencies, err = q.DashboardCurrencies(ctx, sess.Workspace.ID, canInvoices, canExpenses)
		if err != nil {
			return err
		}
		if !slices.Contains(out.Currencies, currency) {
			out.Currencies = append(out.Currencies, currency)
			slices.Sort(out.Currencies)
		}
		if canInvoices {
			invoices, err := q.InvoiceMetrics(ctx, sess.Workspace.ID, currency, today, "")
			if err != nil {
				return err
			}
			out.Outstanding = major(invoices.Outstanding.Amount)
			out.OpenCount = invoices.Outstanding.Count
			out.OverdueCount = invoices.Overdue.Count
			if invoices.AvgDaysToPay != nil {
				out.AvgDaysToPay = *invoices.AvgDaysToPay
			}
			if invoices.CollectionRate != nil {
				out.CollectionRate = *invoices.CollectionRate
			}
			out.InvoiceCount, err = q.DashboardInvoiceCount(ctx, sess.Workspace.ID, currency)
			if err != nil {
				return err
			}
		}
		if canExpenses {
			expenses, err := q.DashboardExpenseSummary(ctx, sess.Workspace.ID, currency, today)
			if err != nil {
				return err
			}
			out.SpentThisMonth = major(expenses.Spent)
			out.VATToReclaim = major(expenses.DeductibleVAT)
			out.PendingCount = expenses.Pending
			out.ExpenseCount = expenses.Count
			out.ReceiptsMatched = expenses.ReceiptsMatched
		}
		movements, err := q.DashboardMovements(ctx, sess.Workspace.ID, currency, firstMonth.Format(time.DateOnly), today, canInvoices, canExpenses)
		if err != nil {
			return err
		}
		months, err := q.DashboardMonths(ctx, sess.Workspace.ID, currency, today, canInvoices, canExpenses)
		if err != nil {
			return err
		}
		out.fillSeries(date, movements, months)
		return nil
	})
	return out, err
}

func (out *response) fillSeries(today time.Time, movements []store.DashboardMovement, months []store.DashboardMonth) {
	byDay := make(map[string]store.DashboardMovement, len(movements))
	byMonth := make(map[string]store.DashboardMovement, len(months))
	for _, m := range movements {
		byDay[m.Date] = m
		total := byMonth[m.Date[:7]]
		total.Income += m.Income
		total.Expenses += m.Expenses
		byMonth[m.Date[:7]] = total
	}
	out.CashFlow = map[string][]point{"30d": {}, "90d": {}, "12m": {}, "years": {}}
	thisMonth := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC)
	for d := time.Date(today.Year()-4, time.January, 1, 0, 0, 0, 0, time.UTC); !d.After(thisMonth); d = d.AddDate(0, 1, 0) {
		m := byMonth[d.Format("2006-01")]
		out.CashFlow["years"] = append(out.CashFlow["years"], point{Date: d.Format(time.DateOnly), Income: major(m.Income), Expenses: major(m.Expenses)})
	}
	for _, rangeDays := range []struct {
		key  string
		days int
	}{{"30d", 30}, {"90d", 90}} {
		for d := today.AddDate(0, 0, 1-rangeDays.days); !d.After(today); d = d.AddDate(0, 0, 1) {
			day := d.Format(time.DateOnly)
			m := byDay[day]
			out.CashFlow[rangeDays.key] = append(out.CashFlow[rangeDays.key], point{Date: day, Income: major(m.Income), Expenses: major(m.Expenses)})
		}
	}
	for _, month := range months {
		m := byMonth[month.Month]
		out.CashFlow["12m"] = append(out.CashFlow["12m"], point{Date: month.Month + "-01", Income: major(m.Income), Expenses: major(m.Expenses)})
		out.Trends.Outstanding = append(out.Trends.Outstanding, major(month.Outstanding))
		out.Trends.VAT = append(out.Trends.VAT, major(month.VAT))
		out.Trends.Paid = append(out.Trends.Paid, major(m.Income))
		out.Trends.Spent = append(out.Trends.Spent, major(m.Expenses))
	}
	current := byMonth[today.Format("2006-01")].Income
	previousMonth := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -1, 0)
	previous := byMonth[previousMonth.Format("2006-01")].Income
	out.PaidThisMonth = major(current)
	if previous > 0 {
		out.PaidChange = float64(current-previous) / float64(previous)
	}
}
