# Integritetspolicy

## 1. Vilka vi är

Helvetly (”Helvetly”, ”vi”) driver webbplatsen helvetly.com, dokumentationen på docs.helvetly.com,
Helvetly-plattformen och kundportalen. Kontakt för dataskydd:
[support@helvetly.com](mailto:support@helvetly.com).

Helvetly är en tjänst för företag. Den riktar sig inte till barn.

## 2. Två roller

- **Personuppgiftsansvarig** för uppgifter om personer som använder Helvetly: konto- och inloggningsuppgifter, fakturering av Helvetly-abonnemang, säkerhetsuppgifter, återkoppling och supportärenden samt webbplatsen.
- **Personuppgiftsbiträde** för affärsuppgifter som våra kunder lagrar i sina arbetsytor: deras kunder och kontakter (inklusive personer som loggar in i en kunds kundportal), fakturor, utgifter, dokument, signeringsförfrågningar och undertecknare, uppdrag, AI-importer, Heidi-konversationer och personal- och löneregister för deras anställda. Kunden är personuppgiftsansvarig för dessa uppgifter; vi behandlar dem enbart enligt kundens instruktioner enligt [personuppgiftsbiträdesavtalet](dpa.md). Om du är kund, kontaktperson, undertecknare eller anställd hos en kund ska du kontakta den kunden om dina uppgifter.

**Personal- och löneuppgifter.** En kund med Business-abonnemang kan föra personal- och
löneregister i Helvetly: identitet (namn, anställningsnummer), kontaktuppgifter,
anställningsuppgifter (befattning, avdelning, avtalstyp, datum, uppsägningstid, arbetstid,
arbetsplats och arbetsland, bosättningsland och socialförsäkringsland, gränsarbetarstatus),
lönevillkor och de lönebelopp kunden anger eller importerar, socialförsäkringsnummer (till exempel
schweiziskt AHV/AVS-nummer), skattenummer, bankuppgifter, källskattestatus och kanton samt dokument
som kunden laddar upp för en anställd (till exempel avtal, lönespecifikationer eller tillstånd).
Helvetly beräknar inte lön, skatt eller avgifter, lagrar inga hälso- eller frånvarouppgifter och
har inga fält för andra särskilda kategorier av uppgifter; dokument som kunden laddar upp kan
innehålla sådana uppgifter, vilket är kundens ansvar. Helvetly hämtar inte personal- eller
löneregister för OpenAI-förfrågningar. Dessa poster är inte tillgängliga via MCP eller personliga
API-token. Kunden fastställer som personuppgiftsansvarig vilken rättslig grund som gäller
(till exempel GDPR art. 6.1 b och c och art. 88, nDSG, art. 328b i den schweiziska obligationsrätten
eller art. 50e–50g AHVG för AHV-numret); [personuppgiftsbiträdesavtalet](dpa.md) beskriver detaljerna.

## 3. Vad vi behandlar som personuppgiftsansvarig, varför och på vilken grund

| Uppgifter                                                                                                                                                                                                                                | Ändamål                                     | Grund (GDPR)                                                               | Lagringstid                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| E-postadress, namn, profilbild (från Google om det används, eller ett uppladdat foto), inloggningsidentiteter, passkeys (endast publika nycklar), tvåfaktorsinställningar (hemlighet krypterad med AES-GCM; återställningskoder hashade) | Skapa och skydda ditt konto, logga in dig   | Avtal (art. 6.1 b)                                                         | Tills du raderar kontot; då raderas inloggningsuppgifter och profilen anonymiseras (e-post ersätts, namn och foto tas bort) |
| Sessioner: webbläsare, operativsystem, IP-adress, inloggningstid, senaste aktivitet                                                                                                                                                      | Visa och avsluta aktiva sessioner, säkerhet | Berättigat intresse av säkerhet (art. 6.1 f)                               | Tills sessionen avslutas eller löper ut (30 dagar som standard); utgångna sessioner tas bort                                |
| Engångskoder för inloggning och misslyckade tvåfaktorsförsök                                                                                                                                                                             | Förhindra kontokapning                      | Berättigat intresse (art. 6.1 f)                                           | Koder: giltiga i minuter, tas bort efter 24 timmar; misslyckade försök: till nästa lyckade inloggning                       |
| Personliga API-token: namn, behörighetsomfattning, första tecken, skapande och senaste användning (själva token endast som SHA-256-hash)                                                                                                 | Låta dig ansluta egna verktyg               | Avtal                                                                      | Tills du återkallar token eller den löper ut; avvisas när kontot stängts                                                    |
| Arbetsytans ägares e-postadress, arbetsytans namn, faktureringsadress och skattenummer som anges i kassan, abonnemang, platser och betalningsstatus (kortuppgifter stannar hos Stripe)                                                   | Fakturera Helvetly-abonnemang               | Avtal; rättslig skyldighet att bevara bokföringsmaterial (art. 6.1 c)      | 10 år för bokföringsmaterial (schweiziska obligationsrätten art. 958f)                                                      |
| Vem som startade en gratis provperiod, som envägshashar av kontot, dess e-postadress och kortets fingeravtryck (aldrig kortet)                                                                                                           | Ge varje kund en provperiod                 | Berättigat intresse av att förhindra missbruk av provperioder (art. 6.1 f) | 24 månader från provperiodens start, därefter radering                                                                      |
| Återkoppling och felrapporter: beskrivning, sidan du var på, upp till fem skärmbilder, ditt konto och din arbetsyta                                                                                                                      | Svara dig och förbättra Helvetly            | Berättigat intresse (art. 6.1 f)                                           | 2 år efter att ärendet stängts; rapporter skickas även till teamets e-postinkorg                                            |
| E-post vi skickar: inloggningskoder, inbjudningar, meddelanden, säkerhetsvarningar, sammanställningar                                                                                                                                    | Driva tjänsten                              | Avtal                                                                      | Så länge e-postleverantören sparar sina leveransloggar                                                                      |
| Felloggar (rutt, fel, tid) och driftleverantörens loggar (kan innehålla IP-adresser)                                                                                                                                                     | Driva och skydda tjänsten                   | Berättigat intresse                                                        | 30 dagar. Applikationen skriver själv ingen åtkomstlogg; den loggar fel utan token från URL:er                              |

Vi säljer inte personuppgifter, anpassar inte reklam, profilerar dig inte och fattar inga
beslut om dig enbart automatiserat (nDSG art. 21, GDPR art. 22).

**Valfri annonsmätning.** Med ditt samtycke kan Google Ads koppla ett annonsklick till en ny registrering hos Helvetly. Google får klickets identifierare, webbläsar- och nätverksuppgifter samt ett slumpmässigt konverterings-ID. Händelsen innehåller ingen e-postadress eller information från arbetsytan. Google använder förstapartskakor för tillskrivning (`_gcl_*`). Helvetly sparar ditt val i 180 dagar och registreringsmarkören i högst tio minuter. Du kan neka eller återkalla samtycket under Annonsmätning i sidfoten (artikel 6.1 a i GDPR).

**Cookies och webbläsarlagring.** Webbplatsen (www.helvetly.com) använder Google Analytics 4 för
att räkna besök och se vilka sidor och kanaler som ger besökare; den sätter Googles `_ga`-cookies
(upp till 2 år) och skickar sidvisningar och enhetsuppgifter till Google, som endast använder
IP-adressen för att härleda en ungefärlig plats och inte lagrar den (berättigat intresse,
art. 6.1 f). Om du blockerar cookies eller skript i webbläsaren stängs detta av. Dokumentationen
sätter inga cookies och använder ingen analys, reklam eller spårning. Plattformen
(app.helvetly.com) använder Google Analytics 4 på samma sätt men skickar enbart varje sidas adress
utan frågesträng eller fragment, aldrig det du skriver in eller uppgifter i arbetsytan. När du
är inloggad lägger den till en pseudonym för kontot och arbetsytan (en nycklad hash som Google
inte kan spåra tillbaka till dig) och din roll, så att besök från flera enheter räknas som en
person. Kundportalen laddar ingen analys. Utöver valfri annonsmätning och Googles `_ga`-cookies sätter plattformen och
kundportalen bara cookies som är strikt nödvändiga för inloggning:

| Namn                      | Sätts av     | Ändamål                                   | Livslängd                         |
| ------------------------- | ------------ | ----------------------------------------- | --------------------------------- |
| `helvetly_session`        | Plattformen  | Håller dig inloggad                       | Tills du loggar ut eller 30 dagar |
| `helvetly_login`          | Plattformen  | Skyddar en pågående inloggning med Google | 10 minuter                        |
| `helvetly_portal_session` | Kundportalen | Håller kundens kund inloggad i portalen   | Till utloggning eller utgång      |

Plattformen sparar också visningsinställningar i webbläsarens lokala lagring (till exempel
hopfälld sidopanel, valda tabellkolumner, period i översikten eller ett avfärdat meddelande).
De lämnar aldrig webbläsaren. Dokumentationens API-testmiljö sparar ett inklistrat API-token
enbart i sessionslagringen för den webbläsarfliken.

## 4. Heidi, AI-import och OpenAI

Du godkänner AI-användning en gång för dig själv i varje arbetsyta. Godkännandet omfattar alla
AI-verktyg där; det godkänner inte en annan medlem och gäller inte i en annan arbetsyta. Att
avböja eller stänga dialogen startar ingen AI-åtgärd. Helvetly registrerar vilken version av
denna information du godkänt: när informationen ändras upphör tidigare godkännanden att gälla
och varje medlem godkänner den nya versionen en gång innan innehåll skickas igen. Du kan när
som helst återkalla ditt godkännande; därefter skickas inget du skriver eller laddar upp i
arbetsytan till OpenAI.

Heidi besvarar många frågor från arbetsytans poster utan någon extern tjänst. För andra frågor,
**AI-import** (läsa uppladdade filer och föreslå poster), kvittoläsning, förslag på arbetsytenamn
och **automatisk sortering** av uppladdade dokument använder Helvetly OpenAI:s API (OpenAI, USA)
endast efter ditt eget godkännande för arbetsytan. AI-import, kvittoläsning och automatisk
sortering är tillgängliga i de abonnemang som omfattar AI-import.

Vad som skickas:

- Heidi skickar meddelandet du skriver, upp till 20 tidigare meddelanden i konversationen (som kan innehålla belopp Heidi visat dig) och filer du bifogar till meddelandet. En kort kontroll av om meddelandet handlar om Helvetly eller ditt företag skickas också till OpenAI.
- Beroende på din fråga skickar Heidi även begränsade resultat från arbetsytans uppgifter som du har tillgång till (inklusive företags- och kunduppgifter), innehållet i ett dokument som du ber henne läsa, identifierare för den aktuella sidan och dess tillgängliga kontroller samt den svarsstil du valt.
- AI-import skickar innehållet i valda filer, del för del; kvittoläsning skickar kvittot du väljer.
- Förslaget på arbetsytenamn skickar endast företagsnamnet du anger.
- **Automatisk sortering:** efter att du laddat upp en fil i Dokument skickar Helvetly i bakgrunden filens namn och typ, början av texten (upp till cirka 6 000 byte) eller, om den saknar läsbar text, själva PDF-filen eller bilden (upp till 4 MiB; en större fil endast med namn), tillsammans med namnen på upp till 200 mappar i arbetsytan och upp till 50 använda taggar. Modellen föreslår taggar och en mapp; du kan ångra resultatet.
- Före varje förfrågan skickas samma innehåll också till OpenAI:s endpoint för tokenräkning, för att kontrollera det mot arbetsytans AI-kvot.

Helvetly hämtar inte poster från Anställda eller Löner, eller filer som sparats för en anställd,
för AI-förfrågningar, och löneimporter läses utan AI. Om du klistrar in sådana uppgifter i ett
meddelande, bifogar dem eller laddar upp dem i Dokument i stället för i den anställdas post
skickas de som annat innehåll, så gör inte det.

Vi ber OpenAI att inte behålla förfrågningar och svar som lagrat applikationstillstånd
(`store: false`). Detta är skilt från OpenAI:s egen lagring: enligt API-villkoren kan API-data
lagras i upp till 30 dagar för att upptäcka missbruk och används inte för att träna modeller om
inte API-kunden väljer att dela data med OpenAI. Helvetly lagrar sina egna uppgifter separat:
Heidi-konversationer sparas i Helvetly, ännu utan fast raderingsfrist, tills du raderar kontot
(i en raderad arbetsyta förblir de lagrade med övriga poster); importerade filer, poster och
sorterade dokument ligger kvar i arbetsytan som andra uppgifter. Heidi är märkt som AI-assistent;
svaren, importerade poster och sorteringsförslag kan vara felaktiga och är förslag som du ska granska.

Helvetly räknar slutförda sökningar och åtgärder per ämne för att föreslå frågor i kommande chattar i den här arbetsytan. I kontoinställningarna kan du se och rensa både räknarna och din svarsstil eller stänga av minnet. Räknarna stannar i Helvetly.

## 5. Mottagare och överföringar utomlands

Tjänster som behandlar uppgifter för oss listas i [subprocessors.md](subprocessors.md). Vissa
finns i USA (Stripe, Google, OpenAI, Cloudflare). Vi lämnar endast ut uppgifter utomlands där
nDSG art. 16–17 och GDPR kapitel V tillåter det: till länder som förbundsrådet eller Europeiska
kommissionen erkänner som adekvata (för USA företag certifierade enligt Swiss–US och EU–US Data
Privacy Framework), eller med stöd av standardavtalsklausuler erkända av FDPIC och Europeiska kommissionen.

Helvetly skickar inget till skattemyndigheter eller e-faktureringsnätverk: kunder laddar ned
momsdeklarationer och e-fakturafiler och lämnar in dem själva.

## 6. Dina rättigheter

Du kan begära tillgång till dina uppgifter (nDSG art. 25, GDPR art. 15), få dem rättade eller
raderade, invända mot eller begränsa behandling och få dem i ett vanligt maskinläsbart format
(nDSG art. 28, GDPR art. 20). Vi svarar inom 30 dagar (GDPR: en månad, med förlängning där lagen
tillåter). Det mesta kan du göra själv:

- **Ladda ned dina uppgifter:** Kontoinställningar → Dina uppgifter ger en JSON-fil med profil, inloggningsmetoder, passkeys, sessioner, API-token (utan själva token), arbetsytor, dina Heidi-meddelanden och inskickad återkoppling.
- **Arbetsytans uppgifter:** en ägare laddar ned allt i arbetsytan (poster och filer) som ZIP i Inställningar → Arbetsyta → Exportera alla uppgifter, inklusive personal- och löneuppgifter i en separat mapp.
- **Radera ditt konto:** Kontoinställningar → Radera konto. Inloggningsmetoder, sessioner och medlemskap raderas, Heidi-konversationer raderas och profilen anonymiseras. Poster du skapat i en arbetsyta tillhör arbetsytan och stannar där utan ditt namn eller din adress; be arbetsytans ägare eller oss om du vill få dem borttagna.

Ägaren som raderade en arbetsyta kan återställa den inom 30 dagar. Kort efter raderingen sparar
ett bakgrundsjobb även en arkivkopia: en ZIP med arbetsytans poster och filer, inklusive personal-
och löneuppgifter, och en anteckning om vem som raderade den, när och vilka medlemmarna var.
Den visar arbetsytan som den är när jobbet körs.

En raderad arbetsyta kan inte längre nås av någon, men poster, filer och arkivkopian förblir
lagrade; Helvetly raderar dem ännu inte automatiskt och någon raderingsfrist har inte fastställts.
Poster som måste bevaras enligt bokföringslagstiftningen (fakturor, kvitton, granskningslogg:
10 år, OR art. 958f och GeBüV) sparas minst så länge. Skriv till
[support@helvetly.com](mailto:support@helvetly.com) för tidigare radering där lagen tillåter det
eller i andra frågor; vi kan först be dig styrka din identitet. Du kan klaga hos den schweiziska
federala dataskydds- och informationskommissionären (FDPIC, www.edoeb.admin.ch) eller i EU hos din
nationella dataskyddsmyndighet.

## 7. Säkerhet

Lösenordsfri inloggning (Google, e-postkoder, passkeys) med valfri tvåfaktorsautentisering;
sessions- och API-token lagras endast som SHA-256-hashar; krypterade anslutningar; varje arbetsytas
uppgifter separeras i varje databasfråga; ekonomiska poster i en hashkedjad logg där poster endast
kan läggas till; där lagringen är konfigurerad för det skyddas utfärdade fakturor och bokförda
kvitton mot radering (S3 Object Lock); lagrade uppgifter krypteras och säkerhetskopieras regelbundet.

## 8. Ändringar

Vi publicerar ändringar här med datum. Senast ändrad: 18 november 2026.
