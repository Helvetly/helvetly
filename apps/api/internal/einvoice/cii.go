package einvoice

import (
	"encoding/xml"
	"strings"

	"helvetly.com/api/internal/store"
)

// UN/CEFACT CII D16B elements in schema order; the rsm/ram/udt prefixes are written literally.

type ciiDoc struct {
	XMLName    xml.Name      `xml:"rsm:CrossIndustryInvoice"`
	Rsm        string        `xml:"xmlns:rsm,attr"`
	Ram        string        `xml:"xmlns:ram,attr"`
	Udt        string        `xml:"xmlns:udt,attr"`
	Process    *ciiParam     `xml:"rsm:ExchangedDocumentContext>ram:BusinessProcessSpecifiedDocumentContextParameter"`
	Guideline  string        `xml:"rsm:ExchangedDocumentContext>ram:GuidelineSpecifiedDocumentContextParameter>ram:ID"`
	ID         string        `xml:"rsm:ExchangedDocument>ram:ID"`
	TypeCode   string        `xml:"rsm:ExchangedDocument>ram:TypeCode"`
	IssueDate  ciiDate       `xml:"rsm:ExchangedDocument>ram:IssueDateTime>udt:DateTimeString"`
	Note       *ciiNote      `xml:"rsm:ExchangedDocument>ram:IncludedNote"`
	Lines      []ciiLine     `xml:"rsm:SupplyChainTradeTransaction>ram:IncludedSupplyChainTradeLineItem"`
	Agreement  ciiAgreement  `xml:"rsm:SupplyChainTradeTransaction>ram:ApplicableHeaderTradeAgreement"`
	Delivery   ciiDelivery   `xml:"rsm:SupplyChainTradeTransaction>ram:ApplicableHeaderTradeDelivery"`
	Settlement ciiSettlement `xml:"rsm:SupplyChainTradeTransaction>ram:ApplicableHeaderTradeSettlement"`
}

type ciiDate struct {
	Format string `xml:"format,attr"`
	Value  string `xml:",chardata"`
}

type ciiLine struct {
	ID        string        `xml:"ram:AssociatedDocumentLineDocument>ram:LineID"`
	Name      string        `xml:"ram:SpecifiedTradeProduct>ram:Name"`
	Price     string        `xml:"ram:SpecifiedLineTradeAgreement>ram:NetPriceProductTradePrice>ram:ChargeAmount"`
	PriceBase *ublQuantity  `xml:"ram:SpecifiedLineTradeAgreement>ram:NetPriceProductTradePrice>ram:BasisQuantity"`
	Quantity  ublQuantity   `xml:"ram:SpecifiedLineTradeDelivery>ram:BilledQuantity"`
	Tax       ciiTax        `xml:"ram:SpecifiedLineTradeSettlement>ram:ApplicableTradeTax"`
	Allowance *ciiAllowance `xml:"ram:SpecifiedLineTradeSettlement>ram:SpecifiedTradeAllowanceCharge"`
	Net       string        `xml:"ram:SpecifiedLineTradeSettlement>ram:SpecifiedTradeSettlementLineMonetarySummation>ram:LineTotalAmount"`
}

type ciiTax struct {
	Calculated      string `xml:"ram:CalculatedAmount,omitempty"`
	Type            string `xml:"ram:TypeCode"`
	ExemptionReason string `xml:"ram:ExemptionReason,omitempty"`
	Basis           string `xml:"ram:BasisAmount,omitempty"`
	Category        string `xml:"ram:CategoryCode"`
	ExemptionCode   string `xml:"ram:ExemptionReasonCode,omitempty"`
	Rate            string `xml:"ram:RateApplicablePercent,omitempty"`
}

type ciiAllowance struct {
	Charge   bool    `xml:"ram:ChargeIndicator>udt:Indicator"`
	Amount   string  `xml:"ram:ActualAmount"`
	Reason   string  `xml:"ram:Reason"`
	Category *ciiTax `xml:"ram:CategoryTradeTax"`
}

type ciiAgreement struct {
	BuyerReference string     `xml:"ram:BuyerReference,omitempty"`
	Seller         ciiParty   `xml:"ram:SellerTradeParty"`
	Buyer          ciiParty   `xml:"ram:BuyerTradeParty"`
	Order          *ciiDocRef `xml:"ram:BuyerOrderReferencedDocument"`
}

type ciiParty struct {
	Name     string      `xml:"ram:Name"`
	Legal    *ciiLegal   `xml:"ram:SpecifiedLegalOrganization"`
	Contact  *ciiContact `xml:"ram:DefinedTradeContact"`
	Address  ciiAddress  `xml:"ram:PostalTradeAddress"`
	Endpoint *ciiURI     `xml:"ram:URIUniversalCommunication"`
	VAT      *ciiTaxReg  `xml:"ram:SpecifiedTaxRegistration"`
}

type ciiLegal struct {
	ID string `xml:"ram:ID"`
}

type ciiContact struct {
	Name  string    `xml:"ram:PersonName"`
	Phone *ciiPhone `xml:"ram:TelephoneUniversalCommunication"`
	Email *ciiEmail `xml:"ram:EmailURIUniversalCommunication"`
}

type ciiPhone struct {
	Number string `xml:"ram:CompleteNumber"`
}

type ciiEmail struct {
	ID string `xml:"ram:URIID"`
}

type ciiAddress struct {
	Zip     string `xml:"ram:PostcodeCode"`
	Line1   string `xml:"ram:LineOne"`
	Line2   string `xml:"ram:LineTwo,omitempty"`
	City    string `xml:"ram:CityName"`
	Country string `xml:"ram:CountryID"`
}

type ciiSettlement struct {
	PaymentReference string         `xml:"ram:PaymentReference,omitempty"`
	Currency         string         `xml:"ram:InvoiceCurrencyCode"`
	Means            ciiMeans       `xml:"ram:SpecifiedTradeSettlementPaymentMeans"`
	Taxes            []ciiTax       `xml:"ram:ApplicableTradeTax"`
	Period           *ciiPeriod     `xml:"ram:BillingSpecifiedPeriod"`
	Allowances       []ciiAllowance `xml:"ram:SpecifiedTradeAllowanceCharge"`
	DueDate          *ciiDate       `xml:"ram:SpecifiedTradePaymentTerms>ram:DueDateDateTime>udt:DateTimeString"`
	Sum              ciiSum         `xml:"ram:SpecifiedTradeSettlementHeaderMonetarySummation"`
	Preceding        *ciiDocRef     `xml:"ram:InvoiceReferencedDocument"`
}

type ciiSum struct {
	LineTotal  string    `xml:"ram:LineTotalAmount"`
	Allowances string    `xml:"ram:AllowanceTotalAmount,omitempty"`
	TaxBasis   string    `xml:"ram:TaxBasisTotalAmount"`
	TaxTotal   ublAmount `xml:"ram:TaxTotalAmount"`
	Rounding   string    `xml:"ram:RoundingAmount,omitempty"`
	Grand      string    `xml:"ram:GrandTotalAmount"`
	Due        string    `xml:"ram:DuePayableAmount"`
}

// CII renders the XRechnung CII syntax; a credit note keeps the same structure with type 381 and positive amounts.
// XRechnung needs the seller contact's phone and email (ErrSellerContact).
func CII(inv store.Invoice) ([]byte, error) { return cii(inv, false) }

// FacturXML is the same CII invoice in the Factur-X / ZUGFeRD EN 16931 profile: the plain EN 16931 core, without
// XRechnung's national rules or Peppol's process identifier.
func FacturXML(inv store.Invoice) ([]byte, error) { return cii(inv, true) }

func cii(inv store.Invoice, facturX bool) ([]byte, error) {
	d, err := build(inv)
	if err != nil {
		return nil, err
	}
	sc, err := d.sellerContact(!facturX)
	if err != nil {
		return nil, err
	}
	c := ciiDoc{
		Rsm:     "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
		Ram:     "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
		Udt:     "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
		Process: &ciiParam{peppolProcess}, Guideline: xrechnungID,
		ID: deref(inv.Number), TypeCode: d.typeCode, IssueDate: date102(inv.IssueDate),
		Agreement: ciiAgreement{BuyerReference: d.buyerReference(), Seller: ciiPartyOf(d.xmlParty(*inv.Seller)),
			Buyer: ciiPartyOf(d.xmlParty(*inv.Buyer))},
		Settlement: ciiSettlement{Currency: inv.Currency, Means: ciiMeans{Code: "1"}, DueDate: ptr(date102(inv.DueDate)),
			Sum: ciiSum{LineTotal: d.lineTotal.String(), TaxBasis: inv.NetTotal.String(),
				TaxTotal: ublAmount{inv.Currency, inv.VATTotal.String()}, Grand: inv.Total.String(), Due: inv.Payable().String()}},
	}
	if facturX { // BT-10 is optional in EN 16931: no "n/a" stand-in as XRechnung needs
		c.Process, c.Guideline, c.Agreement.BuyerReference = nil, en16931ID, deref(inv.Reference)
	}
	if sc != nil { // a partial contact (EN 16931 only) leaves out what is missing rather than writing it empty
		contact := &ciiContact{Name: inv.Seller.Name}
		if sc.Phone != "" {
			contact.Phone = &ciiPhone{sc.Phone}
		}
		if sc.Email != "" {
			contact.Email = &ciiEmail{sc.Email}
		}
		c.Agreement.Seller.Contact = contact
	}
	if n := d.note(); n != "" {
		c.Note = &ciiNote{n}
	}
	if inv.ServiceDate != nil {
		c.Delivery.Event = &ciiEvent{date102(*inv.ServiceDate)}
	}
	if start, end, ok := d.period(); ok {
		c.Settlement.Period = &ciiPeriod{date102(start), date102(end)}
	}
	if inv.CreditedInvoice != nil {
		c.Settlement.Preceding = &ciiDocRef{inv.CreditedInvoice.Number}
	}
	if inv.Reference != nil {
		c.Agreement.Order = &ciiDocRef{*inv.Reference}
	}
	if !d.creditNote() && inv.Payment.IBAN != nil {
		c.Settlement.Means = ciiMeans{"58", &ciiAccount{iban(inv.Payment.IBAN)}}
		c.Settlement.PaymentReference = deref(inv.Payment.Reference)
	}
	for _, g := range d.groups {
		c.Settlement.Taxes = append(c.Settlement.Taxes, ciiTax{Calculated: g.VATAmount.String(), Type: "VAT",
			ExemptionReason: g.reason, Basis: g.TaxableAmount.String(), Category: g.Category, ExemptionCode: g.code,
			Rate: g.Rate.String()})
	}
	for _, a := range d.allowances {
		c.Settlement.Allowances = append(c.Settlement.Allowances, ciiAllowance{Amount: a.amount.String(), Reason: a.reason,
			Category: &ciiTax{Type: "VAT", Category: a.category, Rate: percent(a.category, a.rate)}})
	}
	if d.allowTotal != 0 {
		c.Settlement.Sum.Allowances = d.allowTotal.String()
	}
	if inv.RoundingAmount != 0 {
		c.Settlement.Sum.Rounding = inv.RoundingAmount.String()
	}
	for _, l := range d.lines {
		cl := ciiLine{ID: l.id, Name: l.name, Price: l.price.String(), Quantity: ublQuantity{l.unitCode, l.qty.String()},
			Tax: ciiTax{Type: "VAT", Category: l.category, Rate: percent(l.category, l.rate)}, Net: l.net.String()}
		if l.priceBase != 0 {
			cl.PriceBase = &ublQuantity{l.unitCode, l.priceBase.String()}
		}
		if l.allowance != 0 {
			cl.Allowance = &ciiAllowance{Amount: l.allowance.String(), Reason: "Discount"}
		}
		c.Lines = append(c.Lines, cl)
	}
	return marshal(c)
}

func ciiPartyOf(p store.Party) ciiParty {
	cp := ciiParty{Name: p.Name,
		Address: ciiAddress{Zip: p.Zip, Line1: street(p), Line2: deref(p.Apt), City: p.City, Country: p.Country}}
	if p.RegistrationNumber != nil {
		cp.Legal = &ciiLegal{*p.RegistrationNumber}
	}
	if p.ElectronicAddress != nil {
		cp.Endpoint = &ciiURI{schemeID{p.ElectronicAddress.Scheme, p.ElectronicAddress.ID}}
	} else if p.Email != nil {
		cp.Endpoint = &ciiURI{schemeID{"EM", *p.Email}}
	}
	if p.VATNumber != nil {
		cp.VAT = &ciiTaxReg{schemeID{"VA", *p.VATNumber}}
	}
	return cp
}

// date102 is a civil date in UNTDID 2379 format 102 (CCYYMMDD).
func date102(d string) ciiDate { return ciiDate{"102", strings.ReplaceAll(d, "-", "")} }

type ciiParam struct {
	ID string `xml:"ram:ID"`
}

type ciiNote struct {
	Content string `xml:"ram:Content"`
}

type ciiDelivery struct {
	Event *ciiEvent `xml:"ram:ActualDeliverySupplyChainEvent"`
}

type ciiEvent struct {
	Date ciiDate `xml:"ram:OccurrenceDateTime>udt:DateTimeString"` // BT-72
}

type ciiPeriod struct {
	Start ciiDate `xml:"ram:StartDateTime>udt:DateTimeString"`
	End   ciiDate `xml:"ram:EndDateTime>udt:DateTimeString"`
}

type ciiDocRef struct {
	ID string `xml:"ram:IssuerAssignedID"`
}

type ciiURI struct {
	ID schemeID `xml:"ram:URIID"`
}

type ciiTaxReg struct {
	ID schemeID `xml:"ram:ID"`
}

type ciiMeans struct {
	Code    string      `xml:"ram:TypeCode"`
	Account *ciiAccount `xml:"ram:PayeePartyCreditorFinancialAccount"`
}

type ciiAccount struct {
	IBAN string `xml:"ram:IBANID"`
}
