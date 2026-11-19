---
title: E-fakturering för schweiziska företag som säljer utomlands
description: Varför EU-kunder ber schweiziska leverantörer om e-fakturor och vad XRechnung, ZUGFeRD, Peppol, polska KSeF och rumänska e-Factura betyder för dig.
category: E-invoicing
categoryLabel: E-fakturering
updated: 2026-11-11
readingMinutes: 8
---

Schweiz har inget generellt krav på e-fakturor mellan företag. Många EU-länder har det redan eller får det snart. Om du säljer till kunder i Tyskland, Polen, Rumänien eller andra EU-länder kommer någon förr eller senare att skriva: ”Vi kan bara godta fakturor i XRechnung-format” eller ”Skicka fakturan via Peppol.”

Guiden förklarar vad som ligger bakom sådana önskemål, vilka regler som faktiskt gäller för en schweizisk säljare och vad du behöver förbereda.

## Vad räknas som en e-faktura?

I EU är en e-faktura inte en PDF som skickas via mejl. Det är en **strukturerad fil** (XML) som köparens program kan läsa och bokföra utan manuell inmatning.

Den gemensamma grunden är den europeiska standarden **EN 16931**. Den definierar fakturans innehåll (säljare, köpare, rader, momsfördelning, betalningsuppgifter) och tillåter två XML-syntaxer: UBL och UN/CEFACT CII. Nationella format som XRechnung, Peppol BIS Billing och rumänska RO_CIUS lägger regelverk ovanpå EN 16931. Polska KSeF använder en egen nationell struktur.

## Varför dina EU-kunder ber om e-fakturor

De flesta önskemålen kommer från kundens skyldigheter, inte dina:

- **Deras leverantörsreskontra digitaliseras.** Företag som måste ta emot och skicka e-fakturor nationellt vill ha en process för alla leverantörer, även utländska.
- **Myndigheter kräver det.** Offentliga myndigheter i EU måste godta e-fakturor enligt EN 16931, och många, inklusive tyska federala myndigheter, godtar inget annat.
- **Gränsöverskridande rapportering kommer.** Enligt EU:s paket ”VAT in the Digital Age” (ViDA) gäller digital rapportering baserad på e-fakturor för B2B-transaktioner inom EU från 1 juli 2030.

Även när lagen inte förpliktar dig kan en giltig e-faktura alltså hjälpa dig att behålla platsen som godkänd leverantör och få betalt snabbare.

## Tyskland: tidsplan för B2B

Tyskland har infört obligatorisk e-fakturering för inhemska B2B-transaktioner stegvis:

| Datum                 | Förändring                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 januari 2025        | Alla företag etablerade i Tyskland måste kunna **ta emot** e-fakturor                                                                         |
| Till 31 december 2026 | Avsändare får fortfarande använda papper eller andra elektroniska format med köparens samtycke                                                |
| 1 januari 2027        | Företag med total omsättning över EUR 800,000 föregående år måste **skicka** e-fakturor; mindre företag får fortsätta som tidigare under 2027 |
| 1 januari 2028        | Alla företag etablerade i Tyskland måste skicka e-fakturor (med lagstadgade undantag, till exempel småföretag enligt §19 UStG)                |

Kravet gäller leveranser **mellan företag som båda är etablerade i Tyskland** (säte, företagsledning eller fast etableringsställe). Ett schweiziskt företag utan etablering i Tyskland omfattas normalt inte, även om det har ett tyskt momsnummer. Tyska kunder får ändå kräva e-fakturor som affärsvillkor, och många gör det.

För tyska kunder i **offentlig sektor** är läget annorlunda: federala myndigheter har krävt e-fakturor sedan november 2020, och delstater och kommuner har egna regler. Dessa fakturor behöver köparens **Leitweg-ID**.

## XRechnung jämfört med ZUGFeRD

Båda följer EN 16931, men förpackningen skiljer sig:

|                             | XRechnung                                        | ZUGFeRD                                                                 |
| --------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Vad det är                  | Ren XML-fil, tyskt regelverk (CIUS) för EN 16931 | Hybrid: PDF/A-3 med inbäddad XML                                        |
| Syntax                      | UBL eller CII                                    | CII                                                                     |
| Läsbart för människor       | Bara med en visare                               | Ja, även en vanlig PDF                                                  |
| Typisk användning           | Offentlig sektor, större företag                 | Privat B2B, mindre företag                                              |
| Giltig e-faktura i Tyskland | Ja                                               | Bara från profilen EN 16931 och uppåt; MINIMUM och BASIC WL gäller inte |

ZUGFeRD är tekniskt identiskt med franska Factur-X. Om en tysk kund bara säger ”e-faktura”, fråga vilket format systemet kan läsa. Vid tvekan är XRechnung det säkraste svaret.

## Peppol BIS Billing

**Peppol** är ett internationellt nätverk för utbyte av affärsdokument som förvaltas av OpenPeppol. I stället för mejl går fakturorna mellan certifierade **Access Points**: du skickar till din Access Point, som levererar till köparens Access Point, som skickar fakturan vidare till köparen. Varje deltagare hittas via ett **Peppol participant ID**, ofta baserat på moms- eller företagsnummer.

**Peppol BIS Billing 3.0** är fakturaformatet på nätverket. Det använder UBL och följer EN 16931. Många europeiska myndigheter och företag tar bara emot fakturor via Peppol, och även tyska XRechnung kan levereras där.

För att skicka via Peppol behöver du en Access Point-leverantör. Att skapa en giltig Peppol BIS-fil är första halvan; leveransen över nätverket är den andra.

## Polen: KSeF

Polens nationella e-fakturasystem (**KSeF**, Krajowy System e-Faktur) är en central statlig plattform. Fakturor skickas till KSeF i den nationella XML-strukturen **FA(3)**, KSeF tilldelar varje faktura ett nummer och köparen hämtar den därifrån.

| Datum                 | Förändring                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1 februari 2026       | Alla skattskyldiga tar emot fakturor via KSeF; de största företagen (försäljning över PLN 200 miljoner under 2024) utfärdar dem också där |
| 1 april 2026          | Alla övriga skattskyldiga måste utfärda fakturor i KSeF                                                                                   |
| Till 31 december 2026 | Företag med fakturerad försäljning upp till PLN 10,000 per månad får fortfarande utfärda fakturor utanför KSeF                            |

Kravet gäller skattskyldiga med **säte eller fast etableringsställe i Polen**. Enligt KSeF:s officiella frågor och svar är en utländsk säljare utan någotdera inte skyldig att utfärda fakturor i KSeF och får fakturera utanför systemet; frivillig användning är möjlig. Polska kunder kan ändå föredra KSeF-strukturen eftersom den passar deras bokföring.

## Rumänien: RO e-Factura

Rumänien har ett centralt e-fakturasystem, **RO e-Factura**, som drivs av skattemyndigheten (ANAF) och nås via dess portal (SPV) eller API. Fakturorna följer **RO_CIUS**, det rumänska regelverket för EN 16931, i UBL eller CII. Sedan 2024 måste fakturor mellan företag etablerade i Rumänien gå genom systemet för att vara giltiga.

Liksom i Polen riktar sig reglerna till företag som är etablerade i landet. Om du är momsregistrerad i Rumänien utan att vara etablerad där bör du fråga en rumänsk rådgivare om och hur systemet gäller dig. Den rumänska kunden behöver i vilket fall dina fakturauppgifter i en form som kan registreras.

## Vad en schweizisk säljare behöver

Oavsett format avgör samma uppgifter om e-fakturan godtas. Samla in dem när du lägger upp kunden, inte när den första fakturan avvisas.

| Uppgift                                                       | Källa                                                                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Ditt schweiziska momsnummer (CHE-…MWST) och företagsuppgifter | Dina egna register                                                                                                    |
| Köparens momsnummer (t.ex. DE…, PL NIP, RO CUI)               | Kunden                                                                                                                |
| Köparreferens eller inköpsordernummer                         | Kunden; XRechnung kräver en köparreferens                                                                             |
| Leitweg-ID                                                    | Tyska offentliga köpare; används som köparreferens                                                                    |
| Peppol participant ID                                         | Kunden, om den tar emot via Peppol                                                                                    |
| Önskat format och kanal                                       | Kunden: XRechnung UBL eller CII, ZUGFeRD, Peppol, mejl                                                                |
| Momskategori per rad                                          | Din skatterådgivare: t.ex. standardsats (S), omvänd skattskyldighet (AE) eller utanför momsens tillämpningsområde (O) |
| Bankuppgifter och valuta                                      | Vanligtvis IBAN och EUR                                                                                               |

Två praktiska tips:

- **Validera innan du skickar.** En fil som inte klarar köparens validering avvisas som om den aldrig skickats, och betalningsfristen börjar inte löpa.
- **Arkivera XML-filen du skickade.** Den strukturerade filen är originalfakturan, inte PDF-visningen av den.

## Så hjälper Helvetly

Helvetly exporterar en utfärdad faktura som XML i XRechnung (UBL eller CII), Peppol BIS Billing, polska KSeF FA(3) eller rumänska e-Factura (RO_CIUS), med undantagskoder för momsbefriade rader. Kundens Leitweg-ID lagras hos kunden och följer med som köparreferens, och varje exporterad fil arkiveras. Leverans över själva Peppol-nätverket kräver en Access Point-leverantör. Export av e-fakturor som XML ingår i Business; Helvetly levererar inte självt fakturor via Peppol, KSeF eller det rumänska nätverket.

## Källor

- [E-Rechnung, vanliga frågor – Bundesministerium der Finanzen](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html)
- [XRechnung – xeinkauf.de (KoSIT)](https://xeinkauf.de/xrechnung/)
- [E-fakturering och EN 16931 – Europeiska kommissionen](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/eInvoicing)
- [VAT in the Digital Age (ViDA) – Europeiska kommissionen](https://taxation-customs.ec.europa.eu/taxation/vat/vat-digital-age-vida_en)
- [Peppol BIS Billing 3.0 – OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/)
- [Peppol – OpenPeppol](https://peppol.org/)
- [KSeF:s tillämpningsregler och lagstiftning – ksef.podatki.gov.pl](https://ksef.podatki.gov.pl/ksef-news/zasady-obowiazywania-ksef-i-przepisy-prawne/)
- [KSeF – Krajowy System e-Faktur](https://ksef.podatki.gov.pl/)
- [RO e-Factura, teknisk information – rumänska finansministeriet](https://mfinante.gov.ro/en/web/efactura/informatii-tehnice)
- [ANAF – Agenția Națională de Administrare Fiscală](https://www.anaf.ro/)
