---
title: Wat een Zwitserse factuur moet bevatten
description: De gegevens die een Zwitserse btw-factuur volgens MWSTG art. 26 nodig heeft, QR-facturen, talen, creditnota's, correcties en bewaartermijnen.
category: Getting paid
updated: 2026-11-11
readingMinutes: 7
---

Zwitserland heeft geen afzonderlijke "factuurwet". Wat een factuur moet bevatten volgt vooral uit de btw-wet, omdat je klant een juiste factuur nodig heeft om de door jou berekende btw af te trekken. Voeg daar de QR-factuur aan toe, waarmee de meeste Zwitserse facturen worden betaald, en de regels voor het bewaren van de administratie: dan is het beeld compleet.

## De verplichte gegevens (MWSTG art. 26)

Als je voor btw geregistreerd bent kan je klant vragen om een factuur die jou, de klant en de geleverde prestatie duidelijk identificeert. In de regel bevat die:

| #   | Gegeven                                                                    | Voorbeeld                             |
| --- | -------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Je naam en vestigingsplaats zoals gebruikt in het handelsverkeer           | Muster Consulting, Bern               |
| 2   | Vermelding van je btw-registratie met btw-nummer                           | CHE-123.456.789 MWST                  |
| 3   | Naam en vestigingsplaats van de klant zoals gebruikt in het handelsverkeer | Beispiel AG, Zürich                   |
| 4   | Leveringsdatum of -periode indien anders dan de factuurdatum               | Werk uitgevoerd in oktober 2026       |
| 5   | Aard, onderwerp en omvang van de prestatie                                 | 32 uur IT-advies, project "Nieuw CRM" |
| 6   | De prijs (vergoeding)                                                      | CHF 5,200.00                          |
| 7   | Het btw-tarief en btw-bedrag                                               | 8.1 % btw, CHF 421.20                 |

Enkele praktische punten:

- **Prijzen inclusief btw.** Bevat je prijs de btw al, dan volstaat het tarief ("incl. 8.1 % btw"), maar het bedrag tonen helpt je klant.
- **Meerdere tarieven.** Staan op één factuur prestaties met verschillende tarieven, zoals boeken tegen 2.6 % en advies tegen 8.1 %, toon dan elk tarief met de bijbehorende bedragen.
- **Handelsnamen tellen mee.** Je handelsnaam, bijvoorbeeld een winkelnaam, volstaat zolang je duidelijk identificeerbaar bent.
- **Kassabonnen tot CHF 400.** Kassabonnen tot CHF 400 inclusief btw hoeven geen gegevens over de koper te bevatten.
- **Papier, pdf en e-factuur zijn gelijkwaardig.** Voor btw-doeleinden telt een pdf of gestructureerde e-factuur hetzelfde als een papieren factuur.
- **Niet geregistreerd?** Dan mag je **helemaal geen** btw vermelden. Wie btw op een factuur toont is dat bedrag aan de ESTV verschuldigd, geregistreerd of niet.

Niet wettelijk vereist maar in de praktijk verwacht: een factuurnummer, factuurdatum, betalingsvoorwaarden en vervaldatum. De vervaldatum is later van belang: zodra deze is verstreken is de klant in verzuim en kun je volgens het Zwitserse verbintenissenrecht (OR art. 104) 5 % vertragingsrente rekenen.

## De basis van de QR-factuur

Sinds oktober 2022 is de QR-factuur het enige Zwitserse betaalformulier. Het is het geperforeerde betaaldeel onderaan een factuur (of op een aparte pagina), met een Zwitserse QR-code die de betaler in e-banking scant. De volledige regels staan in onze handleiding over [de Zwitserse QR-factuur](/guides/qr-bill); voor de factuur zelf is de belangrijkste keuze welke rekening en referentie je gebruikt.

| Rekening        | Referentie                                                | Wanneer gebruiken                                                           |
| --------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| **QR-IBAN**     | **QR-referentie** (27 cijfers, inclusief controlecijfer)  | Automatisch betalingen koppelen; je bank geeft je een afzonderlijke QR-IBAN |
| **Gewone IBAN** | **Creditor Reference** (SCOR, ISO 11649, begint met "RF") | Automatisch koppelen met je normale rekening; ook internationaal gebruikt   |
| **Gewone IBAN** | Geen referentie, alleen vrije tekst                       | Kleine aantallen waarbij je betalingen handmatig koppelt                    |

De combinaties liggen vast: een QR-IBAN vereist altijd een QR-referentie en een QR-referentie werkt alleen met een QR-IBAN. Een QR-IBAN lijkt op een gewone IBAN, maar de instellingscode (cijfers 5 tot 9) ligt tussen 30000 en 31999.

Twee recente wijzigingen zijn van belang:

- **Alleen gestructureerde adressen.** Sinds november 2025 moeten adressen van schuldeiser en schuldenaar in de QR-code gestructureerd zijn (straat, nummer, postcode en plaats in afzonderlijke velden). Software met het oude gecombineerde adrestype maakt facturen die banken kunnen weigeren.
- **Eurofacturen vanaf 14 november 2026.** Volgens versie 2.4 van de SIX-regels mag een QR-factuur in EUR alleen een gewone IBAN gebruiken, met een Creditor Reference of vrije tekst. De QR-IBAN met QR-referentie blijft beschikbaar voor CHF.

## Talen

De btw-wet schrijft geen factuurtaal voor. Gebruik een taal die je klant begrijpt; de meeste Zwitserse facturen zijn in de praktijk Duits, Frans, Italiaans of Engels. Het betaaldeel van de QR-factuur heeft vaste opschriften ("Payment part", "Account / Payable to" enzovoort), die in een door SIX toegestane taal moeten staan: Duits, Frans, Italiaans of Engels, en sinds januari 2026 ook Reto-Romaans. De opschriften mogen in een andere taal zijn dan de rest van de factuur, maar gebruik binnen het betaaldeel en ontvangstbewijs één taal.

## Creditnota's en correcties

**Creditnota's in de betekenis van self-billing.** In Zwitserland betekent "Gutschrift" vaak een factuur die de **klant** in plaats van de leverancier uitgeeft (self-billing), gebruikelijk bij commissies en royalty's. Voor de btw geldt dit als factuur. De leverancier moet met alle verplichte gegevens worden genoemd; het btw-nummer van de leverancier vermelden wordt aanbevolen.

**Creditnota's die een factuur verlagen.** Verandert de prijs achteraf door korting, retour of gedeeltelijke terugbetaling, geef dan een creditnota uit die naar de oorspronkelijke factuur verwijst en de verlaging en bijbehorende btw toont. Je corrigeert de btw in de periode waarin je de correctie boekt; de klant verlaagt de voorbelasting overeenkomstig.

**Fouten corrigeren.** Bewerk een al verstuurde factuur niet en geef deze niet onder hetzelfde nummer opnieuw uit. Doe in plaats daarvan het volgende:

- Stuur bij **te hoog vermelde of ten onrechte berekende btw** een document dat naar de oorspronkelijke factuur verwijst en deze annuleert. Tot dat gebeurt ben je de vermelde btw verschuldigd.
- Stuur bij **vergeten btw**, een **te laag tarief** of een **gewijzigde prijs** een aanvullend document dat naar de oorspronkelijke factuur verwijst en deze annuleert of aanvult.

De duidelijkste werkwijze is doorgaans een creditnota voor het volledige oorspronkelijke bedrag, gevolgd door een nieuwe, juiste factuur.

## Hoe lang facturen bewaren

| Regel                             | Bewaartermijn                                                                  | Van toepassing op                                        |
| --------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Verbintenissenrecht, OR art. 958f | **10 jaar**, gerekend vanaf het einde van het boekjaar                         | Administratie, waaronder uitgaande en inkomende facturen |
| Btw-wet, MWSTG art. 70            | Tot de btw-vordering verjaard is, maximaal **10 jaar** na het belastingtijdvak | Voor btw geregistreerde bedrijven                        |
| Btw-wet, MWSTG art. 70 lid 3      | **20 jaar** (de ESTV-richtlijn noemt 26)                                       | Gegevens over zakelijk gebruikt vastgoed                 |

Facturen mogen op papier of elektronisch worden bewaard, zolang bestanden niet onzichtbaar kunnen worden gewijzigd en de hele termijn leesbaar blijven. Een scan of pdf kan het papieren origineel vervangen als aan die voorwaarden is voldaan.

## Hoe Helvetly helpt

Helvetly geeft facturen uit met alle gegevens uit MWSTG art. 26 en een QR-factuur met QR-referentie of Creditor Reference en gestructureerde adressen. Automatische herinneringen volgen achterstallige facturen op en kunnen vertragingsrente volgens OR 104 toevoegen. Voor buitenlandse klanten zijn ook XRechnung-, Peppol BIS-, KSeF- en e-Factura-exports mogelijk. Automatische herinneringen horen bij Pro en Business, XML voor e-facturen bij Business.

## Bronnen

- [Federal Act on Value Added Tax (MWSTG, SR 641.20) – Fedlex](https://www.fedlex.admin.ch/eli/cc/2009/615/en): art. 26, 27, 41, 70
- [Value Added Tax Ordinance (MWSTV, SR 641.201) – Fedlex](https://www.fedlex.admin.ch/eli/cc/2009/828/de): art. 57
- [Swiss Code of Obligations (OR, SR 220) – Fedlex](https://www.fedlex.admin.ch/eli/cc/27/317_321_377/en): art. 104, 958f
- [QR-bill – SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html)
- [Swiss Implementation Guidelines for the QR-bill, version 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf)
- [Swiss VAT rates – ESTV](https://www.estv.admin.ch/en/vat-rates-switzerland)
