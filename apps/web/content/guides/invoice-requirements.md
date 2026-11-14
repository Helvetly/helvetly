---
title: What a Swiss invoice must contain
description: The details a Swiss VAT invoice needs under MWSTG art. 26, QR bill basics, languages, credit notes, corrections and how long to keep invoices.
category: Getting paid
updated: 2026-11-11
readingMinutes: 7
---

Swiss law has no single "invoice law". What an invoice must contain follows mainly from the VAT Act, because your client needs a correct invoice to deduct the VAT you charge. Add the QR bill, which is how most Swiss invoices get paid, and the bookkeeping rules on keeping records, and you have the full picture.

## The required details (MWSTG art. 26)

If you are registered for VAT, your client can ask you for an invoice that clearly identifies you, them and what you supplied. As a rule, it contains:

| #   | Detail                                                           | Example                                      |
| --- | ---------------------------------------------------------------- | -------------------------------------------- |
| 1   | Your name and place, as you appear in business                   | Muster Consulting, Bern                      |
| 2   | A note that you are VAT-registered, with your VAT number         | CHE-123.456.789 MWST                         |
| 3   | The client's name and place, as they appear in business          | Beispiel AG, Zürich                          |
| 4   | Date or period of the supply, if different from the invoice date | Work done in October 2026                    |
| 5   | Type, subject and scope of the supply                            | 32 hours of IT consulting, project "New CRM" |
| 6   | The price (consideration)                                        | CHF 5,200.00                                 |
| 7   | The VAT rate and the VAT amount                                  | 8.1 % VAT, CHF 421.20                        |

A few practical points:

- **Prices including VAT.** If your price already includes VAT, the rate alone is enough ("incl. 8.1 % VAT"), but showing the amount helps your client.
- **Several rates.** If one invoice contains supplies at different rates, for example books at 2.6 % and consulting at 8.1 %, show each rate with the amounts it applies to.
- **Trade names count.** The name you use in business, such as a shop name, is acceptable as long as you can be clearly identified.
- **Till receipts up to CHF 400.** Receipts from cash registers for up to CHF 400 including VAT need no details about the buyer.
- **Paper, PDF and e-invoice are equal.** For VAT purposes, a PDF or a structured e-invoice counts the same as a paper invoice.
- **Not registered?** Then you must **not** show VAT at all. Anyone who shows VAT on an invoice owes that amount to the ESTV, registered or not.

Not required by law but expected in practice: an invoice number, an invoice date, payment terms and a due date. The due date matters later: once it has passed, the client is in default and you can charge 5 % default interest under the Code of Obligations (OR art. 104).

## QR bill basics

Since October 2022 the QR bill is the only Swiss payment slip. It is the perforated payment part at the bottom of an invoice (or a separate page), with a Swiss QR code that the payer scans in e-banking. The full rules are in our guide to [the Swiss QR bill](/guides/qr-bill); for the invoice itself, the key choice is which account and reference you use.

| Account         | Reference                                                  | When to use                                                            |
| --------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| **QR-IBAN**     | **QR reference** (27 digits, with a check digit)           | Automatic matching of payments; your bank gives you a separate QR-IBAN |
| **Normal IBAN** | **Creditor Reference** (SCOR, ISO 11649, starts with "RF") | Automatic matching with your normal account; also used internationally |
| **Normal IBAN** | No reference, only a free-text message                     | Small volumes, where you match payments by hand                        |

The combinations are fixed: a QR-IBAN always needs a QR reference, and a QR reference only works with a QR-IBAN. A QR-IBAN looks like a normal IBAN, but the institution identifier (digits 5 to 9) is in the range 30000 to 31999.

Two recent changes matter:

- **Structured addresses only.** Since November 2025, the creditor's and debtor's addresses in the QR code must be structured (street, number, postcode and town in separate fields). Software that still creates the old combined address type produces bills that banks may reject.
- **Euro bills from 14 November 2026.** Under version 2.4 of the SIX rules, a QR bill in EUR can only use a normal IBAN, with a Creditor Reference or with an unstructured message. The QR-IBAN with QR reference remains available for CHF.

## Languages

The VAT Act does not prescribe a language for invoices. Use one your client understands; in practice most Swiss invoices are written in German, French, Italian or English. The payment part of the QR bill has fixed headings ("Payment part", "Account / Payable to", and so on), which must be printed in one of the languages the SIX guidelines allow: German, French, Italian or English, and since January 2026 also Romansh. The headings can be in a different language from the rest of the invoice, but use one language throughout the payment part and receipt.

## Credit notes and corrections

**Credit notes in the self-billing sense.** In Switzerland, "Gutschrift" often means an invoice issued by the **client** instead of the supplier (self-billing), common for commissions and royalties. For VAT this counts as an invoice. It must name the supplier with all required details, and stating the supplier's VAT number is recommended.

**Credit notes that reduce an invoice.** If the price changes afterwards, through a discount, a return or a partial refund, issue a credit note that refers to the original invoice and shows the reduction and the VAT on it. You adjust your VAT in the period in which you book the correction, and the client reduces their input tax accordingly.

**Correcting errors.** Do not edit or reissue an invoice that has already been sent under the same number. Instead:

- For a **VAT amount that was too high or should not have been shown**, send the client a document that refers to the original invoice and cancels it. Until you do, you owe the VAT shown.
- For **VAT forgotten**, a **rate that was too low** or a **changed price**, send an additional document that refers to the original invoice and either cancels or supplements it.

The cleanest way in practice is a credit note for the full original amount followed by a new, correct invoice.

## How long to keep invoices

| Rule                              | Retention                                                                     | Applies to                                                 |
| --------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Code of Obligations, OR art. 958f | **10 years**, counted from the end of the business year                       | Accounting records, including issued and received invoices |
| VAT Act, MWSTG art. 70            | Until the VAT claim is time-barred, at most **10 years** after the tax period | VAT-registered businesses                                  |
| VAT Act, MWSTG art. 70 para. 3    | **20 years** (the ESTV's guidance says 26)                                    | Records about real estate used in the business             |

You can keep invoices on paper or electronically, as long as the files cannot be changed without this being visible and they can be read for the whole period. A scanned or PDF invoice can replace the paper original if these conditions are met.

## How Helvetly helps

Helvetly issues invoices with every detail listed in MWSTG art. 26 and a QR bill with a QR reference or a Creditor Reference and structured addresses. Automatic reminders follow overdue invoices and can add OR 104 default interest. For clients abroad, it can also export XRechnung, Peppol BIS, KSeF and e-Factura e-invoices.

## Sources

- [Federal Act on Value Added Tax (MWSTG, SR 641.20) – Fedlex](https://www.fedlex.admin.ch/eli/cc/2009/615/en): art. 26, 27, 41, 70
- [Value Added Tax Ordinance (MWSTV, SR 641.201) – Fedlex](https://www.fedlex.admin.ch/eli/cc/2009/828/de): art. 57
- [Swiss Code of Obligations (OR, SR 220) – Fedlex](https://www.fedlex.admin.ch/eli/cc/27/317_321_377/en): art. 104, 958f
- [QR-bill – SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html)
- [Swiss Implementation Guidelines for the QR-bill, version 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf)
- [Swiss VAT rates – ESTV](https://www.estv.admin.ch/en/vat-rates-switzerland)
