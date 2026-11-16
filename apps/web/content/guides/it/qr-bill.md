---
title: La QR-fattura svizzera
description: Cos’è la QR-fattura svizzera, quale IBAN e riferimento usare, come è organizzata la sezione di pagamento e quali errori causano il rifiuto delle fatture.
category: Getting paid
categoryLabel: Incassi
updated: 2026-11-11
readingMinutes: 7
---

La QR-fattura è la polizza di versamento standard svizzera. Ha sostituito le polizze arancioni e rosse, che le banche hanno smesso di elaborare il 30 settembre 2022. Se invii fatture a clienti in Svizzera, si aspettano di trovarla: scansionano il codice nell’app bancaria e tutti i campi vengono compilati automaticamente.

Le regole sono stabilite da SIX nelle Swiss Implementation Guidelines QR-bill. Questa guida spiega gli aspetti rilevanti per una piccola impresa.

## Cosa contiene una QR-fattura

La QR-fattura è una fascia in fondo alla fattura, o su una pagina separata, composta da due parti:

| Parte             | Dimensioni              | Scopo                                                          |
| ----------------- | ----------------------- | -------------------------------------------------------------- |
| Ricevuta          | 62 × 105 mm, a sinistra | Il pagatore la conserva per i propri documenti                 |
| Sezione pagamento | 148 × 105 mm, a destra  | Contiene lo Swiss QR Code e gli stessi dati in testo leggibile |

Insieme misurano 210 × 105 mm: il terzo inferiore di una pagina A4.

Lo **Swiss QR Code** misura 46 × 46 mm e ha una croce svizzera al centro. Contiene tutti i dati di pagamento: conto, nome e indirizzo del creditore, importo e valuta, nome e indirizzo del pagatore, riferimento ed eventuale messaggio. I campi di testo accanto al codice ripetono i dati perché una persona possa verificarli o pagare allo sportello postale.

Principali limiti dei dati:

- **Valuta:** solo CHF o EUR.
- **Importo:** fino a 999,999,999.99, oppure vuoto perché lo compili il pagatore.
- **Informazioni supplementari:** fino a 140 caratteri complessivi per messaggio non strutturato e informazioni strutturate di fatturazione.
- **Procedure alternative:** fino a due voci, ad esempio eBill.

## QR-IBAN o IBAN: scegliere il riferimento

La decisione più importante riguarda il conto e il tipo di riferimento. Esistono tre combinazioni:

| Conto        | Riferimento                                           | Quando usarlo                                                                 |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| QR-IBAN      | Riferimento QR (QRR), 27 cifre                        | Vuoi abbinare automaticamente i pagamenti e la banca ti ha fornito un QR-IBAN |
| IBAN normale | Creditor Reference (SCOR), ISO 11649, inizia con "RF" | Vuoi l’abbinamento automatico usando il conto normale                         |
| IBAN normale | Nessun riferimento (NON)                              | Casi semplici, piccoli volumi; abbinamento manuale                            |

Come distinguerli:

- Un **QR-IBAN** assomiglia a un IBAN svizzero normale, ma l’identificativo della banca (posizioni da 5 a 9) è compreso tra 30000 e 31999. La banca lo emette per lo stesso conto dell’IBAN normale.
- Un **riferimento QR** ha 27 cifre. L’ultima è una cifra di controllo (modulo 10 ricorsivo), che permette di rilevare errori di digitazione.
- Una **Creditor Reference** inizia con "RF", seguito da due cifre di controllo e fino a 21 caratteri a tua scelta.

La regola che causa più rifiuti: **un QR-IBAN richiede sempre un riferimento QR e un riferimento QR funziona solo con un QR-IBAN.** Un IBAN normale accetta una Creditor Reference oppure nessun riferimento.

Con un riferimento, la banca riporta il pagamento insieme al riferimento nell’estratto conto elettronico (camt.054 o camt.053), così il software contabile può segnare come pagata la fattura corretta senza interventi manuali.

## Indirizzi: solo strutturati

Dall’entrata in vigore della versione 2.3 delle direttive SIX a novembre 2025, il codice QR accetta solo **indirizzi strutturati** (tipo di indirizzo "S"). Via, numero civico, codice postale, località e paese hanno ciascuno il proprio campo. Il precedente indirizzo combinato ("K"), con via e località in righe di testo libero, non è più consentito. La stessa versione permette anche il set di caratteri esteso degli Swiss Payment Standards.

Se il programma di fatturazione o le anagrafiche clienti conservano ancora gli indirizzi in righe libere, correggili prima. È il motivo più comune per cui una QR-fattura creata da un vecchio software non viene più letta.

## Impaginazione della sezione pagamento

Le direttive fissano l’impaginazione perché tutte le fatture abbiano lo stesso aspetto:

- Titolo «Sezione pagamento» in alto a sinistra, con il codice QR sotto.
- Valuta e importo sotto il codice.
- A destra: Conto / Pagabile a, Riferimento, Informazioni supplementari, Pagabile da.
- Se l’importo o il pagatore non sono specificati, viene stampato un riquadro vuoto delimitato da angoli.
- Caratteri: Arial, Frutiger, Helvetica o Liberation Sans, nero su bianco. Le intestazioni sono in grassetto.
- La ricevuta mostra gli stessi conto, riferimento, pagatore e importo, oltre a «Punto di accettazione».

Le etichette devono essere in una delle lingue consentite dalle direttive: tedesco, francese, italiano o inglese.

## La linea di separazione con le forbici

Ricevuta e sezione pagamento sono pensate per essere staccate e usate separatamente. Il modo di indicarlo dipende dal supporto:

- **Stampa su carta:** le linee di separazione tra fattura e QR-fattura e tra ricevuta e sezione pagamento devono essere perforate.
- **Invio in PDF:** le stesse linee vengono tracciate continue o tratteggiate, con un simbolo di forbici o il testo «Da staccare prima del versamento» sopra la linea.

## Errori comuni

| Errore                                                     | Conseguenza                                    | Soluzione                                                      |
| ---------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| QR-IBAN con SCOR o senza riferimento                       | La banca rifiuta il pagamento                  | Usa un riferimento QR oppure passa all’IBAN normale            |
| IBAN normale con riferimento QR                            | Pagamento rifiutato                            | Usa SCOR oppure nessun riferimento                             |
| Indirizzo non strutturato (tipo K)                         | Codice non più valido                          | Memorizza separatamente via, numero, codice postale e località |
| Cifra di controllo del riferimento errata                  | Le app di scansione rifiutano il codice        | Genera i riferimenti nel software, mai a mano                  |
| Codice QR ridotto o stampato sfocato                       | Il codice non viene letto                      | Stampalo nitido nelle dimensioni complete di 46 × 46 mm        |
| Valuta diversa da CHF o EUR                                | Non consentita                                 | Fattura in CHF o EUR se vuoi una QR-fattura                    |
| Dati del mittente diversi da quelli del titolare del conto | Pagamenti ritardati o richieste di chiarimento | Usa esattamente nome e indirizzo registrati per il conto       |

Prova alcune fatture con la tua app bancaria prima di inviare il primo gruppo e ripeti la prova dopo ogni aggiornamento del software.

## eBill e QR-fattura a confronto

eBill è il servizio svizzero di fatturazione elettronica gestito da SIX. La fattura arriva direttamente nell’e-banking del cliente, che la approva con un clic. Non serve scaricare PDF né scansionare codici.

|                       | QR-fattura                               | eBill                                               |
| --------------------- | ---------------------------------------- | --------------------------------------------------- |
| Consegna              | Carta o PDF, per posta o email           | Nell’e-banking del pagatore                         |
| Azione del pagatore   | Scansionare il codice e confermare       | Approvare nell’e-banking                            |
| Chi può riceverla     | Chiunque                                 | Pagatori registrati per eBill presso la tua azienda |
| Configurazione per te | Un conto bancario (e un QR-IBAN per QRR) | Un contratto con un partner della rete eBill        |

Sono complementari. Molte aziende offrono eBill ai clienti registrati e inviano una QR-fattura a tutti gli altri. Una QR-fattura può anche segnalare la disponibilità di eBill tramite il campo delle procedure alternative.

## Come ti aiuta Helvetly

Helvetly aggiunge una QR-fattura a ogni fattura in CHF o EUR, con riferimento QR per il QR-IBAN oppure Creditor Reference per l’IBAN normale e indirizzi strutturati. Anche i solleciti e i piani rateali hanno la propria QR-fattura: una per il saldo totale nel sollecito e una con un riferimento distinto per ogni rata.

## Fonti

- [QR-fattura – SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html)
- [Swiss Implementation Guidelines QR-bill, versione 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf)
- [Guida alle modifiche della QR-fattura versione 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-delta-guide-v2.3-en.pdf)
- [QR-fattura: informazioni per le PMI – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/factsheet-qr-bill-transition-period-sme-en.pdf)
- [eBill – SIX](https://www.ebill.ch/en/)
