package invoices

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/swissqr"
)

// Settings is the seller profile and the invoice defaults, stored as one document per workspace.
type Settings struct {
	Seller           Seller              `json:"seller"`
	VATRegistered    bool                `json:"vat_registered"`
	DefaultVATMode   string              `json:"default_vat_mode"`
	DefaultVATRate   invoicecalc.Percent `json:"default_vat_rate"`
	IBAN             *string             `json:"iban"`
	BankName         *string             `json:"bank_name"`
	Currency         string              `json:"currency"`
	Language         string              `json:"language"`
	DefaultTermsDays int                 `json:"default_terms_days"`
	NumberFormat     string              `json:"number_format"`
	Footer           *string             `json:"footer"`
	QRBillEnabled    bool                `json:"qr_bill_enabled"` // offered on invoices; new ones start with what is enabled
	RevolutEnabled   bool                `json:"revolut_enabled"`
	RevolutUsername  *string             `json:"revolut_username"` // without the revolut.me/ prefix
	Instalments      InstalmentSettings  `json:"instalments"`
	Dunning          DunningSettings     `json:"dunning"`
	LogoFileID       *string             `json:"logo_file_id"`
	LogoURL          *string             `json:"logo_url"` // derived: the logo's download path
	IsComplete       bool                `json:"is_complete"`
	MissingFields    []string            `json:"missing_fields"`
}

type Seller struct {
	store.Party
}

var numberFormats = []string{"YYYY-NNN", "YYYY/NNN", "NNN/YYYY", "RE-YYYY-NNN"}

func defaultSettings() Settings {
	return Settings{Seller: Seller{Party: store.Party{Country: "CH"}}, VATRegistered: true, DefaultVATMode: invoicecalc.Exclusive,
		DefaultVATRate: 810, Currency: "CHF", Language: "de", DefaultTermsDays: 30, NumberFormat: "YYYY-NNN", QRBillEnabled: true,
		Instalments: defaultInstalmentSettings(), Dunning: defaultDunningSettings()}
}

func loadSettings(ctx context.Context, q store.Q, workspaceID string) (Settings, error) {
	s := defaultSettings()
	if _, err := q.InvoiceSettings(ctx, workspaceID, &s); err != nil {
		return s, err
	}
	s.derive()
	return s, nil
}

// derive sets is_complete and missing_fields: what blocks issuing.
func (s *Settings) derive() {
	s.MissingFields = []string{}
	for _, f := range []struct {
		name  string
		empty bool
	}{
		{"seller.name", s.Seller.Name == ""}, {"seller.street", s.Seller.Street == ""},
		{"seller.street_number", s.Seller.StreetNumber == ""}, {"seller.zip", s.Seller.Zip == ""},
		{"seller.city", s.Seller.City == ""}, {"seller.country", s.Seller.Country == ""},
		{"seller.vat_number", s.VATRegistered && s.Seller.VATNumber == nil}, {"iban", s.IBAN == nil},
	} {
		if f.empty {
			s.MissingFields = append(s.MissingFields, f.name)
		}
	}
	s.IsComplete = len(s.MissingFields) == 0
	s.LogoURL = nil
	if s.LogoFileID != nil {
		u := logoPath
		s.LogoURL = &u
	}
}

func (s *Service) getSettings(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	set, err := loadSettings(r.Context(), s.db.Q, sess.Workspace.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(set))
	return nil
}

var settingsKeys = []string{"seller", "vat_registered", "default_vat_mode", "default_vat_rate", "iban", "bank_name", "currency",
	"language", "default_terms_days", "number_format", "footer", "qr_bill_enabled", "revolut_enabled", "revolut_username", "instalments", "dunning", "logo_file_id", "logo_url", "is_complete", "missing_fields"}

var sellerKeys = []string{"name", "street", "street_number", "apt", "zip", "city", "country", "vat_number", "email", "phone", "electronic_address", "registration_number"}

// putSettings: fields left out keep their value. Seller limits are the QR bill's (SPS 2.3, structured address).
func (s *Service) putSettings(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	var raw json.RawMessage
	if !s.auth.Decode(w, r, &raw) {
		return nil
	}
	body, err := object(raw, "the settings", settingsKeys...)
	if err != nil {
		return err
	}
	var seller map[string]json.RawMessage
	if v, ok := body["seller"]; ok {
		if seller, err = object(v, "seller", sellerKeys...); err != nil {
			return err
		}
	}
	var saved Settings
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockInvoiceSettings(r.Context(), sess.Workspace.ID); err != nil {
			return err
		}
		set, err := loadSettings(r.Context(), q, sess.Workspace.ID)
		if err != nil {
			return err
		}
		currency := set.Currency
		p := newParser()
		sl := &set.Seller
		for _, f := range []struct {
			key  string
			into *string
			max  int
			norm func(string) (string, string)
		}{
			{"name", &sl.Name, 70, nil}, {"street", &sl.Street, 70, nil}, {"street_number", &sl.StreetNumber, 16, nil},
			{"zip", &sl.Zip, 16, nil}, {"city", &sl.City, 35, nil}, {"country", &sl.Country, 2, clients.NormaliseCountry},
		} {
			if v, ok := seller[f.key]; ok {
				*f.into = ""
				if t := p.text("seller."+f.key, v, f.max, f.norm); t != nil {
					*f.into = *t
				}
			}
		}
		for _, f := range []struct {
			key  string
			into **string
			max  int
			norm func(string) (string, string)
		}{
			{"apt", &sl.Apt, 50, nil}, {"vat_number", &sl.VATNumber, 30, clients.NormaliseVATNumber},
			{"email", &sl.Email, 254, clients.NormaliseEmail}, {"phone", &sl.Phone, 30, nil},
			{"registration_number", &sl.RegistrationNumber, 100, nil},
		} {
			if v, ok := seller[f.key]; ok {
				*f.into = p.text("seller."+f.key, v, f.max, f.norm)
			}
		}
		if _, ok := seller["country"]; ok {
			if msg := unsupportedSeller(sl.Country); msg != "" {
				p.fail("seller.country", msg)
			}
		}
		if raw, ok := seller["electronic_address"]; ok {
			address, msg := clients.NormaliseElectronicAddress(raw)
			if msg != "" {
				p.fail("seller.electronic_address", msg)
			} else {
				sl.ElectronicAddress = address
			}
		}
		for _, k := range settingsKeys {
			v, ok := body[k]
			if !ok {
				continue
			}
			switch k {
			case "vat_registered":
				if json.Unmarshal(v, &set.VATRegistered) != nil || isNull(v) {
					p.fail(k, "Choose true or false.")
				}
			case "default_vat_mode":
				set.DefaultVATMode = p.required(k, v, 10, oneOf(invoicecalc.Exclusive, invoicecalc.Inclusive, invoicecalc.None), "Choose a VAT mode.")
			case "default_vat_rate":
				if n, ok := p.decimal(k, v, parsePercent, "Enter a rate from 0 to 100 with at most two decimals."); ok {
					set.DefaultVATRate = invoicecalc.Percent(n)
				}
			case "iban":
				set.IBAN = p.text(k, v, 42, func(v string) (string, string) {
					if iban, ok := swissqr.NormalizeIBAN(v); ok {
						return iban, ""
					}
					return "", "Enter a valid IBAN, such as CH93 0076 2011 6238 5295 7."
				})
			case "bank_name":
				set.BankName = p.text(k, v, 100, nil)
			case "currency":
				set.Currency = p.required(k, v, 3, twoDecimalCurrency, "Choose a currency.")
			case "language":
				set.Language = p.required(k, v, 2, oneOf("de", "fr", "it", "en"), "Choose a language.")
			case "default_terms_days":
				if json.Unmarshal(v, &set.DefaultTermsDays) != nil || set.DefaultTermsDays < 0 || set.DefaultTermsDays > 365 {
					p.fail(k, "Enter a number of days from 0 to 365.")
				}
			case "number_format":
				set.NumberFormat = p.required(k, v, 20, oneOf(numberFormats...), "Choose a number format.")
			case "footer":
				set.Footer = p.text(k, v, 1000, nil)
			case "qr_bill_enabled", "revolut_enabled":
				into := map[string]*bool{"qr_bill_enabled": &set.QRBillEnabled, "revolut_enabled": &set.RevolutEnabled}[k]
				if json.Unmarshal(v, into) != nil || isNull(v) {
					p.fail(k, "Choose true or false.")
				}
			case "revolut_username":
				set.RevolutUsername = p.text(k, v, 100, normaliseRevolut)
			case "instalments":
				if err := parseInstalmentSettings(p, v, &set.Instalments); err != nil {
					return err
				}
			case "dunning":
				if err := parseDunningSettings(p, v, &set.Dunning); err != nil {
					return err
				}
				// logo_file_id, logo_url, is_complete and missing_fields are read-only, accepted so a form can send
				// back what it read; the logo changes through /invoice-settings/logo.
			}
		}
		if _, ok := body["default_vat_mode"]; !ok && body["vat_registered"] != nil { // follow the registration
			switch {
			case !set.VATRegistered:
				set.DefaultVATMode = invoicecalc.None
			case set.DefaultVATMode == invoicecalc.None:
				set.DefaultVATMode = invoicecalc.Exclusive
			}
		}
		if set.DefaultVATMode == invoicecalc.None && set.VATRegistered || set.DefaultVATMode != invoicecalc.None && !set.VATRegistered {
			p.fail("default_vat_mode", "Use no VAT exactly when the seller is not VAT-registered.")
		}
		if set.RevolutEnabled && set.RevolutUsername == nil {
			p.fail("revolut_username", "Enter your revolut.me username to offer Revolut.")
		}
		if set.DefaultVATMode != invoicecalc.None && set.DefaultVATRate == 0 {
			p.fail("default_vat_rate", "Enter the standard rate, such as 8.1.")
		}
		if err := p.err(); err != nil {
			return err
		}
		if set.Currency != currency {
			if locked, err := q.CurrencyLocked(r.Context(), sess.Workspace.ID); err != nil {
				return err
			} else if locked {
				return auth.Error(http.StatusConflict, "currency_locked",
					"The base currency cannot change once an invoice is issued or an expense booked.", nil)
			}
		}
		set.derive()
		saved = set
		return q.PutInvoiceSettings(r.Context(), sess.Workspace.ID, set, s.now())
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(saved))
	return nil
}

// draftPayment sets a draft's payment details as they would be on issue with the current settings.
func draftPayment(inv *store.Invoice, set Settings) {
	inv.Payment = store.InvoicePaymentInfo{IBAN: set.IBAN, ReferenceType: "NON"}
	if !Receivable(inv.Kind) { // no QR bill, reference or Revolut on what the buyer does not pay
		return
	}
	if inv.PaymentMethods.Revolut && set.RevolutEnabled && set.RevolutUsername != nil {
		inv.Payment.RevolutURL = revolutURL(*set.RevolutUsername)
	}
	if set.IBAN == nil {
		return
	}
	inv.Payment.ReferenceType = "SCOR"
	if swissqr.IsQRIBAN(*set.IBAN) {
		inv.Payment.ReferenceType = "QRR"
	}
	inv.Payment.QRBill = inv.PaymentMethods.QRBill && set.QRBillEnabled && qrBill(inv.Currency, *set.IBAN, inv.Payable())
}

// usableMethods keeps of the chosen methods those that can apply, the rule the editor shows: the QR bill when
// enabled, with a Swiss or Liechtenstein IBAN, in one of its qrCurrencies; Revolut when enabled with a username. A choice that
// cannot apply is dropped on every save and on issue, never kept hidden to refuse the issue later.
func usableMethods(m store.PaymentMethods, set Settings, currency string) store.PaymentMethods {
	return store.PaymentMethods{
		QRBill:  m.QRBill && set.QRBillEnabled && set.IBAN != nil && slices.Contains(qrCurrencies(*set.IBAN), currency),
		Revolut: m.Revolut && set.RevolutEnabled && set.RevolutUsername != nil,
	}
}

// defaultMethods: a new invoice offers every method that can apply.
func defaultMethods(set Settings, currency string) store.PaymentMethods {
	return usableMethods(store.PaymentMethods{QRBill: true, Revolut: true}, set, currency)
}

// revolutURL: the plain revolut.me profile link. Revolut documents no amount or currency in the link (amounts are
// set in its app), so the PDF and email print the amount and the reference beside it.
func revolutURL(username string) *string {
	u := "https://revolut.me/" + username
	return &u
}

var revolutUsername = regexp.MustCompile(`^[A-Za-z0-9._-]{3,32}$`)

// normaliseRevolut accepts a username, "@username" or a pasted revolut.me link, and keeps the bare username.
func normaliseRevolut(v string) (string, string) {
	u, _, _ := strings.Cut(v, "?")
	u = strings.TrimSuffix(u, "/")
	for _, prefix := range []string{"https://", "http://", "www.", "revolut.me/", "@"} {
		if len(u) >= len(prefix) && strings.EqualFold(u[:len(prefix)], prefix) {
			u = u[len(prefix):]
		}
	}
	if !revolutUsername.MatchString(u) {
		return "", "Enter your revolut.me username: 3 to 32 letters, digits, dots, dashes or underscores."
	}
	return u, ""
}

// qrBill: a Swiss QR bill exists in qrCurrencies of a Swiss or Liechtenstein account, for an amount above 0.
func qrBill(currency, iban string, payable invoicecalc.Money) bool {
	return slices.Contains(qrCurrencies(iban), currency) && payable > 0
}

// qrCurrencies: what a QR bill to the account may be in. SIX IG 2.4 (§2.8, §4.3.2, from 2026-11-14) allows a
// QR-IBAN with its QR reference in CHF only; EUR needs a normal CH/LI IBAN with an RF reference or none.
func qrCurrencies(iban string) []string {
	switch {
	case swissqr.IsQRIBAN(iban):
		return []string{"CHF"}
	case swissqr.QRBill(iban):
		return []string{"CHF", "EUR"}
	}
	return nil
}

// SellerOf is the workspace's own business as its invoices name it (empty fields until the settings are filled).
func SellerOf(ctx context.Context, q store.Q, workspaceID string) (store.Party, error) {
	s, err := loadSettings(ctx, q, workspaceID)
	return s.Seller.Party, err
}
