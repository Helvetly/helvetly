---
title: Fatturare a clienti all’estero e in valuta estera
description: Valute della QR-fattura, fatture in USD, conversione in CHF per l’IVA, prestazioni all’estero e fatture elettroniche per clienti UE.
category: Choosing software
categoryLabel: Scegliere un software
updated: 2026-11-19
readingMinutes: 6
---

Un’impresa svizzera può fatturare in qualsiasi valuta, ma la QR-fattura accetta solo CHF ed EUR: le fatture in USD o altre valute richiedono quindi altri dati di pagamento. Ai fini IVA, ogni importo in valuta estera va convertito in CHF al corso medio mensile dell’AFC o al corso di vendita giornaliero, e i servizi a clienti all’estero sono in genere fatturati senza IVA svizzera.

Questa guida risponde alle domande che sorgono con il primo cliente fuori dalla Svizzera. Sono informazioni generali, non una consulenza fiscale; per un caso particolare rivolgiti all’AFC o al tuo fiduciario.

## Un’azienda svizzera può fatturare in valuta estera?

Sì. Nulla obbliga una fattura svizzera a essere in franchi; puoi concordare con il cliente qualsiasi valuta. Ai fini IVA, però, regoli i conti con l’AFC in CHF, quindi ogni importo in valuta estera va convertito quando l’imposta diventa esigibile (art. 45 OIVA).

Concorda la valuta nel preventivo o nel contratto e mantienila uguale sulla fattura. Se un importo sia in valuta estera dipende dalla valuta della fattura, non da quella con cui paga il cliente.

## Quali valute accetta la QR-fattura svizzera?

La QR-fattura svizzera accetta solo CHF ed EUR. Una fattura in USD, GBP o in qualsiasi altra valuta non può avere una QR-fattura.

Per l’EUR, dal 14 novembre 2026 si applica la versione 2.4 delle regole SIX: una QR-fattura in EUR usa un IBAN normale con una Creditor Reference o un messaggio non strutturato. Il QR-IBAN con riferimento QR resta disponibile solo per CHF. Per le regole complete vedi [la QR-fattura svizzera](/guides/qr-bill).

## Come si viene pagati in USD o in un’altra valuta?

Senza QR-fattura, indica sulla fattura le coordinate del tuo conto per i bonifici internazionali, esattamente come te le fornisce la banca, e il numero di fattura come riferimento di pagamento. Chiedi alla banca se il tuo conto può ricevere quella valuta o se la converte in CHF, e a quale costo.

Alcuni punti pratici:

- **Stabilisci chi paga le spese.** I bonifici internazionali possono perdere parte dell’importo in commissioni bancarie; concorda nelle condizioni chi le sostiene.
- **Attento al rischio di cambio.** Se fatturi 5,000 USD e il franco si rafforza prima che il cliente paghi, ricevi meno franchi. Per i progetti lunghi valuta di fatturare in CHF o a tranche.
- **Completa i dati del cliente.** Ai fini IVA, la fattura deve indicare chiaramente chi è il cliente e dove si trova ([cosa deve contenere una fattura svizzera](/guides/invoice-requirements)).

## Come si convertono le fatture in valuta estera per la dichiarazione IVA svizzera?

Converti ogni importo in valuta estera in CHF nel momento in cui l’imposta diventa esigibile, usando il corso medio mensile pubblicato dall’AFC oppure il corso di vendita giornaliero delle divise. Qualunque scelta tu faccia, mantienila per almeno un intero periodo fiscale, per l’imposta sulla cifra d’affari, l’imposta sull’acquisto e l’imposta precedente.

Le regole dell’art. 45 OIVA, come le spiega l’AFC:

| Regola                       | Cosa significa                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Corso medio mensile          | Pubblicato dall’AFC attorno al 25 di ogni mese e usato per il mese successivo                              |
| Corso di vendita giornaliero | Il corso di vendita delle divise del giorno, pubblicato dall’AFC nei giorni lavorativi                     |
| Nessun corso AFC pubblicato  | Si usa il corso di vendita giornaliero pubblicato da una banca svizzera                                    |
| Gruppi                       | Le società di un gruppo possono usare il corso interno del gruppo, se lo fanno tutte le società del gruppo |
| Mantenere la scelta          | Almeno un periodo fiscale; il cambio è possibile solo all’inizio di un nuovo periodo fiscale               |

Con le controprestazioni convenute, il metodo predefinito, l’imposta è dovuta quando emetti la fattura, quindi si applica il corso di quella data o di quel mese. La stessa scelta vale per le tue spese in valuta estera quando deduci la relativa imposta precedente. Per le controprestazioni convenute e ricevute vedi [L’IVA svizzera, spiegata](/guides/swiss-vat).

## Si addebita l’IVA svizzera ai clienti all’estero?

Di solito no, per i servizi. La maggior parte dei servizi è tassata dove il cliente ha la sede o lo stabilimento d’impresa (art. 8 cpv. 1 LIVA), quindi un servizio a un cliente all’estero è fatturato senza IVA svizzera. Vale, ad esempio, per consulenza, pubblicità, elaborazione di dati e servizi fiduciari o legali.

Ci sono eccezioni nell’art. 8 cpv. 2 LIVA, dove il luogo della prestazione è altrove, ad esempio i servizi legati a immobili (dove si trova l’immobile) e i servizi di ristorazione (dove sono forniti). Le merci sono un tema a parte, con dogana e prova di esportazione, che qui non trattiamo.

Due punti in cui si sbaglia spesso:

- **I compensi dall’estero contano per la soglia.** La cifra d’affari all’estero concorre ai CHF 100,000 annui che ti rendono assoggettato all’IVA svizzera ([IVA per gli indipendenti](/guides/vat-for-the-self-employed)).
- **Se non sei iscritto, nessuna fattura può riportare l’IVA.** Chi espone l’IVA in una fattura la deve all’AFC, anche se non è iscritto.

Se il tuo cliente debba l’IVA nel proprio Paese lo stabiliscono le regole di quel Paese.

## I clienti UE hanno bisogno di fatture elettroniche?

Spesso sì. La Svizzera non ha un obbligo generale di inviare fatture elettroniche tra imprese, ma molti Paesi UE sì, e le loro imprese chiedono ai fornitori esteri file strutturati come XRechnung, Peppol BIS, il KSeF polacco o l’e-Factura rumena.

Un PDF con QR-fattura resta una fattura valida per un cliente in Svizzera. Per i clienti UE leggi [la fattura elettronica per le aziende svizzere](/guides/e-invoicing-for-swiss-companies) per sapere quali regole valgono per un venditore svizzero e cosa preparare.

## Come gestisce Helvetly le valute estere?

Helvetly permette di impostare una valuta per ogni cliente e per ogni fattura, con una QR-fattura sulle fatture in CHF o EUR. Le fatture in altre valute non hanno QR-fattura e restano fuori dai dati della dichiarazione IVA, con un avviso: ne aggiungi a mano gli importi in CHF.

Nel dettaglio:

- **Valuta per cliente e per fattura.** I dati di fatturazione predefiniti del cliente impostano valuta, lingua del documento e condizioni di pagamento; ogni fattura può modificarli ([creare ed emettere una fattura](/help/create-and-issue-an-invoice)).
- **Quattro lingue del documento.** Fatture in tedesco, francese, italiano o inglese.
- **Le spese in valuta estera** conservano il tasso di cambio, la sua data e la fonte, e l’importo nella tua valuta di base.
- **Dichiarazione IVA.** Helvetly prepara i dati da fatture e spese in CHF ed elenca quelle in altre valute perché tu le aggiunga ([preparare la dichiarazione IVA svizzera](/help/swiss-vat-return)); Pro e Business.
- **Fatture elettroniche.** File XML XRechnung, Peppol BIS, KSeF ed e-Factura per i clienti UE, nel piano Business ([esportare una fattura elettronica](/help/export-an-e-invoice)). La consegna tramite le reti richiede un fornitore esterno.

Stai scegliendo un software per questo? Vedi [come scegliere un software di back office](/guides/back-office-software-for-small-businesses) e [alternative a bexio in Svizzera](/guides/bexio-alternatives).

## Fonti

- [Value Added Tax Ordinance (MWSTV, SR 641.201) – Fedlex](https://www.fedlex.admin.ch/eli/cc/2009/828/de): art. 45
- [Federal Act on Value Added Tax (MWSTG, SR 641.20) – Fedlex](https://www.fedlex.admin.ch/eli/cc/2009/615/en): art. 8, 10, 27
- [Fremdwährungskurse MWST – ESTV](https://www.estv.admin.ch/de/mwst-fremdwaehrungskurse)
- [QR-bill – SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html)
