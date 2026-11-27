package workspaceaudit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

type ref struct {
	Kind  string `json:"kind"`
	ID    string `json:"id"`
	Label string `json:"label"`
}
type finding struct {
	ID       string   `json:"id"`
	Class    string   `json:"class"`
	Code     string   `json:"code"`
	Severity string   `json:"severity"`
	Category string   `json:"category"`
	Evidence []ref    `json:"evidence"`
	Values   []string `json:"values,omitempty"`
	Advice   string   `json:"advice,omitempty"`
}
type report struct {
	Findings []finding      `json:"findings"`
	Pending  []string       `json:"pending"`
	Counts   map[string]int `json:"counts"`
	Read     int            `json:"read"`
	Partial  int            `json:"partial"`
}
type access struct{ clients, invoices, documents, quotes, expenses bool }
type snapshot struct {
	clients          []store.AuditClient
	invoices         []store.AuditInvoice
	docs             []store.AuditDocument
	payments         []store.AuditPayment
	quotes, expenses []store.AuditOtherRecord
}

func auditAccess(sess store.Session) access {
	may := func(kind string) bool { return permissions.Allows(sess.Role, sess.Scopes, "read:"+kind) }
	return access{may("clients"), may("invoices"), may("documents"), may("invoices"), may("expenses")}
}

func (s *Service) report(ctx context.Context, sess store.Session, lang, _ string, selected areas) (any, error) {
	a := auditAccess(sess)
	if a == (access{}) {
		return nil, denied()
	}
	var data snapshot
	ws := sess.Workspace.ID
	err := s.db.DashboardRead(ctx, func(q store.Q) error {
		var err error
		if a.clients {
			data.clients, err = q.AuditClients(ctx, ws)
			if err != nil {
				return err
			}
		}
		if a.invoices {
			data.invoices, err = q.AuditInvoices(ctx, ws)
			if err != nil {
				return err
			}
			data.payments, err = q.AuditPayments(ctx, ws)
			if err != nil {
				return err
			}
		}
		if a.quotes {
			data.quotes, err = q.AuditQuotes(ctx, ws)
			if err != nil {
				return err
			}
		}
		if a.expenses {
			data.expenses, err = q.AuditExpenses(ctx, ws)
			if err != nil {
				return err
			}
		}
		if a.documents {
			contractChecks := a.invoices && selected["contracts"] && !selected["documents"]
			data.docs, err = q.AuditDocuments(ctx, ws, lang, sess.Workspace.Timezone, "", contractChecks)
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return evaluate(data, a, selected)
}
func severityLevel(kind string) string {
	switch kind {
	case "critical":
		return "critical"
	case "error":
		return "high"
	case "discrepancy", "missing":
		return "medium"
	default:
		return "low"
	}
}

func (r *report) add(code, severity, category string, refs []ref, values ...string) {
	class := severity
	if severity == "critical" {
		class = "error"
	}
	r.Findings = append(r.Findings, finding{Class: class, Code: code, Severity: severityLevel(severity), Category: category, Evidence: refs, Values: values})
}
func identifier(v string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToUpper(r)
		}
		return -1
	}, v)
}
func clientRef(c store.AuditClient) ref {
	return ref{"client", c.ID, fmt.Sprintf("#%d %s", c.Number, c.Name)}
}
func invoiceRef(i store.AuditInvoice) ref    { return ref{"invoice", i.ID, i.Number} }
func docRef(d store.AuditDocument) ref       { return ref{"document", d.ID, d.Name} }
func amount(v int64, currency string) string { return currency + " " + invoicecalc.Money(v).String() }
func hasOwner(d store.AuditDocument, client string) bool {
	if len(d.Owners) > 0 {
		return slices.Contains(d.Owners, client)
	}
	return client != "" && d.Client == client
}
func sameMoney(f facts, total int64, currency string) bool {
	return f.Total == nil || f.Currency == "" || (f.Currency == currency && *f.Total == total)
}
func relevantClient(kind string) bool {
	return slices.Contains([]string{"contracts", "payment_confirmations", "bank_statements"}, kind)
}

func (selected areas) includesDocument(d store.AuditDocument, a access) bool {
	// Every original can produce a file integrity or completeness finding.
	if selected.includes("documents") {
		return true
	}
	var area string
	switch d.Kind {
	case "invoices", "credit_notes":
		area = "invoices"
	case "quotes", "contracts":
		area = d.Kind
	case "bank_statements", "payment_confirmations":
		area = "payments"
	case "receipts":
		area = "expenses"
	case "tax_documents":
		area = "tax"
	}
	if selected.includes(area) {
		return true
	}
	// An original can support a second check through its record links.
	return (a.invoices && selected["contracts"] && d.ContractEvidence) ||
		(a.invoices && selected["payments"] && len(d.Payments)+len(d.Refunds) > 0) ||
		(a.expenses && selected["expenses"] && len(d.Expenses) == 1) ||
		(a.clients && a.invoices && selected["clients"] && d.Kind == "other" &&
			(len(d.Owners) > 0 || (d.Client != "" && d.Client != store.NoClient)))
}

func evaluate(s snapshot, a access, selected areas) (report, error) {
	out := report{Findings: []finding{}, Pending: []string{}, Counts: map[string]int{}}
	if a.clients {
		out.Counts["clients"] = len(s.clients)
	}
	if a.documents {
		out.Counts["documents"] = len(s.docs)
	}
	if a.invoices {
		out.Counts["invoices"] = len(s.invoices)
		out.Counts["payments"] = len(s.payments)
	}
	if a.quotes {
		out.Counts["quotes"] = len(s.quotes)
	}
	if a.expenses {
		out.Counts["expenses"] = len(s.expenses)
	}
	clients := map[string]store.AuditClient{}
	names := map[string][]store.AuditClient{}
	for _, c := range s.clients {
		clients[c.ID] = c
		k := strings.ToLower(strings.Join(strings.Fields(c.Name), " "))
		names[k] = append(names[k], c)
	}
	docs := map[string]store.AuditDocument{}
	byKey := map[string]store.AuditDocument{}
	readings := map[string]facts{}
	contracts := map[string][]store.AuditDocument{}
	firstProof := map[string]ref{}
	for _, d := range s.docs {
		docs[d.ID] = d
		byKey[d.ObjectKey] = d
		var f facts
		if d.Status == "read" {
			if err := json.Unmarshal(d.Facts, &f); err != nil {
				return out, err
			}
			readings[d.ID] = f
			if f.Kind == "contract" && identifier(f.Contract) != "" {
				contracts[identifier(f.Contract)] = append(contracts[identifier(f.Contract)], d)
			}
		}
		if relevantClient(d.Kind) || f.Kind == "contract" || f.Kind == "payment-confirmation" {
			for _, id := range append(slices.Clone(d.Owners), d.Client) {
				if _, ok := firstProof[id]; !ok {
					firstProof[id] = docRef(d)
				}
			}
		}
	}
	invoiced := map[string]bool{}
	numbered := map[string][]store.AuditInvoice{}
	payments := map[string][]store.AuditPayment{}
	byPay := map[string]store.AuditPayment{}
	supported := map[string]bool{}
	for _, p := range s.payments {
		payments[p.Invoice] = append(payments[p.Invoice], p)
		byPay[p.ID] = p
	}
	originals := map[string][]store.AuditInvoice{}
	byInvoice := map[string]store.AuditInvoice{}
	for _, i := range s.invoices {
		byInvoice[i.ID] = i
		if i.Number == "" || i.Status == "draft" {
			continue
		}
		invoiced[i.Client] = true
		numbered[identifier(i.Number)] = append(numbered[identifier(i.Number)], i)
		ir := invoiceRef(i)
		if i.Paid != i.PaidRows {
			out.add("ledger_total", "critical", "payments", []ref{ir}, amount(i.Paid, i.Currency), amount(i.PaidRows, i.Currency))
		}
		if len(i.Schedule) > 0 && i.InstalmentTotal != i.Total {
			out.add("schedule_total", "error", "invoices", []ref{ir}, amount(i.InstalmentTotal, i.Currency), amount(i.Total, i.Currency))
		}
		if !a.documents {
			continue
		}
		d, ok := docs[i.Source]
		if !ok && i.Source == "" {
			d, ok = byKey[i.PDFKey]
		}
		if ok {
			originals[d.ID] = append(originals[d.ID], i)
		} else {
			out.add("missing_original", "error", "invoices", []ref{ir})
		}
		if i.Contract != "" {
			d, ok := docs[i.Contract]
			if !ok {
				out.add("broken_contract", "error", "contracts", []ref{ir})
			} else if a.clients && len(d.Owners) > 0 && !slices.Contains(d.Owners, i.Client) {
				out.add("contract_owner", "discrepancy", "contracts", []ref{ir, docRef(d)})
			}
			if reading, ok := readings[i.Contract]; ok && reading.Kind == "contract" && i.Reference != "" && reading.Contract != "" && identifier(i.Reference) != identifier(reading.Contract) {
				out.add("contract_reference", "discrepancy", "contracts", []ref{ir, docRef(d)}, reading.Contract, i.Reference)
			}
		} else if i.Reference != "" {
			refs := []ref{ir}
			for _, d := range contracts[identifier(i.Reference)] {
				if hasOwner(d, i.Client) {
					refs = append(refs, docRef(d))
				}
			}
			out.add("contract_link", "missing", "contracts", refs, i.Reference)
		}
	}
	for _, d := range s.docs {
		f := readings[d.ID]
		if f.Kind != "contract" || f.Contract == "" {
			continue
		}
		candidates := contracts[identifier(f.Contract)]
		if len(candidates) < 2 {
			continue
		}
		owners := d.Owners
		if len(owners) == 0 && d.Client != "" && d.Client != store.NoClient {
			owners = []string{d.Client}
		}
		for _, owner := range owners {
			var refs []ref
			for _, other := range candidates {
				if hasOwner(other, owner) {
					refs = append(refs, docRef(other))
				}
			}
			if len(refs) > 1 && refs[0].ID == d.ID {
				out.add("contract_versions", "review", "contracts", refs, f.Contract)
			}
		}
	}
	for _, c := range s.clients {
		key := strings.ToLower(strings.Join(strings.Fields(c.Name), " "))
		same := names[key]
		if len(same) > 1 && same[0].ID == c.ID {
			refs := []ref{}
			for _, other := range same {
				refs = append(refs, clientRef(other))
			}
			out.add("same_name", "review", "clients", refs)
		}
		if proof, ok := firstProof[c.ID]; a.invoices && ok && !invoiced[c.ID] {
			out.add("client_no_invoice", "missing", "clients", []ref{clientRef(c), proof})
		}
	}
	quotes := map[string]store.AuditOtherRecord{}
	for _, q := range s.quotes {
		if q.PDFKey != "" {
			quotes[q.PDFKey] = q
		}
	}
	expenses := map[string]store.AuditOtherRecord{}
	for _, e := range s.expenses {
		expenses[e.ID] = e
	}
	byContract := map[string][]store.AuditInvoice{}
	for _, i := range s.invoices {
		if i.Number != "" && i.Status != "draft" && i.Reference != "" {
			k := identifier(i.Reference)
			byContract[k] = append(byContract[k], i)
		}
	}
	for _, d := range s.docs {
		dr := docRef(d)
		refs := []ref{dr}
		if c, ok := clients[d.FolderClient]; ok && len(d.Owners) > 0 && !slices.Contains(d.Owners, c.ID) {
			out.add("folder_owner", "discrepancy", "documents", []ref{dr, clientRef(c)})
		}
		for _, id := range d.Invoices {
			if i, ok := byInvoice[id]; ok && len(d.Owners) > 0 && !slices.Contains(d.Owners, i.Client) && a.clients {
				out.add("record_owner", "discrepancy", "documents", []ref{dr, invoiceRef(i)})
			}
		}
		for _, id := range d.Payments {
			supported[id] = true
			if p, ok := byPay[id]; ok {
				if i, ok := byInvoice[p.Invoice]; ok && a.clients && len(d.Owners) > 0 && !slices.Contains(d.Owners, i.Client) {
					out.add("record_owner", "discrepancy", "payments", []ref{dr, invoiceRef(i)})
				}
			}
		}
		switch d.Status {
		case "":
			if selected.includesDocument(d, a) {
				out.Pending = append(out.Pending, d.ID)
			}
			continue
		case "missing", "integrity":
			out.Partial++
			out.add("file_"+d.Status, "critical", "documents", refs)
			continue
		case "oversize", "unsupported":
			out.Partial++
			out.add("file_"+d.Status, "review", "documents", refs)
			continue
		}
		f := readings[d.ID]
		out.Read++
		if !f.Complete {
			out.Partial++
			out.add("partial_read", "review", "documents", refs)
		}
		cat := "documents"
		switch f.Kind {
		case "contract":
			cat = "contracts"
		case "invoice":
			cat = "invoices"
		case "payment-confirmation", "bank-statement":
			cat = "payments"
		case "tax-document":
			cat = "tax"
		case "receipt":
			cat = "expenses"
		case "quote":
			cat = "quotes"
		}
		for _, issue := range f.Issues {
			if strings.TrimSpace(issue.Evidence) != "" {
				out.Findings = append(out.Findings, finding{Class: "review", Code: "source_observation", Severity: "low", Category: cat, Evidence: refs, Values: []string{issue.Evidence}, Advice: issue.Recommendation})
			}
		}
		if a.clients && (f.Kind == "contract" || f.Kind == "payment-confirmation") && len(d.Owners) == 0 && (d.Client == "" || d.Client == store.NoClient) {
			out.add("missing_client", "missing", cat, refs)
		}
		if f.Kind == "tax-document" && d.FolderYear != "" && len(f.TaxYear) == 4 && f.TaxYear != d.FolderYear {
			out.add("tax_year", "discrepancy", "tax", refs, f.TaxYear, d.FolderYear)
		}
		if a.clients && f.Party != "" {
			exact := names[strings.ToLower(strings.Join(strings.Fields(f.Party), " "))]
			if len(exact) == 1 && !hasOwner(d, exact[0].ID) && (f.Kind == "contract" || f.Kind == "invoice" || f.Kind == "quote") {
				out.add("printed_owner", "review", cat, []ref{dr, clientRef(exact[0])})
			}
		}
		if a.invoices && f.Kind == "invoice" && len(originals[d.ID]) == 0 && len(d.Expenses) == 0 {
			if candidates := numbered[identifier(f.Reference)]; len(candidates) == 1 && !slices.Contains(d.Invoices, candidates[0].ID) {
				out.add("invoice_copy", "review", "invoices", []ref{dr, invoiceRef(candidates[0])}, f.Reference)
			}
		}
		for _, i := range originals[d.ID] {
			evidence := []ref{dr, invoiceRef(i)}
			if f.Kind != "invoice" {
				if f.Complete && f.Kind != "other" {
					out.add("original_kind", "discrepancy", "invoices", evidence)
				}
				continue
			}
			if !sameMoney(f, i.Total, i.Currency) {
				out.add("original_total", "error", "invoices", evidence, amount(*f.Total, f.Currency), amount(i.Total, i.Currency))
			}
			if f.Reference != "" && identifier(f.Reference) != identifier(i.Number) {
				out.add("original_number", "error", "invoices", evidence, f.Reference, i.Number)
			}
			if f.Contract != "" && identifier(f.Contract) != identifier(i.Reference) {
				out.add("contract_reference", "discrepancy", "contracts", evidence, f.Contract, i.Reference)
			}
			if f.Complete && len(f.Instalments) > 0 && !slices.Equal(f.Instalments, i.Schedule) {
				out.add("original_schedule", "discrepancy", "invoices", evidence)
			}
		}
		if f.Kind == "contract" && f.Contract != "" {
			for _, i := range byContract[identifier(f.Contract)] {
				if !hasOwner(d, i.Client) {
					if a.clients && (len(d.Owners) > 0 || clients[d.Client].ID != "") {
						out.add("contract_owner", "discrepancy", "contracts", []ref{dr, invoiceRef(i)})
					}
					continue
				}
				if !sameMoney(f, i.Total, i.Currency) {
					out.add("contract_amount", "review", "contracts", []ref{dr, invoiceRef(i)}, amount(*f.Total, f.Currency), amount(i.Total, i.Currency))
				}
			}
		}
		if q, ok := quotes[d.ObjectKey]; ok && f.Kind == "quote" && !sameMoney(f, q.Total, q.Currency) {
			out.add("original_total", "error", "quotes", []ref{dr, {"quote", q.ID, q.Label}}, amount(*f.Total, f.Currency), amount(q.Total, q.Currency))
		}
		if f.Kind == "receipt" && len(d.Expenses) == 1 {
			if e, ok := expenses[d.Expenses[0]]; ok && !sameMoney(f, e.Total, e.Currency) {
				out.add("receipt_total", "review", "expenses", []ref{dr, {"expense", e.ID, e.Label}}, amount(*f.Total, f.Currency), amount(e.Total, e.Currency))
			}
		}
		if a.invoices && (f.Kind == "payment-confirmation" || f.Kind == "bank-statement") {
			checkCredits(&out, d, f.Credits, numbered, payments, a.clients, supported)
		}
	}
	if a.documents && a.invoices {
		for _, p := range s.payments {
			if p.Method == "bank_transfer" && !supported[p.ID] {
				i := byInvoice[p.Invoice]
				out.add("booking_without_proof", "missing", "payments", []ref{invoiceRef(i)}, amount(p.Amount, i.Currency), p.Date)
			}
		}
	}
	maps.DeleteFunc(out.Counts, func(area string, _ int) bool { return !selected.includes(area) })
	// Two equivalent explanations from the same evidence are one finding in the drawer.
	seen := map[string]bool{}
	unique := out.Findings[:0]
	for _, f := range out.Findings {
		if !selected.includes(f.Category) {
			continue
		}
		raw, err := json.Marshal(f)
		if err != nil {
			return out, err
		}
		sum := sha256.Sum256(raw)
		f.ID = hex.EncodeToString(sum[:16])
		if !seen[f.ID] {
			seen[f.ID] = true
			unique = append(unique, f)
		}
	}
	out.Findings = unique
	return out, nil
}

func checkCredits(out *report, d store.AuditDocument, credits []entry, numbers map[string][]store.AuditInvoice, payments map[string][]store.AuditPayment, clients bool, supported map[string]bool) {
	dr := docRef(d)
	named := filenameInvoices(d.Name, numbers)
	for _, c := range credits {
		if c.Reference == "" {
			continue
		}
		if len(named) == 1 && identifier(named[0].Number) != identifier(c.Reference) {
			evidence := []ref{dr, invoiceRef(named[0])}
			if other := numbers[identifier(c.Reference)]; len(other) == 1 {
				evidence = append(evidence, invoiceRef(other[0]))
			}
			out.add("filename_reference", "discrepancy", "payments", evidence, named[0].Number, c.Reference)
		}
		candidates := numbers[identifier(c.Reference)]
		if len(candidates) == 0 {
			out.add("unknown_invoice", "missing", "payments", []ref{dr}, c.Reference)
			continue
		}
		if len(candidates) != 1 {
			continue
		}
		i := candidates[0]
		refs := []ref{dr, invoiceRef(i)}
		if clients && (len(d.Owners) > 0 || d.FolderClient != "") && !hasOwner(d, i.Client) {
			out.add("payment_owner", "discrepancy", "payments", refs)
			continue
		}
		if c.Amount == nil || c.Currency == "" || (c.Date == "" && c.Booking == "") {
			continue
		}
		matches := []string{}
		for _, p := range payments[i.ID] {
			if c.Currency == i.Currency && p.Amount == *c.Amount && (p.Date == c.Date || p.Date == c.Booking) {
				matches = append(matches, p.ID)
			}
		}
		date := c.Date
		if date == "" {
			date = c.Booking
		}
		if len(matches) == 0 {
			out.add("payment_unmatched", "discrepancy", "payments", refs, amount(*c.Amount, c.Currency), date)
		} else if len(matches) == 1 {
			supported[matches[0]] = true
			if slices.Contains(d.Payments, matches[0]) {
				continue
			}
			out.add("payment_link", "missing", "payments", refs, amount(*c.Amount, c.Currency), date)
		}
	}
	if len(credits) > 0 && len(d.Payments) == 0 && len(d.Refunds) == 0 && !slices.ContainsFunc(credits, func(c entry) bool { return c.Reference != "" }) {
		out.add("unreferenced_transfer", "review", "payments", []ref{dr}, strconv.Itoa(len(credits)))
	}
}

// Scan contiguous filename words, looking up normalized invoice numbers; punctuation is a separator,
// so a proof for INV-100 never accidentally matches INV-10.
func filenameInvoices(name string, numbers map[string][]store.AuditInvoice) []store.AuditInvoice {
	words := strings.FieldsFunc(strings.ToUpper(name), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	var found []store.AuditInvoice
	longest := 0
	for start := range words {
		var number strings.Builder
		for _, word := range words[start:] {
			number.WriteString(word)
			if number.Len() > 128 {
				break
			}
			key := number.String()
			if number.Len() < 3 || number.Len() < longest || !strings.ContainsFunc(key, unicode.IsDigit) {
				continue
			}
			if len(key) == 4 && key >= "1900" && key <= "2199" {
				if _, err := strconv.Atoi(key); err == nil {
					continue
				}
			}
			if rows := numbers[key]; len(rows) > 0 {
				if number.Len() > longest {
					found = nil
					longest = number.Len()
				}
				for _, v := range rows {
					if !slices.ContainsFunc(found, func(i store.AuditInvoice) bool { return i.ID == v.ID }) {
						found = append(found, v)
					}
				}
			}
		}
	}
	return found
}
