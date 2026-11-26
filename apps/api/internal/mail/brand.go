package mail

import (
	"context"
	"fmt"
	"html"
	"strings"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/phone"
)

// Brand is the business a workspace's email to its clients comes from: its name is the From display name and the
// header, its details the footer under the card.
type Brand struct {
	Name     string
	LogoPath string   // the logo's path under the public URL; empty for none
	Address  []string // the printed address lines: street, zip and city
	Phone    string
	Email    string
	Website  string // an http(s) URL; shown as its domain
	VAT      string // the VAT or UID number as registered
	Language string // the workspace's document language, for a message without its own
	ReplyTo  string // the workspace's reply address, else the company email; empty when it has neither
	Owner    string // the owner's email: replies go there when neither the brand nor the sender names an address
	SentWith bool   // ends with a muted "Sent with Helvetly.com" (Free and Basic; plans with remove_branding have none)
}

// Branded sends a workspace's email to its clients as the business: its name in From (the address stays MAIL_FROM's),
// Reply-To its own mailbox, its logo and details on the card. Email without a Workspace, or to the workspace's own
// members, passes through as Helvetly's: marked Members, or every recipient (To and Cc) one of its members.
type Branded struct {
	Sender  Sending
	NoReply string // MAIL_FROM's address: never a Reply-To
	Brands  func(ctx context.Context, workspaceID string) (Brand, error)
	// IsMember says whether an address is one of the workspace's members; nil decides by Members alone.
	IsMember func(ctx context.Context, workspaceID, email string) (bool, error)
}

func (b *Branded) Send(ctx context.Context, m Message) error {
	if m.Workspace != "" && !m.Members && b.IsMember != nil {
		members, err := b.allMembers(ctx, m)
		if err != nil {
			return fmt.Errorf("email recipients: %w", err)
		}
		m.Members = members
	}
	if m.Workspace == "" || m.Members || b.Brands == nil {
		return b.Sender.Send(ctx, m)
	}
	brand, err := b.Brands(ctx, m.Workspace)
	if err != nil {
		return fmt.Errorf("email brand: %w", err)
	}
	m.Brand = &brand
	m.ReplyTo = b.replyTo(brand, m.ReplyTo)
	if m.Language == "" {
		m.Language = brand.Language
	}
	return b.Sender.Send(ctx, m)
}

// allMembers: every To and Cc address is a member of the workspace (Bcc copies never decide the look).
func (b *Branded) allMembers(ctx context.Context, m Message) (bool, error) {
	recipients := append(append([]string{}, m.To...), m.Cc...)
	if len(recipients) == 0 {
		return false, nil
	}
	for _, to := range recipients {
		member, err := b.IsMember(ctx, m.Workspace, strings.TrimSpace(to))
		if err != nil || !member {
			return false, err
		}
	}
	return true, nil
}

// replyTo: the workspace's address, else the one the sender gave (the member who sends), else the owner's.
func (b *Branded) replyTo(brand Brand, given string) string {
	for _, a := range []string{brand.ReplyTo, given, brand.Owner} {
		if a = strings.TrimSpace(a); a != "" && !strings.EqualFold(a, b.NoReply) {
			return a
		}
	}
	return ""
}

// displayName makes a company name safe as a From display name: no control characters (a CR or LF could start a
// header), spaces collapsed, at most 70 characters. net/mail quotes or RFC 2047-encodes the rest.
func displayName(name string) string {
	name = strings.Join(strings.FieldsFunc(name, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }), " ")
	if utf8.RuneCountInString(name) > 70 {
		name = strings.TrimSpace(string([]rune(name)[:70]))
	}
	return name
}

type footerCopy struct{ sentWith, vat, pitch string }

var footerWords = map[string]footerCopy{
	"de": {"Gesendet mit", "MWST", "Ihr privates Backoffice, alles an einem Ort"},
	"fr": {"Envoyé avec", "TVA", "Votre back-office privé, tout au même endroit"},
	"it": {"Inviato con", "IVA", "Il suo back office privato, tutto in un unico posto"},
	"en": {"Sent with", "VAT", "Your private back office, all in one place"},
}

func wordsFor(language string) footerCopy {
	if w, ok := footerWords[language]; ok {
		return w
	}
	return footerWords["en"]
}

// vatLine is the number as on the invoices: a bare Swiss UID gets the VAT suffix in the email's language.
func vatLine(b Brand, language string) string {
	if strings.HasPrefix(b.VAT, "CHE-") && !strings.Contains(b.VAT, " ") {
		return b.VAT + " " + wordsFor(language).vat
	}
	return b.VAT
}

// lines are the footer's text lines: name, address, contact, VAT number; empty ones left out. With rich the lines
// are HTML (escaped; phone, email and website muted links, the address broken for data detectors, so no mail app
// turns them blue); without, plain text. The phone is spaced as the app shows it.
func (b Brand) lines(language string, rich bool) []string {
	esc := func(v string) string {
		if rich {
			return html.EscapeString(v)
		}
		return v
	}
	quiet := func(href, label string) string {
		if !rich {
			return label
		}
		return `<a href="` + html.EscapeString(href) + `" style="color:` + muted + `;text-decoration:none">` + html.EscapeString(label) + `</a>`
	}
	contact := []string{}
	if p := phone.Display(b.Phone); p != "" {
		contact = append(contact, quiet("tel:"+strings.ReplaceAll(p, " ", ""), p))
	}
	if b.Email != "" {
		contact = append(contact, quiet("mailto:"+b.Email, b.Email))
	}
	if d := websiteDomain(b.Website); d != "" {
		contact = append(contact, quiet(b.Website, d))
	}
	address := esc(strings.Join(b.Address, ", "))
	if rich { // a zero-width space after each space: Gmail no longer reads it as an address to link
		address = strings.ReplaceAll(address, " ", " &#8203;")
	}
	out := []string{}
	for _, l := range []string{esc(b.Name), address, strings.Join(contact, " · "), esc(vatLine(b, language))} {
		if strings.TrimSpace(l) != "" {
			out = append(out, l)
		}
	}
	return out
}

// websiteDomain: "https://www.firma.ch/" as "firma.ch".
func websiteDomain(u string) string {
	u = strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(u), "https://"), "http://")
	return strings.TrimSuffix(strings.TrimPrefix(u, "www."), "/")
}

// brandFooter is the business footer under the card, with optional Helvetly attribution.
func brandFooter(b Brand, language string) string {
	var f strings.Builder
	for i, l := range b.lines(language, true) {
		if i == 0 {
			f.WriteString(`<strong style="color:` + text + `">` + l + "</strong>")
			continue
		}
		f.WriteString("<br>" + l)
	}
	if b.SentWith {
		w := wordsFor(language)
		f.WriteString(`<br><br><span style="font-size:11px">` + html.EscapeString(w.sentWith) + ` <a href="` +
			html.EscapeString(SiteURL) + `" style="color:` + muted + `"><strong>Helvetly.com</strong></a> · ` + html.EscapeString(w.pitch) + "</span>")
	}
	return f.String()
}

// brandText is the plain-text part's footer, after the signature delimiter.
func brandText(b Brand, language string) string {
	out := "\n\n-- \n" + strings.Join(b.lines(language, false), "\n") + "\n"
	if b.SentWith {
		w := wordsFor(language)
		out += "\n" + w.sentWith + " " + SiteURL + " · " + w.pitch + "\n"
	}
	return out
}

// Preview is the HTML a workspace's client would get for m, as Branded and Sender build it, without sending.
func Preview(m Message, brand Brand, publicURL string) string {
	h, _ := Render(m, brand, publicURL)
	return h
}

// Render is the HTML and text parts a workspace's client gets for m, as Branded and Sender build them; with a brand
// without a name, Helvetly's own email.
func Render(m Message, brand Brand, publicURL string) (htmlPart, textPart string) {
	if brand.Name == "" {
		return layout(m, publicURL), plainText(m)
	}
	m.Brand = &brand
	if m.Language == "" {
		m.Language = brand.Language
	}
	return layout(m, publicURL), plainText(m)
}
