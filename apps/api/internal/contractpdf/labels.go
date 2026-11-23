package contractpdf

// labels is the printed wording of one language. Page %d = page ({nb} becomes the count).
type labels struct {
	Title, Number, Date, Quote, Draft, Between, And, Seller, Client       string
	Services, Description, Quantity, UnitPrice, Amount                    string
	Subtotal, Discount, Net, VAT, Total, Schedule, Due, Signatures, Place string
	Page                                                                  string
}

var languages = map[string]labels{
	"de": {Title: "Vertrag", Number: "Vertragsnummer", Date: "Datum", Quote: "Angebot", Draft: "Entwurf", Between: "zwischen",
		And: "und", Seller: "Auftragnehmer", Client: "Auftraggeber", Services: "Leistungen und Preise", Description: "Beschreibung",
		Quantity: "Menge", UnitPrice: "Preis", Amount: "Betrag", Subtotal: "Zwischensumme", Discount: "Rabatt", Net: "Netto",
		VAT: "MWST", Total: "Total", Schedule: "Zahlungsplan", Due: "Fällig am", Signatures: "Unterschriften",
		Place: "Ort, Datum", Page: "Seite %d von {nb}"},
	"fr": {Title: "Contrat", Number: "Numéro de contrat", Date: "Date", Quote: "Devis", Draft: "Brouillon", Between: "entre",
		And: "et", Seller: "Mandataire", Client: "Mandant", Services: "Prestations et prix", Description: "Description",
		Quantity: "Quantité", UnitPrice: "Prix", Amount: "Montant", Subtotal: "Sous-total", Discount: "Rabais", Net: "Net",
		VAT: "TVA", Total: "Total", Schedule: "Échéancier", Due: "Échéance", Signatures: "Signatures",
		Place: "Lieu, date", Page: "Page %d sur {nb}"},
	"it": {Title: "Contratto", Number: "Numero di contratto", Date: "Data", Quote: "Offerta", Draft: "Bozza", Between: "tra",
		And: "e", Seller: "Mandatario", Client: "Mandante", Services: "Prestazioni e prezzi", Description: "Descrizione",
		Quantity: "Quantità", UnitPrice: "Prezzo", Amount: "Importo", Subtotal: "Subtotale", Discount: "Sconto", Net: "Netto",
		VAT: "IVA", Total: "Totale", Schedule: "Piano di pagamento", Due: "Scadenza", Signatures: "Firme",
		Place: "Luogo, data", Page: "Pagina %d di {nb}"},
	"en": {Title: "Contract", Number: "Contract number", Date: "Date", Quote: "Quote", Draft: "Draft", Between: "between",
		And: "and", Seller: "Contractor", Client: "Client", Services: "Services and prices", Description: "Description",
		Quantity: "Qty", UnitPrice: "Price", Amount: "Amount", Subtotal: "Subtotal", Discount: "Discount", Net: "Net",
		VAT: "VAT", Total: "Total", Schedule: "Payment schedule", Due: "Due", Signatures: "Signatures",
		Place: "Place, date", Page: "Page %d of {nb}"},
}

// Languages: the languages a contract is printed in.
func Languages() []string { return []string{"de", "fr", "it", "en"} }

// SignatureWords are a signature page's heading and date caption in lang (English when it has none).
func SignatureWords(lang string) (heading, date string) {
	l, ok := languages[lang]
	if !ok {
		l = languages["en"]
	}
	return l.Signatures, l.Date
}
