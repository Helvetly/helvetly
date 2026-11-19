---
title: Een e-factuur exporteren (XRechnung, Peppol, ZUGFeRD / Factur-X, e-Factura, KSeF)
description: Download uitgegeven facturen als XRechnung, Peppol BIS 3.0, ZUGFeRD / Factur-X, e-Factura of KSeF en voeg de XML aan factuurmails toe.
category: Invoices and getting paid
order: 13
updated: 2026-11-17
---

Sommige klanten en overheden hebben facturen als gestructureerde XML nodig. Zo exporteer je ze.

XML-export van e-facturen hoort bij **Business**. Helvetly maakt de bestanden; het verstuurt ze niet via Peppol, KSeF of het Roemeense netwerk.

1. Vul eerst **Settings → Invoices → E-invoices** in (registratienummer, adresschema voor e-facturen en elektronisch adres).
2. Open een uitgegeven factuur en open het menu **…**.
3. Kies onder **E-invoice XML** voor **XRechnung (UBL)**, **XRechnung (CII)**, **Peppol BIS 3.0** of **ZUGFeRD / Factur-X (PDF)**: de uitgegeven pdf als PDF/A-3 met de EN 16931-XML erin, één bestand voor mensen en software. Je ziet ook **e-Factura (CIUS-RO)** voor een Roemeense klant en **KSeF FA(3)** als je bedrijf Pools is.
4. Upload het gedownloade bestand zelf in het ontvangende portaal, bijvoorbeeld SPV voor e-Factura of Aplikacja Podatnika voor KSeF.
5. Bewerk de klant en kies onder **E-invoice** het formaat om de XML automatisch met factuurmails mee te sturen. Bij ZUGFeRD / Factur-X bevat de e-mail die pdf in plaats van de gewone pdf. Vul voor een Duitse overheidsinstantie ook de **Leitweg-ID** in.

## Goed om te weten

- Helvetly verstuurt geen e-facturen via een Peppol-netwerk of overheids-API. De XML-export is uitsluitend een bestand.
- Als een verzending bestaat, verschijnt deze onder **E-invoice transmissions** op de factuur.
