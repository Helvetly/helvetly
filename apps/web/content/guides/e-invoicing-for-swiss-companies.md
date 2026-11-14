---
title: E-invoicing for Swiss companies selling abroad
description: Why EU customers ask Swiss suppliers for e-invoices, and what XRechnung, ZUGFeRD, Peppol, Poland's KSeF and Romania's e-Factura mean for you.
category: E-invoicing
updated: 2026-11-11
readingMinutes: 8
---

Switzerland has no general obligation to send e-invoices between businesses. Many EU countries do, or will soon. If you sell to customers in Germany, Poland, Romania or other EU countries, sooner or later one of them will write: "We can only accept invoices in XRechnung format" or "Please send your invoice through Peppol."

This guide explains what is behind those requests, which rules actually apply to a Swiss seller, and what you need to prepare.

## What counts as an e-invoice

In the EU, an e-invoice is not a PDF sent by email. It is a **structured file** (XML) that the buyer's software can read and book without anyone typing it in.

The common basis is the European standard **EN 16931**. It defines the content of an invoice (seller, buyer, lines, VAT breakdown, payment details) and allows two XML syntaxes: UBL and UN/CEFACT CII. National formats such as XRechnung, Peppol BIS Billing or Romania's RO_CIUS are rule sets on top of EN 16931. Poland's KSeF uses its own national structure.

## Why your EU customers ask for e-invoices

Most requests come from the customer's own obligations, not yours:

- **Their accounts payable is going digital.** Businesses that must receive and send e-invoices at home want one process for all suppliers, including foreign ones.
- **Public bodies require it.** Public authorities across the EU must accept e-invoices that follow EN 16931, and many, including German federal authorities, accept nothing else.
- **Cross-border reporting is coming.** Under the EU's "VAT in the Digital Age" (ViDA) package, digital reporting based on e-invoices applies to intra-EU B2B transactions from 1 July 2030.

So even where the law does not oblige you, being able to send a valid e-invoice keeps you on the approved supplier list and gets you paid faster.

## Germany: the B2B timeline

Germany introduced mandatory e-invoicing for domestic B2B transactions in stages:

| Date                   | What changes                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1 January 2025         | Every business established in Germany must be able to **receive** e-invoices                                                            |
| Until 31 December 2026 | Senders may still use paper, or other electronic formats with the buyer's consent                                                       |
| 1 January 2027         | Businesses with prior-year total turnover above EUR 800,000 must **send** e-invoices; smaller ones may continue the old way during 2027 |
| 1 January 2028         | All businesses established in Germany must send e-invoices (with legal exceptions, such as small businesses under §19 UStG)             |

The obligation covers supplies **between businesses that are both established in Germany** (registered office, place of management or a fixed establishment). A Swiss company with no establishment in Germany is generally outside it, even if it holds a German VAT number. Your German customers are still free to ask for e-invoices as a condition of doing business, and many do.

For German **public sector** customers it is different: federal authorities have required e-invoices since November 2020, and the states and municipalities have their own rules. These invoices need the buyer's **Leitweg-ID**.

## XRechnung vs ZUGFeRD

Both are accepted as e-invoices in Germany, as long as they meet EN 16931.

|                            | XRechnung                                         | ZUGFeRD                                                         |
| -------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| What it is                 | Pure XML file, German rule set (CIUS) of EN 16931 | Hybrid: a PDF/A-3 with the XML embedded inside                  |
| Syntax                     | UBL or CII                                        | CII                                                             |
| Human-readable             | Only with a viewer                                | Yes, it is a normal PDF too                                     |
| Typical use                | Public sector, larger companies                   | Private B2B, smaller companies                                  |
| Valid e-invoice in Germany | Yes                                               | Only from profile EN 16931 upward; MINIMUM and BASIC WL are not |

ZUGFeRD is technically identical to France's Factur-X. If a German customer just says "e-invoice", ask which format their system reads. When in doubt, XRechnung is the safest answer.

## Peppol BIS Billing

**Peppol** is an international network for exchanging business documents, governed by OpenPeppol. Instead of email, invoices travel between certified **Access Points**: you send to your Access Point, which delivers to the buyer's Access Point, which passes the invoice to the buyer. Each participant is found by a **Peppol participant ID**, often based on a VAT or company number.

**Peppol BIS Billing 3.0** is the invoice format used on the network. It is UBL, and it complies with EN 16931. Many European public bodies and businesses receive invoices only through Peppol, and German XRechnung can also be delivered over it.

To send through Peppol you need an Access Point provider. Creating a valid Peppol BIS file is the first half; delivering it over the network is the second.

## Poland: KSeF

Poland's National e-Invoice System (**KSeF**, Krajowy System e-Faktur) is a central government platform. Invoices are sent to KSeF in the national XML structure **FA(3)**, KSeF assigns each one a number, and the buyer downloads it from there.

| Date                   | What changes                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1 February 2026        | All taxpayers receive invoices through KSeF; the largest businesses (2024 sales above PLN 200 million) also issue them there |
| 1 April 2026           | All other taxpayers must issue invoices in KSeF                                                                              |
| Until 31 December 2026 | Businesses with invoiced sales up to PLN 10,000 per month may still issue outside KSeF                                       |

The obligation applies to taxpayers with a **registered office or a fixed establishment in Poland**. According to the official KSeF FAQ, a foreign seller without either is not obliged to issue invoices in KSeF and may invoice outside it; using KSeF voluntarily is possible. Polish customers may still prefer the KSeF structure, because it fits their bookkeeping.

## Romania: RO e-Factura

Romania runs a central e-invoicing system, **RO e-Factura**, operated by the tax administration (ANAF) and accessed through its online portal (SPV) or API. Invoices follow **RO_CIUS**, the Romanian rule set of EN 16931, in UBL or CII. Since 2024, invoices between businesses established in Romania must go through the system to be valid.

As with Poland, the rules focus on businesses established in the country. If you are registered for VAT in Romania without being established there, ask a Romanian adviser whether and how the system applies to you. Your Romanian customer will in any case need your invoice data in a form it can record.

## What a Swiss seller needs

Whatever the format, the same data decides whether an e-invoice is accepted. Collect it when you set up the customer, not when the first invoice bounces.

| Data                                                  | Where it comes from                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Your Swiss VAT number (CHE-…MWST) and company details | Your own records                                                                        |
| The buyer's VAT ID (e.g. DE…, PL NIP, RO CUI)         | The customer                                                                            |
| Buyer reference or purchase order number              | The customer; XRechnung requires a buyer reference                                      |
| Leitweg-ID                                            | German public sector buyers; used as the buyer reference                                |
| Peppol participant ID                                 | The customer, if it receives through Peppol                                             |
| Preferred format and channel                          | The customer: XRechnung UBL or CII, ZUGFeRD, Peppol, email                              |
| VAT category per line                                 | Your tax adviser: e.g. standard rate (S), reverse charge (AE) or not subject to VAT (O) |
| Bank details and currency                             | Usually an IBAN and EUR                                                                 |

Two practical tips:

- **Validate before you send.** A file that fails the buyer's validation is rejected as if you never sent it, and the payment term does not start.
- **Archive the XML you sent.** The structured file is the original invoice, not the PDF view of it.

## How Helvetly helps

Helvetly exports an issued invoice as XRechnung (UBL or CII), Peppol BIS Billing, Polish KSeF FA(3) or Romanian e-Factura (RO_CIUS) XML, with exemption codes for VAT-exempt lines. The customer's Leitweg-ID is stored on the client and carried into the buyer reference, and each exported file is archived. Delivery over the Peppol network itself needs an Access Point provider.

## Sources

- [E-Rechnung: frequently asked questions – Bundesministerium der Finanzen](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html)
- [XRechnung – xeinkauf.de (KoSIT)](https://xeinkauf.de/xrechnung/)
- [eInvoicing and EN 16931 – European Commission](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/eInvoicing)
- [VAT in the Digital Age (ViDA) – European Commission](https://taxation-customs.ec.europa.eu/taxation/vat/vat-digital-age-vida_en)
- [Peppol BIS Billing 3.0 – OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/)
- [Peppol – OpenPeppol](https://peppol.org/)
- [Zasady obowiązywania KSeF i przepisy prawne – ksef.podatki.gov.pl](https://ksef.podatki.gov.pl/ksef-news/zasady-obowiazywania-ksef-i-przepisy-prawne/)
- [KSeF – Krajowy System e-Faktur](https://ksef.podatki.gov.pl/)
- [RO e-Factura technical information – Romanian Ministry of Finance](https://mfinante.gov.ro/en/web/efactura/informatii-tehnice)
- [ANAF – Agenția Națională de Administrare Fiscală](https://www.anaf.ro/)
