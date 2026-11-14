package ledgercalc

import (
	"sort"
)

type accountKey struct{ account, currency string }

// carryAccount takes over the result of earlier years: income-statement accounts (KMU classes 3-8) open each year at zero.
const (
	carryAccount = "2970"
	carryName    = "Gewinnvortrag / Verlustvortrag"
)

func accountName(code string, names map[string]string) string {
	if n, ok := names[code]; ok {
		return n
	}
	if n := AccountName(code); n != "" {
		return n
	}
	if code == carryAccount {
		return carryName
	}
	return ""
}

func isIncomeStatement(code string) bool {
	return code != "" && code[0] >= '3' && code[0] <= '8'
}

// openingSides names the accounts a row dated before from moves in the opening: a row from before from's year moves its
// income-statement side into the carry account.
func openingSides(r Row, from string) (debit, credit string) {
	debit, credit = r.Debit, r.Credit
	if r.Date >= from[:4]+"-01-01" {
		return
	}
	if isIncomeStatement(debit) {
		debit = carryAccount
	}
	if isIncomeStatement(credit) {
		credit = carryAccount
	}
	return
}

// InRange keeps the rows dated from..to inclusive, in their order.
func InRange(rows []Row, from, to string) []Row {
	var out []Row
	for _, r := range rows {
		if r.Date >= from && r.Date <= to {
			out = append(out, r)
		}
	}
	return out
}

// Balances sums every account and currency: Opening before from, Debit and Credit within from..to; rows after to are ignored.
func Balances(rows []Row, from, to string, names map[string]string) []Balance {
	acc := map[accountKey]*Balance{}
	get := func(a, c string) *Balance {
		k := accountKey{a, c}
		if acc[k] == nil {
			acc[k] = &Balance{Account: a, Name: accountName(a, names), Currency: c}
		}
		return acc[k]
	}
	for _, r := range rows {
		if r.Date > to {
			continue
		}
		d, c := get(r.Debit, r.Currency), get(r.Credit, r.Currency)
		if r.Date < from {
			da, ca := openingSides(r, from)
			get(da, r.Currency).Opening += r.Amount
			get(ca, r.Currency).Opening -= r.Amount
		} else {
			d.Debit += r.Amount
			c.Credit += r.Amount
		}
	}
	out := make([]Balance, 0, len(acc))
	for _, b := range acc {
		b.Closing = b.Opening + b.Debit - b.Credit
		out = append(out, *b)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Account != out[j].Account {
			return out[i].Account < out[j].Account
		}
		return out[i].Currency < out[j].Currency
	})
	return out
}

// AccountStatement is the Hauptbuch of one account and currency over from..to, lines in date order with a running balance.
func AccountStatement(rows []Row, account, currency, from, to string, names map[string]string) Statement {
	st := Statement{Account: account, Name: accountName(account, names), Currency: currency, Lines: []StatementLine{}}
	var inRange []Row
	for _, r := range rows {
		if r.Currency != currency || r.Date > to {
			continue
		}
		if r.Date < from {
			da, ca := openingSides(r, from)
			if da == account {
				st.Opening += r.Amount
			}
			if ca == account {
				st.Opening -= r.Amount
			}
			continue
		}
		if r.Debit != account && r.Credit != account {
			continue
		}
		inRange = append(inRange, r)
	}
	sort.SliceStable(inRange, func(i, j int) bool { return inRange[i].Date < inRange[j].Date })
	bal := st.Opening
	for _, r := range inRange {
		l := StatementLine{Date: r.Date, Ref: r.Ref, Description: r.Description}
		if r.Debit == account {
			l.Debit, l.Contra = r.Amount, r.Credit
		} else {
			l.Credit, l.Contra = r.Amount, r.Debit
		}
		bal += l.Debit - l.Credit
		l.Balance = bal
		st.Lines = append(st.Lines, l)
	}
	st.Closing = bal
	return st
}
