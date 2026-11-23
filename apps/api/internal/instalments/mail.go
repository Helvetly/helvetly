package instalments

import (
	"context"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// reminderText is one language's reminder: the subject, the sentence before and after the due date (what, due date),
// what is reminded of (invoice number; or instalment, count and invoice number), the labels of the open amount and
// the payment reference, and the sign-off.
type reminderText struct{ subject, before, after, invoice, instalment, open, reference, signOff string }

var reminderTexts = map[string]reminderText{
	"de": {"Zahlungserinnerung", "Wir erinnern Sie an die Zahlung für %s, fällig am %s.",
		"Die Zahlung für %s, fällig am %s, ist bei uns noch nicht eingegangen.", "Rechnung %s", "Rate %d von %d der Rechnung %s",
		"Offener Betrag", "Zahlungsreferenz", "Freundliche Grüsse"},
	"fr": {"Rappel de paiement", "Nous vous rappelons le paiement de : %s, échéance le %s.",
		"Sauf erreur de notre part, le paiement de : %s, échu le %s, ne nous est pas encore parvenu.", "facture %s",
		"versement %d sur %d de la facture %s", "Montant ouvert", "Référence de paiement", "Meilleures salutations"},
	"it": {"Promemoria di pagamento", "Le ricordiamo il pagamento di: %s, in scadenza il %s.",
		"Salvo errore, il pagamento di: %s, scaduto il %s, non ci è ancora pervenuto.", "fattura %s", "rata %d di %d della fattura %s",
		"Importo aperto", "Riferimento di pagamento", "Cordiali saluti"},
	"en": {"Payment reminder", "This is a reminder of the payment for %s, due on %s.",
		"According to our records, the payment for %s, due on %s, has not reached us yet.", "invoice %s",
		"instalment %d of %d of invoice %s", "Open amount", "Payment reference", "Kind regards"},
}

// reminderMessage is the reminder of t for inv, in the invoice's language, to the client's primary contact, the
// invoice PDF attached and replies going to the seller.
func reminderMessage(inv store.Invoice, t store.ReminderTarget, pdf []byte) mail.Message {
	lang := t.Language
	if _, ok := reminderTexts[lang]; !ok {
		lang = "en"
	}
	text := reminderTexts[lang]
	what := fmt.Sprintf(text.invoice, t.Number)
	if t.Count > 1 {
		what = fmt.Sprintf(text.instalment, t.Seq, t.Count, t.Number)
	}
	sentence := text.before
	if t.Kind == "after" {
		sentence = text.after
	}
	buyer, seller := "", ""
	if inv.Buyer != nil {
		buyer = inv.Buyer.Name
	}
	if inv.Seller != nil {
		seller = inv.Seller.Name
	}
	l := mail.NewLetter(lang).Greeting(buyer).Lead(fmt.Sprintf(sentence, what, swissDate(t.DueDate))).Summary(
		mail.Row{Label: invoicepdf.Title(lang, inv.Kind), Value: t.Number},
		mail.Row{Label: text.open, Value: inv.Currency + " " + t.Open.Swiss("'")},
		mail.Row{Label: invoicepdf.EmailWordsFor(lang).DueDate, Value: swissDate(t.DueDate)},
		mail.Row{Label: text.reference, Value: reference(inv, t.Seq)},
	).Lead(strings.TrimSpace(text.signOff + "\n" + seller)).Attached(pdfName(inv))
	m := mail.Message{Workspace: t.WorkspaceID, Language: inv.Language, To: []string{t.ClientEmail}, Subject: text.subject + ": " + what,
		Text: l.Text(), HTML: l.HTML(), Attachments: []mail.Attachment{{Name: pdfName(inv), ContentType: "application/pdf", Data: pdf}}}
	if inv.Seller != nil && inv.Seller.Email != nil {
		m.ReplyTo = *inv.Seller.Email
	}
	return m
}

// reference: the instalment's own payment reference on a schedule, else the invoice's.
func reference(inv store.Invoice, seq int) string {
	if inv.Instalments != nil && seq >= 1 && seq <= len(inv.Instalments.Items) && inv.Instalments.Items[seq-1].Reference != nil {
		return *inv.Instalments.Items[seq-1].Reference
	}
	if inv.Payment.Reference != nil {
		return *inv.Payment.Reference
	}
	return ""
}

// pdfName matches the attachment name of POST /send.
func pdfName(inv store.Invoice) string {
	name := invoices.Title(inv)
	if inv.Number != nil {
		name += "-" + strings.ReplaceAll(*inv.Number, "/", "-")
	}
	return name + ".pdf"
}

func swissDate(d string) string {
	t, err := time.Parse(time.DateOnly, d)
	if err != nil {
		return d
	}
	return t.Format("02.01.2006")
}

// DigestWorkspaces: the workspaces with lines for the "Instalments" section at now.
func (s *Service) DigestWorkspaces(ctx context.Context, now time.Time) ([]store.Workspace, error) {
	return s.db.InstalmentDigestWorkspaces(ctx, now)
}

// DigestSection is the "Instalments" section of the engagements digest: instalments overdue and due in the next 7
// days (schedules and plan partials), plan items not issued although their day came, and partials issued in the
// last 24 hours.
func (s *Service) DigestSection(ctx context.Context, ws store.Workspace, now time.Time) (string, []engagements.DigestLine, error) {
	rows, err := s.db.DigestRows(ctx, ws.ID, now)
	if err != nil {
		return "", nil, fmt.Errorf("digest rows: %w", err)
	}
	notIssued := "Not issued yet: "
	if slices.ContainsFunc(rows, func(r store.DigestRow) bool { return r.Kind == "not_issued" }) {
		if over, err := s.overLimit(ctx, ws); err != nil {
			return "", nil, err
		} else if over {
			notIssued = "Plan invoice not issued: plan limit reached: "
		}
	}
	lines := make([]engagements.DigestLine, len(rows))
	for i, r := range rows {
		text := fmt.Sprintf("%s, instalment %d/%d, %s: %s %s, due %s", r.Number, r.Seq, r.Count, r.ClientName, r.Currency,
			r.Open.Swiss("'"), swissDate(r.DueDate))
		switch r.Kind {
		case "overdue":
			text = "Overdue: " + text
		case "issued":
			text = fmt.Sprintf("Issued %s, instalment %d/%d, %s", r.Number, r.Seq, r.Count, r.ClientName)
		case "not_issued":
			text = fmt.Sprintf("%sinstalment %d/%d, %s, due %s", notIssued, r.Seq, r.Count, r.ClientName, swissDate(r.DueDate))
		}
		lines[i] = engagements.DigestLine{Text: text, Path: invoicePath(r.InvoiceID)}
	}
	return "Instalments", lines, nil
}

func invoicePath(id string) string { return "/invoices?id=" + url.QueryEscape(id) }
