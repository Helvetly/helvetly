package invoicepdf

import "helvetly.com/api/internal/store"

// labels is the printed wording of one language. Format verbs: Preceding %s = preceding invoice number, VATOn %s %s =
// rate and taxable amount, Page %d = page ({nb} becomes the page count).
type labels struct {
	Titles                                                                                      map[string]string // by kind, plus "final" (an invoice with deducted prepayments) and "quote"
	Preceding                                                                                   map[string]string // by kind: the line naming the preceding invoice
	SelfBilling, NotVATInvoice, AmountDue, ContractNumber                                       string
	Number, IssueDate, ServiceDate, ServicePeriod, DueDate, ValidUntil, Reference, ClientNumber string
	BilledBy, BilledTo                                                                          string // the two party columns
	Pos, Description, Quantity, UnitPrice, Discount, VAT, Amount                                string
	Subtotal, DocDiscount, NetTotal, VATOn, Total, TotalNoVAT, Rounding, Payable, Credited      string
	InclusiveNote, NotRegistered, PayBy, BankDetails, PaymentReference, Page, Draft, Refunded   string
	PayWithRevolut, RevolutAmount, RevolutNote                                                  string // RevolutAmount %s %s = currency, amount; RevolutNote %s = number
	Units                                                                                       map[string]string
	CategoryNotes                                                                               map[string]string
	VATSuffix                                                                                   string // after a Swiss UID: CHE-123.456.789 MWST
	// instalments: InstalmentOf %d %d %s = seq, count, due date; PlanPart %d %d = plan seq, count
	Schedule, InstalmentNo, InstalmentDue, InstalmentOf, PlanPart string
	// QR bill (SIX Swiss Payment Standards, the fixed headings of each language)
	Receipt, PaymentPart, AccountPayableTo, QRReference, AdditionalInfo, PayableBy, PayableByBlank string
	Currency, QRAmount, AcceptancePoint, SeparateBeforePaying                                      string
}

// Swiss statute references apply to the Swiss VAT area, independently of the document language.
var foreignCategoryNotes = map[string]map[string]string{
	"de": {"E": "Von der Steuer ausgenommene Leistung.", "G": "Steuerbefreite Ausfuhr."},
	"fr": {"E": "Prestation exonérée de TVA.", "G": "Exportation exonérée."},
	"it": {"E": "Prestazione esente da IVA.", "G": "Esportazione esente."},
	"en": {"E": "Exempt from VAT.", "G": "VAT-exempt export."},
}

var languages = map[string]labels{
	"de": {
		Titles: map[string]string{"invoice": "Rechnung", "partial": "Teilrechnung", "prepayment": "Anzahlungsrechnung",
			"debit_note": "Belastungsanzeige", "corrected": "Korrigierte Rechnung", "credit_note": "Gutschrift",
			"proforma": "Proforma-Rechnung", "self_billed": "Gutschrift (Selbstfakturierung)", "final": "Schlussrechnung", "quote": "Offerte"},
		Preceding: map[string]string{"credit_note": "Gutschrift zu Rechnung %s", "debit_note": "Belastungsanzeige zu Rechnung %s",
			"corrected": "Ersetzt Rechnung %s"},
		SelfBilling: "Gutschrift (Selbstfakturierung)", NotVATInvoice: "Keine MWST-Rechnung", AmountDue: "Restbetrag", Number: "Nummer",
		IssueDate: "Datum", ServiceDate: "Leistungsdatum", ServicePeriod: "Leistungszeitraum", DueDate: "Zahlbar bis", ValidUntil: "Gültig bis",
		Reference: "Ihre Referenz", ClientNumber: "Kundennummer", ContractNumber: "Vertragsnummer", BilledBy: "Absender", BilledTo: "Empfänger",
		Pos: "Pos.", Description: "Beschreibung", Quantity: "Menge", UnitPrice: "Preis", Discount: "Rabatt", VAT: "MWST", Amount: "Betrag",
		Subtotal: "Zwischentotal", DocDiscount: "Rabatt %s %%", NetTotal: "Total exkl. MWST", VATOn: "MWST %s %% auf %s",
		Total: "Total inkl. MWST", TotalNoVAT: "Total", Rounding: "Rundung", Payable: "Zu bezahlen", Credited: "Gutgeschrieben",
		InclusiveNote: "Preise inkl. MWST.", NotRegistered: "Nicht mehrwertsteuerpflichtig.", PayBy: "Zahlbar bis %s.",
		BankDetails: "Bankverbindung", Refunded: "Der Betrag wird Ihnen zurückerstattet.", PaymentReference: "Zahlungsreferenz", Page: "Seite %d von {nb}", Draft: "ENTWURF",
		PayWithRevolut: "Mit Revolut bezahlen", RevolutAmount: "Betrag %s %s", RevolutNote: "Vermerk: %s",
		Units: map[string]string{"hour": "Std.", "day": "Tage", "piece": "Stk.", "month": "Mt.", "km": "km", "flat": "pauschal"},
		CategoryNotes: map[string]string{
			"E":  "Von der Steuer ausgenommene Leistung (Art. 21 MWSTG).",
			"AE": "Reverse Charge: Die Steuer schuldet der Leistungsempfänger.",
			"K":  "Steuerbefreite innergemeinschaftliche Lieferung.",
			"G":  "Steuerbefreite Ausfuhr (Art. 23 MWSTG).",
		},
		Schedule: "Ratenplan", InstalmentNo: "Nr.", InstalmentDue: "Fällig", InstalmentOf: "Rate %d von %d · fällig %s", PlanPart: "Rate %d/%d",
		VATSuffix: "MWST",
		Receipt:   "Empfangsschein", PaymentPart: "Zahlteil", AccountPayableTo: "Konto / Zahlbar an", QRReference: "Referenz",
		AdditionalInfo: "Zusätzliche Informationen", PayableBy: "Zahlbar durch", PayableByBlank: "Zahlbar durch (Name/Adresse)",
		Currency: "Währung", QRAmount: "Betrag", AcceptancePoint: "Annahmestelle", SeparateBeforePaying: "Vor der Einzahlung abzutrennen",
	},
	"fr": {
		Titles: map[string]string{"invoice": "Facture", "partial": "Facture partielle", "prepayment": "Facture d'acompte",
			"debit_note": "Note de débit", "corrected": "Facture rectificative", "credit_note": "Note de crédit",
			"proforma": "Facture pro forma", "self_billed": "Autofacture", "final": "Facture finale", "quote": "Offre"},
		Preceding: map[string]string{"credit_note": "Note de crédit pour la facture %s", "debit_note": "Note de débit pour la facture %s",
			"corrected": "Remplace la facture %s"},
		SelfBilling: "Autofacturation", NotVATInvoice: "Ceci n'est pas une facture TVA", AmountDue: "Solde à payer", Number: "Numéro",
		IssueDate: "Date", ServiceDate: "Date de prestation", ServicePeriod: "Période de prestation", DueDate: "Payable jusqu'au", ValidUntil: "Valable jusqu'au",
		Reference: "Votre référence", ClientNumber: "N° client", ContractNumber: "N° de contrat", BilledBy: "Émetteur", BilledTo: "Destinataire",
		Pos: "Pos.", Description: "Description", Quantity: "Quantité", UnitPrice: "Prix", Discount: "Rabais", VAT: "TVA", Amount: "Montant",
		Subtotal: "Sous-total", DocDiscount: "Rabais %s %%", NetTotal: "Total hors TVA", VATOn: "TVA %s %% sur %s",
		Total: "Total TVA incluse", TotalNoVAT: "Total", Rounding: "Arrondi", Payable: "Montant à payer", Credited: "Montant crédité",
		InclusiveNote: "Prix TVA incluse.", NotRegistered: "Non assujetti à la TVA.", PayBy: "Payable jusqu'au %s.",
		BankDetails: "Coordonnées bancaires", Refunded: "Le montant vous sera remboursé.", PaymentReference: "Référence de paiement", Page: "Page %d sur {nb}", Draft: "BROUILLON",
		PayWithRevolut: "Payer avec Revolut", RevolutAmount: "Montant %s %s", RevolutNote: "communication : %s",
		Units: map[string]string{"hour": "h", "day": "jours", "piece": "pce", "month": "mois", "km": "km", "flat": "forfait"},
		CategoryNotes: map[string]string{
			"E":  "Prestation exclue du champ de l'impôt (art. 21 LTVA).",
			"AE": "Autoliquidation : la TVA est due par le destinataire.",
			"K":  "Livraison intracommunautaire exonérée.",
			"G":  "Exportation exonérée (art. 23 LTVA).",
		},
		Schedule: "Plan de paiement", InstalmentNo: "N°", InstalmentDue: "Échéance", InstalmentOf: "Versement %d sur %d · échéance %s", PlanPart: "Versement %d/%d",
		VATSuffix: "TVA",
		Receipt:   "Récépissé", PaymentPart: "Section paiement", AccountPayableTo: "Compte / Payable à", QRReference: "Référence",
		AdditionalInfo: "Informations supplémentaires", PayableBy: "Payable par", PayableByBlank: "Payable par (nom/adresse)",
		Currency: "Monnaie", QRAmount: "Montant", AcceptancePoint: "Point de dépôt", SeparateBeforePaying: "A détacher avant le versement",
	},
	"it": {
		Titles: map[string]string{"invoice": "Fattura", "partial": "Fattura parziale", "prepayment": "Fattura d'acconto",
			"debit_note": "Nota di debito", "corrected": "Fattura rettificativa", "credit_note": "Nota di credito",
			"proforma": "Fattura proforma", "self_billed": "Autofattura", "final": "Fattura finale", "quote": "Offerta"},
		Preceding: map[string]string{"credit_note": "Nota di credito per la fattura %s", "debit_note": "Nota di debito per la fattura %s",
			"corrected": "Sostituisce la fattura %s"},
		SelfBilling: "Autofatturazione", NotVATInvoice: "Non è una fattura IVA", AmountDue: "Saldo da pagare", Number: "Numero",
		IssueDate: "Data", ServiceDate: "Data della prestazione", ServicePeriod: "Periodo della prestazione", DueDate: "Pagabile entro", ValidUntil: "Valida fino al",
		Reference: "Vostro riferimento", ClientNumber: "N. cliente", ContractNumber: "N. contratto", BilledBy: "Mittente", BilledTo: "Destinatario",
		Pos: "Pos.", Description: "Descrizione", Quantity: "Quantità", UnitPrice: "Prezzo", Discount: "Sconto", VAT: "IVA", Amount: "Importo",
		Subtotal: "Subtotale", DocDiscount: "Sconto %s %%", NetTotal: "Totale IVA esclusa", VATOn: "IVA %s %% su %s",
		Total: "Totale IVA inclusa", TotalNoVAT: "Totale", Rounding: "Arrotondamento", Payable: "Importo da pagare", Credited: "Importo accreditato",
		InclusiveNote: "Prezzi IVA inclusa.", NotRegistered: "Non assoggettato all'IVA.", PayBy: "Pagabile entro il %s.",
		BankDetails: "Coordinate bancarie", Refunded: "L'importo le verrà rimborsato.", PaymentReference: "Riferimento di pagamento", Page: "Pagina %d di {nb}", Draft: "BOZZA",
		PayWithRevolut: "Paga con Revolut", RevolutAmount: "Importo %s %s", RevolutNote: "causale: %s",
		Units: map[string]string{"hour": "ore", "day": "giorni", "piece": "pz.", "month": "mesi", "km": "km", "flat": "forfait"},
		CategoryNotes: map[string]string{
			"E":  "Prestazione esclusa dall'imposta (art. 21 LIVA).",
			"AE": "Inversione contabile: l'imposta è dovuta dal destinatario.",
			"K":  "Cessione intracomunitaria esente.",
			"G":  "Esportazione esente (art. 23 LIVA).",
		},
		Schedule: "Piano rateale", InstalmentNo: "N.", InstalmentDue: "Scadenza", InstalmentOf: "Rata %d di %d · scadenza %s", PlanPart: "Rata %d/%d",
		VATSuffix: "IVA",
		Receipt:   "Ricevuta", PaymentPart: "Sezione pagamento", AccountPayableTo: "Conto / Pagabile a", QRReference: "Riferimento",
		AdditionalInfo: "Informazioni supplementari", PayableBy: "Pagabile da", PayableByBlank: "Pagabile da (nome/indirizzo)",
		Currency: "Valuta", QRAmount: "Importo", AcceptancePoint: "Punto di accettazione", SeparateBeforePaying: "Da staccare prima del versamento",
	},
	"en": {
		Titles: map[string]string{"invoice": "Invoice", "partial": "Partial invoice", "prepayment": "Prepayment invoice",
			"debit_note": "Debit note", "corrected": "Corrected invoice", "credit_note": "Credit note",
			"proforma": "Proforma invoice", "self_billed": "Self-billed invoice", "final": "Final invoice", "quote": "Quote"},
		Preceding: map[string]string{"credit_note": "Credit note for invoice %s", "debit_note": "Debit note for invoice %s",
			"corrected": "Replaces invoice %s"},
		SelfBilling: "Self-billing", NotVATInvoice: "Not a VAT invoice", AmountDue: "Amount due", Number: "Number",
		IssueDate: "Date", ServiceDate: "Service date", ServicePeriod: "Service period", DueDate: "Due date", ValidUntil: "Valid until",
		Reference: "Your reference", ClientNumber: "Client number", ContractNumber: "Contract no.", BilledBy: "Billed by", BilledTo: "Billed to",
		Pos: "Pos.", Description: "Description", Quantity: "Qty", UnitPrice: "Price", Discount: "Disc.", VAT: "VAT", Amount: "Amount",
		Subtotal: "Subtotal", DocDiscount: "Discount %s %%", NetTotal: "Total excl. VAT", VATOn: "VAT %s %% on %s",
		Total: "Total incl. VAT", TotalNoVAT: "Total", Rounding: "Rounding", Payable: "Amount payable", Credited: "Amount credited",
		InclusiveNote: "Prices include VAT.", NotRegistered: "Not subject to VAT.", PayBy: "Payable by %s.",
		BankDetails: "Bank details", Refunded: "The amount will be refunded to you.", PaymentReference: "Payment reference", Page: "Page %d of {nb}", Draft: "DRAFT",
		PayWithRevolut: "Pay with Revolut", RevolutAmount: "Amount %s %s", RevolutNote: "reference: %s",
		Units: map[string]string{"hour": "h", "day": "days", "piece": "pcs", "month": "months", "km": "km", "flat": "flat"},
		CategoryNotes: map[string]string{
			"E":  "Exempt from VAT (Art. 21 Swiss VAT Act).",
			"AE": "Reverse charge: VAT is due by the recipient.",
			"K":  "VAT-exempt intra-community supply.",
			"G":  "VAT-exempt export (Art. 23 Swiss VAT Act).",
		},
		Schedule: "Instalment schedule", InstalmentNo: "No.", InstalmentDue: "Due", InstalmentOf: "Instalment %d of %d · due %s", PlanPart: "Instalment %d/%d",
		VATSuffix: "VAT",
		Receipt:   "Receipt", PaymentPart: "Payment part", AccountPayableTo: "Account / Payable to", QRReference: "Reference",
		AdditionalInfo: "Additional information", PayableBy: "Payable by", PayableByBlank: "Payable by (name/address)",
		Currency: "Currency", QRAmount: "Amount", AcceptancePoint: "Acceptance point", SeparateBeforePaying: "Separate before paying in",
	},
}

// Title: the document title in the language ("Rechnung", "Gutschrift"), for subjects and file names too.
func Title(language, kind string) string {
	l := languages[language]
	if t, ok := l.Titles[kind]; ok {
		return t
	}
	return l.Titles["invoice"]
}

// TitleFor is Title, except that an invoice with deducted prepayments is a final invoice ("Schlussrechnung").
func TitleFor(inv store.Invoice) string {
	if inv.Kind == "invoice" && len(inv.Prepayments) > 0 {
		return Title(inv.Language, "final")
	}
	return Title(inv.Language, inv.Kind)
}
