---
title: Export an e-invoice (XRechnung, Peppol, e-Factura, KSeF)
description: Download issued invoices as XRechnung, Peppol BIS 3.0, e-Factura or KSeF XML, and attach the XML to invoice emails.
category: Invoices and getting paid
order: 13
updated: 2026-11-11
---

Some clients and authorities need invoices as structured XML. Here is how to export them.

1. First fill in **Settings → Invoices → E-invoices** (registration number, e-invoice address scheme and electronic address).
2. Open an issued invoice and open the **…** menu.
3. Under **E-invoice XML**, pick **XRechnung (UBL)**, **XRechnung (CII)** or **Peppol BIS 3.0**. You also see **e-Factura (CIUS-RO)** for a Romanian client and **KSeF FA(3)** if your company is Polish.
4. Upload the downloaded file in the receiving portal yourself, for example SPV for e-Factura or Aplikacja Podatnika for KSeF.
5. To attach the XML automatically when you email invoices, edit the client and choose the format under **E-invoice**. For a German public body, also enter the **Leitweg-ID**.

## Good to know

- Helvetly does not send e-invoices through a Peppol network or government API. The XML export is only a file.
- If a transmission exists, it shows in **E-invoice transmissions** on the invoice.
