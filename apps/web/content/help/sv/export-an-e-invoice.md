---
title: Exportera en e-faktura (XRechnung, Peppol, ZUGFeRD / Factur-X, e-Factura, KSeF)
description: Ladda ned utfärdade fakturor som XRechnung, Peppol BIS 3.0, ZUGFeRD / Factur-X, e-Factura eller KSeF och bifoga XML i fakturamejl.
category: Invoices and getting paid
categoryLabel: Fakturor och betalningar
order: 13
updated: 2026-11-17
---

Vissa kunder och myndigheter behöver fakturor som strukturerad XML. Så här exporterar du dem.

Export av e-fakturor som XML ingår i **Business**. Helvetly skapar filerna men levererar dem inte via Peppol, KSeF eller det rumänska nätverket.

1. Fyll först i **Settings → Invoices → E-invoices** (registreringsnummer, adresschema för e-fakturor och elektronisk adress).
2. Öppna en utfärdad faktura och öppna menyn **…**.
3. Under **E-invoice XML** väljer du **XRechnung (UBL)**, **XRechnung (CII)**, **Peppol BIS 3.0** eller **ZUGFeRD / Factur-X (PDF)**: den utfärdade PDF-filen som PDF/A-3 med EN 16931-XML inbäddad, en fil för människor och program. Du ser även **e-Factura (CIUS-RO)** för en rumänsk kund och **KSeF FA(3)** om ditt företag är polskt.
4. Ladda själv upp den nedladdade filen i mottagarportalen, till exempel SPV e-Factura eller Aplikacja Podatnika KSeF.
5. Om XML automatiskt ska bifogas när du mejlar fakturor redigerar du kunden och väljer format under **E-invoice**. Mejl med ZUGFeRD / Factur-X använder den PDF-filen i stället för den vanliga. Ange även **Leitweg-ID** för en tysk myndighet.

## Bra att veta

- Helvetly skickar inte e-fakturor via Peppol-nätverket eller statliga API:er. XML-exporten är bara en fil.
- Om en överföring finns visas den under **E-invoice transmissions** på fakturan.
