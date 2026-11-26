package invoicepdf

import (
	"fmt"

	"helvetly.com/api/internal/dunningcalc"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/swissqr"
)

// Notice is one dunning notice of an issued invoice (docs/invoices-contract.md "Dunning").
type Notice struct {
	Words        Words  // ReminderWords(…) of the step
	Title        string // the step's name, or Words.Title
	SentOn       string // the letter's date
	Amounts      dunningcalc.Amounts
	Rate         invoicecalc.Percent // a year, 0 without interest
	InterestFrom string              // first day of interest, "" without
}

// Words is the wording of a notice in one language, shared by the letter and the email. Sentence %s %s %s = invoice
// number, invoice date, due date; Open %s = invoice number; Interest %s %s %s %d = rate, from, to, days.
type Words struct {
	Title, Greeting, Sentence, PayWithin, Settled, SignOff string
	Date, Invoice, InvoiceDate, DueDate                    string
	Open, Fee, Interest, Total                             string
}

type reminderLabels struct {
	titles, sentences                     [3]string // first, middle (a format of its number), final
	soon                                  [3]string // a note before the due date: title, sentence, pay by the due date
	greeting, payWithin, settled, signOff string
	date, invoice, invoiceDate, dueDate   string
	open, fee, interest, total            string
}

var reminderTexts = map[string]reminderLabels{
	"de": {
		soon: [3]string{"Zahlungshinweis", "Wir erinnern Sie freundlich daran, dass die Rechnung %s vom %s am %s fällig wird.",
			"Bitte überweisen Sie den Betrag bis zum Fälligkeitsdatum."},
		titles: [3]string{"Zahlungserinnerung", "%d. Mahnung", "Letzte Mahnung"},
		sentences: [3]string{
			"Die Rechnung %s vom %s war am %s zur Zahlung fällig und ist bei uns noch nicht beglichen. Wir bitten Sie, den offenen Betrag zu bezahlen.",
			"Trotz unserer Zahlungserinnerung ist die Rechnung %s vom %s, fällig am %s, noch offen. Wir bitten Sie, den Betrag umgehend zu überweisen.",
			"Die Rechnung %s vom %s, fällig am %s, ist trotz unserer Mahnungen nicht bezahlt. Ohne Zahlung behalten wir uns weitere Schritte vor, insbesondere die Betreibung.",
		},
		greeting: "Guten Tag", payWithin: "Bitte überweisen Sie den Gesamtbetrag innert 10 Tagen.",
		settled: "Falls Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben als gegenstandslos.",
		signOff: "Freundliche Grüsse", date: "Datum", invoice: "Rechnung", invoiceDate: "Rechnungsdatum", dueDate: "Fällig am",
		open: "Offener Betrag Rechnung %s", fee: "Mahngebühr", interest: "Verzugszins %s %% vom %s bis %s (%d Tage)", total: "Total zu bezahlen",
	},
	"fr": {
		soon: [3]string{"Avis d'échéance", "Nous vous rappelons aimablement que la facture %s du %s arrive à échéance le %s.",
			"Veuillez virer le montant d'ici l'échéance."},
		titles: [3]string{"Rappel de paiement", "%de rappel", "Dernier rappel"},
		sentences: [3]string{
			"Sauf erreur de notre part, la facture %s du %s, échue le %s, n'est pas encore réglée. Nous vous prions de bien vouloir payer le montant ouvert.",
			"Malgré notre rappel, la facture %s du %s, échue le %s, reste impayée. Nous vous prions de virer le montant sans délai.",
			"La facture %s du %s, échue le %s, reste impayée malgré nos rappels. À défaut de paiement, nous nous réservons d'autres démarches, notamment une poursuite.",
		},
		greeting: "Bonjour", payWithin: "Veuillez virer le montant total dans les 10 jours.",
		settled: "Si vous avez déjà effectué le paiement, veuillez ne pas tenir compte de ce courrier.",
		signOff: "Meilleures salutations", date: "Date", invoice: "Facture", invoiceDate: "Date de la facture", dueDate: "Échéance",
		open: "Montant ouvert facture %s", fee: "Frais de rappel", interest: "Intérêt moratoire %s %% du %s au %s (%d jours)", total: "Total à payer",
	},
	"it": {
		soon: [3]string{"Avviso di scadenza", "Le ricordiamo cordialmente che la fattura %s del %s scade il %s.",
			"La preghiamo di versare l'importo entro la scadenza."},
		titles: [3]string{"Promemoria di pagamento", "%d° sollecito", "Ultimo sollecito"},
		sentences: [3]string{
			"Salvo errore, la fattura %s del %s, scaduta il %s, non risulta ancora pagata. La preghiamo di saldare l'importo aperto.",
			"Nonostante il nostro promemoria, la fattura %s del %s, scaduta il %s, è ancora aperta. La preghiamo di versare l'importo senza indugio.",
			"La fattura %s del %s, scaduta il %s, non è stata pagata nonostante i nostri solleciti. In mancanza di pagamento ci riserviamo ulteriori passi, in particolare l'esecuzione.",
		},
		greeting: "Buongiorno", payWithin: "La preghiamo di versare l'importo totale entro 10 giorni.",
		settled: "Se ha già effettuato il pagamento, consideri nulla la presente.",
		signOff: "Cordiali saluti", date: "Data", invoice: "Fattura", invoiceDate: "Data fattura", dueDate: "Scadenza",
		open: "Importo aperto fattura %s", fee: "Spese di sollecito", interest: "Interesse di mora %s %% dal %s al %s (%d giorni)", total: "Totale da pagare",
	},
	"en": {
		soon: [3]string{"Payment due soon", "A friendly note that invoice %s of %s is due on %s.",
			"Please transfer the amount by the due date."},
		titles: [3]string{"Payment reminder", "Reminder %d", "Final reminder"},
		sentences: [3]string{
			"According to our records, invoice %s of %s, due on %s, has not been paid yet. Please settle the open amount.",
			"Despite our reminder, invoice %s of %s, due on %s, is still open. Please transfer the amount without delay.",
			"Invoice %s of %s, due on %s, remains unpaid despite our reminders. Without payment we reserve further steps, in particular debt collection.",
		},
		greeting: "Hello", payWithin: "Please transfer the total within 10 days.",
		settled: "If you have already paid, please disregard this letter.",
		signOff: "Kind regards", date: "Date", invoice: "Invoice", invoiceDate: "Invoice date", dueDate: "Due on",
		open: "Open amount invoice %s", fee: "Reminder fee", interest: "Default interest %s %% from %s to %s (%d days)", total: "Total payable",
	},
}

// ReminderWords: the wording of a reminder in language (English when unknown). A note before the due date has its
// own; otherwise rank (1-based) of ranks, the reminders after the due date: the first is the payment reminder, the
// last of two or more the final reminder, one between them is numbered.
func ReminderWords(language string, rank, ranks int, beforeDue bool) Words {
	t, ok := reminderTexts[language]
	if !ok {
		t = reminderTexts["en"]
	}
	w := Words{Greeting: t.greeting, PayWithin: t.payWithin, Settled: t.settled, SignOff: t.signOff, Date: t.date,
		Invoice: t.invoice, InvoiceDate: t.invoiceDate, DueDate: t.dueDate, Open: t.open, Fee: t.fee, Interest: t.interest,
		Total: t.total}
	switch {
	case beforeDue:
		w.Title, w.Sentence, w.PayWithin = t.soon[0], t.soon[1], t.soon[2]
	case rank <= 1:
		w.Title, w.Sentence = t.titles[0], t.sentences[0]
	case rank >= ranks:
		w.Title, w.Sentence = t.titles[2], t.sentences[2]
	default:
		w.Title, w.Sentence = fmt.Sprintf(t.titles[1], rank), t.sentences[1]
	}
	return w
}

// SwissDate: "2026-01-31" as "31.01.2026", as printed.
func SwissDate(d string) string { return swissDate(d) }

// RenderReminder renders the letter of notice n for the issued invoice of d (its snapshots, logo and payment
// details), with d.Bill, when set, as the QR bill for the notice's total.
func RenderReminder(d Document, n Notice) ([]byte, error) {
	inv := d.Invoice
	w := n.Words
	r, onQRPage, err := newRenderer(d, n.Title+" "+number(inv))
	if err != nil {
		return nil, err
	}
	pdf, cur := r.pdf, inv.Currency
	pdf.AddPage()
	r.letterhead(d.Seller, d.Buyer, d.Phone)
	details := [][2]string{{w.Date, swissDate(n.SentOn)}, {w.Invoice, number(inv)}, {w.InvoiceDate, swissDate(inv.IssueDate)},
		{w.DueDate, swissDate(inv.DueDate)}}
	if no, ok := clientNumber(inv); ok {
		details = append(details, [2]string{r.l.ClientNumber, no})
	}
	r.details(details)

	y := 95.0
	r.set("B", 16)
	r.cell(left, y, contentW, 8, n.Title, "L")
	y += 12
	sentence := fmt.Sprintf(w.Sentence, number(inv), swissDate(inv.IssueDate), swissDate(inv.DueDate))
	r.set("", 9.5)
	y = r.lines(left, y, contentW, 4.6, r.wrap(w.Greeting+"\n\n"+sentence, contentW), "L") + 6

	type row struct {
		label string
		value invoicecalc.Money
	}
	rows := []row{{fmt.Sprintf(w.Open, number(inv)), n.Amounts.Open}}
	if n.Amounts.Fee != 0 {
		rows = append(rows, row{w.Fee, n.Amounts.Fee})
	}
	if n.Amounts.Interest != 0 {
		rows = append(rows, row{fmt.Sprintf(w.Interest, n.Rate, swissDate(n.InterestFrom), swissDate(n.SentOn), n.Amounts.Days),
			n.Amounts.Interest})
	}
	r.set("", 9)
	for _, rw := range rows {
		r.cell(left, y, 140, 5, rw.label, "L")
		r.cell(160, y, 30, 5, cur+" "+rw.value.Swiss("'"), "R")
		y += 5
	}
	pdf.SetLineWidth(0.3)
	pdf.Line(left, y, right, y)
	y += 0.8
	r.set("B", 9.5)
	r.cell(left, y, 140, 5.5, w.Total, "L")
	r.cell(160, y, 30, 5.5, cur+" "+n.Amounts.Total.Swiss("'"), "R")
	y += 12

	r.set("", 9.5)
	y = r.lines(left, y, contentW, 4.6, r.wrap(w.PayWithin+" "+w.Settled, contentW), "L")
	var block []string
	if inv.Payment.IBAN != nil {
		block = append(block, "", r.l.BankDetails+": IBAN "+swissqr.FormatIBAN(*inv.Payment.IBAN))
	}
	if ref := paymentReference(inv.Payment.ReferenceType, inv.Payment.Reference); ref != "" {
		block = append(block, r.l.PaymentReference+": "+ref)
	}
	block = append(block, "", w.SignOff, d.Seller.Name)
	r.block(y, block)
	pdf.RegisterAlias("{nb}", fmt.Sprint(pdf.PageNo()))

	if d.Bill != nil {
		pdf.AddPage()
		*onQRPage = true
		if err := r.qrBill(*d.Bill); err != nil {
			return nil, err
		}
	}
	return r.output()
}
