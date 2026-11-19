---
title: Export e-faktury (XRechnung, Peppol, ZUGFeRD / Factur-X, e-Factura, KSeF)
description: Stáhněte vystavené faktury jako XRechnung, Peppol BIS 3.0, ZUGFeRD / Factur-X, e-Factura nebo KSeF a připojujte XML k e-mailům s fakturami.
category: Invoices and getting paid
order: 13
updated: 2026-11-17
---

Někteří klienti a úřady potřebují faktury jako strukturované XML. Zde je postup exportu.

Export XML e-faktur je součástí **Business**. Helvetly vytváří soubory; nedoručuje je přes Peppol, KSeF ani rumunskou síť.

1. Nejprve vyplňte **Settings → Invoices → E-invoices** (registrační číslo, schéma adresy e-faktury a elektronickou adresu).
2. Otevřete vystavenou fakturu a nabídku **…**.
3. V **E-invoice XML** vyberte **XRechnung (UBL)**, **XRechnung (CII)**, **Peppol BIS 3.0** nebo **ZUGFeRD / Factur-X (PDF)**: vystavené PDF jako PDF/A-3 s vloženým XML EN 16931, jeden soubor pro lidi i software. Pro rumunského klienta uvidíte také **e-Factura (CIUS-RO)** a u polské firmy **KSeF FA(3)**.
4. Stažený soubor sami nahrajte do přijímacího portálu, například SPV pro e-Factura nebo Aplikacja Podatnika pro KSeF.
5. Chcete-li XML automaticky přikládat k fakturám odesílaným e-mailem, upravte klienta a zvolte formát v **E-invoice**. U ZUGFeRD / Factur-X e-mail obsahuje toto PDF namísto běžného. U německého orgánu veřejné správy zadejte také **Leitweg-ID**.

## Co je dobré vědět

- Helvetly neodesílá e-faktury přes síť Peppol ani státní API. Export XML je pouze soubor.
- Pokud existuje přenos, zobrazí se na faktuře v **E-invoice transmissions**.
