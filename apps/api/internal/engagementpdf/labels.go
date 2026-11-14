package engagementpdf

// labels is the printed wording of one language. Created %s = date, Page %d = page ({nb} becomes the count).
type labels struct {
	Title, Engagement, Number, Reference, Period, Client                    string
	Date, Description, PerformedBy, Quantity                                string
	Committed, CarriedIn, Used, Remaining, Overage, Invoices, Created, Page string
	NoEntries, Draft                                                        string
	Units                                                                   map[string]string
}

var languages = map[string]labels{
	"de": {Title: "Leistungsnachweis", Engagement: "Auftrag", Number: "Nummer", Reference: "Ihre Referenz", Period: "Zeitraum", Client: "Kunde",
		Date: "Datum", Description: "Beschreibung", PerformedBy: "Erbracht von", Quantity: "Menge",
		Committed: "Vereinbart", CarriedIn: "Übertrag", Used: "Verbraucht", Remaining: "Verbleibend", Overage: "Mehrverbrauch", Invoices: "Rechnungen",
		Created: "Erstellt am %s", Page: "Seite %d von {nb}", NoEntries: "Keine Einträge in diesem Zeitraum.", Draft: "Entwurf",
		Units: map[string]string{"hour": "Std.", "day": "Tage", "piece": "Stk.", "month": "Mt.", "km": "km", "flat": "pauschal"}},
	"fr": {Title: "Rapport de prestations", Engagement: "Mandat", Number: "Numéro", Reference: "Votre référence", Period: "Période", Client: "Client",
		Date: "Date", Description: "Description", PerformedBy: "Effectué par", Quantity: "Quantité",
		Committed: "Convenu", CarriedIn: "Report", Used: "Utilisé", Remaining: "Restant", Overage: "Dépassement", Invoices: "Factures",
		Created: "Créé le %s", Page: "Page %d sur {nb}", NoEntries: "Aucune entrée pour cette période.", Draft: "Brouillon",
		Units: map[string]string{"hour": "h", "day": "jours", "piece": "pce", "month": "mois", "km": "km", "flat": "forfait"}},
	"it": {Title: "Rapporto delle prestazioni", Engagement: "Incarico", Number: "Numero", Reference: "Vostro riferimento", Period: "Periodo", Client: "Cliente",
		Date: "Data", Description: "Descrizione", PerformedBy: "Eseguito da", Quantity: "Quantità",
		Committed: "Concordato", CarriedIn: "Riporto", Used: "Utilizzato", Remaining: "Rimanente", Overage: "Eccedenza", Invoices: "Fatture",
		Created: "Creato il %s", Page: "Pagina %d di {nb}", NoEntries: "Nessuna voce in questo periodo.", Draft: "Bozza",
		Units: map[string]string{"hour": "ore", "day": "giorni", "piece": "pz.", "month": "mesi", "km": "km", "flat": "forfait"}},
	"en": {Title: "Service report", Engagement: "Engagement", Number: "Number", Reference: "Your reference", Period: "Period", Client: "Client",
		Date: "Date", Description: "Description", PerformedBy: "Performed by", Quantity: "Qty",
		Committed: "Committed", CarriedIn: "Carried in", Used: "Used", Remaining: "Remaining", Overage: "Overage", Invoices: "Invoices",
		Created: "Created %s", Page: "Page %d of {nb}", NoEntries: "No entries in this period.", Draft: "Draft",
		Units: map[string]string{"hour": "h", "day": "days", "piece": "pcs", "month": "months", "km": "km", "flat": "flat"}},
}
