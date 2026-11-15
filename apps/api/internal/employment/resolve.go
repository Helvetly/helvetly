package employment

import (
	"fmt"
	"slices"
	"time"
)

// Input is what selects rules: where the person works and lives, and the date. Never the interface language,
// currency, address of the request or the account's country.
type Input struct {
	EmployerCountry       string // the employing entity's seat: bookkeeping retention follows it
	SocialSecurityCountry string // where social security is paid (an A1 certificate or similar), when known
	WorkCountry           string
	WorkRegion            string
	WorkLocality          string
	ResidenceCountry      string
	CrossBorder           bool
	On                    time.Time
}

// Resolution statuses.
const (
	RegisterOnly = "register_only" // modelled; pay is recorded, not calculated
	Ambiguous    = "ambiguous"     // modelled, but facts are missing or cross-border: nothing automatic
	Unsupported  = "unsupported"   // not modelled: data and register only
)

// Block is an automation that is unavailable, with the reason a person reads.
type Block struct {
	Feature string `json:"feature"`
	Reason  string `json:"reason"`
}

// Resolution is what the module can do for one employee's situation on a date.
type Resolution struct {
	Jurisdiction string   `json:"jurisdiction"`
	CountryName  string   `json:"country_name"`
	Group        Group    `json:"group"`
	Status       string   `json:"status"`
	Mode         string   `json:"mode"` // always "register" while no calculation rule is verified
	Reasons      []string `json:"reasons"`
	Blocked      []Block  `json:"blocked"`
	Rules        []Rule   `json:"rules"`
	Applicable   []string `json:"applicable"` // the jurisdictions whose rules are looked at
}

// Applicable is the jurisdictions whose rules apply: the employer's country, the place of work and its country.
func Applicable(employerCountry, workJurisdiction string) []string {
	out := []string{}
	for _, j := range []string{employerCountry, workJurisdiction, country(workJurisdiction)} {
		if j != "" && !slices.Contains(out, j) {
			out = append(out, j)
		}
	}
	return out
}

// Resolve places an employee's situation. Administrative operations never depend on the answer; automation does,
// and every automation without a verified rule is listed as blocked with its reason.
func Resolve(in Input) Resolution {
	res := Resolution{Jurisdiction: in.WorkCountry, Mode: "register", Status: RegisterOnly, Reasons: []string{}, Rules: []Rule{}}
	c, ok := CountryOf(in.WorkCountry)
	switch {
	case !ok:
		res.Status, res.Group = Unsupported, Others
		res.Reasons = append(res.Reasons, fmt.Sprintf("%s has no employment profile here. Records, documents and the payroll register "+
			"work; nothing is calculated, suggested or checked against its law.", in.WorkCountry))
	default:
		res.CountryName, res.Group = c.Name, c.Group
		if c.RegionLabel != "" {
			if r, ok := c.RegionOf(in.WorkRegion); ok {
				res.Jurisdiction = c.Code + "-" + r.Code
			} else {
				res.Status = Ambiguous
				res.Reasons = append(res.Reasons, fmt.Sprintf("The %s of employment is not set; rules in %s differ by %s.",
					lower(c.RegionLabel), c.Name, lower(c.RegionLabel)))
			}
		}
		if c.Locality && in.WorkLocality == "" {
			res.Reasons = append(res.Reasons, "The locality of work is not set; local rules may apply.")
		}
	}
	if c.Research == "not_researched" || !ok {
		res.Reasons = append(res.Reasons, "No employment rules were researched for this country, so no retention period is suggested.")
	}
	if in.SocialSecurityCountry != "" && in.SocialSecurityCountry != in.WorkCountry {
		res.Status = Ambiguous
		res.Reasons = append(res.Reasons, "Social security is paid in another country than the work is done; the rules of both may apply.")
	}
	if in.CrossBorder || in.ResidenceCountry != "" && in.ResidenceCountry != in.WorkCountry {
		res.Status = Ambiguous
		res.Reasons = append(res.Reasons, "Cross-border employment: which country's social security and tax rules apply "+
			"depends on facts and agreements this module does not assess. Ask a payroll specialist.")
	}
	day := in.On.Format(time.DateOnly)
	res.Applicable = Applicable(in.EmployerCountry, res.Jurisdiction)
	for _, r := range rules {
		if slices.Contains(res.Applicable, r.Jurisdiction) && r.valid(day) {
			res.Rules = append(res.Rules, r)
		}
	}
	res.Blocked = []Block{
		{"payroll_calculation", "No verified, current tax and contribution rules exist for this situation, so pay, deductions " +
			"and employer costs are entered or imported, not calculated."},
		{"statutory_reports", "Official declarations, certificates and payslips are not produced."},
	}
	if res.Status != RegisterOnly {
		res.Blocked = append(res.Blocked, Block{"retention_suggestion", "Retention periods are not suggested until the " +
			"situation is clear; set them on each document."})
	}
	return res
}

func lower(s string) string {
	if s == "" {
		return s
	}
	return string(s[0]+'a'-'A') + s[1:]
}
