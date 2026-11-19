---
title: Vad en schweizisk faktura måste innehålla
description: Uppgifterna som en schweizisk momsfaktura kräver enligt MWSTG art. 26, grunderna för QR-fakturor, språk, kreditnotor, rättelser och arkiveringstid.
category: Getting paid
categoryLabel: Få betalt
updated: 2026-11-11
readingMinutes: 7
---

Schweiz har ingen särskild ”fakturalag”. Kraven på en fakturas innehåll följer främst av momslagen, eftersom kunden behöver en korrekt faktura för att dra av momsen du tar ut. Lägg till QR-fakturan, som används för de flesta schweiziska fakturabetalningar, och bokföringsreglerna om bevarande av handlingar, så har du hela bilden.

## Obligatoriska uppgifter (MWSTG art. 26)

Om du är momsregistrerad kan kunden begära en faktura som tydligt identifierar dig, kunden och det du har levererat. Som regel innehåller den:

| #   | Uppgift                                                                    | Exempel                                        |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | Ditt namn och din ort som du uppträder med i verksamheten                  | Muster Consulting, Bern                        |
| 2   | Uppgift om att du är momsregistrerad samt ditt momsnummer                  | CHE-123.456.789 MWST                           |
| 3   | Kundens namn och ort som kunden uppträder med i verksamheten               | Beispiel AG, Zürich                            |
| 4   | Leveransdatum eller leveransperiod, om det skiljer sig från fakturadatumet | Arbete utfört i oktober 2026                   |
| 5   | Leveransens art, föremål och omfattning                                    | 32 timmars IT-konsultarbete, projekt ”New CRM” |
| 6   | Priset (vederlaget)                                                        | CHF 5,200.00                                   |
| 7   | Momssats och momsbelopp                                                    | 8.1 % moms, CHF 421.20                         |

Några praktiska punkter:

- **Priser inklusive moms.** Om priset redan innehåller moms räcker momssatsen (”inkl. 8.1 % moms”), men beloppet hjälper kunden.
- **Flera satser.** Om fakturan innehåller leveranser med olika satser, till exempel böcker med 2.6 % och konsultarbete med 8.1 %, ska beloppen för respektive sats framgå.
- **Verksamhetsnamn fungerar.** Namnet du använder i verksamheten, till exempel ett butiksnamn, godtas så länge du kan identifieras tydligt.
- **Kassakvitton upp till CHF 400.** Kvitton från kassaregister på upp till CHF 400 inklusive moms behöver inte innehålla köparuppgifter.
- **Papper, PDF och e-faktura är likvärdiga.** För momsändamål räknas en PDF eller strukturerad e-faktura på samma sätt som en pappersfaktura.
- **Inte momsregistrerad?** Då får du **inte** ange moms alls. Den som anger moms på en faktura är skyldig ESTV beloppet, oavsett registrering.

Följande krävs inte enligt lag men förväntas i praktiken: fakturanummer, fakturadatum, betalningsvillkor och förfallodag. Förfallodagen spelar roll senare: när den har passerat är kunden i dröjsmål, och du kan ta ut 5 % dröjsmålsränta enligt obligationsrätten (OR art. 104).

## Grunderna för QR-fakturan

Sedan oktober 2022 är QR-fakturan den enda schweiziska inbetalningsblanketten. Det är den perforerade betalningsdelen längst ned på fakturan (eller på en separat sida), med en schweizisk QR-kod som betalaren skannar i sin internetbank. De fullständiga reglerna finns i vår guide om [den schweiziska QR-fakturan](/guides/qr-bill); för själva fakturan är huvudvalet vilket konto och vilken referens du använder.

| Konto            | Referens                                                  | Användning                                                                |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| **QR-IBAN**      | **QR-referens** (27 siffror med en kontrollsiffra)        | Automatisk matchning av betalningar; banken ger dig ett separat QR-IBAN   |
| **Vanligt IBAN** | **Creditor Reference** (SCOR, ISO 11649, börjar med ”RF”) | Automatisk matchning med ditt vanliga konto; används även internationellt |
| **Vanligt IBAN** | Ingen referens, bara ett fritextmeddelande                | Små volymer där du matchar betalningar manuellt                           |

Kombinationerna är fasta: QR-IBAN kräver alltid QR-referens, och QR-referens fungerar bara med QR-IBAN. Ett QR-IBAN ser ut som ett vanligt IBAN, men institutidentifieraren (siffrorna 5 till 9) ligger mellan 30000 och 31999.

Två nya ändringar är viktiga:

- **Bara strukturerade adresser.** Sedan november 2025 måste betalningsmottagarens och betalarens adresser i QR-koden vara strukturerade (gata, nummer, postnummer och ort i separata fält). Program som fortfarande skapar den gamla kombinerade adresstypen producerar fakturor som banker kan avvisa.
- **Eurofakturor från 14 november 2026.** Enligt version 2.4 av SIX-reglerna får en QR-faktura i EUR bara använda vanligt IBAN med Creditor Reference eller ett ostrukturerat meddelande. QR-IBAN med QR-referens finns kvar för CHF.

## Språk

Momslagen föreskriver inget fakturaspråk. Använd ett språk kunden förstår; i praktiken skrivs de flesta schweiziska fakturor på tyska, franska, italienska eller engelska. QR-fakturans betalningsdel har fasta rubriker (”Payment part”, ”Account / Payable to” och så vidare) som måste skrivas på ett språk som SIX-riktlinjerna tillåter: tyska, franska, italienska eller engelska, och sedan januari 2026 även rätoromanska. Rubrikerna får vara på ett annat språk än resten av fakturan, men samma språk ska användas i hela betalningsdelen och kvittot.

## Kreditnotor och rättelser

**Kreditnotor i betydelsen självfakturering.** I Schweiz betyder ”Gutschrift” ofta en faktura som utfärdas av **kunden** i stället för leverantören (självfakturering), vanligt för provisioner och royalty. Momsmässigt räknas den som en faktura. Den måste ange leverantören och alla obligatoriska uppgifter; leverantörens momsnummer rekommenderas också.

**Kreditnotor minskar en faktura.** Om priset ändras i efterhand, genom rabatt, retur eller delvis återbetalning, utfärdar du en kreditnota som hänvisar till originalfakturan och visar minskningen och momsen på den. Du justerar momsen i perioden då rättelsen bokförs, och kunden minskar sin ingående moms på motsvarande sätt.

**Rätta fel.** Redigera eller utfärda inte en redan skickad faktura på nytt med samma nummer. Gör i stället så här:

- För ett **för högt momsbelopp eller moms som inte skulle ha angetts** skickar du kunden ett dokument som hänvisar till och upphäver originalfakturan. Fram till dess är du skyldig den angivna momsen.
- För **glömd moms**, en **för låg momssats** eller ett **ändrat pris** skickar du ett ytterligare dokument som hänvisar till originalfakturan och upphäver eller kompletterar den.

I praktiken är det tydligast med en kreditnota för hela originalbeloppet och därefter en ny, korrekt faktura.

## Hur länge fakturor ska sparas

| Regel                           | Bevarandetid                                                          | Gäller                                                        |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| Obligationsrätten, OR art. 958f | **10 år**, räknat från räkenskapsårets slut                           | Bokföringsunderlag, inklusive utfärdade och mottagna fakturor |
| Momslagen, MWSTG art. 70        | Tills momsfordran preskriberas, oftast **10 år** efter skatteperioden | Momsregistrerade företag                                      |
| Momslagen, MWSTG art. 70 st. 3  | **20 år** (ESTV:s vägledning anger 26)                                | Handlingar om fastigheter som används i verksamheten          |

Du kan spara fakturor på papper eller elektroniskt, så länge filerna inte kan ändras utan att det syns och förblir läsbara under hela perioden. En skannad faktura eller PDF-faktura kan ersätta pappersoriginalet om dessa villkor är uppfyllda.

## Så hjälper Helvetly

Helvetly utfärdar fakturor med alla uppgifter i MWSTG art. 26 och QR-fakturor med QR-referens eller Creditor Reference och strukturerade adresser. Automatiska påminnelser följer upp förfallna fakturor och kan lägga till dröjsmålsränta enligt OR 104. För kunder utomlands kan du även exportera e-fakturor i XRechnung, Peppol BIS, KSeF och e-Factura. Automatiska påminnelser ingår i Pro och Business, e-fakturor som XML i Business.

## Källor

- [Federal lag om mervärdesskatt (MWSTG, SR 641.20) – Fedlex](https://www.fedlex.admin.ch/eli/cc/2009/615/en): art. 26, 27, 41, 70
- [Mervärdesskatteförordningen (MWSTV, SR 641.201) – Fedlex](https://www.fedlex.admin.ch/eli/cc/2009/828/de): art. 57
- [Schweiziska obligationsrätten (OR, SR 220) – Fedlex](https://www.fedlex.admin.ch/eli/cc/27/317_321_377/en): art. 104, 958f
- [QR-faktura – SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html)
- [Schweiziska tillämpningsriktlinjer för QR-fakturan, version 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf)
- [Schweiziska momssatser – ESTV](https://www.estv.admin.ch/en/vat-rates-switzerland)
