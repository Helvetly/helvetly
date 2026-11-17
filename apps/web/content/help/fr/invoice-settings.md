---
title: Configurer la facturation
description: Renseignez les coordonnées de votre entreprise, son logo, son assujettissement à la TVA, son IBAN, ses moyens de paiement et la numérotation avant d’émettre des factures.
category: Invoices and getting paid
categoryLabel: Factures et encaissements
order: 1
updated: 2026-11-11
---

Renseignez une fois les coordonnées de votre entreprise ; chaque facture les réutilisera.

1. Ouvrez **Settings → Invoices**, ou choisissez **Invoice settings** dans le menu de la page **Invoices**.
2. Renseignez **Logo**, **Company** (nom et adresse) et **VAT**. Sous VAT, activez **Registered for VAT**, puis ajoutez votre IDE avec MWST, le taux par défaut et le mode de saisie des prix, nets ou bruts.
3. Sous **Bank account**, saisissez votre **IBAN** et votre banque. Sous **Payment methods**, activez **Swiss QR bill** et/ou **Revolut**.
4. Sous **Numbering**, choisissez l’un des formats usuels dans le pays de votre entreprise (par exemple 2026-001 en Suisse ou INV-0001 aux États-Unis), ou choisissez **Format personnalisé** et composez le vôtre avec du texte et des espaces réservés : {YYYY} ou {YY} (année), {MM} (mois), {DD} (jour), {TYPE} (INV, CN, DN, PF ou Q) et {NNN} (le numéro courant, complété à trois chiffres ; {N} sans complément). Le numéro courant est obligatoire. Avec une année dans le format, il recommence chaque année ; sans année, il ne recommence jamais. Après un import de factures dans un nouvel espace de travail, l’accueil propose de continuer leur numérotation.
5. Définissez vos **Defaults** (devise, langue des documents, conditions de paiement), **Instalments**, **Dunning** et **Footer**.
6. Lorsque la liste de contrôle affiche **Ready to issue invoices**, tout est prêt.

## Bon à savoir

- Seuls les propriétaires et administrateurs peuvent modifier ces paramètres.
- Les numéros sont attribués lors de l’émission, sans interruption, et la séquence redémarre chaque année lorsque le format contient une année.
- Il existe une seule séquence de numérotation ; les notes de crédit reçoivent leurs propres numéros.
