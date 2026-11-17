---
title: Configurare le impostazioni delle fatture
description: Aggiungi dati aziendali, logo, registrazione IVA, IBAN, metodi di pagamento e numerazione prima di emettere fatture.
category: Invoices and getting paid
categoryLabel: Fatture e incassi
order: 1
updated: 2026-11-11
---

Configura i dati della tua azienda una sola volta: verranno usati da ogni fattura.

1. Vai a **Settings → Invoices** oppure scegli **Invoice settings** nel menu della pagina **Invoices**.
2. Compila **Logo**, **Company** (nome e indirizzo) e **VAT**. In VAT, attiva **Registered for VAT**, poi aggiungi il tuo numero IDI con MWST, l’aliquota predefinita e indica se inserisci prezzi netti o lordi.
3. In **Bank account**, inserisci il tuo **IBAN** e la banca. In **Payment methods**, attiva **Swiss QR bill** e/o **Revolut**.
4. In **Numbering**, scegli uno dei formati usuali nel paese della tua azienda (per esempio 2026-001 in Svizzera o INV-0001 negli Stati Uniti), oppure **Formato personalizzato** e componi il tuo con testo e segnaposto: {YYYY} o {YY} (anno), {MM} (mese), {DD} (giorno), {TYPE} (INV, CN, DN, PF o Q) e {NNN} (il numero progressivo, completato a tre cifre; {N} senza completamento). Il numero progressivo è obbligatorio. Con un anno nel formato ricomincia ogni anno; senza, non ricomincia mai. Dopo un’importazione di fatture in un nuovo spazio di lavoro, il benvenuto propone di continuare la loro numerazione.
5. Imposta **Defaults** (valuta, lingua del documento, termini di pagamento), **Instalments**, **Dunning** e **Footer**.
6. Quando l’elenco di controllo mostra **Ready to issue invoices**, è tutto pronto.

## Da sapere

- Solo titolari e amministratori possono modificare queste impostazioni.
- I numeri vengono assegnati all’emissione, senza lacune, e ricominciano ogni anno quando il formato contiene un anno.
- Esiste un’unica sequenza di numerazione e le note di credito ricevono numeri propri.
