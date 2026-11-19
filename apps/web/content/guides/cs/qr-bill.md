---
title: Švýcarský QR účet
description: Co je švýcarský QR účet, jaký IBAN a referenci použít, jak vypadá platební část a které chyby vedou k odmítnutí.
category: Getting paid
updated: 2026-11-11
readingMinutes: 7
---

QR účet je standardní švýcarská platební složenka. Nahradil oranžové a červené složenky, které banky přestaly zpracovávat 30. září 2022. Při fakturaci švýcarským klientům jej zákazníci očekávají: naskenují kód v bankovní aplikaci a všechna pole se vyplní.

Pravidla určuje SIX v Swiss Implementation Guidelines for the QR-bill. Tento průvodce vysvětluje to podstatné pro malou firmu.

## Co obsahuje QR účet

QR účet je pruh dole na faktuře (nebo samostatné stránce) se dvěma částmi:

| Část          | Rozměry              | Účel                                                   |
| ------------- | -------------------- | ------------------------------------------------------ |
| Potvrzení     | 62 × 105 mm, vlevo   | Plátce si jej ponechá v evidenci                       |
| Platební část | 148 × 105 mm, vpravo | Obsahuje Swiss QR Code a stejné údaje v čitelném textu |

Celkem 210 × 105 mm, spodní třetina stránky A4.

**Swiss QR Code** má 46 × 46 mm a uprostřed švýcarský kříž. Obsahuje všechny platební údaje: účet, jméno a adresu příjemce, částku a měnu, jméno a adresu plátce, referenci a volitelnou zprávu. Textová pole vedle kódu údaje opakují pro kontrolu člověkem nebo platbu na poště.

Hlavní omezení údajů:

- **Měna:** pouze CHF nebo EUR.
- **Částka:** až 999,999,999.99 nebo prázdná pro doplnění plátcem.
- **Doplňující informace:** celkem až 140 znaků pro volnou zprávu a strukturované fakturační informace.
- **Alternativní postupy:** až dvě položky, například eBill.

## QR-IBAN nebo IBAN: výběr reference

Nejdůležitější rozhodnutí je účet a typ reference. Existují tři kombinace:

| Účet       | Reference                                         | Kdy použít                                                       |
| ---------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| QR-IBAN    | QR reference (QRR), 27 číslic                     | Chcete automatické párování plateb a banka vám přidělila QR-IBAN |
| Běžný IBAN | Reference věřitele (SCOR), ISO 11649, začíná „RF“ | Chcete automatické párování s běžným účtem                       |
| Běžný IBAN | Bez reference (NON)                               | Jednoduché případy s nízkým objemem; ruční párování              |

Jak je rozlišit:

- **QR-IBAN** vypadá jako běžný švýcarský IBAN, ale bankovní identifikátor (pozice 5 až 9) je v rozsahu 30000 až 31999. Banka jej vydá pro stejný účet jako běžný IBAN.
- **QR reference** má 27 číslic. Poslední je kontrolní (modulo 10, rekurzivně), takže se zachytí překlepy.
- **Reference věřitele** začíná „RF“, následují dvě kontrolní číslice a až 21 vlastních znaků.

Pravidlo způsobující nejvíce odmítnutí: **QR-IBAN vždy vyžaduje QR referenci a QR reference funguje jen s QR-IBAN.** Běžný IBAN používá referenci věřitele nebo žádnou.

Při použití reference banka hlásí tuto referenci v elektronickém výpisu (camt.054 nebo camt.053), takže účetní software dokáže označit správnou fakturu za uhrazenou bez ruční práce.

## Adresy: pouze strukturované

Od účinnosti verze 2.3 pokynů SIX v listopadu 2025 QR kód přijímá jen **strukturované adresy** (typ „S“). Ulice, číslo budovy, PSČ, město a země mají vlastní pole. Starší kombinovaný typ („K“) s ulicí a městem ve volných řádcích už není povolen. Stejná verze také umožňuje rozšířenou znakovou sadu Swiss Payment Standards.

Pokud fakturační nástroj nebo evidence zákazníků stále ukládá adresy jako volný text, opravte to nejprve. Jde o nejběžnější důvod, proč QR účet ze staršího softwaru nejde naskenovat.

## Rozložení platební části

Pokyny určují rozložení, aby každý účet vypadal stejně:

- Nadpis „Payment part“ vlevo nahoře, pod ním QR kód.
- Měna a částka pod kódem.
- Vpravo: Account / Payable to, Reference, Additional information, Payable by.
- Pokud částka nebo plátce není uveden, tiskne se prázdný rámeček s vyznačenými rohy.
- Písma: Arial, Frutiger, Helvetica nebo Liberation Sans, černě na bílém. Nadpisy jsou tučné.
- Potvrzení ukazuje stejný účet, referenci, plátce a částku, navíc „Acceptance point“.

Popisky musí být v jednom z jazyků povolených pokyny: němčině, francouzštině, italštině nebo angličtině.

## Čára s nůžkami

Potvrzení a platební část jsou určeny k odtržení a samostatnému zaplacení. Označení závisí na médiu:

- **Tisk na papír:** oddělovací čáry mezi fakturou a QR účtem i mezi potvrzením a platební částí musí být perforované.
- **Odeslání jako PDF:** stejné čáry jsou plné nebo přerušované, se symbolem nůžek nebo textem „Separate before paying in“ nad čarou.

## Časté chyby

| Chyba                                        | Následek                       | Řešení                                             |
| -------------------------------------------- | ------------------------------ | -------------------------------------------------- |
| QR-IBAN se SCOR nebo bez reference           | Banka odmítne platbu           | Použijte QR referenci nebo běžný IBAN              |
| Běžný IBAN s QR referencí                    | Platba odmítnuta               | Použijte SCOR nebo žádnou referenci                |
| Nestrukturovaná adresa (typ K)               | Kód již není platný            | Ukládejte ulici, číslo, PSČ a město zvlášť         |
| Chybná kontrolní číslice reference           | Skenovací aplikace kód odmítne | Reference generujte v softwaru, nikdy ručně        |
| Zmenšený nebo neostrý QR kód                 | Kód nelze naskenovat           | Tiskněte ostře v plném rozměru 46 × 46 mm          |
| Jiná měna než CHF či EUR                     | Není dovoleno                  | Pro QR účet fakturujte v CHF nebo EUR              |
| Údaje odesílatele neodpovídají majiteli účtu | Zpoždění či dotazy k platbě    | Použijte přesné jméno a adresu registrované k účtu |

Před odesláním první sady vyzkoušejte několik účtů vlastní bankovní aplikací a test zopakujte po aktualizaci softwaru.

## eBill vs QR účet

eBill je švýcarská služba elektronických účtů provozovaná SIX. Účet přijde přímo do elektronického bankovnictví zákazníka, který jej tam schválí.

|                   | QR účet                            | eBill                                      |
| ----------------- | ---------------------------------- | ------------------------------------------ |
| Doručení          | Papír či PDF, poštou nebo e-mailem | V elektronickém bankovnictví plátce        |
| Akce plátce       | Naskenovat kód, potvrdit           | Schválit v bankovnictví                    |
| Kdo může přijímat | Kdokoli                            | Plátci registrovaní u vaší firmy pro eBill |
| Co nastavujete vy | Bankovní účet (a QR-IBAN pro QRR)  | Smlouvu se síťovým partnerem eBill         |

Oba způsoby se doplňují. Mnoho firem nabízí eBill registrovaným klientům a ostatním posílá QR účet. QR účet může v poli alternativních postupů také uvádět dostupnost eBill.

## Jak pomáhá Helvetly

Helvetly přidává QR účet ke každé faktuře v CHF či EUR, s QR referencí pro QR-IBAN nebo referencí věřitele pro běžný IBAN a se strukturovanými adresami. Upomínky a splátkové kalendáře mají vlastní QR účty: upomínka na celkový dluh a každá splátka s vlastní referencí.

## Zdroje

- [QR-bill – SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html)
- [Swiss Implementation Guidelines for the QR-bill, version 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf)
- [QR-bill version 2.3 delta guide – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-delta-guide-v2.3-en.pdf)
- [New requirements for the QR-bill: factsheet for SMEs – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/factsheet-qr-bill-transition-period-sme-en.pdf)
- [eBill – SIX](https://www.ebill.ch/en/)
