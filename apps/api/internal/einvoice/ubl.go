package einvoice

import (
	"encoding/xml"
	"fmt"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// UBL 2.1 elements in schema order; the cac/cbc prefixes are written literally and declared on the root.

type ublAmount struct {
	Currency string `xml:"currencyID,attr"`
	Value    string `xml:",chardata"`
}

type ublQuantity struct {
	Unit  string `xml:"unitCode,attr"`
	Value string `xml:",chardata"`
}

type schemeID struct {
	Scheme string `xml:"schemeID,attr,omitempty"`
	Value  string `xml:",chardata"`
}

type ublDoc struct {
	XMLName            xml.Name
	Xmlns              string           `xml:"xmlns,attr"`
	Cac                string           `xml:"xmlns:cac,attr"`
	Cbc                string           `xml:"xmlns:cbc,attr"`
	CustomizationID    string           `xml:"cbc:CustomizationID"`
	ProfileID          string           `xml:"cbc:ProfileID"`
	ID                 string           `xml:"cbc:ID"`
	IssueDate          string           `xml:"cbc:IssueDate"`
	DueDate            string           `xml:"cbc:DueDate,omitempty"`
	InvoiceTypeCode    string           `xml:"cbc:InvoiceTypeCode,omitempty"`
	CreditNoteTypeCode string           `xml:"cbc:CreditNoteTypeCode,omitempty"`
	Note               string           `xml:"cbc:Note,omitempty"`
	Currency           string           `xml:"cbc:DocumentCurrencyCode"`
	TaxCurrency        string           `xml:"cbc:TaxCurrencyCode,omitempty"` // BT-6
	BuyerReference     string           `xml:"cbc:BuyerReference"`
	InvoicePeriod      *ublPeriod       `xml:"cac:InvoicePeriod"`
	OrderReference     *ublID           `xml:"cac:OrderReference"`
	BillingReference   *ublBillingRef   `xml:"cac:BillingReference"`
	Supplier           ublParty         `xml:"cac:AccountingSupplierParty>cac:Party"`
	Customer           ublParty         `xml:"cac:AccountingCustomerParty>cac:Party"`
	Delivery           *ublDelivery     `xml:"cac:Delivery"`
	PaymentMeans       ublPaymentMeans  `xml:"cac:PaymentMeans"`
	Allowances         []ublAllowance   `xml:"cac:AllowanceCharge"`
	TaxTotals          []ublTaxTotal    `xml:"cac:TaxTotal"` // the second, without subtotals, is BT-111
	Totals             ublMonetaryTotal `xml:"cac:LegalMonetaryTotal"`
	InvoiceLines       []ublLine        `xml:"cac:InvoiceLine"`
	CreditNoteLines    []ublLine        `xml:"cac:CreditNoteLine"`
}

type ublParty struct {
	Endpoint  *schemeID    `xml:"cbc:EndpointID"`
	Name      string       `xml:"cac:PartyName>cbc:Name"`
	Address   ublAddress   `xml:"cac:PostalAddress"`
	TaxScheme *ublPartyTax `xml:"cac:PartyTaxScheme"`
	Legal     ublLegal     `xml:"cac:PartyLegalEntity"`
	Contact   *ublContact  `xml:"cac:Contact"`
}

type ublLegal struct {
	Name         string `xml:"cbc:RegistrationName"`
	Registration string `xml:"cbc:CompanyID,omitempty"`
}

type ublAddress struct {
	Street     string `xml:"cbc:StreetName"`
	Additional string `xml:"cbc:AdditionalStreetName,omitempty"`
	City       string `xml:"cbc:CityName"`
	Zip        string `xml:"cbc:PostalZone"`
	Region     string `xml:"cbc:CountrySubentity,omitempty"` // BT-39, BT-54
	Country    string `xml:"cac:Country>cbc:IdentificationCode"`
}

type ublContact struct {
	Name  string `xml:"cbc:Name"`
	Phone string `xml:"cbc:Telephone,omitempty"`
	Email string `xml:"cbc:ElectronicMail,omitempty"`
}

type ublPaymentMeans struct {
	Code      string `xml:"cbc:PaymentMeansCode"`
	DueDate   string `xml:"cbc:PaymentDueDate,omitempty"` // BT-9 of a credit note, which has no root DueDate
	PaymentID string `xml:"cbc:PaymentID,omitempty"`
	Account   *ublID `xml:"cac:PayeeFinancialAccount"`
}

type ublTaxCategory struct {
	ID              string `xml:"cbc:ID"`
	Percent         string `xml:"cbc:Percent,omitempty"`
	ExemptionCode   string `xml:"cbc:TaxExemptionReasonCode,omitempty"`
	ExemptionReason string `xml:"cbc:TaxExemptionReason,omitempty"`
	Scheme          string `xml:"cac:TaxScheme>cbc:ID"`
}

type ublAllowance struct {
	Charge   bool            `xml:"cbc:ChargeIndicator"`
	Reason   string          `xml:"cbc:AllowanceChargeReason"`
	Amount   ublAmount       `xml:"cbc:Amount"`
	Category *ublTaxCategory `xml:"cac:TaxCategory"`
}

type ublTaxTotal struct {
	Amount    ublAmount        `xml:"cbc:TaxAmount"`
	Subtotals []ublTaxSubtotal `xml:"cac:TaxSubtotal"`
}

type ublTaxSubtotal struct {
	Taxable  ublAmount      `xml:"cbc:TaxableAmount"`
	Amount   ublAmount      `xml:"cbc:TaxAmount"`
	Category ublTaxCategory `xml:"cac:TaxCategory"`
}

type ublMonetaryTotal struct {
	LineExtension ublAmount  `xml:"cbc:LineExtensionAmount"`
	TaxExclusive  ublAmount  `xml:"cbc:TaxExclusiveAmount"`
	TaxInclusive  ublAmount  `xml:"cbc:TaxInclusiveAmount"`
	Allowances    *ublAmount `xml:"cbc:AllowanceTotalAmount"`
	Rounding      *ublAmount `xml:"cbc:PayableRoundingAmount"`
	Payable       ublAmount  `xml:"cbc:PayableAmount"`
}

type ublLine struct {
	ID               string         `xml:"cbc:ID"`
	InvoicedQuantity *ublQuantity   `xml:"cbc:InvoicedQuantity"`
	CreditedQuantity *ublQuantity   `xml:"cbc:CreditedQuantity"`
	Net              ublAmount      `xml:"cbc:LineExtensionAmount"`
	Allowance        *ublAllowance  `xml:"cac:AllowanceCharge"`
	Description      string         `xml:"cac:Item>cbc:Description,omitempty"`
	Name             string         `xml:"cac:Item>cbc:Name"`
	Category         ublTaxCategory `xml:"cac:Item>cac:ClassifiedTaxCategory"`
	Price            ublAmount      `xml:"cac:Price>cbc:PriceAmount"`
	PriceBase        *ublQuantity   `xml:"cac:Price>cbc:BaseQuantity"`
}

// UBL renders an Invoice, or a CreditNote for a credit note, for profile "xrechnung", "peppol" or "ro_cius";
// xrechnung needs the seller contact's phone and email (ErrSellerContact).
// Peppol requires explicit electronic addresses for both parties; CIUS-RO what roCheck lists (*ROError).
func UBL(inv store.Invoice, profile string) ([]byte, error) {
	customization, ok := map[string]string{"xrechnung": xrechnungID, "peppol": peppolID, "ro_cius": roCIUSID}[profile]
	if !ok {
		return nil, fmt.Errorf("einvoice: unknown UBL profile %q", profile)
	}
	d, err := build(inv)
	if err != nil {
		return nil, err
	}
	if profile == "peppol" {
		if err := d.requireEndpoints(); err != nil {
			return nil, err
		}
	}
	ro := profile == "ro_cius"
	if ro {
		if err := roCheck(d); err != nil {
			return nil, err
		}
	}
	sc, err := d.sellerContact(profile == "xrechnung")
	if err != nil {
		return nil, err
	}
	cur := inv.Currency
	amt := func(m invoicecalc.Money) ublAmount { return ublAmount{cur, m.String()} }
	u := ublDoc{
		Cac:             "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
		Cbc:             "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
		CustomizationID: customization, ProfileID: peppolProcess,
		ID: deref(inv.Number), IssueDate: inv.IssueDate, Currency: cur,
		Note: d.note(), BuyerReference: d.buyerReference(),
		Supplier: ublPartyOf(d.xmlParty(*inv.Seller)), Customer: ublPartyOf(d.xmlParty(*inv.Buyer)),
		PaymentMeans: ublPaymentMeans{Code: "1"},
		TaxTotals:    []ublTaxTotal{{Amount: amt(inv.VATTotal)}},
		Totals: ublMonetaryTotal{LineExtension: amt(d.lineTotal), TaxExclusive: amt(inv.NetTotal),
			TaxInclusive: amt(inv.Total), Payable: amt(inv.Payable())},
	}
	if ro && cur != "RON" {
		vat, err := ronVAT(inv.VATTotal, *inv.TaxCurrencyRate)
		if err != nil {
			return nil, err
		}
		u.TaxCurrency = "RON"
		u.TaxTotals = append(u.TaxTotals, ublTaxTotal{Amount: ublAmount{"RON", vat.String()}})
	}
	if ro {
		for _, p := range []*ublParty{&u.Supplier, &u.Customer} {
			if sector, ok := roSector(p.Address.City); ok && p.Address.Region == "RO-B" {
				p.Address.City = sector
			}
		}
	}
	if sc != nil {
		u.Supplier.Contact = &ublContact{Name: inv.Seller.Name, Phone: sc.Phone, Email: sc.Email}
	}
	if start, end, ok := d.period(); ok {
		u.InvoicePeriod = &ublPeriod{start, end}
	}
	if inv.ServiceDate != nil {
		u.Delivery = &ublDelivery{*inv.ServiceDate}
	}
	if inv.CreditedInvoice != nil {
		u.BillingReference = &ublBillingRef{ublID{inv.CreditedInvoice.Number}}
	}
	if inv.Reference != nil {
		u.OrderReference = &ublID{*inv.Reference}
	}
	if d.creditNote() {
		u.XMLName.Local, u.Xmlns, u.CreditNoteTypeCode = "CreditNote", "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2", d.typeCode
		u.PaymentMeans.DueDate = inv.DueDate
	} else {
		u.XMLName.Local, u.Xmlns, u.InvoiceTypeCode = "Invoice", "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2", d.typeCode
		u.DueDate = inv.DueDate
		if inv.Payment.IBAN != nil {
			u.PaymentMeans = ublPaymentMeans{Code: "58", PaymentID: deref(inv.Payment.Reference), Account: &ublID{iban(inv.Payment.IBAN)}}
		}
	}
	for _, a := range d.allowances {
		u.Allowances = append(u.Allowances, ublAllowance{Reason: a.reason, Amount: amt(a.amount),
			Category: &ublTaxCategory{ID: a.category, Percent: percent(a.category, a.rate), Scheme: "VAT"}})
	}
	for _, g := range d.groups {
		u.TaxTotals[0].Subtotals = append(u.TaxTotals[0].Subtotals, ublTaxSubtotal{Taxable: amt(g.TaxableAmount), Amount: amt(g.VATAmount),
			Category: ublTaxCategory{ID: g.Category, Percent: g.Rate.String(), ExemptionCode: g.code,
				ExemptionReason: g.reason, Scheme: "VAT"}})
	}
	if d.allowTotal != 0 {
		u.Totals.Allowances = ptr(amt(d.allowTotal))
	}
	if inv.RoundingAmount != 0 {
		u.Totals.Rounding = ptr(amt(inv.RoundingAmount))
	}
	for _, l := range d.lines {
		ul := ublLine{ID: l.id, Net: amt(l.net), Name: l.name, Price: amt(l.price),
			Category: ublTaxCategory{ID: l.category, Percent: percent(l.category, l.rate), Scheme: "VAT"}}
		if ro {
			ul.Name, ul.Description = roItem(l.name)
		}
		q := &ublQuantity{l.unitCode, l.qty.String()}
		if l.priceBase != 0 {
			ul.PriceBase = &ublQuantity{l.unitCode, l.priceBase.String()}
		}
		if l.allowance != 0 {
			ul.Allowance = &ublAllowance{Reason: "Discount", Amount: amt(l.allowance)}
		}
		if d.creditNote() {
			ul.CreditedQuantity = q
			u.CreditNoteLines = append(u.CreditNoteLines, ul)
		} else {
			ul.InvoicedQuantity = q
			u.InvoiceLines = append(u.InvoiceLines, ul)
		}
	}
	return marshal(u)
}

// Explicit electronic addresses take precedence; email is only an XRechnung fallback.
func ublPartyOf(p store.Party) ublParty {
	up := ublParty{Name: p.Name, Legal: ublLegal{p.Name, deref(p.RegistrationNumber)},
		Address: ublAddress{Street: street(p), Additional: deref(p.Apt), City: p.City, Zip: p.Zip, Region: deref(p.Region),
			Country: p.Country}}
	if p.ElectronicAddress != nil {
		up.Endpoint = &schemeID{p.ElectronicAddress.Scheme, p.ElectronicAddress.ID}
	} else if p.Email != nil {
		up.Endpoint = &schemeID{"EM", *p.Email}
	}
	if p.VATNumber != nil {
		up.TaxScheme = &ublPartyTax{*p.VATNumber, "VAT"}
	}
	return up
}

func marshal(v any) ([]byte, error) {
	out, err := xml.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("einvoice: %w", err)
	}
	return append([]byte(xml.Header), append(out, '\n')...), nil
}

func ptr[T any](v T) *T { return &v }

type ublID struct {
	ID string `xml:"cbc:ID"`
}

type ublBillingRef struct {
	Invoice ublID `xml:"cac:InvoiceDocumentReference"`
}

type ublPeriod struct {
	Start string `xml:"cbc:StartDate"`
	End   string `xml:"cbc:EndDate"`
}

type ublDelivery struct {
	Date string `xml:"cbc:ActualDeliveryDate"` // BT-72
}

type ublPartyTax struct {
	CompanyID string `xml:"cbc:CompanyID"`
	Scheme    string `xml:"cac:TaxScheme>cbc:ID"`
}
