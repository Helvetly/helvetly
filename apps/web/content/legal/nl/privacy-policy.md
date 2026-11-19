# Privacybeleid

## 1. Wie wij zijn

Helvetly ('Helvetly', 'wij') beheert de website helvetly.com, de documentatie op docs.helvetly.com,
het Helvetly-platform en het klantenportaal. Contact voor gegevensbescherming:
[support@helvetly.com](mailto:support@helvetly.com).

Helvetly is een dienst voor ondernemingen en richt zich niet op kinderen.

## 2. Twee rollen

- **Verwerkingsverantwoordelijke** voor gegevens van mensen die Helvetly gebruiken: account- en aanmeldgegevens, facturering van Helvetly-abonnementen, beveiligingsgegevens, feedback en ondersteuningsverzoeken, en de website.
- **Verwerker** voor bedrijfsgegevens die klanten in hun werkruimten bewaren: hun klanten en contacten (inclusief personen die inloggen op het klantenportaal van een klant), facturen, kosten, documenten, ondertekenverzoeken en ondertekenaars, opdrachten, AI-imports, Heidi-gesprekken en personeels- en loonregistraties van hun werknemers. De klant is hiervoor verwerkingsverantwoordelijke; wij verwerken uitsluitend op diens instructies, op grond van de [verwerkersovereenkomst](dpa.md). Ben je een klant, contactpersoon, ondertekenaar of werknemer van een klant, neem dan met die klant contact op over je gegevens.

**Werknemers- en loongegevens.** Een klant met Business kan personeels- en loonregistraties in
Helvetly bijhouden: identiteit (naam, personeelsnummer), contactgegevens, dienstverbandgegevens
(functie, afdeling, contracttype, datums, opzegtermijn, werktijd, werkplek en werkland, woonland en
socialezekerheidsland, grensarbeidersstatus), loonvoorwaarden en ingevoerde of geïmporteerde
loongegevens, socialezekerheidsnummers (zoals het Zwitserse AHV/AVS-nummer), fiscale
identificatienummers, bankgegevens, bronbelastingstatus en kanton, en documenten die de klant
voor een werknemer uploadt (zoals contracten, loonstroken of vergunningen). Helvetly berekent geen
loon, belasting of premies, bewaart geen gezondheids- of afwezigheidsgegevens en heeft geen velden
voor andere bijzondere categorieën gegevens; geüploade documenten kunnen zulke gegevens bevatten,
waarvoor de klant verantwoordelijk is. Helvetly haalt geen werknemers- of loonregistraties op
voor OpenAI-verzoeken. Deze gegevens zijn niet beschikbaar via MCP of persoonlijke API-tokens.
Welke rechtsgrond geldt (bijvoorbeeld GDPR art. 6(1)(b) en (c) en art. 88, de nDSG, art. 328b van het
Zwitserse verbintenissenrecht of art. 50e–50g AHVG voor het AHV-nummer) bepaalt de klant als
verwerkingsverantwoordelijke; de [verwerkersovereenkomst](dpa.md) beschrijft de details.

## 3. Wat wij als verwerkingsverantwoordelijke verwerken, waarom en op welke grondslag

| Gegevens                                                                                                                                                                                                                        | Doel                                             | Grondslag (GDPR)                                                           | Bewaartermijn                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E-mailadres, naam, profielfoto (van Google bij gebruik daarvan, of een geüploade foto), aanmeldidentiteiten, passkeys (alleen publieke sleutels), tweefactorinstellingen (geheim versleuteld met AES-GCM; herstelcodes gehasht) | Je account aanmaken en beveiligen, je aanmelden  | Overeenkomst (art. 6(1)(b))                                                | Tot je het account verwijdert; daarna worden aanmeldgegevens verwijderd en wordt het profiel geanonimiseerd (e-mailadres vervangen, naam en foto verwijderd) |
| Sessies: browser, besturingssysteem, IP-adres, aanmeldtijd, laatste activiteit                                                                                                                                                  | Actieve sessies tonen en beëindigen, beveiliging | Gerechtvaardigd belang bij beveiliging (art. 6(1)(f))                      | Tot de sessie eindigt of verloopt (standaard 30 dagen); verlopen sessies worden verwijderd                                                                   |
| Eenmalige aanmeldcodes en mislukte tweefactorpogingen                                                                                                                                                                           | Accountovername voorkomen                        | Gerechtvaardigd belang (art. 6(1)(f))                                      | Codes: minuten geldig, na 24 uur verwijderd; mislukte pogingen: tot de volgende geslaagde aanmelding                                                         |
| Persoonlijke API-tokens: naam, scopes, eerste tekens, aanmaak en laatste gebruik (het token zelf uitsluitend als SHA-256-hash)                                                                                                  | Je eigen tools verbinden                         | Overeenkomst                                                               | Tot intrekking of verloop van het token; geweigerd zodra je account is gesloten                                                                              |
| E-mailadres van werkruimte-eigenaar, werkruimtenaam, factuuradres en fiscaal nummer ingevoerd bij afrekenen, abonnement, plaatsen en betaalstatus (kaartgegevens blijven bij Stripe)                                            | Helvetly-abonnementen factureren                 | Overeenkomst; wettelijke bewaarplicht voor boekhoudgegevens (art. 6(1)(c)) | 10 jaar voor boekhoudgegevens (Zwitsers verbintenissenrecht art. 958f)                                                                                       |
| Wie een gratis proefperiode begon, als eenrichtingshashes van account, e-mailadres en kaartvingerafdruk (nooit de kaart)                                                                                                        | Elke klant één proefperiode geven                | Gerechtvaardigd belang bij voorkomen van proefmisbruik (art. 6(1)(f))      | 24 maanden vanaf het begin van de proefperiode, daarna verwijderd                                                                                            |
| Feedback en probleemmeldingen: je beschrijving, de bezochte pagina, maximaal vijf schermafbeeldingen, je account en werkruimte                                                                                                  | Je antwoorden en Helvetly verbeteren             | Gerechtvaardigd belang (art. 6(1)(f))                                      | 2 jaar na afsluiting van de melding; meldingen worden ook naar de inbox van ons team gemaild                                                                 |
| E-mails die we versturen: aanmeldcodes, uitnodigingen, mededelingen, beveiligingswaarschuwingen, overzichten                                                                                                                    | De dienst laten werken                           | Overeenkomst                                                               | Zolang de e-mailaanbieder zijn bezorglogboeken bewaart                                                                                                       |
| Foutlogs (route, fout, tijd) en logbestanden van onze hostingaanbieder (kunnen IP-adressen bevatten)                                                                                                                            | De dienst beheren en beveiligen                  | Gerechtvaardigd belang                                                     | 30 dagen. De applicatie zelf houdt geen toegangslog bij; fouten worden gelogd zonder tokens uit URL's                                                        |

We verkopen geen persoonsgegevens, gebruiken deze niet voor reclame, profileren je niet en nemen
geen besluiten over je uitsluitend op geautomatiseerde wijze (nDSG art. 21, GDPR art. 22).

**Cookies en browseropslag.** De website (www.helvetly.com) gebruikt Google Analytics 4 om bezoeken
te tellen en te zien welke pagina's en kanalen bezoekers brengen; zij plaatst de `_ga`-cookies
van Google (maximaal 2 jaar) en verstuurt paginaweergaven en apparaatgegevens naar Google, dat het
IP-adres uitsluitend gebruikt voor een geschatte locatie en niet opslaat (gerechtvaardigd belang,
art. 6(1)(f)). Cookies of scripts blokkeren in je browser schakelt dit uit. De documentatie plaatst
geen cookies en gebruikt geen analyse, reclame of tracking. Het platform (app.helvetly.com)
gebruikt Google Analytics 4 op dezelfde manier, maar verstuurt uitsluitend het adres van elke
pagina zonder query of fragment, nooit je invoer of gegevens uit je werkruimte. Na aanmelding
voegt het een pseudoniem van je account en werkruimte toe (een hash met sleutel die Google niet
naar je kan herleiden) en je rol, zodat bezoeken vanaf meerdere apparaten als één persoon tellen.
Het klantenportaal laadt geen analyse. Behalve Googles `_ga`-cookies plaatsen platform en
klantenportaal alleen cookies die strikt noodzakelijk zijn voor aanmelden:

| Naam                      | Geplaatst door | Doel                                                   | Geldigheidsduur           |
| ------------------------- | -------------- | ------------------------------------------------------ | ------------------------- |
| `helvetly_session`        | Platform       | Houdt je aangemeld                                     | Tot afmelden, of 30 dagen |
| `helvetly_login`          | Platform       | Beschermt een lopende Google-aanmelding                | 10 minuten                |
| `helvetly_portal_session` | Klantenportaal | Houdt een klant van een klant aangemeld in het portaal | Tot afmelden of verloop   |

Het platform bewaart weergavevoorkeuren ook in de lokale browseropslag (bijvoorbeeld een ingeklapte
zijbalk, gekozen tabelkolommen, dashboardperiode of gesloten melding). Deze verlaten je browser
nooit. De API-proefomgeving in de documentatie bewaart een geplakt API-token uitsluitend in de
sessieopslag van dat browsertabblad.

## 4. Heidi, AI-import en OpenAI

Je keurt AI-gebruik eenmaal voor jezelf goed in elke werkruimte. Dit omvat alle AI-functies daar;
het keurt geen ander lid goed en wordt niet overgenomen in een andere werkruimte. Weigeren of
sluiten van het goedkeuringsvenster start geen AI-actie. Helvetly registreert welke versie van
deze informatie je hebt goedgekeurd: wanneer deze verandert, gelden eerdere goedkeuringen niet
meer en keurt elk lid de nieuwe versie eenmaal goed voordat diens inhoud opnieuw wordt verstuurd.
Je kunt de goedkeuring altijd intrekken; vanaf dat moment gaat niets wat je in die werkruimte
verstuurt of uploadt naar OpenAI.

Heidi beantwoordt veel vragen uit de gegevens van je werkruimte zonder externe dienst. Voor andere
vragen, **AI-import** (bestanden lezen en gegevens voorstellen), bonnetjes uitlezen, suggesties
voor werkruimtenamen en **automatische ordening** van geüploade documenten gebruikt Helvetly de
OpenAI-API (OpenAI, VS), uitsluitend na je eigen goedkeuring voor die werkruimte. AI-import,
bonnetjes uitlezen en automatische ordening zijn beschikbaar in abonnementen met AI-import.

Wat wordt verstuurd:

- Heidi verstuurt je geschreven bericht, maximaal 20 eerdere berichten uit dat gesprek (die door Heidi getoonde cijfers kunnen bevatten) en bestanden die je aan dat bericht toevoegt. Een korte controle of het bericht over Helvetly of je bedrijf gaat wordt ook naar OpenAI verstuurd.
- AI-import verstuurt de inhoud van je gekozen bestanden, deel voor deel; bonnetjes uitlezen verstuurt de gekozen bon.
- De suggestie voor een werkruimtenaam verstuurt alleen de ingevoerde bedrijfsnaam.
- **Automatische ordening:** nadat je een bestand naar Documenten uploadt, verstuurt Helvetly op de achtergrond de naam en het type, het begin van de tekst (tot ongeveer 6.000 bytes) of, als er geen leesbare tekst is, de pdf of afbeelding zelf (tot 4 MiB; een groter bestand alleen met zijn naam), met de namen van maximaal 200 werkruimtemappen en maximaal 50 gebruikte tags. Het model stelt tags en een map voor; je kunt het resultaat ongedaan maken.
- Vóór elk verzoek wordt dezelfde inhoud ook naar het endpoint voor tokentelling van OpenAI verstuurd om deze aan de AI-limiet van de werkruimte te toetsen.

Helvetly haalt geen Werknemers- of Loonadministratieregistraties of bestanden bij werknemers op
voor AI-verzoeken, en loonimports worden zonder AI gelezen. Plak je zulke gegevens in een bericht,
voeg je ze bij of upload je ze naar Documenten in plaats van het werknemersdossier, dan worden ze
als andere inhoud verstuurd; doe dit daarom niet.

We vragen OpenAI verzoeken en antwoorden niet als opgeslagen applicatiestatus te bewaren
(`store: false`). Dit staat los van OpenAI's eigen bewaartermijnen: volgens de API-voorwaarden
kunnen API-gegevens maximaal 30 dagen worden bewaard om misbruik op te sporen en worden ze niet
gebruikt voor modeltraining tenzij de API-klant ervoor kiest gegevens met OpenAI te delen. Helvetly
bewaart eigen gegevens afzonderlijk: Heidi-gesprekken worden in Helvetly bewaard, nog zonder vaste
verwijdertermijn, totdat je je account verwijdert (in een verwijderde werkruimte blijven ze samen
met andere gegevens opgeslagen); geïmporteerde bestanden, registraties en geordende documenten
blijven in de werkruimte zoals andere gegevens. Heidi is aangeduid als AI-assistent; antwoorden,
geïmporteerde gegevens en ordeningsvoorstellen kunnen onjuist zijn en zijn suggesties die je moet controleren.

## 5. Ontvangers en doorgifte naar het buitenland

De diensten die voor ons gegevens verwerken staan in [subprocessors.md](subprocessors.md).
Sommige bevinden zich in de VS (Stripe, Google, OpenAI, Cloudflare). We verstrekken gegevens alleen
in het buitenland waar nDSG art. 16–17 en GDPR hoofdstuk V dat toestaan: aan landen die de Zwitserse
Bondsraad of de Europese Commissie als adequaat erkennen (voor de VS: ondernemingen gecertificeerd
onder het Swiss–US en EU–US Data Privacy Framework), of onder de door FDPIC en Europese Commissie
erkende standaardcontractbepalingen.

Helvetly verstuurt niets naar belastingautoriteiten of e-facturatienetwerken: klanten downloaden
btw-aangiften en e-factuurbestanden en dienen deze zelf in.

## 6. Je rechten

Je kunt inzage vragen (nDSG art. 25, GDPR art. 15), gegevens laten corrigeren of verwijderen,
bezwaar maken tegen verwerking of deze beperken, en gegevens in een gangbaar machineleesbaar
formaat ontvangen (nDSG art. 28, GDPR art. 20). We antwoorden binnen 30 dagen (GDPR: één maand,
verlengbaar waar de wet dit toestaat). Het meeste kun je zelf doen:

- **Je gegevens downloaden:** Accountinstellingen → Je gegevens levert een JSON-bestand met je profiel, aanmeldmethoden, passkeys, sessies, API-tokens (zonder de tokens), werkruimten, je Heidi-berichten en verstuurde feedback.
- **Werkruimtegegevens:** een eigenaar downloadt alles uit een werkruimte (gegevens en bestanden) als ZIP via Instellingen → Werkruimte → Alle gegevens exporteren, inclusief werknemers- en loongegevens in een aparte map.
- **Je account verwijderen:** Accountinstellingen → Account verwijderen. Je aanmeldmethoden, sessies en lidmaatschappen worden verwijderd, Heidi-gesprekken worden verwijderd en je profiel geanonimiseerd. Gegevens die je in een werkruimte hebt aangemaakt behoren daartoe en blijven daar zonder je naam of adres; vraag de eigenaar of ons om verwijdering.

De eigenaar die een werkruimte heeft verwijderd kan deze binnen 30 dagen herstellen. Kort daarna
slaat een achtergrondtaak ook een archiefkopie op: een ZIP van gegevens en bestanden, inclusief
werknemers- en loongegevens, met een notitie wie de werkruimte wanneer verwijderde en wie de leden
waren. Deze geeft de werkruimte weer zoals die is wanneer de taak draait.

Niemand kan meer bij een verwijderde werkruimte, maar gegevens, bestanden en archiefkopie blijven
opgeslagen; Helvetly wist deze nog niet automatisch en er is nog geen verwijdertermijn vastgesteld.
Gegevens waarvoor een boekhoudkundige bewaarplicht geldt (facturen, bonnen, auditlog: 10 jaar, OR
art. 958f en GeBüV) worden minstens die termijn bewaard. Schrijf naar
[support@helvetly.com](mailto:support@helvetly.com) voor eerdere verwijdering waar de wet dit toestaat
of voor andere vragen; we kunnen eerst om bevestiging van je identiteit vragen. Je kunt een klacht
indienen bij de Zwitserse toezichthouder (FDPIC, www.edoeb.admin.ch) of, in de EU, je nationale
gegevensbeschermingsautoriteit.

## 7. Beveiliging

Aanmelden zonder wachtwoord (Google, e-mailcodes, passkeys) met optionele tweefactorauthenticatie;
sessie- en API-tokens uitsluitend als SHA-256-hashes opgeslagen; versleutelde verbindingen;
werkruimtegegevens gescheiden in elke query; financiële gegevens in een uitsluitend aanvulbaar,
via hashes gekoppeld log; waar de opslag ervoor is ingesteld zijn uitgegeven facturen en geboekte
bonnen tegen verwijdering vergrendeld (S3 Object Lock); opgeslagen gegevens worden versleuteld en
regelmatig geback-upt.

## 8. Wijzigingen

We publiceren wijzigingen hier met hun datum. Laatst gewijzigd: 18 november 2026.
