package employment

import "strings"

// Group is how a country relates to the EU, which decides which rule families can apply; never one "Europe".
type Group string

const (
	CH     Group = "ch"     // Switzerland: its own law, bilateral agreements with the EU
	EU     Group = "eu"     // EU member state
	EEA    Group = "eea"    // EEA member outside the EU
	NonEU  Group = "non_eu" // European, neither EU nor EEA
	US     Group = "us"     // United States: federal, state and local rules
	Others Group = ""       // not modelled: accepted as data, automation unsupported
)

// Region is a subdivision whose rules differ (a canton, a state): ISO 3166-2 code without the country prefix.
type Region struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// Country is a modelled country: its group and, where rules differ by subdivision, the list to choose from.
type Country struct {
	Code        string   `json:"code"`
	Name        string   `json:"name"`
	Group       Group    `json:"group"`
	RegionLabel string   `json:"region_label,omitempty"` // "Canton", "State": a region is required when set
	Regions     []Region `json:"regions,omitempty"`
	Locality    bool     `json:"locality"`        // local (city, county) rules exist, so the locality is asked for
	Research    string   `json:"research_status"` // researched, partially_researched, not_researched
}

func regions(pairs string) []Region {
	var out []Region
	for item := range strings.SplitSeq(pairs, ";") {
		code, name, _ := strings.Cut(item, "=")
		out = append(out, Region{code, name})
	}
	return out
}

var countries = func() []Country {
	list := []Country{
		{Code: "CH", Name: "Switzerland", Group: CH, RegionLabel: "Canton", Regions: regions("AG=Aargau;AI=Appenzell Innerrhoden;" +
			"AR=Appenzell Ausserrhoden;BE=Bern;BL=Basel-Landschaft;BS=Basel-Stadt;FR=Fribourg;GE=Geneva;GL=Glarus;GR=Graubünden;" +
			"JU=Jura;LU=Lucerne;NE=Neuchâtel;NW=Nidwalden;OW=Obwalden;SG=St. Gallen;SH=Schaffhausen;SO=Solothurn;SZ=Schwyz;" +
			"TG=Thurgau;TI=Ticino;UR=Uri;VD=Vaud;VS=Valais;ZG=Zug;ZH=Zurich")},
		{Code: "US", Name: "United States", Group: US, RegionLabel: "State", Locality: true, Regions: regions("AL=Alabama;" +
			"AK=Alaska;AZ=Arizona;AR=Arkansas;CA=California;CO=Colorado;CT=Connecticut;DE=Delaware;DC=District of Columbia;" +
			"FL=Florida;GA=Georgia;HI=Hawaii;ID=Idaho;IL=Illinois;IN=Indiana;IA=Iowa;KS=Kansas;KY=Kentucky;LA=Louisiana;ME=Maine;" +
			"MD=Maryland;MA=Massachusetts;MI=Michigan;MN=Minnesota;MS=Mississippi;MO=Missouri;MT=Montana;NE=Nebraska;NV=Nevada;" +
			"NH=New Hampshire;NJ=New Jersey;NM=New Mexico;NY=New York;NC=North Carolina;ND=North Dakota;OH=Ohio;OK=Oklahoma;" +
			"OR=Oregon;PA=Pennsylvania;RI=Rhode Island;SC=South Carolina;SD=South Dakota;TN=Tennessee;TX=Texas;UT=Utah;" +
			"VT=Vermont;VA=Virginia;WA=Washington;WV=West Virginia;WI=Wisconsin;WY=Wyoming")},
	}
	for group, pairs := range map[Group]string{
		EU: "AT=Austria;BE=Belgium;BG=Bulgaria;HR=Croatia;CY=Cyprus;CZ=Czechia;DK=Denmark;EE=Estonia;FI=Finland;FR=France;" +
			"DE=Germany;GR=Greece;HU=Hungary;IE=Ireland;IT=Italy;LV=Latvia;LT=Lithuania;LU=Luxembourg;MT=Malta;NL=Netherlands;" +
			"PL=Poland;PT=Portugal;RO=Romania;SK=Slovakia;SI=Slovenia;ES=Spain;SE=Sweden",
		EEA: "IS=Iceland;LI=Liechtenstein;NO=Norway",
		NonEU: "AD=Andorra;AL=Albania;BA=Bosnia and Herzegovina;BY=Belarus;GB=United Kingdom;MC=Monaco;MD=Moldova;" +
			"ME=Montenegro;MK=North Macedonia;RS=Serbia;RU=Russia;SM=San Marino;TR=Türkiye;UA=Ukraine;VA=Vatican City;XK=Kosovo;" +
			"GE=Georgia;GG=Guernsey;GI=Gibraltar;IM=Isle of Man;JE=Jersey",
	} {
		for _, r := range regions(pairs) {
			list = append(list, Country{Code: r.Code, Name: r.Name, Group: group})
		}
	}
	for i := range list {
		list[i].Research = "not_researched"
		for _, j := range research.Jurisdictions {
			if j.Code == list[i].Code {
				list[i].Research = j.ResearchStatus
			}
		}
	}
	return list
}()

// Countries lists the modelled countries.
func Countries() []Country { return countries }

// CountryOf finds a modelled country by its ISO 3166-1 alpha-2 code.
func CountryOf(code string) (Country, bool) {
	for _, c := range countries {
		if c.Code == code {
			return c, true
		}
	}
	return Country{}, false
}

// RegionOf finds a region of a modelled country.
func (c Country) RegionOf(code string) (Region, bool) {
	for _, r := range c.Regions {
		if r.Code == code {
			return r, true
		}
	}
	return Region{}, false
}
