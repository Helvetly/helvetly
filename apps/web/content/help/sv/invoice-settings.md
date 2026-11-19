---
title: Ställ in faktureringen
description: Lägg till företagsuppgifter, logotyp, momsregistrering, IBAN, betalningssätt och fakturanumrering innan du utfärdar fakturor.
category: Invoices and getting paid
categoryLabel: Fakturor och betalningar
order: 1
updated: 2026-11-11
---

Ange företagets uppgifter en gång så används de på varje faktura.

1. Gå till **Settings → Invoices**, eller välj **Invoice settings** i sidmenyn på **Invoices**.
2. Fyll i **Logo**, **Company** (namn och adress) och **VAT**. Under VAT aktiverar du **Registered for VAT** och lägger sedan till ditt UID med MWST, standardsatsen och om priser anges netto eller brutto.
3. Under **Bank account** anger du **IBAN** och bank. Under **Payment methods** aktiverar du **Swiss QR bill** och/eller **Revolut**.
4. Under **Numbering** väljer du ett format som är vanligt i företagets land (till exempel 2026-001 i Schweiz eller INV-0001 i USA), eller **Custom format** och bygger ett eget med text och platshållare: {YYYY} eller {YY} (år), {MM} (månad), {DD} (dag), {TYPE} (INV, CN, DN, PF eller Q) och {NNN} (löpnumret, utfyllt med nollor till tre siffror; {N} utan utfyllnad). Löpnumret är obligatoriskt. Med år i formatet börjar numreringen om varje år; utan år börjar den aldrig om. Efter fakturaimport till en ny arbetsyta erbjuder välkomstflödet att behålla samma numrering.
5. Ange **Defaults** (valuta, dokumentspråk, betalningsvillkor), **Instalments**, **Dunning** och **Footer**.
6. När checklistan visar **Ready to issue invoices** är allt klart.

## Bra att veta

- Bara ägare och administratörer kan ändra inställningarna.
- Nummer tilldelas när en faktura utfärdas, utan luckor, och börjar om varje år om formatet innehåller årtal.
- Det finns en nummerserie, och kreditnotor får egna nummer.
