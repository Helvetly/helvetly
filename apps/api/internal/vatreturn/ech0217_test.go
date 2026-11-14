package vatreturn

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/vatcalc"
	"helvetly.com/api/internal/xsdtest"
)

const echDir = "testdata/ech0217"

func validECH(t *testing.T, name string, doc []byte) {
	t.Helper()
	xsdtest.Valid(t, echDir, "xmlns/eCH-0217/2/eCH-0217-2-0-0.xsd", name, doc)
}

func TestECH0217Fixtures(t *testing.T) {
	files := xsdtest.Pinned(t, echDir)
	for _, path := range files {
		if strings.HasPrefix(path, "examples/") { // the official examples validate: the schema setup is complete
			raw, err := os.ReadFile(filepath.Join(echDir, path))
			if err != nil {
				t.Fatal(err)
			}
			validECH(t, filepath.Base(path), raw)
		}
	}
	if len(files) != 14 {
		t.Fatalf("SHA256SUMS lists %d files, want 14", len(files))
	}
}

func TestUIDOf(t *testing.T) {
	for in, want := range map[string]string{
		"CHE-109.322.551 MWST": "CHE109322551", "che109322551": "CHE109322551", "CHE-109.322.551 TVA": "CHE109322551",
		"CHE-009.322.551": "", "CHE-109.322.55": "", "DE123456789": "", "": "",
	} {
		if got, _ := uidOf(in); got != want {
			t.Errorf("uidOf(%q) = %q, want %q", in, got, want)
		}
	}
}

func money(s string) invoicecalc.Money {
	m, ok := invoicecalc.ParseMoney(strings.TrimPrefix(s, "-"))
	if !ok {
		panic(s)
	}
	if strings.HasPrefix(s, "-") {
		return -m
	}
	return m
}

func rate(s string) invoicecalc.Percent {
	p, ok := invoicecalc.ParsePercent(s)
	if !ok {
		panic(s)
	}
	return p
}

func group(cat, r, net, vat string) vatcalc.Group {
	return vatcalc.Group{Category: cat, Rate: rate(r), TaxableAmount: money(net), VATAmount: money(vat)}
}

func TestReportXML(t *testing.T) {
	sales := []vatcalc.Sale{
		{Ref: "2026-001", SupplyDate: "2026-08-10", Groups: []vatcalc.Group{group("S", "8.1", "1000.00", "81.00"),
			group("S", "2.6", "200.00", "5.20"), group("G", "0", "500.00", "0.00"), group("E", "0", "50.00", "0.00")}},
		{Ref: "CN-001", SupplyDate: "2026-09-01", Groups: []vatcalc.Group{group("S", "8.1", "-100.00", "-8.10")}},
	}
	purchases := []vatcalc.Purchase{
		{Ref: "E-1", SupplyDate: "2026-08-05", Box: "400", DeductibleVAT: money("40.50"), DeductiblePercent: 10000},
		{Ref: "E-2", SupplyDate: "2026-08-06", Box: "405", ReverseCharge: true, Net: money("1000.00"), DeductiblePercent: 10000},
	}
	cases := []struct {
		name     string
		settings vatcalc.Settings
		basis    string
		check    func(t *testing.T, d echDeclaration)
	}{
		{"effective, agreed", vatcalc.Settings{Method: vatcalc.Effective}, "agreed", func(t *testing.T, d echDeclaration) {
			e := d.Effective
			if d.Net != nil || e == nil || e.GrossOrNet != 1 || d.General.Form != 1 {
				t.Fatalf("method and form: %+v", d)
			}
			// 200: 1000 + 200 + 500 + 50 − 100; 220 exports 500; 230 exempt 50; 221 a tracked 0
			if tu := d.Turnover; tu.Total != "1650.00" || tu.Exports != "500.00" || tu.Exempt != "50.00" || tu.Abroad != "0.00" ||
				tu.Transfer != "" || tu.Reduced != "" {
				t.Errorf("turnover: %+v", tu)
			}
			if !sameRates(e.Supplies, "8.1=900.00", "2.6=200.00") || !sameRates(e.Acquisition, "8.1=1000.00") {
				t.Errorf("rates: supplies %+v acquisition %+v", e.Supplies, e.Acquisition)
			}
			// input tax: 40.50 on 400; the acquisition tax's 81.00 on 405; untracked 205, 410, 415, 420 omitted
			if e.Material != "40.50" || e.Investments != "81.00" || e.Opted != "" || e.Subsequent != "" || e.Corrections != "" ||
				e.Reductions != "" {
				t.Errorf("input tax: %+v", e)
			}
			// tax 72.90 + 5.20 + 81.00 (acquisition) − input 121.50
			if d.Payable != "37.60" {
				t.Errorf("payableTax = %s", d.Payable)
			}
		}},
		{"net tax rate, received", vatcalc.Settings{Method: vatcalc.NetTaxRate, Rates: []vatcalc.NetRate{{Label: "Beratung", Rate: 620}}},
			"received", func(t *testing.T, d echDeclaration) {
				n := d.Net
				if d.Effective != nil || n == nil || d.General.Form != 2 {
					t.Fatalf("method and form: %+v", d)
				}
				// gross: 1081 + 205.20 − 108.10 at the net tax rate; G and E stay deductions
				if !sameRates(n.Supplies, "6.2=1178.10") || !sameRates(n.Acquisition, "8.1=1000.00") {
					t.Errorf("rates: supplies %+v acquisition %+v", n.Supplies, n.Acquisition)
				}
				if d.Turnover.Total != "1728.10" { // gross 1178.10 + 500 + 50
					t.Errorf("total = %s", d.Turnover.Total)
				}
				if d.Payable != "154.04" { // 73.04 + 81.00, no input tax under this method
					t.Errorf("payableTax = %s", d.Payable)
				}
			}},
	}
	at := time.Date(2026, 11, 9, 8, 30, 0, 0, time.FixedZone("CET", 3600))
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ret := vatcalc.Compute(c.settings, sales, purchases)
			rep := Report{Period: "2026-Q3", From: "2026-07-01", To: "2026-09-30", Method: ret.Method, Basis: c.basis,
				Lines: ret.Lines, Warnings: ret.Warnings}
			if r := exportReasons(rep, "CHE109322551"); len(r) > 0 {
				t.Fatalf("unexpected reasons %v", r)
			}
			doc, err := reportXML(rep, "CHE109322551", "  Muster   GmbH ", at)
			if err != nil {
				t.Fatal(err)
			}
			validECH(t, "return.xml", doc)
			var d echDeclaration
			if err := xml.Unmarshal(doc, &d); err != nil {
				t.Fatal(err)
			}
			g := d.General
			if g.UID != "CHE109322551" || g.Name != "Muster GmbH" || g.Generated != "2026-11-09T07:30:00Z" ||
				g.From != "2026-07-01" || g.Till != "2026-09-30" || g.Submission != 1 || g.BusinessRef != "helvetly-2026-Q3" {
				t.Errorf("general information: %+v", g)
			}
			c.check(t, d)
		})
	}
}

func sameRates(got []echRate, want ...string) bool {
	if len(got) != len(want) {
		return false
	}
	for i, r := range got {
		if r.Rate+"="+r.Turnover != want[i] {
			return false
		}
	}
	return true
}

func TestXMLExport(t *testing.T) {
	e := newEnv(t)
	b := fixture(e)
	ws := b.workspace

	// no UID, and an EUR invoice whose CHF amounts are unknown: both are reasons, and no file is served
	resp, raw := e.send(b, "GET", "/api/v1/vat-return?period=2026-Q3&format=xml", nil)
	var refused struct {
		Error struct {
			Code    string
			Details struct{ Reasons []struct{ Code string } }
		}
	}
	_ = json.Unmarshal(raw, &refused)
	codes := []string{}
	for _, r := range refused.Error.Details.Reasons {
		codes = append(codes, r.Code)
	}
	if resp.StatusCode != http.StatusConflict || refused.Error.Code != "cannot_export" ||
		strings.Join(codes, ",") != "uid_missing,foreign_currency" {
		t.Fatalf("refusal: %d %s", resp.StatusCode, raw)
	}

	e.exec(`DELETE FROM invoices WHERE id = $1||'-EUR-1'`, ws)
	settings := map[string]any{"seller": map[string]any{"name": "Muster GmbH", "vat_number": "CHE-109.322.551 MWST"}}
	if err := e.st.PutInvoiceSettings(context.Background(), ws, settings, time.Now()); err != nil {
		t.Fatal(err)
	}
	resp, raw = e.send(b, "GET", "/api/v1/vat-return?period=2026-Q3&format=xml", nil)
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "application/xml; charset=utf-8" ||
		resp.Header.Get("Content-Disposition") != `attachment; filename="MWST_CHE109322551_2026-Q3.xml"` {
		t.Fatalf("export: %d %v %s", resp.StatusCode, resp.Header, raw)
	}
	validECH(t, "export.xml", raw)
	var d echDeclaration
	if err := xml.Unmarshal(raw, &d); err != nil {
		t.Fatal(err)
	}
	// the fixture's Q3 return (TestEffectiveAgreed): 303 at 1000 − 100 + 300 − 200, exports 500, acquisition 1000
	if d.General.UID != "CHE109322551" || d.Turnover.Exports != "500.00" || d.Effective == nil ||
		!sameRates(d.Effective.Supplies, "8.1=1000.00") || !sameRates(d.Effective.Acquisition, "8.1=1000.00") {
		t.Errorf("exported return: %s", raw)
	}
	if resp, _ := e.send(e.join(ws, "member"), "GET", "/api/v1/vat-return?period=2026-Q3&format=xml", nil); resp.StatusCode != 200 {
		t.Errorf("a member exports like they read: %d", resp.StatusCode)
	}
}
