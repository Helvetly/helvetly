---
title: Den schweiziska QR-fakturan
description: Vad en schweizisk QR-faktura är, vilket IBAN och vilken referens du ska använda, betalningsdelens utformning och felen som leder till avvisade fakturor.
category: Getting paid
categoryLabel: Få betalt
updated: 2026-11-11
readingMinutes: 7
---

QR-fakturan är den schweiziska standardblanketten för betalningar. Den ersatte de orange och röda inbetalningsblanketterna, som bankerna slutade hantera den 30 september 2022. Om du skickar fakturor till kunder i Schweiz förväntar de sig en sådan: de skannar koden i bankappen och alla fält fylls i automatiskt.

Reglerna fastställs av SIX i Swiss Implementation Guidelines for the QR-bill. Den här guiden förklarar det viktigaste för ett småföretag.

## Vad en QR-faktura innehåller

En QR-faktura är ett fält längst ned på fakturan (eller på en separat sida) med två delar:

| Del           | Storlek                   | Syfte                                                      |
| ------------- | ------------------------- | ---------------------------------------------------------- |
| Kvitto        | 62 × 105 mm, till vänster | Sparas av betalaren som underlag                           |
| Betalningsdel | 148 × 105 mm, till höger  | Innehåller Swiss QR Code och samma uppgifter i läsbar text |

Tillsammans är de 210 × 105 mm, den nedersta tredjedelen av en A4-sida.

**Swiss QR Code** är 46 × 46 mm med ett schweiziskt kors i mitten. Den innehåller alla betalningsuppgifter: ditt konto, namn och adress, belopp och valuta, betalarens namn och adress, referens och valfritt meddelande. Textfälten bredvid koden upprepar uppgifterna så att en person kan kontrollera dem eller betala vid en postdisk.

Viktiga datagränser:

- **Valuta:** bara CHF eller EUR.
- **Belopp:** upp till 999,999,999.99, eller tomt så att betalaren fyller i det.
- **Ytterligare information:** sammanlagt upp till 140 tecken för det ostrukturerade meddelandet och den strukturerade faktureringsinformationen.
- **Alternativa förfaranden:** upp till två poster, till exempel eBill.

## QR-IBAN eller IBAN: välj referens

Det viktigaste beslutet är vilket konto och vilken referenstyp du ska använda. Det finns tre kombinationer:

| Konto        | Referens                                              | När den används                                                            |
| ------------ | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| QR-IBAN      | QR-referens (QRR), 27 siffror                         | Du vill matcha betalningar automatiskt och banken har gett dig ett QR-IBAN |
| Vanligt IBAN | Creditor Reference (SCOR), ISO 11649, börjar med ”RF” | Du vill matcha automatiskt men använder ett vanligt konto                  |
| Vanligt IBAN | Ingen referens (NON)                                  | Enkla fall, låga volymer; matchningen görs manuellt                        |

Så skiljer du dem åt:

- Ett **QR-IBAN** ser ut som ett vanligt schweiziskt IBAN, men bankidentifieraren (positionerna 5 till 9) ligger mellan 30000 och 31999. Banken utfärdar det för samma konto som ditt vanliga IBAN.
- En **QR-referens** har 27 siffror. Den sista är en kontrollsiffra (rekursiv modulo 10), så att skrivfel upptäcks.
- En **Creditor Reference** börjar med ”RF”, följt av två kontrollsiffror och upp till 21 egna tecken.

Regeln bakom de flesta avvisningar: **QR-IBAN kräver alltid QR-referens, och QR-referens fungerar bara med QR-IBAN.** Ett vanligt IBAN använder Creditor Reference eller ingen referens.

Med referens rapporterar banken varje betalning med referensen i sitt elektroniska kontoutdrag (camt.054 eller camt.053), så att bokföringsprogrammet kan markera rätt faktura som betald utan manuellt arbete.

## Adresser: bara strukturerade

Sedan SIX-riktlinjerna version 2.3 trädde i kraft i november 2025 godtar QR-koden bara **strukturerade adresser** (adresstyp ”S”). Gata, husnummer, postnummer, ort och land ska ha egna fält. Den äldre kombinerade adresstypen (”K”), där gata och ort var fria textrader, är inte längre tillåten. Samma version tillåter också den utökade teckenuppsättningen i Swiss Payment Standards.

Om faktureringsverktyget eller kundregistret fortfarande lagrar adresser som fria textrader bör du rätta det först. Det är den vanligaste orsaken till att QR-fakturor från äldre program inte längre kan skannas.

## Betalningsdelens utformning

Riktlinjerna fastställer utformningen så att alla fakturor ser likadana ut:

- Rubriken ”Payment part” högst upp till vänster och QR-koden under den.
- Valuta och belopp under koden.
- Till höger: Account / Payable to, Reference, Additional information, Payable by.
- Om beloppet eller betalaren lämnas öppet skrivs en tom ruta med hörnmarkeringar ut i stället.
- Typsnitt: Arial, Frutiger, Helvetica eller Liberation Sans, svart på vitt. Rubriker är feta.
- Kvittot visar samma konto, referens, betalare och belopp samt ”Acceptance point”.

Etiketterna måste vara på ett av de språk riktlinjerna tillåter: tyska, franska, italienska eller engelska.

## Klipplinjen

Kvittot och betalningsdelen ska kunna rivas av och betalas separat. Markeringen beror på mediet:

- **Utskrivet på papper:** skiljelinjerna mellan fakturan och QR-fakturan samt mellan kvittot och betalningsdelen måste vara perforerade.
- **Skickat som PDF:** samma linjer ritas heldragna eller streckade, med en saxsymbol eller texten ”Separate before paying in” ovanför linjen.

## Vanliga fel

| Fel                                         | Följd                                      | Lösning                                                          |
| ------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| QR-IBAN med SCOR eller utan referens        | Banken avvisar betalningen                 | Använd QR-referens eller byt till vanligt IBAN                   |
| Vanligt IBAN med QR-referens                | Betalningen avvisas                        | Använd SCOR eller ingen referens                                 |
| Ostrukturerad adress (typ K)                | Koden är inte längre giltig                | Spara gata, nummer, postnummer och ort separat                   |
| Fel kontrollsiffra i referensen             | Skanningsappar avvisar koden               | Generera referenser i programmet, aldrig för hand                |
| Förminskad eller oskarpt utskriven QR-kod   | Koden kan inte skannas                     | Skriv ut den skarpt i full storlek, 46 × 46 mm                   |
| Annan valuta än CHF eller EUR               | Inte tillåtet                              | Fakturera i CHF eller EUR om du vill ha en QR-faktura            |
| Avsändaruppgifter avviker från kontohavaren | Betalningar försenas eller behöver utredas | Använd exakt det namn och den adress som registrerats för kontot |

Testa några fakturor med din egen bankapp innan du skickar den första omgången, och igen efter varje programuppdatering.

## eBill jämfört med QR-faktura

eBill är den schweiziska elektroniska fakturatjänsten som drivs av SIX. Fakturan kommer direkt till kundens internetbank och godkänns med ett klick. Ingen PDF behöver laddas ned och ingen kod skannas.

|                   | QR-faktura                            | eBill                                                   |
| ----------------- | ------------------------------------- | ------------------------------------------------------- |
| Leverans          | Papper eller PDF, via post eller mejl | I betalarens internetbank                               |
| Betalarens åtgärd | Skanna koden och bekräfta             | Godkänna i internetbanken                               |
| Vem kan ta emot   | Vem som helst                         | Betalare som registrerat sig för eBill hos ditt företag |
| Vad du behöver    | Ett bankkonto (och QR-IBAN för QRR)   | Ett avtal med en eBill-nätverkspartner                  |

De kompletterar varandra. Många företag erbjuder eBill till registrerade kunder och skickar QR-fakturor till övriga. En QR-faktura kan också ange att eBill finns tillgängligt i fältet för alternativa förfaranden.

## Så hjälper Helvetly

Helvetly lägger en QR-betalningsdel på varje faktura i CHF eller EUR, med QR-referens för QR-IBAN eller Creditor Reference för vanligt IBAN och strukturerade adresser. Påminnelser och delbetalningsplaner har egna QR-fakturor: en för det utestående totalbeloppet på varje påminnelse och en med egen referens för varje delbetalning.

## Källor

- [QR-faktura – SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html)
- [Schweiziska tillämpningsriktlinjer för QR-fakturan, version 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf)
- [Ändringsguide för QR-fakturan version 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-delta-guide-v2.3-en.pdf)
- [Nya krav för QR-fakturan, faktablad för små och medelstora företag – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/factsheet-qr-bill-transition-period-sme-en.pdf)
- [eBill – SIX](https://www.ebill.ch/en/)
