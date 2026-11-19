---
title: De Zwitserse QR-factuur
description: Wat een Zwitserse QR-factuur is, welke IBAN en referentie je gebruikt, hoe het betaaldeel is opgebouwd en welke fouten tot afwijzing leiden.
category: Getting paid
updated: 2026-11-11
readingMinutes: 7
---

De QR-factuur is het standaard Zwitserse betaalformulier. Ze verving de oranje en rode betaalstroken, die banken sinds 30 september 2022 niet meer verwerken. Verstuur je facturen naar klanten in Zwitserland, dan verwachten zij er een: ze scannen de code in hun bankapp en alle velden worden ingevuld.

SIX bepaalt de regels in de Swiss Implementation Guidelines for the QR-bill. Deze handleiding legt uit wat voor een klein bedrijf van belang is.

## Wat een QR-factuur bevat

Een QR-factuur is een strook onderaan de factuur (of op een aparte pagina) met twee delen:

| Deel            | Afmeting             | Doel                                                           |
| --------------- | -------------------- | -------------------------------------------------------------- |
| Ontvangstbewijs | 62 × 105 mm, links   | Door de betaler bewaard voor de administratie                  |
| Betaaldeel      | 148 × 105 mm, rechts | Bevat de Swiss QR Code en dezelfde gegevens als leesbare tekst |

Samen zijn ze 210 × 105 mm, het onderste derde deel van een A4-pagina.

De **Swiss QR Code** is 46 × 46 mm met een Zwitsers kruis in het midden. Hij bevat alle betaalgegevens: je rekening, naam en adres, bedrag en valuta, naam en adres van de betaler, een referentie en een optioneel bericht. De tekstvelden naast de code herhalen de gegevens zodat iemand ze kan controleren of aan een postloket kan betalen.

Belangrijke gegevenslimieten:

- **Valuta:** alleen CHF of EUR.
- **Bedrag:** maximaal 999,999,999.99, of leeg zodat de betaler het invult.
- **Aanvullende informatie:** maximaal 140 tekens in totaal voor vrije tekst en gestructureerde factuurinformatie.
- **Alternatieve procedures:** maximaal twee vermeldingen, bijvoorbeeld eBill.

## QR-IBAN of IBAN: de referentie kiezen

De belangrijkste beslissing is welke rekening en welk referentietype je gebruikt. Er zijn drie combinaties:

| Rekening    | Referentie                                            | Wanneer gebruiken                                                              |
| ----------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| QR-IBAN     | QR-referentie (QRR), 27 cijfers                       | Je wilt betalingen automatisch koppelen en je bank heeft een QR-IBAN verstrekt |
| Gewone IBAN | Creditor Reference (SCOR), ISO 11649, begint met "RF" | Je wilt automatisch koppelen maar gebruikt een gewone rekening                 |
| Gewone IBAN | Geen referentie (NON)                                 | Eenvoudige situaties, kleine aantallen; handmatig koppelen                     |

Zo herken je het verschil:

- Een **QR-IBAN** lijkt op een gewone Zwitserse IBAN, maar de bankcode (posities 5 tot 9) ligt tussen 30000 en 31999. Je bank verstrekt deze voor dezelfde rekening als je gewone IBAN.
- Een **QR-referentie** telt 27 cijfers. Het laatste cijfer is een controlecijfer (modulo 10, recursief), zodat typefouten worden herkend.
- Een **Creditor Reference** begint met "RF", gevolgd door twee controlecijfers en maximaal 21 eigen tekens.

De regel die de meeste afwijzingen veroorzaakt: **een QR-IBAN vereist altijd een QR-referentie en een QR-referentie werkt alleen met een QR-IBAN.** Een gewone IBAN gebruikt een Creditor Reference of geen referentie.

Met een referentie meldt je bank elke betaling met die referentie in het elektronische rekeningafschrift (camt.054 of camt.053), zodat je boekhoudsoftware de juiste factuur zonder handwerk als betaald kan markeren.

## Adressen: alleen gestructureerd

Sinds versie 2.3 van de SIX-richtlijnen in november 2025 van kracht werd, accepteert de QR-code alleen **gestructureerde adressen** (adrestype "S"). Straat, huisnummer, postcode, plaats en land hebben elk een eigen veld. Het oudere gecombineerde type ("K"), met straat en plaats als vrije tekstregels, is niet meer toegestaan. Dezelfde versie staat ook de uitgebreide tekenset van de Swiss Payment Standards toe.

Bewaren je factuurprogramma of klantgegevens adressen nog als vrije tekstregels, corrigeer dat dan eerst. Dit is de meest voorkomende reden waarom een QR-factuur uit oudere software niet meer scant.

## Indeling van het betaaldeel

De richtlijnen leggen de indeling vast zodat elke factuur er hetzelfde uitziet:

- De titel "Payment part" linksboven, met daaronder de QR-code.
- Valuta en bedrag onder de code.
- Rechts: Account / Payable to, Reference, Additional information, Payable by.
- Als het bedrag of de betaler niet is ingevuld, wordt een leeg vak met hoekmarkeringen afgedrukt.
- Lettertypen: Arial, Frutiger, Helvetica of Liberation Sans, zwart op wit. Opschriften zijn vet.
- Het ontvangstbewijs toont dezelfde rekening, referentie, betaler en hetzelfde bedrag, plus "Acceptance point".

Opschriften moeten in een toegestane taal staan: Duits, Frans, Italiaans of Engels.

## De kniplijn

Het ontvangstbewijs en betaaldeel zijn bedoeld om los te maken en afzonderlijk te betalen. De markering hangt af van het medium:

- **Op papier afgedrukt:** de scheidingslijnen tussen factuur en QR-factuur, en tussen ontvangstbewijs en betaaldeel, moeten geperforeerd zijn.
- **Als pdf verstuurd:** dezelfde lijnen worden doorgetrokken of gestippeld getekend, met een schaarpictogram of de tekst "Separate before paying in" boven de lijn.

## Veelvoorkomende fouten

| Fout                                          | Gevolg                         | Oplossing                                                 |
| --------------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| QR-IBAN met SCOR of zonder referentie         | Bank weigert betaling          | Gebruik een QR-referentie of je gewone IBAN               |
| Gewone IBAN met QR-referentie                 | Betaling geweigerd             | Gebruik SCOR of geen referentie                           |
| Ongestructureerd adres (type K)               | Code niet meer geldig          | Bewaar straat, nummer, postcode en plaats apart           |
| Verkeerd controlecijfer in de referentie      | Scanapps weigeren de code      | Genereer referenties met software, nooit handmatig        |
| QR-code verkleind of onscherp afgedrukt       | Code scant niet                | Druk scherp af op de volledige 46 × 46 mm                 |
| Andere valuta dan CHF of EUR                  | Niet toegestaan                | Factureer in CHF of EUR als je een QR-factuur wilt        |
| Afzendergegevens wijken af van rekeninghouder | Betaling vertraagd of bevraagd | Gebruik exact de geregistreerde rekeningnaam en het adres |

Test enkele facturen met je eigen bankapp voordat je de eerste reeks verstuurt, en opnieuw na elke software-update.

## eBill versus QR-factuur

eBill is de Zwitserse elektronische factuurdienst van SIX. De factuur verschijnt direct in de e-banking van de klant, die met één klik goedkeurt. Er is geen pdf om te downloaden of code om te scannen.

|                   | QR-factuur                         | eBill                                                     |
| ----------------- | ---------------------------------- | --------------------------------------------------------- |
| Aflevering        | Papier of pdf, per post of e-mail  | In de e-banking van de betaler                            |
| Actie betaler     | Code scannen, bevestigen           | Goedkeuren in e-banking                                   |
| Wie kan ontvangen | Iedereen                           | Betalers die bij je bedrijf voor eBill geregistreerd zijn |
| Wat je nodig hebt | Bankrekening (en QR-IBAN voor QRR) | Contract met een eBill-netwerkpartner                     |

Ze vullen elkaar aan. Veel bedrijven bieden eBill aan geregistreerde klanten aan en sturen de rest een QR-factuur. Een QR-factuur kan via het veld voor alternatieve procedures ook aangeven dat eBill beschikbaar is.

## Hoe Helvetly helpt

Helvetly voegt aan elke factuur in CHF of EUR een QR-factuur toe, met QR-referentie voor een QR-IBAN of Creditor Reference voor een gewone IBAN en gestructureerde adressen. Herinneringen en betalingsregelingen hebben een eigen QR-factuur: bij elke herinnering één voor het openstaande totaal, en bij elke termijn één met een eigen referentie.

## Bronnen

- [QR-bill – SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html)
- [Swiss Implementation Guidelines for the QR-bill, version 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf)
- [QR-bill version 2.3 delta guide – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-delta-guide-v2.3-en.pdf)
- [New requirements for the QR-bill: factsheet for SMEs – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/factsheet-qr-bill-transition-period-sme-en.pdf)
- [eBill – SIX](https://www.ebill.ch/en/)
