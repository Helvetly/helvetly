package employment

import (
	"testing"
	"time"
)

func day(s string) time.Time {
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestCountries(t *testing.T) {
	groups := map[Group]int{}
	seen := map[string]bool{}
	for _, c := range Countries() {
		if seen[c.Code] || len(c.Code) != 2 || c.Name == "" {
			t.Errorf("bad or duplicate country %+v", c)
		}
		seen[c.Code] = true
		groups[c.Group]++
	}
	if groups[EU] != 27 || groups[EEA] != 3 || groups[CH] != 1 || groups[US] != 1 || groups[NonEU] == 0 {
		t.Fatalf("groups = %v", groups)
	}
	ch, _ := CountryOf("CH")
	us, _ := CountryOf("US")
	if len(ch.Regions) != 26 || len(us.Regions) != 51 || !us.Locality || ch.Locality {
		t.Fatalf("CH %d cantons, US %d states", len(ch.Regions), len(us.Regions))
	}
	if c, _ := CountryOf("NO"); c.Group != EEA {
		t.Fatal("Norway is EEA, not EU")
	}
	if c, _ := CountryOf("GB"); c.Group != NonEU {
		t.Fatal("the United Kingdom is outside the EU and EEA")
	}
}

func TestResolve(t *testing.T) {
	for _, c := range []struct {
		name         string
		in           Input
		jurisdiction string
		status       string
	}{
		{"canton set", Input{WorkCountry: "CH", WorkRegion: "ZH"}, "CH-ZH", RegisterOnly},
		{"canton missing", Input{WorkCountry: "CH"}, "CH", Ambiguous},
		{"unknown canton", Input{WorkCountry: "CH", WorkRegion: "XX"}, "CH", Ambiguous},
		{"EU country", Input{WorkCountry: "DE"}, "DE", RegisterOnly},
		{"EEA country", Input{WorkCountry: "LI"}, "LI", RegisterOnly},
		{"US state without locality", Input{WorkCountry: "US", WorkRegion: "CA"}, "US-CA", RegisterOnly},
		{"unsupported country", Input{WorkCountry: "JP"}, "JP", Unsupported},
		{"cross-border flag", Input{WorkCountry: "CH", WorkRegion: "GE", CrossBorder: true}, "CH-GE", Ambiguous},
		{"lives elsewhere", Input{WorkCountry: "CH", WorkRegion: "BS", ResidenceCountry: "DE"}, "CH-BS", Ambiguous},
		{"lives in the same country", Input{WorkCountry: "DE", ResidenceCountry: "DE"}, "DE", RegisterOnly},
	} {
		t.Run(c.name, func(t *testing.T) {
			r := Resolve(c.in)
			if r.Jurisdiction != c.jurisdiction || r.Status != c.status || r.Mode != "register" {
				t.Fatalf("Resolve = %s %s %s, want %s %s register", r.Jurisdiction, r.Status, r.Mode, c.jurisdiction, c.status)
			}
			if r.Status != RegisterOnly && len(r.Reasons) == 0 {
				t.Fatal("a situation that is not plain must say why")
			}
			if len(r.Blocked) == 0 || r.Blocked[0].Feature != "payroll_calculation" {
				t.Fatalf("payroll calculation must be blocked: %+v", r.Blocked)
			}
		})
	}
	if r := Resolve(Input{WorkCountry: "US", WorkRegion: "NY"}); len(r.Reasons) == 0 {
		t.Fatal("a missing US locality must be pointed out")
	}
}

func TestRuleVersionByDate(t *testing.T) {
	saved := rules
	t.Cleanup(func() { rules = saved })
	rules = []Rule{
		{ID: "ch-old", Jurisdiction: "CH", Topic: "retention", DocumentType: "payroll_record", Years: 5, Trigger: FromYearEnd,
			ValidFrom: "2000-01-01", ValidTo: "2025-12-31", Status: Verified},
		{ID: "ch-new", Jurisdiction: "CH", Topic: "retention", DocumentType: "payroll_record", Years: 10, Trigger: FromYearEnd,
			ValidFrom: "2026-01-01", Status: Verified},
		{ID: "ch-zh", Jurisdiction: "CH-ZH", Topic: "retention", DocumentType: "employment_contract", Years: 7, Trigger: FromEmploymentEnd,
			Status: Verified},
		{ID: "de-guide", Jurisdiction: "DE", Topic: "retention", DocumentType: "payroll_record", Years: 8, Trigger: FromYearEnd,
			Status: PartiallyVerified},
		{ID: "de-ignored", Jurisdiction: "DE", Topic: "retention", DocumentType: "payroll_record", Years: 30, Trigger: FromYearEnd,
			Status: NotVerified},
		{ID: "us", Jurisdiction: "US", Topic: "retention", DocumentType: "payroll_record", Years: 3, Trigger: FromRecord, Status: Verified},
		{ID: "us-ca", Jurisdiction: "US-CA", Topic: "retention", DocumentType: "payroll_record", Years: 4, Trigger: FromRecord, Status: Verified},
		{ID: "us-tax", Jurisdiction: "US", Topic: "retention", DocumentType: "tax_withholding_record", Years: 4,
			Trigger: "tax_due_or_paid_later", Status: Verified},
	}
	for _, c := range []struct {
		jurisdiction, docType, on, want string
	}{
		{"CH-ZH", "payroll_record", "2025-06-30", "ch-old"},
		{"CH-ZH", "payroll_record", "2025-12-31", "ch-old"},
		{"CH-ZH", "payroll_record", "2026-01-01", "ch-new"},
		{"CH", "payroll_record", "2027-03-01", "ch-new"},
		{"CH-ZH", "employment_contract", "2026-01-01", "ch-zh"},
		{"CH-BE", "employment_contract", "2026-01-01", ""},
		{"JP", "payroll_record", "2026-01-01", ""},
	} {
		r, ok := RuleAt(c.jurisdiction, "retention", c.docType, day(c.on))
		if r.ID != c.want || ok != (c.want != "") {
			t.Errorf("RuleAt(%s, %s, %s) = %q, want %q", c.jurisdiction, c.docType, c.on, r.ID, c.want)
		}
	}

	today := day("2026-11-15")
	doc, end := day("2025-03-15"), day("2026-04-30")
	r := RetainUntil([]string{"CH", "CH-ZH"}, "payroll_record", &doc, nil, today)
	if r.Until == nil || *r.Until != day("2030-12-31") || len(r.Rules) != 1 || r.Rules[0].ID != "ch-old" {
		t.Fatalf("a 2025 payroll record uses the 2025 version: %+v", r)
	}
	if r := RetainUntil([]string{"CH-ZH"}, "employment_contract", nil, &end, today); r.Until == nil || *r.Until != day("2033-04-30") {
		t.Fatalf("contract retention %+v", r)
	}
	if r := RetainUntil([]string{"CH-ZH"}, "employment_contract", &doc, nil, today); r.Until != nil {
		t.Fatal("a period counted from the end of employment has no date while employment goes on")
	}
	r = RetainUntil([]string{"DE"}, "payroll_record", &doc, nil, today)
	if r.Until != nil || len(r.Guidance) != 1 || r.Guidance[0].ID != "de-guide" {
		t.Fatalf("partially verified rules are guidance only and not verified ones are ignored: %+v", r)
	}
	r = RetainUntil(Applicable("US", "US-CA"), "payroll_record", &doc, nil, today)
	if r.Until == nil || *r.Until != day("2029-03-15") || len(r.Rules) != 2 {
		t.Fatalf("the longest of the federal and state minimums wins: %+v", r)
	}
	if r := RetainUntil([]string{"US"}, "tax_withholding_record", &doc, nil, today); r.Until != nil || len(r.Guidance) != 1 {
		t.Fatalf("a start the module cannot date leaves the rule as guidance: %+v", r)
	}
	if r := RetainUntil([]string{"JP"}, "payroll_record", &doc, &end, today); r.Until != nil || len(r.Guidance) != 0 {
		t.Fatal("no rule, no date: nothing is guessed")
	}
}

func TestShippedResearch(t *testing.T) {
	d := Data()
	if d.Source == "" || d.GeneratedOn == "" || len(d.Jurisdictions) == 0 || len(d.Coverage) == 0 {
		t.Fatal("the research data must say where it comes from")
	}
	ids := map[string]bool{}
	for _, r := range Rules() {
		if ids[r.ID] {
			t.Errorf("duplicate rule %q", r.ID)
		}
		ids[r.ID] = true
		if r.ID == "" || r.Jurisdiction == "" || r.Topic == "" || r.SourceURL == "" || r.Verification == "" {
			t.Errorf("rule %q misses a required field", r.ID)
		}
		if r.Status != Verified && r.Status != PartiallyVerified && r.Status != NotVerified {
			t.Errorf("rule %q has status %q", r.ID, r.Status)
		}
		for _, v := range []string{r.CheckedAt, r.ValidFrom, r.ValidTo} {
			if _, err := time.Parse(time.DateOnly, v); v != "" && err != nil {
				t.Errorf("rule %q date %q", r.ID, v)
			}
		}
	}
	for _, c := range d.Coverage {
		if c.Feature == "automatic_calculation" && c.OfferedInV1 {
			t.Errorf("%s offers automatic calculation: V1 records and imports pay, it never calculates it", c.Jurisdiction)
		}
	}
	// The dated change the research named: French tax records go from 6 to 10 years on 2027-01-01.
	before, _ := RuleAt("FR", "retention", "tax_withholding_record", day("2026-12-31"))
	after, _ := RuleAt("FR", "retention", "tax_withholding_record", day("2027-01-01"))
	if before.Years != 6 || after.Years != 10 {
		t.Fatalf("FR tax records: %d years before 2027, %d after", before.Years, after.Years)
	}
}
