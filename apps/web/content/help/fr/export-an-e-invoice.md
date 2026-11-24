---
title: Exporter une facture électronique (XRechnung, Peppol, Factur-X / ZUGFeRD, e-Factura, KSeF)
description: Téléchargez les factures émises au format XML XRechnung, Peppol BIS 3.0, e-Factura ou KSeF et joignez le XML aux e-mails de facturation.
category: Invoices and getting paid
categoryLabel: Factures et encaissements
order: 13
updated: 2026-11-17
---

Certains clients et administrations exigent des factures au format XML structuré. Voici comment les exporter.

L’export XML de factures électroniques fait partie de **Business**. Helvetly crée les fichiers, mais ne les transmet pas via Peppol, KSeF ou le réseau roumain.

1. Renseignez d’abord **Paramètres → Factures → Factures électroniques** (numéro d’immatriculation, schéma d’adresse de facturation électronique et adresse électronique).
2. Ouvrez une facture émise et son menu **…**.
3. Sous **Facture électronique XML**, choisissez **XRechnung (UBL)**, **XRechnung (CII)**, **Peppol BIS 3.0** ou **Factur-X / ZUGFeRD (PDF)** : le PDF émis en PDF/A-3 avec le XML EN 16931 intégré, un seul fichier pour les personnes et les logiciels. **e-Factura (CIUS-RO)** apparaît aussi pour un client roumain, et **KSeF FA(3)** si votre entreprise est polonaise.
4. Déposez vous-même le fichier téléchargé dans le portail destinataire, par exemple SPV pour e-Factura ou Aplikacja Podatnika pour KSeF.
5. Pour joindre automatiquement le XML aux factures envoyées par e-mail, modifiez le client et choisissez le format sous **Facture électronique**. Pour un organisme public allemand, renseignez aussi **ID Leitweg**.

## Bon à savoir

- Helvetly n’envoie pas de factures électroniques via un réseau Peppol ou une API gouvernementale. L’export XML est uniquement un fichier.
- Si une transmission existe, elle apparaît sous **Transmissions de factures électroniques** sur la facture.
