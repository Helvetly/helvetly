---
title: E-facturatie voor Zwitserse bedrijven die internationaal verkopen
description: Waarom EU-klanten Zwitserse leveranciers om e-facturen vragen en wat XRechnung, ZUGFeRD, Peppol, het Poolse KSeF en het Roemeense e-Factura betekenen.
category: E-invoicing
updated: 2026-11-11
readingMinutes: 8
---

Zwitserland kent geen algemene verplichting om tussen bedrijven e-facturen te versturen. Veel EU-landen wel, of binnenkort. Verkoop je aan klanten in Duitsland, Polen, Roemenië of andere EU-landen, dan schrijft er vroeg of laat iemand: "We accepteren alleen facturen in XRechnung-formaat" of "Stuur uw factuur via Peppol."

Deze handleiding legt uit waar die verzoeken vandaan komen, welke regels echt voor een Zwitserse verkoper gelden en wat je moet voorbereiden.

## Wat is een e-factuur?

In de EU is een e-factuur geen per e-mail verstuurde pdf. Het is een **gestructureerd bestand** (XML) dat de software van de koper kan lezen en boeken zonder handmatige invoer.

De gemeenschappelijke basis is de Europese standaard **EN 16931**. Deze bepaalt de factuurinhoud (verkoper, koper, regels, btw-uitsplitsing, betaalgegevens) en staat twee XML-syntaxen toe: UBL en UN/CEFACT CII. Nationale formaten zoals XRechnung, Peppol BIS Billing en het Roemeense RO_CIUS voegen regelsets aan EN 16931 toe. Het Poolse KSeF gebruikt een eigen nationale structuur.

## Waarom je EU-klanten om e-facturen vragen

De meeste verzoeken komen voort uit de verplichtingen van de klant, niet die van jou:

- **Hun crediteurenadministratie wordt digitaal.** Bedrijven die in eigen land e-facturen moeten ontvangen en versturen willen één proces voor alle leveranciers, ook buitenlandse.
- **Overheidsinstanties vereisen het.** Overheden in de EU moeten e-facturen accepteren die aan EN 16931 voldoen; veel ervan, waaronder Duitse federale instanties, accepteren niets anders.
- **Grensoverschrijdende rapportage komt eraan.** Onder het EU-pakket "VAT in the Digital Age" (ViDA) geldt vanaf 1 juli 2030 digitale rapportage op basis van e-facturen voor B2B-transacties binnen de EU.

Ook als de wet je niet verplicht, helpt een geldige e-factuur je dus op de lijst van goedgekeurde leveranciers te blijven en sneller betaald te krijgen.

## Duitsland: de B2B-tijdlijn

Duitsland voert verplichte e-facturatie voor binnenlandse B2B-transacties stapsgewijs in:

| Datum                | Wat verandert                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 januari 2025       | Elk in Duitsland gevestigd bedrijf moet e-facturen kunnen **ontvangen**                                                                                               |
| Tot 31 december 2026 | Verzenders mogen papier of, met toestemming van de koper, andere elektronische formaten blijven gebruiken                                                             |
| 1 januari 2027       | Bedrijven met een totale omzet in het vorige jaar boven EUR 800,000 moeten e-facturen **versturen**; kleinere bedrijven mogen in 2027 nog de oude werkwijze gebruiken |
| 1 januari 2028       | Alle in Duitsland gevestigde bedrijven moeten e-facturen versturen (met wettelijke uitzonderingen, zoals kleine ondernemers onder §19 UStG)                           |

De verplichting geldt voor prestaties **tussen bedrijven die allebei in Duitsland gevestigd zijn** (statutaire zetel, bedrijfsleiding of vaste inrichting). Een Zwitsers bedrijf zonder Duitse vestiging valt er doorgaans buiten, ook met een Duits btw-nummer. Duitse klanten mogen e-facturen wel als handelsvoorwaarde eisen en velen doen dat.

Voor Duitse klanten in de **publieke sector** ligt het anders: federale instanties vereisen sinds november 2020 e-facturen; deelstaten en gemeenten hebben eigen regels. Deze facturen vereisen de **Leitweg-ID** van de koper.

## XRechnung versus ZUGFeRD

Beide gelden in Duitsland als e-factuur, mits ze aan EN 16931 voldoen.

|                                | XRechnung                                               | ZUGFeRD                                                 |
| ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------- |
| Wat het is                     | Zuiver XML-bestand, Duitse regelset (CIUS) van EN 16931 | Hybride: een PDF/A-3 met ingebedde XML                  |
| Syntax                         | UBL of CII                                              | CII                                                     |
| Leesbaar voor mensen           | Alleen met een viewer                                   | Ja, het is ook een normale pdf                          |
| Gebruikelijk gebruik           | Publieke sector, grotere bedrijven                      | Private B2B, kleinere bedrijven                         |
| Geldige e-factuur in Duitsland | Ja                                                      | Alleen vanaf profiel EN 16931; MINIMUM en BASIC WL niet |

ZUGFeRD is technisch identiek aan het Franse Factur-X. Vraagt een Duitse klant alleen om een "e-factuur", vraag dan welk formaat het systeem leest. Bij twijfel is XRechnung de veiligste keuze.

## Peppol BIS Billing

**Peppol** is een internationaal netwerk voor de uitwisseling van bedrijfsdocumenten onder beheer van OpenPeppol. Facturen gaan niet per e-mail maar via gecertificeerde **Access Points**: jij stuurt naar jouw Access Point, dat aan het Access Point van de koper levert, waarna de koper de factuur ontvangt. Elke deelnemer wordt gevonden via een **Peppol participant ID**, vaak gebaseerd op een btw- of bedrijfsnummer.

**Peppol BIS Billing 3.0** is het factuurformaat op het netwerk. Het gebruikt UBL en voldoet aan EN 16931. Veel Europese overheden en bedrijven ontvangen facturen alleen via Peppol; ook Duitse XRechnung-facturen kunnen erover worden verstuurd.

Voor verzending via Peppol heb je een Access Point-aanbieder nodig. Een geldig Peppol BIS-bestand maken is de eerste helft; aflevering via het netwerk is de tweede.

## Polen: KSeF

Het Poolse nationale e-factuursysteem (**KSeF**, Krajowy System e-Faktur) is een centraal overheidsplatform. Facturen worden in de nationale XML-structuur **FA(3)** naar KSeF gestuurd, krijgen daar een nummer en worden door de koper opgehaald.

| Datum                | Wat verandert                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1 februari 2026      | Alle belastingplichtigen ontvangen facturen via KSeF; de grootste bedrijven (omzet in 2024 boven PLN 200 miljoen) geven ze daar ook uit |
| 1 april 2026         | Alle overige belastingplichtigen moeten facturen in KSeF uitgeven                                                                       |
| Tot 31 december 2026 | Bedrijven met maximaal PLN 10,000 gefactureerde omzet per maand mogen nog buiten KSeF factureren                                        |

De verplichting geldt voor belastingplichtigen met een **statutaire zetel of vaste inrichting in Polen**. Volgens de officiële KSeF-FAQ hoeft een buitenlandse verkoper zonder beide geen facturen in KSeF uit te geven en mag deze erbuiten factureren; vrijwillig gebruik is mogelijk. Poolse klanten kunnen de voorkeur geven aan de KSeF-structuur omdat deze bij hun boekhouding past.

## Roemenië: RO e-Factura

Roemenië heeft een centraal e-facturatiesysteem, **RO e-Factura**, beheerd door de belastingdienst (ANAF) en bereikbaar via het onlineportaal (SPV) of de API. Facturen volgen **RO_CIUS**, de Roemeense regelset van EN 16931, in UBL of CII. Sinds 2024 moeten facturen tussen in Roemenië gevestigde bedrijven via het systeem lopen om geldig te zijn.

Net als in Polen richten de regels zich op in het land gevestigde bedrijven. Ben je in Roemenië voor btw geregistreerd zonder daar gevestigd te zijn, vraag dan een Roemeense adviseur of en hoe het systeem op jou van toepassing is. Je Roemeense klant heeft hoe dan ook factuurgegevens nodig in een vorm die in de administratie past.

## Wat een Zwitserse verkoper nodig heeft

Ongeacht het formaat bepalen dezelfde gegevens of een e-factuur wordt geaccepteerd. Verzamel ze bij het aanmaken van de klant, niet pas als de eerste factuur wordt afgewezen.

| Gegeven                                                 | Waar het vandaan komt                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Je Zwitserse btw-nummer (CHE-…MWST) en bedrijfsgegevens | Je eigen administratie                                                                           |
| Btw-nummer van de koper (bijv. DE…, PL NIP, RO CUI)     | De klant                                                                                         |
| Kopersreferentie of bestelnummer                        | De klant; XRechnung vereist een kopersreferentie                                                 |
| Leitweg-ID                                              | Duitse overheidsklanten; gebruikt als kopersreferentie                                           |
| Peppol participant ID                                   | De klant, als die via Peppol ontvangt                                                            |
| Gewenst formaat en kanaal                               | De klant: XRechnung UBL of CII, ZUGFeRD, Peppol, e-mail                                          |
| Btw-categorie per regel                                 | Je belastingadviseur: bijv. standaardtarief (S), verlegging (AE) of niet onderworpen aan btw (O) |
| Bankgegevens en valuta                                  | Doorgaans een IBAN en EUR                                                                        |

Twee praktische tips:

- **Valideer voor verzending.** Een bestand dat niet door de validatie van de koper komt wordt behandeld alsof het nooit is verstuurd; de betalingstermijn begint niet.
- **Archiveer de verzonden XML.** Het gestructureerde bestand is de originele factuur, niet de pdf-weergave ervan.

## Hoe Helvetly helpt

Helvetly exporteert een uitgegeven factuur als XRechnung (UBL of CII), Peppol BIS Billing, Poolse KSeF FA(3) of Roemeense e-Factura (RO_CIUS)-XML, met vrijstellingscodes voor btw-vrijgestelde regels. De Leitweg-ID wordt bij de klant bewaard en als kopersreferentie opgenomen; elk geëxporteerd bestand wordt gearchiveerd. Verzending via het Peppol-netwerk zelf vereist een Access Point-aanbieder. XML-export van e-facturen hoort bij Business; Helvetly verstuurt zelf geen facturen via Peppol, KSeF of het Roemeense netwerk.

## Bronnen

- [E-Rechnung: frequently asked questions – Bundesministerium der Finanzen](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html)
- [XRechnung – xeinkauf.de (KoSIT)](https://xeinkauf.de/xrechnung/)
- [eInvoicing and EN 16931 – European Commission](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/eInvoicing)
- [VAT in the Digital Age (ViDA) – European Commission](https://taxation-customs.ec.europa.eu/taxation/vat/vat-digital-age-vida_en)
- [Peppol BIS Billing 3.0 – OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/)
- [Peppol – OpenPeppol](https://peppol.org/)
- [Zasady obowiązywania KSeF i przepisy prawne – ksef.podatki.gov.pl](https://ksef.podatki.gov.pl/ksef-news/zasady-obowiazywania-ksef-i-przepisy-prawne/)
- [KSeF – Krajowy System e-Faktur](https://ksef.podatki.gov.pl/)
- [RO e-Factura technical information – Romanian Ministry of Finance](https://mfinante.gov.ro/en/web/efactura/informatii-tehnice)
- [ANAF – Agenția Națională de Administrare Fiscală](https://www.anaf.ro/)
