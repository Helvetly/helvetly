package vatreturn

import (
	"encoding/xml"
	"fmt"
	"net/http"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/vatcalc"
)

// eCH-0217 V2.0.0 (testdata/ech0217): the only format the ESTV ePortal (MWST-Abrechnung pro) imports. Elements
// without a namespace inherit eCH-0217's default namespace from the root.
type echDeclaration struct {
	XMLName   xml.Name      `xml:"http://www.ech.ch/xmlns/eCH-0217/2 VATDeclaration"`
	General   echGeneral    `xml:"generalInformation"`
	Turnover  echTurnover   `xml:"turnoverComputation"`
	Effective *echEffective `xml:"effectiveReportingMethod"`
	Net       *echNet       `xml:"netTaxRateMethod"`
	Payable   string        `xml:"payableTax"`
}

type echGeneral struct {
	UID         string     `xml:"uid"`
	Name        string     `xml:"organisationName"`
	Generated   string     `xml:"generationTime"`
	From        string     `xml:"reportingPeriodFrom"`
	Till        string     `xml:"reportingPeriodTill"`
	Submission  int        `xml:"typeOfSubmission"` // 1 first submission (2 correction, 3 annual reconciliation)
	Form        int        `xml:"formOfReporting"`  // 1 agreed, 2 received consideration
	BusinessRef string     `xml:"businessReferenceId"`
	Sender      echSending `xml:"sendingApplication"`
}

type echSending struct {
	Manufacturer string `xml:"http://www.ech.ch/xmlns/eCH-0058/5 manufacturer"`
	Product      string `xml:"http://www.ech.ch/xmlns/eCH-0058/5 product"`
	Version      string `xml:"http://www.ech.ch/xmlns/eCH-0058/5 productVersion"`
}

// Optional amounts are "" (omitted) for the Ziffern Helvetly does not track; a tracked 0 is written.
type echTurnover struct {
	Total    string `xml:"totalConsideration"`                      // 200
	Exports  string `xml:"suppliesToForeignCountries,omitempty"`    // 220
	Abroad   string `xml:"suppliesAbroad,omitempty"`                // 221
	Transfer string `xml:"transferNotificationProcedure,omitempty"` // 225
	Exempt   string `xml:"suppliesExemptFromTax,omitempty"`         // 230
	Reduced  string `xml:"reductionOfConsideration,omitempty"`      // 235
}

type echRate struct {
	Rate     string `xml:"taxRate"`
	Turnover string `xml:"turnover"`
}

type echEffective struct {
	GrossOrNet  int       `xml:"grossOrNet"`      // 1 net: vatcalc's effective figures exclude VAT
	Opted       string    `xml:"opted,omitempty"` // 205
	Supplies    []echRate `xml:"suppliesPerTaxRate"`
	Acquisition []echRate `xml:"acquisitionTax"`                        // 383
	Material    string    `xml:"inputTaxMaterialAndServices,omitempty"` // 400
	Investments string    `xml:"inputTaxInvestments,omitempty"`         // 405
	Subsequent  string    `xml:"subsequentInputTaxDeduction,omitempty"` // 410
	Corrections string    `xml:"inputTaxCorrections,omitempty"`         // 415
	Reductions  string    `xml:"inputTaxReductions,omitempty"`          // 420
}

// echNet: turnover including VAT at each approved net tax rate; forms 1050/1055/1056 are not reported.
type echNet struct {
	Supplies    []echRate `xml:"suppliesPerTaxRate"`
	Acquisition []echRate `xml:"acquisitionTax"`
}

// blocking are the warnings whose figures are known to be incomplete or misplaced: a file the ESTV imports as is
// must not carry them, so the person fixes the cause first or files by hand.
var blocking = map[string]bool{"foreign_currency": true, "expense_currency": true, "unknown_rate": true,
	"net_rate_split": true, "net_rate_before_2024": true, "acquisition_before_2024": true}

// uidOf reads a Swiss UID ("CHE-109.322.551 MWST") in the form eCH-0108 takes ("CHE109322551"); ok false otherwise.
func uidOf(vatNumber string) (string, bool) {
	v := strings.ToUpper(strings.TrimSpace(vatNumber))
	if !strings.HasPrefix(v, "CHE") {
		return "", false
	}
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, v[3:])
	if len(digits) != 9 || digits[0] == '0' {
		return "", false
	}
	return "CHE" + digits, true
}

// exportReasons are why a report cannot be exported for the ESTV; empty when it can.
func exportReasons(rep Report, uid string) []map[string]string {
	var out []map[string]string
	if uid == "" {
		out = append(out, map[string]string{"code": "uid_missing",
			"message": "Add your Swiss UID (CHE-…) as the VAT number in the invoice settings: the ESTV file is filed under it."})
	}
	for _, w := range rep.Warnings {
		if blocking[w.Code] {
			out = append(out, map[string]string{"code": w.Code, "message": w.Message})
		}
	}
	return out
}

func errCannotExport(reasons []map[string]string) error {
	return auth.Error(http.StatusConflict, "cannot_export",
		"This return cannot be exported for the ESTV yet: fix the reasons, or file the figures by hand.",
		map[string]any{"reasons": reasons})
}

// reportXML writes the report as eCH-0217 V2.0.0. The caller has checked exportReasons.
func reportXML(rep Report, uid, name string, at time.Time) ([]byte, error) {
	ret := vatcalc.Return{Lines: rep.Lines}
	amount := func(z string) string {
		if l := ret.Line(z); l.Tracked {
			return l.Amount.String()
		}
		return ""
	}
	var supplies, acquisition []echRate
	for _, l := range rep.Lines {
		if l.Kind != "rate" || l.Base == 0 {
			continue
		}
		r := echRate{Rate: l.Rate.String(), Turnover: l.Base.String()}
		if l.Ziffer == "383" {
			acquisition = append(acquisition, r)
		} else {
			supplies = append(supplies, r)
		}
	}
	form := 1
	if rep.Basis == "received" {
		form = 2
	}
	d := echDeclaration{
		General: echGeneral{UID: uid, Name: token(name, 255), Generated: at.UTC().Format("2006-01-02T15:04:05Z"),
			From: rep.From, Till: rep.To, Submission: 1, Form: form, BusinessRef: "helvetly-" + rep.Period,
			Sender: echSending{Manufacturer: "Helvetly", Product: "Helvetly", Version: "1"}},
		Turnover: echTurnover{Total: ret.Line("200").Amount.String(), Exports: amount("220"), Abroad: amount("221"),
			Transfer: amount("225"), Exempt: amount("230"), Reduced: amount("235")},
		Payable: (ret.Line("500").Amount - ret.Line("510").Amount).String(),
	}
	if rep.Method == vatcalc.NetTaxRate {
		d.Net = &echNet{Supplies: supplies, Acquisition: acquisition}
	} else {
		d.Effective = &echEffective{GrossOrNet: 1, Opted: amount("205"), Supplies: supplies, Acquisition: acquisition,
			Material: amount("400"), Investments: amount("405"), Subsequent: amount("410"), Corrections: amount("415"),
			Reductions: amount("420")}
	}
	body, err := xml.MarshalIndent(d, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("vat return xml: %w", err)
	}
	return append([]byte(xml.Header), append(body, '\n')...), nil
}

// token collapses whitespace (xs:token) and keeps at most max characters.
func token(s string, max int) string {
	r := []rune(strings.Join(strings.Fields(s), " "))
	if len(r) > max {
		r = r[:max]
	}
	return strings.TrimSpace(string(r))
}
