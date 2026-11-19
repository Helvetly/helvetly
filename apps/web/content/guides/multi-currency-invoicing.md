---
title: Invoicing clients abroad and in foreign currencies
description: QR bill currencies, invoicing in USD, converting to CHF for VAT, Swiss VAT on services abroad and e-invoices for EU clients.
category: Choosing software
updated: 2026-11-19
readingMinutes: 6
---

A Swiss business may invoice in any currency, but the QR bill accepts only CHF and EUR, so invoices in USD or other currencies need other payment details. For VAT, every foreign-currency amount is converted to CHF at the ESTV's monthly average rate or the daily selling rate, and services to clients abroad are generally invoiced without Swiss VAT.

This guide covers the questions that come up with the first client outside Switzerland. It is general information, not tax advice; for an unusual case, ask the ESTV or your fiduciary.

## Can a Swiss company invoice in a foreign currency?

Yes. Nothing requires a Swiss invoice to be in Swiss francs; you can agree any currency with your client. For VAT, though, you settle with the ESTV in CHF, so each foreign-currency amount must be converted when the VAT becomes due (MWSTV art. 45).

Agree the currency in your quote or contract, and keep it the same on the invoice. Whether an amount counts as foreign currency depends on the currency of the invoice, not the currency the client pays in.

## Which currencies does the Swiss QR bill accept?

The Swiss QR bill accepts only CHF and EUR. An invoice in USD, GBP or any other currency cannot carry a QR bill.

For EUR, version 2.4 of the SIX rules applies from 14 November 2026: a QR bill in EUR uses a normal IBAN with a Creditor Reference or an unstructured message. The QR-IBAN with a QR reference stays available for CHF only. See [the Swiss QR bill](/guides/qr-bill) for the full rules.

## How do you get paid in USD or another currency?

Without a QR bill, put your account details for an international transfer on the invoice, exactly as your bank gives them, and the invoice number as the payment reference. Ask your bank whether your account can receive that currency or converts it to CHF, and what that costs.

Some practical points:

- **Say who pays the fees.** International transfers can lose part of the amount to bank charges; agree in your terms who bears them.
- **Watch the exchange rate risk.** If you invoice USD 5,000 and the franc rises before the client pays, you receive fewer francs. For long projects, consider invoicing in CHF or in parts.
- **Keep the client's details complete.** For VAT, the invoice should make clear who and where the client is ([what a Swiss invoice must contain](/guides/invoice-requirements)).

## How do you convert foreign-currency invoices for the Swiss VAT return?

Convert each foreign-currency amount to CHF at the time the VAT becomes due, using either the ESTV's published monthly average rate or the daily foreign-exchange selling rate. Whichever you choose, keep it for at least one full tax period, for output tax, acquisition tax and input tax alike.

The rules in MWSTV art. 45, as the ESTV explains them:

| Rule                   | What it means                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Monthly average rate   | Published by the ESTV around the 25th of each month and used for the following month       |
| Daily selling rate     | The foreign-exchange selling rate of the day, published by the ESTV on working days        |
| No ESTV rate published | Use the published daily selling rate of a Swiss bank                                       |
| Groups                 | Companies in a group may use the group's internal rate, if every company in the group does |
| Keeping the choice     | At least one tax period; a switch only at the start of a new tax period                    |

Under the agreed basis, the default, VAT is due when you issue the invoice, so the rate of that date or month applies. The same choice applies to your expenses in foreign currencies when you deduct their input tax. See [Swiss VAT, explained](/guides/swiss-vat) for the agreed and received basis.

## Do you charge Swiss VAT to clients abroad?

Usually not for services. Most services are taxed where the client has its seat or place of business (MWSTG art. 8 para. 1), so a service to a client abroad is invoiced without Swiss VAT. This applies, for example, to consulting, advertising, data processing and fiduciary or legal services.

There are exceptions in MWSTG art. 8 para. 2, where the place of supply is somewhere else, for example services connected with real estate (where the property is) and restaurant services (where they are provided). Goods are a separate topic, with customs and proof of export, not covered here.

Two points that catch people out:

- **Foreign fees count towards the threshold.** Turnover abroad counts towards the CHF 100,000 a year that makes you liable for Swiss VAT ([VAT for the self-employed](/guides/vat-for-the-self-employed)).
- **Not registered means no VAT on any invoice.** Anyone who shows VAT on an invoice owes it to the ESTV, registered or not.

Whether your client owes VAT in its own country is decided by that country's rules.

## Do EU clients need e-invoices?

Often, yes. Switzerland has no general obligation to send e-invoices between businesses, but many EU countries do, and their businesses ask foreign suppliers for structured files such as XRechnung, Peppol BIS, Poland's KSeF or Romania's e-Factura.

A PDF with a QR bill is still a valid invoice for a client in Switzerland. For EU clients, read [e-invoicing for Swiss companies](/guides/e-invoicing-for-swiss-companies) to see which rules apply to a Swiss seller and what to prepare.

## How does Helvetly handle foreign currencies?

Helvetly lets you set a currency on each client and each invoice, with a QR bill on invoices in CHF or EUR. Invoices in other currencies have no QR bill and are left out of the VAT return figures, with a warning, so you add their CHF amounts by hand.

In more detail:

- **Currency per client and invoice.** A client's billing defaults set the currency, document language and payment terms; each invoice can change them ([create and issue an invoice](/help/create-and-issue-an-invoice)).
- **Four document languages.** Invoices in German, French, Italian or English.
- **Expenses in foreign currencies** keep the exchange rate, its date and source, and the amount in your base currency.
- **VAT return.** Helvetly prepares the figures from invoices and expenses in CHF and lists the ones in other currencies for you to add ([prepare the Swiss VAT return](/help/swiss-vat-return)); Pro and Business.
- **E-invoices.** XRechnung, Peppol BIS, KSeF and e-Factura XML files for EU clients, on the Business plan ([export an e-invoice](/help/export-an-e-invoice)). Delivery through the networks needs an outside provider.

Choosing software for this? See [how to choose back-office software](/guides/back-office-software-for-small-businesses) and [bexio alternatives in Switzerland](/guides/bexio-alternatives).

## Sources

- [Value Added Tax Ordinance (MWSTV, SR 641.201) – Fedlex](https://www.fedlex.admin.ch/eli/cc/2009/828/de): art. 45
- [Federal Act on Value Added Tax (MWSTG, SR 641.20) – Fedlex](https://www.fedlex.admin.ch/eli/cc/2009/615/en): art. 8, 10, 27
- [Fremdwährungskurse MWST – ESTV](https://www.estv.admin.ch/de/mwst-fremdwaehrungskurse)
- [QR-bill – SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html)
