package heidi

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"helvetly.com/api/internal/store"
)

// Only whole, unqualified requests use the offline shortcut. Filters and other intents go to the planner.
var latestInvoiceQuestions = []struct {
	lang          string
	question      *regexp.Regexp
	empty, answer string
}{
	{"pl", regexp.MustCompile(`^(?:(?:jaka|kt[oó]ra|poka[zż](?: mi)?) (?:by[lł]a |jest )?)?(?:ostatni[aoą]|najnowsz[aą]) (?:by[lł]a )?(?:wystawion[ąa] )?faktur[aęe]$`), "Nie ma jeszcze wystawionych faktur.", "Ostatnia faktura według daty wystawienia to **%s** dla %s, z dnia %s, na kwotę %s %s."},
	{"en", regexp.MustCompile(`^(?:(?:what|which) (?:is|was) |show (?:me )?)?(?:my |the |our )?(?:last|latest|most recent) (?:issued )?invoice(?: (?:issued|we issued|i issued))?$`), "There are no issued invoices yet.", "The latest invoice by issue date is **%s** for %s, dated %s, for %s %s."},
	{"de", regexp.MustCompile(`^(?:welche rechnung wurde zuletzt ausgestellt|(?:zeige? (?:mir )?)?(?:die )?(?:letzte|zuletzt ausgestellte|neueste) (?:ausgestellte )?rechnung)$`), "Es wurden noch keine Rechnungen ausgestellt.", "Die letzte Rechnung nach Rechnungsdatum ist **%s** für %s vom %s über %s %s."},
	{"fr", regexp.MustCompile(`^(?:(?:quelle est|montre-moi) )?(?:la )?dernière facture(?: émise)?$`), "Aucune facture n’a encore été émise.", "La dernière facture par date d’émission est **%s** pour %s, datée du %s, d’un montant de %s %s."},
	{"it", regexp.MustCompile(`^(?:(?:qual è|mostrami) )?(?:l['’])?ultima fattura(?: emessa)?$`), "Non ci sono ancora fatture emesse.", "L’ultima fattura per data di emissione è **%s** per %s, del %s, per %s %s."},
}

func latestInvoiceLanguage(message string) string {
	text := strings.ToLower(strings.Trim(strings.Join(strings.Fields(message), " "), " ?!."))
	for _, q := range latestInvoiceQuestions {
		if q.question.MatchString(text) {
			return q.lang
		}
	}
	return ""
}
func (s *Service) latestInvoice(ctx context.Context, q store.Q, sess store.Session, lang string) (turn, error) {
	if err := need(sess, "read:invoices"); err != nil {
		return turn{}, err
	}
	rows, _, err := q.ListInvoices(ctx, sess.Workspace.ID, sess.Workspace.Today(s.now()), store.InvoiceFilter{IssuedSales: true}, 1, 0)
	if err != nil {
		return turn{}, err
	}
	words := latestInvoiceQuestions[1]
	for _, l := range latestInvoiceQuestions {
		if l.lang == lang {
			words = l
			break
		}
	}
	if len(rows) == 0 {
		return turn{memoryTopic: "latest_issued_invoice", Text: words.empty}, nil
	}
	inv := rows[0]
	card := invoiceRecord(inv)
	return turn{memoryTopic: "latest_issued_invoice", Text: fmt.Sprintf(words.answer, md(card.Title), md(inv.Client.Name), inv.IssueDate, inv.Currency, inv.PayableTotal.String()), Records: []Record{card}}, nil
}
