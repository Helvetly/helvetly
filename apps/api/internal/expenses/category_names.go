package expenses

import (
	"net/http"
	"strings"

	"helvetly.com/api/internal/store"
)

// presetNames: the catalogue's category names in the other languages (English is the stored name, store.CategoryPresets).
// The platform keeps the same words as expenseCategory<Key> in its messages; TestPresetNamesMatchPlatform compares them.
var presetNames = map[string]map[string]string{
	"de": {
		"materials":           "Material & Waren",
		"goods_resale":        "Handelswaren",
		"subcontractors":      "Fremdleistungen",
		"staff_other":         "Übriger Personalaufwand",
		"training":            "Aus- und Weiterbildung",
		"staff_expenses":      "Spesen",
		"rent":                "Miete & Räume",
		"premises_ancillary":  "Nebenkosten der Räume",
		"cleaning":            "Reinigung",
		"repairs":             "Reparaturen & Unterhalt",
		"equipment_leasing":   "Leasing von Geräten",
		"vehicles":            "Fahrzeuge & Transport",
		"fuel":                "Treibstoff",
		"vehicle_insurance":   "Fahrzeugversicherungen",
		"vehicle_tax":         "Verkehrsabgaben & Gebühren",
		"vehicle_leasing":     "Fahrzeugleasing",
		"freight":             "Fracht & Versand",
		"insurance":           "Versicherungen & Gebühren",
		"duties_permits":      "Abgaben, Gebühren & Bewilligungen",
		"energy":              "Energie & Entsorgung",
		"waste":               "Entsorgung",
		"office":              "Büro & Verwaltung",
		"telecom":             "Telefon & Internet",
		"postage":             "Porto",
		"memberships":         "Mitgliederbeiträge",
		"donations":           "Spenden",
		"professional_fees":   "Treuhand- & Rechtskosten",
		"software_saas":       "Informatik & Software",
		"it_services":         "IT-Dienstleistungen",
		"hardware_small":      "Kleingeräte & Hardware",
		"marketing":           "Marketing & Werbung",
		"gifts":               "Kundengeschenke",
		"trade_fairs":         "Messen & Anlässe",
		"travel":              "Reisen",
		"lodging":             "Übernachtung",
		"meals_entertainment": "Verpflegung & Repräsentation",
		"other_operating":     "Übriger Betriebsaufwand",
		"interest":            "Zinsen",
		"bank_fees":           "Bankspesen",
		"direct_taxes":        "Direkte Steuern",
	},
	"fr": {
		"materials":           "Matériel et marchandises",
		"goods_resale":        "Marchandises destinées à la revente",
		"subcontractors":      "Sous-traitance",
		"staff_other":         "Autres charges de personnel",
		"training":            "Formation",
		"staff_expenses":      "Indemnités de frais",
		"rent":                "Loyer et locaux",
		"premises_ancillary":  "Charges des locaux",
		"cleaning":            "Nettoyage",
		"repairs":             "Réparations et entretien",
		"equipment_leasing":   "Leasing d’équipements",
		"vehicles":            "Véhicules et transport",
		"fuel":                "Carburant",
		"vehicle_insurance":   "Assurances des véhicules",
		"vehicle_tax":         "Taxes et redevances des véhicules",
		"vehicle_leasing":     "Leasing de véhicules",
		"freight":             "Fret et livraison",
		"insurance":           "Assurances et taxes",
		"duties_permits":      "Droits, taxes et autorisations",
		"energy":              "Énergie et déchets",
		"waste":               "Élimination des déchets",
		"office":              "Bureau et administration",
		"telecom":             "Téléphone et internet",
		"postage":             "Frais de port",
		"memberships":         "Cotisations",
		"donations":           "Dons",
		"professional_fees":   "Honoraires juridiques et comptables",
		"software_saas":       "Informatique et logiciels",
		"it_services":         "Services informatiques",
		"hardware_small":      "Petit matériel informatique",
		"marketing":           "Marketing et publicité",
		"gifts":               "Cadeaux d’affaires",
		"trade_fairs":         "Salons et événements",
		"travel":              "Voyages",
		"lodging":             "Hébergement",
		"meals_entertainment": "Repas et représentation",
		"other_operating":     "Autres charges d’exploitation",
		"interest":            "Intérêts",
		"bank_fees":           "Frais bancaires",
		"direct_taxes":        "Impôts directs",
	},
	"it": {
		"materials":           "Materiale e merci",
		"goods_resale":        "Merci destinate alla rivendita",
		"subcontractors":      "Subappalti",
		"staff_other":         "Altri costi del personale",
		"training":            "Formazione",
		"staff_expenses":      "Rimborsi spese",
		"rent":                "Affitto e locali",
		"premises_ancillary":  "Spese accessorie dei locali",
		"cleaning":            "Pulizia",
		"repairs":             "Riparazioni e manutenzione",
		"equipment_leasing":   "Leasing di attrezzature",
		"vehicles":            "Veicoli e trasporti",
		"fuel":                "Carburante",
		"vehicle_insurance":   "Assicurazioni dei veicoli",
		"vehicle_tax":         "Tasse e tributi dei veicoli",
		"vehicle_leasing":     "Leasing di veicoli",
		"freight":             "Trasporto e consegna",
		"insurance":           "Assicurazioni e tasse",
		"duties_permits":      "Tributi, tasse e autorizzazioni",
		"energy":              "Energia e rifiuti",
		"waste":               "Smaltimento dei rifiuti",
		"office":              "Ufficio e amministrazione",
		"telecom":             "Telefono e internet",
		"postage":             "Spese postali",
		"memberships":         "Quote associative",
		"donations":           "Donazioni",
		"professional_fees":   "Onorari legali e contabili",
		"software_saas":       "Informatica e software",
		"it_services":         "Servizi informatici",
		"hardware_small":      "Piccolo hardware",
		"marketing":           "Marketing e pubblicità",
		"gifts":               "Omaggi aziendali",
		"trade_fairs":         "Fiere ed eventi",
		"travel":              "Viaggi",
		"lodging":             "Alloggio",
		"meals_entertainment": "Pasti e rappresentanza",
		"other_operating":     "Altri costi d’esercizio",
		"interest":            "Interessi",
		"bank_fees":           "Spese bancarie",
		"direct_taxes":        "Imposte dirette",
	},
}

// language: the asker's language among en, de, fr and it: ?lang, else the first supported of Accept-Language.
func language(r *http.Request) string {
	tags := []string{r.URL.Query().Get("lang")}
	for _, part := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		tags = append(tags, strings.TrimSpace(strings.SplitN(part, ";", 2)[0]))
	}
	for _, tag := range tags {
		lang := strings.ToLower(strings.SplitN(tag, "-", 2)[0])
		if _, ok := presetNames[lang]; ok || lang == "en" {
			return lang
		}
	}
	return "en"
}

// localize names a category of the catalogue in the asker's language; a category someone named keeps its name.
func localize(lang string, c *store.CategoryRef) {
	if c == nil || c.Preset == nil {
		return
	}
	if name, ok := presetNames[lang][*c.Preset]; ok {
		c.Name = name
	}
}
