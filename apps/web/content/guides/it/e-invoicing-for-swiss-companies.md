---
title: Fatturazione elettronica per aziende svizzere che vendono all’estero
description: Perché i clienti UE chiedono fatture elettroniche ai fornitori svizzeri e cosa significano per te XRechnung, ZUGFeRD, Peppol, KSeF polacco ed e-Factura rumeno.
category: E-invoicing
categoryLabel: Fatturazione elettronica
updated: 2026-11-11
readingMinutes: 8
---

In Svizzera non esiste un obbligo generale di inviare fatture elettroniche tra imprese. Molti paesi UE lo prevedono già o lo introdurranno presto. Se vendi a clienti in Germania, Polonia, Romania o altri paesi UE, prima o poi qualcuno ti scriverà: «Possiamo accettare solo fatture in formato XRechnung» oppure «Invia la fattura tramite Peppol».

Questa guida spiega cosa c’è dietro queste richieste, quali regole si applicano davvero a un venditore svizzero e cosa preparare.

## Cosa si intende per fattura elettronica

Nell’UE, una fattura elettronica non è un PDF inviato via email. È un **file strutturato** (XML) che il software dell’acquirente può leggere e contabilizzare senza inserimento manuale.

La base comune è lo standard europeo **EN 16931**. Definisce il contenuto di una fattura (venditore, acquirente, righe, ripartizione IVA, dati di pagamento) e ammette due sintassi XML: UBL e UN/CEFACT CII. I formati nazionali come XRechnung, Peppol BIS Billing o RO_CIUS rumeno aggiungono regole a EN 16931. Il KSeF polacco usa una propria struttura nazionale.

## Perché i clienti UE chiedono fatture elettroniche

La maggior parte delle richieste deriva dagli obblighi del cliente, non dai tuoi:

- **La loro contabilità fornitori si digitalizza.** Le imprese che devono ricevere e inviare fatture elettroniche nel proprio paese vogliono un unico processo per tutti i fornitori, compresi quelli esteri.
- **Gli enti pubblici le richiedono.** Le autorità pubbliche nell’UE devono accettare fatture elettroniche conformi a EN 16931 e molte, comprese le autorità federali tedesche, non accettano altro.
- **Arriva la comunicazione transfrontaliera dei dati.** Il pacchetto UE "VAT in the Digital Age" (ViDA) prevede comunicazioni digitali basate su fatture elettroniche per le operazioni B2B intra-UE dal 1° luglio 2030.

Anche quando la legge non ti obbliga, poter inviare una fattura elettronica valida ti mantiene nell’elenco dei fornitori approvati e aiuta a incassare più rapidamente.

## Germania: calendario B2B

La Germania ha introdotto gradualmente l’obbligo di fatturazione elettronica per le operazioni B2B nazionali:

| Data                     | Cosa cambia                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1° gennaio 2025          | Ogni impresa stabilita in Germania deve poter **ricevere** fatture elettroniche                                                                                                       |
| Fino al 31 dicembre 2026 | Chi emette può ancora usare carta o altri formati elettronici con il consenso dell’acquirente                                                                                         |
| 1° gennaio 2027          | Le imprese con cifra d’affari complessiva dell’anno precedente superiore a EUR 800,000 devono **inviare** fatture elettroniche; le più piccole possono continuare come prima nel 2027 |
| 1° gennaio 2028          | Tutte le imprese stabilite in Germania devono inviare fatture elettroniche, salvo eccezioni legali come le piccole imprese ai sensi del §19 UStG                                      |

L’obbligo riguarda prestazioni **tra imprese entrambe stabilite in Germania**, con sede legale, direzione o stabile organizzazione. Un’azienda svizzera senza stabile organizzazione in Germania generalmente non vi rientra, anche se possiede un numero IVA tedesco. I clienti tedeschi possono comunque richiedere fatture elettroniche come condizione commerciale e molti lo fanno.

Per i clienti del **settore pubblico** tedesco è diverso: le autorità federali richiedono fatture elettroniche da novembre 2020, mentre Länder e comuni hanno regole proprie. Queste fatture richiedono la **Leitweg-ID** dell’acquirente.

## XRechnung e ZUGFeRD a confronto

Entrambi sono accettati come fatture elettroniche in Germania, purché rispettino EN 16931.

|                                        | XRechnung                                             | ZUGFeRD                                                         |
| -------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| Cos’è                                  | File XML puro, con regole tedesche (CIUS) di EN 16931 | Ibrido: PDF/A-3 con XML incorporato                             |
| Sintassi                               | UBL o CII                                             | CII                                                             |
| Leggibile da una persona               | Solo con un visualizzatore                            | Sì, è anche un normale PDF                                      |
| Uso tipico                             | Settore pubblico, grandi aziende                      | B2B privato, aziende più piccole                                |
| Fattura elettronica valida in Germania | Sì                                                    | Solo dal profilo EN 16931 in su; MINIMUM e BASIC WL non lo sono |

ZUGFeRD è tecnicamente identico al Factur-X francese. Se un cliente tedesco chiede solo una «fattura elettronica», domanda quale formato legge il suo sistema. Nel dubbio, XRechnung è la scelta più sicura.

## Peppol BIS Billing

**Peppol** è una rete internazionale per lo scambio di documenti aziendali, governata da OpenPeppol. Invece di viaggiare per email, le fatture passano tra **Access Point** certificati: invii al tuo Access Point, che consegna a quello dell’acquirente, che a sua volta gli trasmette la fattura. Ogni partecipante viene identificato da un **Peppol participant ID**, spesso basato sul numero IVA o dell’azienda.

**Peppol BIS Billing 3.0** è il formato di fattura usato sulla rete. È in UBL e rispetta EN 16931. Molti enti pubblici e imprese europei ricevono fatture solo tramite Peppol; anche XRechnung tedesco può essere consegnato attraverso la rete.

Per inviare tramite Peppol serve un fornitore di Access Point. Creare un file Peppol BIS valido è la prima metà del lavoro; consegnarlo sulla rete è la seconda.

## Polonia: KSeF

Il sistema nazionale polacco di fatturazione elettronica (**KSeF**, Krajowy System e-Faktur) è una piattaforma governativa centrale. Le fatture vengono inviate a KSeF nella struttura XML nazionale **FA(3)**, KSeF assegna un numero e l’acquirente le scarica da lì.

| Data                     | Cosa cambia                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1° febbraio 2026         | Tutti i contribuenti ricevono fatture tramite KSeF; le imprese più grandi, con vendite 2024 superiori a PLN 200 milioni, iniziano anche a emetterle |
| 1° aprile 2026           | Tutti gli altri contribuenti devono emettere fatture in KSeF                                                                                        |
| Fino al 31 dicembre 2026 | Le imprese con vendite fatturate fino a PLN 10,000 al mese possono ancora emettere fuori da KSeF                                                    |

L’obbligo si applica ai contribuenti con **sede o stabile organizzazione in Polonia**. Secondo le FAQ ufficiali KSeF, un venditore estero privo di entrambe non è obbligato a emettere in KSeF e può fatturare al di fuori del sistema; l’uso volontario è possibile. I clienti polacchi possono comunque preferire la struttura KSeF perché si integra nella loro contabilità.

## Romania: RO e-Factura

La Romania gestisce un sistema centrale di fatturazione elettronica, **RO e-Factura**, amministrato dall’autorità fiscale ANAF e accessibile tramite il portale online SPV o API. Le fatture seguono **RO_CIUS**, le regole rumene di EN 16931, in UBL o CII. Dal 2024, le fatture tra imprese stabilite in Romania devono passare dal sistema per essere valide.

Come in Polonia, le regole si concentrano sulle imprese stabilite nel paese. Se sei registrato ai fini IVA in Romania senza esservi stabilito, chiedi a un consulente rumeno se e come il sistema si applica a te. Il cliente rumeno avrà comunque bisogno dei tuoi dati di fatturazione in una forma registrabile.

## Cosa serve a un venditore svizzero

Qualunque sia il formato, gli stessi dati determinano se una fattura elettronica viene accettata. Raccoglili quando configuri il cliente, non quando la prima fattura viene respinta.

| Dato                                                                | Da dove proviene                                                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Il tuo numero IVA svizzero (CHE-…MWST) e i dati aziendali           | Le tue anagrafiche                                                                                             |
| Il numero IVA dell’acquirente (ad es. DE…, NIP polacco, CUI rumeno) | Il cliente                                                                                                     |
| Riferimento acquirente o numero d’ordine d’acquisto                 | Il cliente; XRechnung richiede un riferimento acquirente                                                       |
| Leitweg-ID                                                          | Acquirenti del settore pubblico tedesco; usata come riferimento acquirente                                     |
| Peppol participant ID                                               | Il cliente, se riceve tramite Peppol                                                                           |
| Formato e canale preferiti                                          | Il cliente: XRechnung UBL o CII, ZUGFeRD, Peppol, email                                                        |
| Categoria IVA per riga                                              | Il tuo consulente fiscale: ad esempio aliquota normale (S), inversione contabile (AE) o non soggetto a IVA (O) |
| Coordinate bancarie e valuta                                        | Di solito IBAN ed EUR                                                                                          |

Due consigli pratici:

- **Valida prima di inviare.** Un file che non supera la validazione dell’acquirente viene rifiutato come se non lo avessi mai inviato e il termine di pagamento potrebbe non iniziare.
- **Archivia l’XML inviato.** Il file strutturato è la fattura originale, non la sua rappresentazione PDF.

## Come ti aiuta Helvetly

Helvetly esporta una fattura emessa come XML XRechnung (UBL o CII), Peppol BIS Billing, KSeF FA(3) polacco o e-Factura rumeno (RO_CIUS), con codici di esenzione per le righe esenti da IVA. La Leitweg-ID del cliente è memorizzata nell’anagrafica e riportata nel riferimento acquirente; il file esportato viene archiviato. La consegna sulla rete Peppol richiede comunque un fornitore di Access Point. L’esportazione XML delle fatture elettroniche fa parte di Business; Helvetly non invia direttamente tramite Peppol, KSeF o la rete rumena.

## Fonti

- [Fatturazione elettronica: domande frequenti – Ministero federale tedesco delle finanze](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html)
- [XRechnung – xeinkauf.de (KoSIT)](https://xeinkauf.de/xrechnung/)
- [Fatturazione elettronica e EN 16931 – Commissione europea](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/eInvoicing)
- [IVA nell’era digitale (ViDA) – Commissione europea](https://taxation-customs.ec.europa.eu/taxation/vat/vat-digital-age-vida_en)
- [Peppol BIS Billing 3.0 – OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/)
- [OpenPeppol](https://peppol.org/)
- [Date e regole KSeF – ksef.podatki.gov.pl](https://ksef.podatki.gov.pl/ksef-news/zasady-obowiazywania-ksef-i-przepisy-prawne/)
- [FAQ KSeF – Krajowy System e-Faktur](https://ksef.podatki.gov.pl/)
- [Informazioni tecniche RO e-Factura – Ministero rumeno delle finanze](https://mfinante.gov.ro/en/web/efactura/informatii-tehnice)
- [ANAF – Agenția Națională de Administrare Fiscală](https://www.anaf.ro/)
