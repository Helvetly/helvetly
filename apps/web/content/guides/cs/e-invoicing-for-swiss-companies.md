---
title: E-fakturace pro švýcarské firmy prodávající do zahraničí
description: Proč zákazníci z EU požadují od švýcarských dodavatelů e-faktury a co pro vás znamenají XRechnung, ZUGFeRD, Peppol, polský KSeF a rumunská e-Factura.
category: E-invoicing
updated: 2026-11-11
readingMinutes: 8
---

Ve Švýcarsku neexistuje obecná povinnost zasílat mezi firmami e-faktury. Mnoho zemí EU ji má nebo brzy zavede. Pokud prodáváte zákazníkům v Německu, Polsku, Rumunsku či jiných zemích EU, dříve či později vám někdo napíše: „Přijímáme pouze faktury ve formátu XRechnung“ nebo „Pošlete prosím fakturu přes Peppol“.

Tento průvodce vysvětluje důvody těchto požadavků, pravidla platná pro švýcarského dodavatele a co si připravit.

## Co se považuje za e-fakturu

V EU není e-faktura PDF zaslané e-mailem. Je to **strukturovaný soubor** (XML), který software odběratele dokáže přečíst a zaúčtovat bez ručního přepisování.

Společným základem je evropská norma **EN 16931**. Definuje obsah faktury (dodavatele, odběratele, položky, rozpis DPH, platební údaje) a připouští dvě syntaxe XML: UBL a UN/CEFACT CII. Národní formáty jako XRechnung, Peppol BIS Billing či rumunský RO_CIUS přidávají pravidla nad EN 16931. Polský KSeF používá vlastní národní strukturu.

## Proč zákazníci z EU požadují e-faktury

Většina žádostí vychází z povinností zákazníka, nikoli vašich:

- **Digitalizují zpracování přijatých faktur.** Firmy, které musí doma přijímat a odesílat e-faktury, chtějí jednotný postup pro všechny dodavatele včetně zahraničních.
- **Veřejné instituce je vyžadují.** Veřejné orgány v celé EU musí přijímat e-faktury podle EN 16931 a mnohé, včetně německých spolkových orgánů, nic jiného nepřijímají.
- **Blíží se přeshraniční vykazování.** Podle balíčku EU „VAT in the Digital Age“ (ViDA) bude od 1. července 2030 platit digitální vykazování založené na e-fakturách pro B2B transakce uvnitř EU.

I když vás tedy zákon nezavazuje, schopnost odeslat platnou e-fakturu pomáhá zůstat mezi schválenými dodavateli a urychluje platby.

## Německo: harmonogram B2B

Německo zavedlo povinné e-faktury pro domácí B2B transakce postupně:

| Datum                | Co se mění                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. ledna 2025        | Každá firma usazená v Německu musí být schopna **přijímat** e-faktury                                                                             |
| Do 31. prosince 2026 | Odesílatelé mohou stále používat papír nebo se souhlasem odběratele jiné elektronické formáty                                                     |
| 1. ledna 2027        | Firmy s celkovým obratem za předchozí rok nad EUR 800,000 musí e-faktury **odesílat**; menší mohou během roku 2027 pokračovat dosavadním způsobem |
| 1. ledna 2028        | Všechny firmy usazené v Německu musí odesílat e-faktury (se zákonnými výjimkami, například malé firmy podle §19 UStG)                             |

Povinnost se týká plnění **mezi firmami, které jsou obě usazené v Německu** (sídlo, místo vedení či stálá provozovna). Švýcarská firma bez provozovny v Německu do tohoto okruhu zpravidla nespadá, ani když má německé DIČ. Němečtí zákazníci přesto mohou e-faktury požadovat jako obchodní podmínku a mnozí to dělají.

Pro německé zákazníky z **veřejného sektoru** platí jiná pravidla: spolkové orgány požadují e-faktury od listopadu 2020 a spolkové země a obce mají vlastní pravidla. Tyto faktury potřebují **Leitweg-ID** odběratele.

## XRechnung vs ZUGFeRD

Oba formáty jsou v Německu přijímány jako e-faktury, pokud splňují EN 16931.

|                            | XRechnung                                              | ZUGFeRD                                                   |
| -------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Co to je                   | Čistý soubor XML, německá pravidla (CIUS) nad EN 16931 | Hybrid: PDF/A-3 s vloženým XML                            |
| Syntaxe                    | UBL nebo CII                                           | CII                                                       |
| Čitelnost člověkem         | Jen pomocí prohlížeče                                  | Ano, jde také o běžné PDF                                 |
| Obvyklé využití            | Veřejný sektor, větší firmy                            | Soukromé B2B, menší firmy                                 |
| Platná e-faktura v Německu | Ano                                                    | Pouze od profilu EN 16931 výše; MINIMUM a BASIC WL nikoli |

ZUGFeRD je technicky totožný s francouzským Factur-X. Pokud německý zákazník uvede jen „e-faktura“, zeptejte se, jaký formát jeho systém čte. Při pochybnostech je nejbezpečnější volbou XRechnung.

## Peppol BIS Billing

**Peppol** je mezinárodní síť pro výměnu obchodních dokumentů spravovaná organizací OpenPeppol. Faktury místo e-mailu procházejí certifikovanými **přístupovými body (Access Points)**: odešlete je svému bodu, ten je doručí bodu odběratele a ten odběrateli. Každý účastník má **Peppol participant ID**, často odvozené od DIČ či čísla firmy.

**Peppol BIS Billing 3.0** je formát faktur v této síti. Používá UBL a splňuje EN 16931. Mnoho evropských veřejných institucí a firem přijímá faktury jen přes Peppol a lze jím doručovat i německý XRechnung.

Pro odesílání přes Peppol potřebujete poskytovatele přístupového bodu. Vytvoření platného souboru Peppol BIS je první polovina; doručení sítí je druhá.

## Polsko: KSeF

Polský národní systém e-faktur (**KSeF**, Krajowy System e-Faktur) je centrální státní platforma. Faktury se do KSeF odesílají v národní struktuře XML **FA(3)**, KSeF jim přiděluje čísla a odběratel si je odtud stahuje.

| Datum                | Co se mění                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. února 2026        | Všichni daňoví poplatníci přijímají faktury přes KSeF; největší firmy (tržby za rok 2024 nad PLN 200 milionů) je tam také vystavují |
| 1. dubna 2026        | Všichni ostatní daňoví poplatníci musí vystavovat faktury v KSeF                                                                    |
| Do 31. prosince 2026 | Firmy s fakturovanými tržbami do PLN 10,000 měsíčně mohou dál vystavovat mimo KSeF                                                  |

Povinnost platí pro poplatníky se **sídlem nebo stálou provozovnou v Polsku**. Podle oficiálních častých otázek KSeF zahraniční dodavatel bez sídla i provozovny nemusí vystavovat v KSeF a může fakturovat mimo něj; dobrovolné použití je možné. Polští zákazníci mohou přesto upřednostňovat strukturu KSeF, protože odpovídá jejich účetnictví.

## Rumunsko: RO e-Factura

Rumunsko provozuje centrální systém **RO e-Factura**, který spravuje daňová správa ANAF a zpřístupňuje portál SPV nebo API. Faktury používají **RO_CIUS**, rumunská pravidla EN 16931, v UBL či CII. Od roku 2024 musí faktury mezi firmami usazenými v Rumunsku projít systémem, aby byly platné.

Stejně jako v Polsku se pravidla soustředí na firmy usazené v zemi. Pokud jste v Rumunsku registrováni k DPH, ale nejste tam usazeni, ověřte u rumunského poradce, zda a jak se na vás systém vztahuje. Rumunský zákazník každopádně potřebuje údaje faktury v podobě vhodné k evidenci.

## Co potřebuje švýcarský dodavatel

Bez ohledu na formát rozhodují o přijetí e-faktury stejné údaje. Získejte je při zakládání zákazníka, ne až po odmítnutí první faktury.

| Údaj                                           | Odkud pochází                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Vaše švýcarské DIČ (CHE-…MWST) a firemní údaje | Vaše evidence                                                                                                |
| DIČ odběratele (například DE…, PL NIP, RO CUI) | Zákazník                                                                                                     |
| Reference odběratele nebo číslo objednávky     | Zákazník; XRechnung vyžaduje referenci odběratele                                                            |
| Leitweg-ID                                     | Němečtí veřejní odběratelé; používá se jako reference odběratele                                             |
| Peppol participant ID                          | Zákazník, pokud přijímá přes Peppol                                                                          |
| Preferovaný formát a kanál                     | Zákazník: XRechnung UBL nebo CII, ZUGFeRD, Peppol, e-mail                                                    |
| Kategorie DPH každé položky                    | Váš daňový poradce: například standardní sazba (S), přenesení daňové povinnosti (AE) či mimo předmět DPH (O) |
| Bankovní údaje a měna                          | Obvykle IBAN a EUR                                                                                           |

Dvě praktické rady:

- **Před odesláním ověřte platnost.** Soubor, který neprojde kontrolou odběratele, je odmítnut jako neodeslaný a nezačne běžet lhůta splatnosti.
- **Archivujte odeslané XML.** Originální fakturou je strukturovaný soubor, ne jeho zobrazení v PDF.

## Jak pomáhá Helvetly

Helvetly exportuje vystavené faktury jako XML XRechnung (UBL nebo CII), Peppol BIS Billing, polský KSeF FA(3) či rumunskou e-Factura (RO_CIUS), s kódy osvobození u položek osvobozených od DPH. Leitweg-ID zákazníka je uloženo u klienta a přenáší se do reference odběratele. Každý exportovaný soubor se archivuje. Doručování sítí Peppol vyžaduje poskytovatele přístupového bodu. Export XML e-faktur je součástí Business; Helvetly samo nedoručuje faktury přes Peppol, KSeF ani rumunskou síť.

## Zdroje

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
