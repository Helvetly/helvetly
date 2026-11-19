# Zásady ochrany osobních údajů

## 1. Kdo jsme

Helvetly („Helvetly“, „my“) provozuje web helvetly.com, dokumentaci na docs.helvetly.com, platformu
Helvetly a klientský portál. Kontakt pro ochranu údajů:
[support@helvetly.com](mailto:support@helvetly.com).

Helvetly je služba pro podniky. Není určena dětem.

## 2. Dvě role

- **Správce** údajů osob používajících Helvetly: údaje o účtu a přihlašování, účtování tarifů Helvetly, bezpečnostní údaje, zpětná vazba a žádosti o podporu a web.
- **Zpracovatel** obchodních údajů, které naši zákazníci uchovávají ve svých pracovních prostorech: jejich klienti a kontakty (včetně osob přihlašujících se do klientského portálu zákazníka), faktury, výdaje, dokumenty, žádosti o podpis a podepisující, zakázky, importy pomocí AI, konverzace s Heidi a personální a mzdové záznamy zaměstnanců. Správcem těchto údajů je zákazník; zpracováváme je pouze podle jeho pokynů na základě [smlouvy o zpracování údajů](dpa.md). Jste-li klientem, kontaktní osobou, podepisujícím či zaměstnancem zákazníka, obraťte se ohledně svých údajů na něj.

**Zaměstnanecké a mzdové údaje.** Zákazník s tarifem Business může v Helvetly vést personální
a mzdové záznamy: totožnost (jméno, osobní číslo zaměstnance), kontaktní údaje, údaje o zaměstnání
(pozice, oddělení, typ smlouvy, data, výpovědní doba, pracovní doba, místo a země výkonu práce,
země bydliště a sociálního zabezpečení, postavení přeshraničního pracovníka), mzdové podmínky
a zadané či importované mzdové údaje, čísla sociálního zabezpečení (například švýcarské číslo
AHV/AVS), daňové identifikátory, bankovní údaje, status srážkové daně a kanton a dokumenty nahrané
pro zaměstnance (například smlouvy, výplatní pásky či povolení). Helvetly nepočítá mzdy, daně
ani odvody, neukládá údaje o zdraví či nepřítomnosti a nemá pole pro jiné zvláštní kategorie údajů;
nahrané dokumenty mohou takové údaje obsahovat a odpovídá za to zákazník. Helvetly nezískává
zaměstnanecké ani mzdové záznamy pro požadavky OpenAI. Tyto záznamy nejsou dostupné přes MCP
ani osobní API tokeny. Použitelný právní základ (například GDPR čl. 6 odst. 1 písm. b a c a čl. 88,
nDSG, čl. 328b švýcarského závazkového zákoníku nebo čl. 50e–50g AHVG pro číslo AHV) určuje
zákazník jako správce; podrobnosti uvádí [smlouva o zpracování údajů](dpa.md).

## 3. Co zpracováváme jako správce, proč a na jakém základě

| Údaje                                                                                                                                                                                                                                                        | Účel                                                     | Základ (GDPR)                                                                     | Doba uchovávání                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| E-mailová adresa, jméno, profilový obrázek (z Googlu při jeho použití nebo nahraná fotografie), přihlašovací identity, přístupové klíče (pouze veřejné klíče), nastavení dvoufaktorového ověřování (tajný klíč šifrovaný AES-GCM; obnovovací kódy hashované) | Vytvoření a zabezpečení účtu, přihlášení                 | Smlouva (čl. 6 odst. 1 písm. b)                                                   | Do smazání účtu; poté se přihlašovací údaje smažou a profil anonymizuje (e-mail se nahradí, jméno a fotografie odstraní) |
| Relace: prohlížeč, operační systém, IP adresa, čas přihlášení, poslední aktivita                                                                                                                                                                             | Zobrazení a ukončování aktivních relací, zabezpečení     | Oprávněný zájem na zabezpečení (čl. 6 odst. 1 písm. f)                            | Do ukončení nebo vypršení relace (standardně 30 dní); vypršené relace se odstraňují                                      |
| Jednorázové přihlašovací kódy a neúspěšné pokusy o dvoufaktorové ověření                                                                                                                                                                                     | Ochrana před převzetím účtu                              | Oprávněný zájem (čl. 6 odst. 1 písm. f)                                           | Kódy: platnost v minutách, odstranění po 24 hodinách; neúspěšné pokusy: do dalšího úspěšného přihlášení                  |
| Osobní API tokeny: název, rozsahy oprávnění, první znaky, vytvoření a poslední použití (samotný token pouze jako hash SHA-256)                                                                                                                               | Připojení vašich vlastních nástrojů                      | Smlouva                                                                           | Do odvolání nebo vypršení tokenu; po uzavření účtu jsou odmítány                                                         |
| E-mail vlastníka pracovního prostoru, název prostoru, fakturační adresa a daňové číslo zadané při platbě, tarif, místa a stav platby (údaje karty zůstávají u Stripe)                                                                                        | Účtování tarifů Helvetly                                 | Smlouva; zákonná povinnost uchovávat účetní záznamy (čl. 6 odst. 1 písm. c)       | 10 let u účetních záznamů (švýcarský závazkový zákoník čl. 958f)                                                         |
| Kdo zahájil bezplatné zkušební období, jako jednosměrné otisky účtu, e-mailu a otisku karty (nikdy karta)                                                                                                                                                    | Poskytnutí jednoho zkušebního období každému zákazníkovi | Oprávněný zájem na předcházení zneužití zkušebních období (čl. 6 odst. 1 písm. f) | 24 měsíců od začátku zkušebního období, poté smazání                                                                     |
| Zpětná vazba a hlášení problémů: popis, navštívená stránka, až pět snímků obrazovky, účet a pracovní prostor                                                                                                                                                 | Odpověď a zlepšování Helvetly                            | Oprávněný zájem (čl. 6 odst. 1 písm. f)                                           | 2 roky po uzavření hlášení; hlášení jsou také zasílána do e-mailové schránky našeho týmu                                 |
| Odesílané e-maily: přihlašovací kódy, pozvánky, oznámení, bezpečnostní upozornění, souhrny                                                                                                                                                                   | Provoz služby                                            | Smlouva                                                                           | Po dobu, po kterou poskytovatel e-mailů uchovává protokoly doručení                                                      |
| Chybové protokoly (trasa, chyba, čas) a protokoly poskytovatele hostingu (mohou obsahovat IP adresy)                                                                                                                                                         | Provoz a zabezpečení služby                              | Oprávněný zájem                                                                   | 30 dní. Aplikace sama nevede přístupový protokol; chyby zaznamenává bez tokenů z URL                                     |

Osobní údaje neprodáváme, nepoužíváme je k reklamě, neprofilujeme vás a nerozhodujeme o vás
výhradně automatizovaně (nDSG čl. 21, GDPR čl. 22).

**Cookies a úložiště prohlížeče.** Web (www.helvetly.com) používá Google Analytics 4 k počítání
návštěv a zjišťování, které stránky a kanály přivádějí návštěvníky; ukládá cookies Google `_ga`
(až na 2 roky) a odesílá zobrazení stránek a údaje o zařízení Googlu, který IP adresu používá
pouze k odvození přibližné polohy a neukládá ji (oprávněný zájem, čl. 6 odst. 1 písm. f). Blokování
cookies nebo skriptů v prohlížeči tuto funkci vypne. Dokumentace neukládá cookies a nepoužívá
analytiku, reklamu ani sledování. Platforma (app.helvetly.com) používá Google Analytics 4 stejně,
ale odesílá pouze adresu každé stránky bez dotazu či fragmentu, nikdy zadávaný obsah ani údaje
pracovního prostoru. Po přihlášení přidává pseudonym účtu a pracovního prostoru (hash s klíčem,
který Google nemůže přiřadit zpět k vám) a vaši roli, aby se návštěvy z více zařízení počítaly jako
jedna osoba. Klientský portál analytiku nenačítá. Kromě cookies Google `_ga` platforma a klientský
portál ukládají pouze cookies nezbytné pro přihlašování:

| Název                     | Nastavuje        | Účel                                              | Platnost                   |
| ------------------------- | ---------------- | ------------------------------------------------- | -------------------------- |
| `helvetly_session`        | Platforma        | Udržuje přihlášení                                | Do odhlášení nebo 30 dní   |
| `helvetly_login`          | Platforma        | Chrání probíhající přihlášení přes Google         | 10 minut                   |
| `helvetly_portal_session` | Klientský portál | Udržuje klienta zákazníka přihlášeného do portálu | Do odhlášení nebo vypršení |

Platforma v místním úložišti prohlížeče uchovává také předvolby zobrazení (například sbalený
postranní panel, vybrané sloupce tabulky, období přehledu či zavřené oznámení). Tyto údaje nikdy
neopouštějí prohlížeč. Testovací prostředí API v dokumentaci uchovává vložený API token pouze
v úložišti relace dané karty prohlížeče.

## 4. Heidi, import pomocí AI a OpenAI

Použití AI schvalujete jednou za sebe v každém pracovním prostoru. Schválení zahrnuje všechny
nástroje AI v něm; neschvaluje jiného člena ani se nepřenáší do jiného pracovního prostoru.
Odmítnutí či zavření dialogu nespustí žádnou akci AI. Helvetly zaznamenává verzi tohoto oznámení,
kterou jste schválili: po změně přestávají předchozí schválení platit a každý člen jednou schválí
novou verzi, než se jeho obsah znovu odešle. Schválení můžete kdykoli odvolat; od té chvíle se nic,
co v daném pracovním prostoru odešlete nebo nahrajete, neposílá do OpenAI.

Heidi odpovídá na řadu otázek z údajů pracovního prostoru bez externí služby. Pro jiné otázky,
**import pomocí AI** (čtení nahraných souborů a návrhy záznamů), čtení účtenek, návrh názvu
pracovního prostoru a **automatické třídění** nahraných dokumentů používá Helvetly API OpenAI
(OpenAI, USA) pouze po vašem vlastním schválení pro daný pracovní prostor. Import pomocí AI,
čtení účtenek a automatické třídění jsou dostupné v tarifech zahrnujících import pomocí AI.

Co se odesílá:

- Heidi odesílá napsanou zprávu, až 20 předchozích zpráv dané konverzace (mohou obsahovat hodnoty, které vám Heidi ukázala) a soubory přiložené ke zprávě. Do OpenAI se posílá také krátká kontrola, zda zpráva souvisí s Helvetly nebo vaším podnikáním.
- Import pomocí AI odesílá obsah vybraných souborů po částech; čtení účtenek odesílá vybranou účtenku.
- Návrh názvu pracovního prostoru odesílá pouze zadaný název firmy.
- **Automatické třídění:** po nahrání souboru do Dokumentů Helvetly na pozadí odesílá název a typ souboru, začátek jeho textu (až přibližně 6 000 bajtů), nebo pokud nemá čitelný text, samotné PDF či obrázek (do 4 MiB; větší soubor pouze názvem), spolu s názvy až 200 složek pracovního prostoru a až 50 používanými štítky. Model navrhne štítky a složku; výsledek můžete vrátit zpět.
- Před každým požadavkem se tentýž obsah posílá také na endpoint OpenAI pro počítání tokenů, aby se ověřil vůči limitu AI pracovního prostoru.

Helvetly nezískává pro požadavky AI záznamy Zaměstnanců či Mezd ani soubory uložené u zaměstnance
a mzdové importy čte bez AI. Pokud takové údaje vložíte do zprávy, přiložíte je nebo nahrajete do
Dokumentů místo zaměstnaneckého záznamu, odešlou se jako jakýkoli jiný obsah; proto to nedělejte.

Žádáme OpenAI, aby požadavky a odpovědi neuchovávalo jako uložený stav aplikace (`store: false`).
To je oddělené od vlastního uchovávání OpenAI: podle podmínek API mohou být data API uchovávána
až 30 dní k odhalování zneužití a nepoužívají se k trénování modelů, pokud se zákazník API
nerozhodne sdílet data s OpenAI. Helvetly uchovává vlastní údaje odděleně: konverzace s Heidi
se ukládají v Helvetly, zatím bez pevné lhůty výmazu, do smazání účtu (ve smazaném pracovním
prostoru zůstávají uloženy s ostatními záznamy); importované soubory, záznamy a roztříděné dokumenty
zůstávají v pracovním prostoru jako jiná data. Heidi je označena jako asistentka AI; její odpovědi,
importované záznamy a návrhy třídění mohou být chybné a jsou návrhy k vaší kontrole.

## 5. Příjemci a předávání do zahraničí

Služby zpracovávající údaje pro nás uvádí [subprocessors.md](subprocessors.md). Některé sídlí v USA
(Stripe, Google, OpenAI, Cloudflare). Údaje předáváme do zahraničí pouze tam, kde to dovoluje
nDSG čl. 16–17 a kapitola V GDPR: do zemí uznaných Spolkovou radou či Evropskou komisí za země
s odpovídající ochranou (u USA společnosti certifikované v rámci Swiss–US a EU–US Data Privacy
Framework), nebo na základě standardních smluvních doložek uznaných FDPIC a Evropskou komisí.

Helvetly nic neposílá daňovým úřadům ani sítím elektronické fakturace: zákazníci stahují přiznání
k DPH a soubory elektronických faktur a podávají je sami.

## 6. Vaše práva

Můžete požádat o přístup k údajům (nDSG čl. 25, GDPR čl. 15), o opravu nebo výmaz, vznést námitku
proti zpracování či požádat o jeho omezení a získat údaje v běžném strojově čitelném formátu
(nDSG čl. 28, GDPR čl. 20). Odpovíme do 30 dní (GDPR: jeden měsíc s prodloužením, pokud je zákon
povoluje). Většinu můžete udělat sami:

- **Stažení vašich údajů:** Nastavení účtu → Vaše údaje poskytne soubor JSON s profilem, přihlašovacími metodami, přístupovými klíči, relacemi, API tokeny (bez samotných tokenů), pracovními prostory, zprávami pro Heidi a odeslanou zpětnou vazbou.
- **Údaje pracovního prostoru:** vlastník stáhne vše, co pracovní prostor obsahuje (záznamy a soubory), jako ZIP v Nastavení → Pracovní prostor → Exportovat všechna data, včetně zaměstnaneckých a mzdových údajů v samostatné složce.
- **Smazání účtu:** Nastavení účtu → Smazat účet. Přihlašovací metody, relace a členství se smažou, konverzace s Heidi se smažou a profil se anonymizuje. Záznamy vytvořené v pracovním prostoru patří tomuto prostoru a zůstanou v něm bez vašeho jména či adresy; o odstranění požádejte jeho vlastníka nebo nás.

Vlastník, který pracovní prostor smazal, jej může do 30 dní obnovit. Krátce po smazání úloha
na pozadí také ukládá archivní kopii: ZIP záznamů a souborů pracovního prostoru včetně
zaměstnaneckých a mzdových údajů se záznamem o tom, kdo a kdy jej smazal a kdo byl členem.
Zachycuje pracovní prostor v podobě při běhu úlohy.

Smazaný pracovní prostor již není nikomu dostupný, ale jeho záznamy, soubory a archivní kopie
zůstávají uloženy; Helvetly je zatím automaticky nemaže a lhůta výmazu nebyla stanovena. Záznamy,
které vyžadují účetní předpisy (faktury, účtenky, auditní protokol: 10 let, OR čl. 958f a GeBüV),
se uchovávají alespoň po tuto dobu. Pro dřívější výmaz, pokud jej zákon dovoluje, nebo jiné
záležitosti napište na [support@helvetly.com](mailto:support@helvetly.com); nejprve vás můžeme
požádat o ověření totožnosti. Stížnost můžete podat švýcarskému spolkovému pověřenci pro ochranu
údajů a informace (FDPIC, www.edoeb.admin.ch) nebo v EU svému národnímu dozorovému úřadu.

## 7. Zabezpečení

Přihlašování bez hesla (Google, e-mailové kódy, přístupové klíče) s volitelným dvoufaktorovým
ověřováním; tokeny relací a API ukládané pouze jako hashe SHA-256; šifrovaná připojení; oddělení
údajů pracovních prostorů v každém dotazu; finanční záznamy v protokolu s hashovým řetězcem,
do kterého lze pouze přidávat; při příslušném nastavení úložiště jsou vystavené faktury
a zaúčtované účtenky chráněny před smazáním (S3 Object Lock); uložené údaje jsou šifrované
a pravidelně zálohované.

## 8. Změny

Změny zveřejňujeme zde s datem. Poslední změna: 18. listopadu 2026.
