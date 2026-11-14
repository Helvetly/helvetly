---
title: The Swiss QR bill
description: What the Swiss QR bill is, which IBAN and reference to use, how the payment part is laid out, and the mistakes that get bills rejected.
category: Getting paid
updated: 2026-11-11
readingMinutes: 7
---

The QR bill is the standard Swiss payment slip. It replaced the orange and red inpayment slips, which banks stopped processing on 30 September 2022. If you send invoices to customers in Switzerland, your customers expect one: they scan the code in their banking app and every field is filled in for them.

The rules are set by SIX in the Swiss Implementation Guidelines for the QR-bill. This guide explains what matters for a small business.

## What a QR bill contains

A QR bill is a strip at the bottom of the invoice (or on a separate page) with two parts:

| Part         | Size                       | Purpose                                                    |
| ------------ | -------------------------- | ---------------------------------------------------------- |
| Receipt      | 62 × 105 mm, on the left   | Kept by the payer for their records                        |
| Payment part | 148 × 105 mm, on the right | Holds the Swiss QR Code and the same data in readable text |

Together they are 210 × 105 mm, the bottom third of an A4 page.

The **Swiss QR Code** is 46 × 46 mm with a Swiss cross in the middle. It contains all payment data: your account, your name and address, the amount and currency, the payer's name and address, a reference and an optional message. The text fields next to the code repeat that data so a person can check it, or pay at a post office counter.

Key data limits:

- **Currency:** CHF or EUR only.
- **Amount:** up to 999,999,999.99, or left empty so the payer fills it in.
- **Additional information:** up to 140 characters in total for the unstructured message and the structured billing information.
- **Alternative procedures:** up to two entries, for example eBill.

## QR-IBAN or IBAN: choosing the reference

The most important decision is which account and reference type to use. There are three combinations:

| Account     | Reference                                              | When to use it                                                            |
| ----------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| QR-IBAN     | QR reference (QRR), 27 digits                          | You want automatic matching of payments, and your bank gave you a QR-IBAN |
| Normal IBAN | Creditor Reference (SCOR), ISO 11649, starts with "RF" | You want automatic matching but use a normal account                      |
| Normal IBAN | No reference (NON)                                     | Simple cases, low volume; matching is done by hand                        |

How to tell them apart:

- A **QR-IBAN** looks like a normal Swiss IBAN, but the bank identifier (positions 5 to 9) is in the range 30000 to 31999. Your bank issues it for the same account as your normal IBAN.
- A **QR reference** is 27 digits. The last digit is a check digit (modulo 10, recursive), so typos are caught.
- A **Creditor Reference** starts with "RF", followed by two check digits and up to 21 characters of your own.

The rule that causes most rejections: **a QR-IBAN always needs a QR reference, and a QR reference only works with a QR-IBAN.** A normal IBAN takes a Creditor Reference or no reference.

With a reference, your bank reports each payment with that reference in its electronic statement (camt.054 or camt.053), so your accounting software can mark the right invoice as paid without manual work.

## Addresses: structured only

Since the SIX guidelines version 2.3 took effect in November 2025, the QR code accepts only **structured addresses** (address type "S"). Street, building number, postcode, town and country each go in their own field. The older combined address type ("K"), where street and town were free text lines, is no longer allowed. The same version also allows the extended character set of the Swiss Payment Standards.

If your invoicing tool or your customer records still store addresses as free text lines, fix that first. It is the most common reason a QR bill made with older software no longer scans.

## Layout of the payment part

The guidelines fix the layout so that every bill looks the same:

- Title "Payment part" at the top left, the QR code below it.
- Currency and amount below the code.
- To the right: Account / Payable to, Reference, Additional information, Payable by.
- If the amount or payer is left open, a corner-marked empty box is printed instead.
- Fonts: Arial, Frutiger, Helvetica or Liberation Sans, black on white. Headings are bold.
- The receipt shows the same account, reference, payer and amount, plus "Acceptance point".

Labels must be in one of the languages the guidelines allow: German, French, Italian or English.

## The scissors line

The receipt and payment part are meant to be torn off and paid separately. How to mark that depends on the medium:

- **Printed on paper:** the separation lines between the invoice and the QR bill, and between the receipt and the payment part, must be perforated.
- **Sent as PDF:** the same lines are drawn as solid or dashed lines, with a scissors symbol or the text "Separate before paying in" above the line.

## Common errors

| Error                                         | What happens                   | Fix                                                       |
| --------------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| QR-IBAN with a SCOR or no reference           | Payment rejected by the bank   | Use a QR reference, or switch to your normal IBAN         |
| Normal IBAN with a QR reference               | Payment rejected               | Use SCOR or no reference                                  |
| Unstructured address (type K)                 | Code no longer valid           | Store street, number, postcode and town separately        |
| Wrong check digit in the reference            | Code rejected by scanning apps | Generate references in software, never by hand            |
| QR code scaled down or printed blurry         | Code does not scan             | Print it at the full 46 × 46 mm, sharp                    |
| Currency other than CHF or EUR                | Not allowed                    | Invoice in CHF or EUR when you want a QR bill             |
| Sender details differ from the account holder | Payments delayed or queried    | Use the exact name and address registered for the account |

Test a few bills with your own banking app before you send the first batch, and once again after any software update.

## eBill vs QR bill

eBill is the Swiss electronic bill service run by SIX. The bill arrives directly in the customer's e-banking, and the customer approves it with one click. There is no PDF to download and no code to scan.

|                    | QR bill                                | eBill                                         |
| ------------------ | -------------------------------------- | --------------------------------------------- |
| Delivery           | Paper or PDF, by post or email         | Inside the payer's e-banking                  |
| Payer action       | Scan the code, confirm                 | Approve in e-banking                          |
| Who can receive it | Anyone                                 | Payers registered for eBill with your company |
| Setup for you      | A bank account (and a QR-IBAN for QRR) | A contract with an eBill network partner      |

They are complementary. Many companies offer eBill to customers who registered for it and send a QR bill to everyone else. A QR bill can also announce that eBill is available through its alternative procedures field.

## How Helvetly helps

Helvetly puts a QR bill on every invoice in CHF or EUR, with a QR reference for a QR-IBAN or a Creditor Reference for a normal IBAN, and structured addresses. Reminders and instalment plans carry their own QR bill: one for the outstanding total on each reminder, and one with its own reference for each instalment.

## Sources

- [QR-bill – SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html)
- [Swiss Implementation Guidelines for the QR-bill, version 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf)
- [QR-bill version 2.3 delta guide – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-delta-guide-v2.3-en.pdf)
- [New requirements for the QR-bill: factsheet for SMEs – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/factsheet-qr-bill-transition-period-sme-en.pdf)
- [eBill – SIX](https://www.ebill.ch/en/)
