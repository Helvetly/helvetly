package engagements

import (
	"context"
	"errors"
	"fmt"
	"html"
	"mime"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/engagementpdf"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

type report struct {
	pdf      []byte
	name     string
	language string
	client   store.Client
	e        store.Engagement
	period   string // "dd.mm.yyyy – dd.mm.yyyy"
}

func (s *Service) registerReports(mux *http.ServeMux) {
	for pattern, h := range map[string]handler{
		"GET /api/v1/engagements/{id}/periods/{period_id}/report":       s.report,
		"POST /api/v1/engagements/{id}/periods/{period_id}/report/send": s.sendReport,
		"GET /api/v1/engagements/export":                                s.exportEngagements,
		"GET /api/v1/engagements/{id}/entries/export":                   s.exportEntries,
	} {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				s.auth.WriteError(w, r, notFound(err))
			}
		}))
	}
}

func notFound(err error) error {
	if errors.Is(err, store.ErrNotFound) {
		return auth.ErrNotFound
	}
	return err
}

// build renders the PDF live; an unknown engagement or period is not found.
func (s *Service) build(ctx context.Context, ws store.Workspace, id, periodID string) (report, error) {
	var r report
	err := s.db.Tx(ctx, func(q store.Q) error {
		e, err := q.Engagement(ctx, ws.ID, id, false)
		if err != nil {
			return err
		}
		v, err := s.view(ctx, q, e, s.today(ws))
		if err != nil {
			return err
		}
		var p *PeriodSummary
		for i := range v.periods {
			if v.periods[i].ID == periodID {
				p = &v.periods[i]
			}
		}
		if p == nil {
			return auth.ErrNotFound
		}
		seller, logo, lang, err := s.inv.Seller(ctx, q, ws.ID)
		if err != nil {
			return err
		}
		c, err := q.Client(ctx, ws.ID, e.ClientID)
		if err != nil {
			return err
		}
		if c.Language != nil && *c.Language != "" {
			lang = *c.Language
		}
		entries, err := q.Entries(ctx, e.ID, p.ID)
		if err != nil {
			return err
		}
		invs, err := q.PeriodInvoices(ctx, p.ID)
		if err != nil {
			return err
		}
		if seller.Name == "" {
			seller.Name = ws.Name // no seller in the invoice settings yet
		}
		d := engagementpdf.Document{Language: lang, Seller: seller, Logo: logo, Client: partyOf(c), Title: e.Title,
			Number: int(e.Number), StartsOn: p.StartsOn, EndsOn: p.EndsOn, Committed: p.Quantity.String(),
			CarriedIn: p.CarriedIn.String(), Used: p.Used.String(), Remaining: p.Remaining.String(), Overage: p.Overage.String(),
			Invoices: []string{}, Created: s.today(ws)}
		if e.Reference != nil {
			d.Reference = *e.Reference
		}
		if e.Unit != nil {
			d.Unit = *e.Unit
		}
		for _, en := range entries {
			row := engagementpdf.Row{Date: en.Date, Quantity: en.Quantity.String()}
			if en.Note != nil {
				row.Note = *en.Note
			}
			row.PerformedBy = "–"
			if en.PerformedBy != nil {
				row.PerformedBy = en.PerformedBy.Name
				if strings.TrimSpace(row.PerformedBy) == "" {
					u, err := q.User(ctx, en.PerformedBy.ID)
					if err != nil {
						return err
					}
					row.PerformedBy = u.Email
				}
			}
			d.Entries = append(d.Entries, row)
		}
		for _, i := range invs {
			if i.Number != nil {
				d.Invoices = append(d.Invoices, *i.Number)
			} else if i.Kind == "advance" && i.Status == "draft" {
				d.Invoices = append(d.Invoices, "") // the renderer prints the localized "draft"
			}
		}
		pdf, err := engagementpdf.Render(d)
		if err != nil {
			return err
		}
		period := swiss(p.StartsOn) + " – " + swiss(p.EndsOn)
		name := strings.NewReplacer("/", "-", "\\", "-", "\"", "'").Replace(e.Title) + " – " + period + ".pdf"
		r = report{pdf: pdf, name: name, language: lang, client: c, e: e, period: period}
		return nil
	})
	return r, err
}

func partyOf(c store.Client) store.Party {
	email := c.BillingEmail
	if email == nil {
		email = c.Email
	}
	d := func(v *string) string {
		if v == nil {
			return ""
		}
		return *v
	}
	return store.Party{Name: c.Name, Street: d(c.Street), StreetNumber: d(c.StreetNumber), Apt: c.Apt, Zip: d(c.Zip),
		City: d(c.City), Country: d(c.Country), VATNumber: c.VATNumber, Email: email}
}

func (s *Service) report(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	rep, err := s.build(r.Context(), sess.Workspace, r.PathValue("id"), r.PathValue("period_id"))
	if err != nil {
		return err
	}
	disposition := "inline"
	if r.URL.Query().Get("download") == "1" {
		disposition = "attachment"
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": rep.name}))
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(rep.pdf)
	return nil
}

var reportTexts = map[string]struct{ title, greeting, body, signOff string }{
	"de": {"Leistungsnachweis", "Guten Tag", "Im Anhang finden Sie den Leistungsnachweis «%s» für %s.", "Freundliche Grüsse"},
	"fr": {"Rapport de prestations", "Bonjour", "Veuillez trouver ci-joint le rapport de prestations « %s » pour %s.", "Meilleures salutations"},
	"it": {"Rapporto delle prestazioni", "Buongiorno", "In allegato trovate il rapporto delle prestazioni «%s» per %s.", "Cordiali saluti"},
	"en": {"Service report", "Hello", "Please find attached the service report \"%s\" for %s.", "Kind regards"},
}

const maxRecipients = 10

func addresses(key string, in []string, fields map[string]string) []string {
	out := []string{}
	if len(in) > maxRecipients {
		fields[key] = fmt.Sprintf("Use at most %d addresses.", maxRecipients)
		return out
	}
	for _, a := range in {
		v, msg := clients.NormaliseEmail(strings.TrimSpace(a))
		if msg != "" {
			fields[key] = fmt.Sprintf("%q is not a valid email address.", a)
		} else if !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	return out
}

func (s *Service) sendReport(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		To      []string `json:"to"`
		Cc      []string `json:"cc"`
		Bcc     []string `json:"bcc"`
		Subject *string  `json:"subject"`
		Message *string  `json:"message"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if s.mailer == nil {
		return auth.Error(http.StatusServiceUnavailable, "mail_unavailable", "Email is not set up on this server.", nil)
	}
	rep, err := s.build(r.Context(), sess.Workspace, r.PathValue("id"), r.PathValue("period_id"))
	if err != nil {
		return err
	}
	if len(body.To) == 0 {
		if email := partyOf(rep.client).Email; email != nil {
			body.To = []string{*email}
		}
	}
	fields := map[string]string{}
	to := addresses("to", body.To, fields)
	cc, bcc := mail.Copies(to, addresses("cc", body.Cc, fields), addresses("bcc", body.Bcc, fields))
	if len(to) == 0 && fields["to"] == "" {
		fields["to"] = "Enter an address: the client has no email address."
	}
	t := reportTexts[rep.language]
	subject := t.title + " " + rep.e.Title + " " + rep.period
	message := t.greeting + "\n\n" + fmt.Sprintf(t.body, rep.e.Title, rep.period) + "\n\n" + t.signOff + "\n" + sess.Workspace.Name
	for _, o := range []struct {
		key string
		in  *string
		out *string
		max int
	}{{"subject", body.Subject, &subject, 200}, {"message", body.Message, &message, emailtemplate.MaxMessage}} {
		if o.in == nil {
			continue
		}
		if v := strings.TrimSpace(*o.in); v == "" || utf8.RuneCountInString(v) > o.max {
			fields[o.key] = fmt.Sprintf("Use 1 to %d characters.", o.max)
		} else {
			*o.out = v
		}
	}
	if len(fields) > 0 {
		return validationFailed(fields)
	}
	m := mail.Message{Workspace: sess.Workspace.ID, To: to, Cc: cc, Bcc: bcc, Subject: subject, Text: message,
		HTML:        "<p>" + strings.ReplaceAll(html.EscapeString(message), "\n", "<br>\n") + "</p>",
		Attachments: []mail.Attachment{{Name: rep.name, ContentType: "application/pdf", Data: rep.pdf}}}
	if err := s.mailer.Send(r.Context(), m); err != nil {
		return fmt.Errorf("send service report %s: %w", rep.e.ID, err)
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"to": to}))
	return nil
}
