---
title: Export an e-invoice (XRechnung, Peppol, ZUGFeRD / Factur-X, e-Factura, KSeF)
description: Download issued invoices as XRechnung, Peppol BIS 3.0, ZUGFeRD / Factur-X, e-Factura or KSeF, and attach the XML to invoice emails.
category: Invoices and getting paid
order: 13
updated: 2026-11-17
---

Some clients and authorities need invoices as structured XML. Here is how to export them.

E-invoice XML export is part of **Business**. Helvetly creates the files; it does not deliver them through Peppol, KSeF or the Romanian network.

1. First fill in **Settings → Invoices → E-invoices** (registration number, e-invoice address scheme and electronic address).
2. Open an issued invoice and open the **…** menu.
3. Under **E-invoice XML**, pick **XRechnung (UBL)**, **XRechnung (CII)**, **Peppol BIS 3.0** or **ZUGFeRD / Factur-X (PDF)**: the issued PDF as PDF/A-3 with the EN 16931 XML inside, one file for people and software. You also see **e-Factura (CIUS-RO)** for a Romanian client and **KSeF FA(3)** if your company is Polish.
4. Upload the downloaded file in the receiving portal yourself, for example SPV for e-Factura or Aplikacja Podatnika for KSeF.
5. To attach the XML automatically when you email invoices, edit the client and choose the format under **E-invoice**. With ZUGFeRD / Factur-X the email carries that PDF in place of the plain one. For a German public body, also enter the **Leitweg-ID**.

## Good to know

- Helvetly does not send e-invoices through a Peppol network or government API. The XML export is only a file.
- If a transmission exists, it shows in **E-invoice transmissions** on the invoice.
