package invoices

import (
	"context"
	"encoding/json"
	"fmt"

	"helvetly.com/api/internal/dunningcalc"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/store"
)

// Dunning of overdue invoices (docs/invoices-contract.md "Dunning"): the settings live here, with the other invoice
// settings; internal/dunning sends the steps.

// DunningStep is one reminder: when it goes out (Timing, Days), an optional name replacing the standard title, its
// fee (never before the due date), an optional text replacing the standard sentence and whether the letter carries
// a QR bill.
type DunningStep struct {
	Name   *string            `json:"name"`
	Timing dunningcalc.Timing `json:"timing"`
	Days   int                `json:"days"`
	Fee    invoicecalc.Money  `json:"fee"`
	Text   *string            `json:"text"`
	QRBill bool               `json:"qr_bill"`
}

// DunningSettings: settings "dunning". InterestFrom is "reminder" (default starts with the first notice after the
// due date, OR 102 para. 1) or "due_date" (an agreed due date, OR 102 para. 2).
type DunningSettings struct {
	Enabled         bool                `json:"enabled"`
	Steps           []DunningStep       `json:"steps"`
	InterestEnabled bool                `json:"interest_enabled"`
	InterestRate    invoicecalc.Percent `json:"interest_rate"`
	InterestFrom    string              `json:"interest_from"`
}

// UnmarshalJSON reads stored settings, also those saved before steps: their "levels" (1 to 3; the first after the
// due date, the others after the previous notice) become the same steps, so notices already sent keep their place.
func (d *DunningSettings) UnmarshalJSON(raw []byte) error {
	type plain DunningSettings
	v := struct {
		*plain
		Levels []struct {
			Days int               `json:"days"`
			Fee  invoicecalc.Money `json:"fee"`
			Text *string           `json:"text"`
		} `json:"levels"`
	}{plain: (*plain)(d)}
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	if len(v.Levels) == 0 || hasKey(raw, "steps") {
		return nil
	}
	d.Steps = make([]DunningStep, len(v.Levels))
	for i, l := range v.Levels {
		timing := dunningcalc.AfterPrevious
		if i == 0 {
			timing = dunningcalc.AfterDue
		}
		d.Steps[i] = DunningStep{Timing: timing, Days: l.Days, Fee: l.Fee, Text: l.Text, QRBill: true}
	}
	return nil
}

func hasKey(raw []byte, key string) bool {
	var m map[string]json.RawMessage
	_ = json.Unmarshal(raw, &m)
	_, ok := m[key]
	return ok
}

// StatutoryInterest: 5 % a year (OR 104 para. 1).
const StatutoryInterest invoicecalc.Percent = 500

func defaultDunningSettings() DunningSettings {
	return DunningSettings{Steps: []DunningStep{{Timing: dunningcalc.AfterDue, Days: 10, QRBill: true},
		{Timing: dunningcalc.AfterPrevious, Days: 14, QRBill: true}, {Timing: dunningcalc.AfterPrevious, Days: 14, QRBill: true}},
		InterestRate: StatutoryInterest, InterestFrom: "reminder"}
}

// CalcSteps: the steps for internal/dunningcalc.
func (d DunningSettings) CalcSteps() []dunningcalc.Step {
	out := make([]dunningcalc.Step, len(d.Steps))
	for i, s := range d.Steps {
		out[i] = dunningcalc.Step{Timing: s.Timing, Days: s.Days}
	}
	return out
}

// Words: the wording of step (1-based) in language, as a note before the due date or a reminder after it, and its
// title: the step's name, else the standard one. A reminder is ranked among the steps that are not notes.
func (d DunningSettings) Words(language string, step int, beforeDue bool) (invoicepdf.Words, string) {
	rank, ranks := 0, 0
	for i, s := range d.Steps {
		if s.Timing != dunningcalc.BeforeDue {
			ranks++
			if i < step {
				rank++
			}
		}
	}
	w := invoicepdf.ReminderWords(language, rank, ranks, beforeDue)
	if step >= 1 && step <= len(d.Steps) && d.Steps[step-1].Name != nil {
		return w, *d.Steps[step-1].Name
	}
	return w, w.Title
}

// Rate: the interest rate charged, 0 when interest is off.
func (d DunningSettings) Rate() invoicecalc.Percent {
	if !d.InterestEnabled {
		return 0
	}
	return d.InterestRate
}

// parseDunningSettings applies the fields present in raw; the others keep their value.
func parseDunningSettings(p *parser, raw json.RawMessage, d *DunningSettings) error {
	m, err := object(raw, "dunning", "enabled", "steps", "interest_enabled", "interest_rate", "interest_from")
	if err != nil {
		return err
	}
	for key, into := range map[string]*bool{"enabled": &d.Enabled, "interest_enabled": &d.InterestEnabled} {
		if v, ok := m[key]; ok && (isNull(v) || json.Unmarshal(v, into) != nil) {
			p.fail("dunning."+key, "Choose true or false.")
		}
	}
	if v, ok := m["interest_rate"]; ok {
		// up to 15 %: a higher agreed rate may be usury under cantonal law, and is surely a typo here
		if r, ok := p.decimal("dunning.interest_rate", v, parsePercent, "Enter a rate from 0 to 15 %."); ok && r > 1500 {
			p.fail("dunning.interest_rate", "Enter a rate from 0 to 15 %.")
		} else {
			d.InterestRate = invoicecalc.Percent(r)
		}
	}
	if v, ok := m["interest_from"]; ok {
		d.InterestFrom = p.required("dunning.interest_from", v, 10, oneOf("reminder", "due_date"), "Choose from the first reminder or from the due date.")
	}
	if v, ok := m["steps"]; ok {
		var steps []json.RawMessage
		if isNull(v) || json.Unmarshal(v, &steps) != nil || len(steps) < 1 || len(steps) > dunningcalc.MaxSteps {
			p.fail("dunning.steps", fmt.Sprintf("Enter one to %d reminders.", dunningcalc.MaxSteps))
			return nil
		}
		d.Steps = make([]DunningStep, len(steps))
		for i, raw := range steps {
			if err := parseDunningStep(p, fmt.Sprintf("dunning.steps.%d", i), raw, &d.Steps[i]); err != nil {
				return err
			}
		}
		for i, problem := range dunningcalc.Problems(d.CalcSteps()) {
			if problem != "" {
				p.fail(fmt.Sprintf("dunning.steps.%d.timing", i), problem)
			}
		}
	}
	return nil
}

func parseDunningStep(p *parser, key string, raw json.RawMessage, s *DunningStep) error {
	m, err := object(raw, "a dunning step", "name", "timing", "days", "fee", "text", "qr_bill")
	if err != nil {
		return err
	}
	s.Timing = dunningcalc.Timing(p.required(key+".timing", m["timing"], 20, oneOf(string(dunningcalc.BeforeDue),
		string(dunningcalc.AfterDue), string(dunningcalc.AfterPrevious)), "Choose before the due date, after it or after the previous reminder."))
	maxDays := 90
	if s.Timing == dunningcalc.BeforeDue {
		maxDays = dunningcalc.MaxDaysBefore
	}
	if json.Unmarshal(m["days"], &s.Days) != nil || s.Days < 1 || s.Days > maxDays {
		p.fail(key+".days", fmt.Sprintf("Enter a number of days from 1 to %d.", maxDays))
	}
	if v, ok := m["name"]; ok {
		s.Name = p.text(key+".name", v, 60, nil)
	}
	if v, ok := m["fee"]; ok {
		// multiples of 0.05 keep a CHF total payable in cash rounding
		if fee, ok := p.decimal(key+".fee", v, parseMoney, "Enter a fee such as 20.00."); ok && (fee > 100000 || fee%5 != 0) {
			p.fail(key+".fee", "Enter a fee from 0 to 1000.00, in steps of 0.05.")
		} else if ok && fee != 0 && s.Timing == dunningcalc.BeforeDue {
			p.fail(key+".fee", "A note before the due date has no fee.")
		} else {
			s.Fee = invoicecalc.Money(fee)
		}
	}
	if v, ok := m["text"]; ok {
		s.Text = p.text(key+".text", v, 1000, nil)
	}
	s.QRBill = true
	if v, ok := m["qr_bill"]; ok && (isNull(v) || json.Unmarshal(v, &s.QRBill) != nil) {
		p.fail(key+".qr_bill", "Choose true or false.")
	}
	return nil
}

// DunningSettingsOf: the workspace's dunning settings (defaults where unset).
func (s *Service) DunningSettingsOf(ctx context.Context, q store.Q, workspaceID string) (DunningSettings, error) {
	set, err := loadSettings(ctx, q, workspaceID)
	return set.Dunning, err
}

// ReminderPDF renders the letter of one notice for an issued invoice: the seller and buyer of the invoice's
// snapshots, the workspace's logo, and, with qrBill, a QR bill for the notice's total with the invoice's payment
// reference.
func (s *Service) ReminderPDF(ctx context.Context, ws store.Workspace, inv store.Invoice, n invoicepdf.Notice, qrBill bool) ([]byte, error) {
	set, err := loadSettings(ctx, s.db.Q, ws.ID)
	if err != nil {
		return nil, fmt.Errorf("settings: %w", err)
	}
	logo, err := s.logoBytes(ctx, ws.ID, set)
	if err != nil {
		return nil, fmt.Errorf("logo: %w", err)
	}
	d := s.document(inv, set, false, nil)
	d.Logo = logo
	if d.SentWith, err = s.sentWith(ctx, ws.ID); err != nil {
		return nil, err
	}
	if !qrBill {
		d.Bill = nil
	} else if d.Bill != nil {
		bill := *d.Bill
		bill.Amount = n.Amounts.Total
		bill.Message = n.Title + " " + deref(inv.Number)
		d.Bill = &bill
	}
	return invoicepdf.RenderReminder(d, n)
}
