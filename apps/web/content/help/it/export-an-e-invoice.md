---
title: Esportare una fattura elettronica (XRechnung, Peppol, e-Factura, KSeF)
description: Scarica le fatture emesse come XML XRechnung, Peppol BIS 3.0, e-Factura o KSeF e allega l’XML alle email delle fatture.
category: Invoices and getting paid
categoryLabel: Fatture e incassi
order: 13
updated: 2026-11-15
---

Alcuni clienti e autorità richiedono fatture in formato XML strutturato. Ecco come esportarle.

L’esportazione XML delle fatture elettroniche fa parte di **Business**. Helvetly crea i file; non li invia tramite Peppol, KSeF o la rete rumena.

1. Compila prima **Settings → Invoices → E-invoices** (numero di registrazione, schema dell’indirizzo di fatturazione elettronica e indirizzo elettronico).
2. Apri una fattura emessa e il menu **…**.
3. In **E-invoice XML**, scegli **XRechnung (UBL)**, **XRechnung (CII)** o **Peppol BIS 3.0**. Vedi anche **e-Factura (CIUS-RO)** per un cliente rumeno e **KSeF FA(3)** se la tua azienda è polacca.
4. Carica autonomamente il file scaricato nel portale del destinatario, ad esempio SPV per e-Factura o Aplikacja Podatnika per KSeF.
5. Per allegare automaticamente l’XML quando invii fatture via email, modifica il cliente e scegli il formato in **E-invoice**. Per un ente pubblico tedesco, inserisci anche la **Leitweg-ID**.

## Da sapere

- Helvetly non invia fatture elettroniche tramite una rete Peppol o un’API governativa. L’esportazione XML è soltanto un file.
- Se esiste una trasmissione, appare in **E-invoice transmissions** sulla fattura.
