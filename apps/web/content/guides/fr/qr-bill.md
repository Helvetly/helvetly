---
title: La QR-facture suisse
description: Ce qu’est la QR-facture suisse, quel IBAN et quelle référence utiliser, comment présenter la section de paiement et quelles erreurs provoquent un rejet.
category: Getting paid
categoryLabel: Encaissements
updated: 2026-11-11
readingMinutes: 7
---

La QR-facture est le bulletin de paiement standard en Suisse. Elle a remplacé les bulletins orange et rouges, que les banques ont cessé de traiter le 30 septembre 2022. Si vous facturez des clients en Suisse, ils s’attendent à la recevoir : ils scannent le code dans leur application bancaire et tous les champs sont remplis automatiquement.

Les règles sont définies par SIX dans les Swiss Implementation Guidelines pour la QR-facture. Ce guide présente les points essentiels pour une petite entreprise.

## Le contenu d’une QR-facture

Une QR-facture est une bande au bas de la facture (ou sur une page distincte), composée de deux parties :

| Partie           | Dimensions             | Fonction                                                        |
| ---------------- | ---------------------- | --------------------------------------------------------------- |
| Récépissé        | 62 × 105 mm, à gauche  | Conservé par le payeur comme justificatif                       |
| Section paiement | 148 × 105 mm, à droite | Contient le Swiss QR Code et les mêmes données en texte lisible |

L’ensemble mesure 210 × 105 mm, soit le tiers inférieur d’une page A4.

Le **Swiss QR Code** mesure 46 × 46 mm et comporte une croix suisse au centre. Il contient toutes les données du paiement : votre compte, vos nom et adresse, le montant et la devise, les nom et adresse du payeur, une référence et un message facultatif. Les champs à côté du code répètent ces données pour permettre une vérification visuelle ou un paiement au guichet postal.

Principales limites des données :

- **Devise :** CHF ou EUR uniquement.
- **Montant :** jusqu’à 999,999,999.99, ou vide pour laisser le payeur le compléter.
- **Informations supplémentaires :** jusqu’à 140 caractères au total pour le message non structuré et les informations structurées de facturation.
- **Procédures alternatives :** jusqu’à deux entrées, par exemple eBill.

## QR-IBAN ou IBAN : choisir la référence

Le choix essentiel concerne le compte et le type de référence. Trois combinaisons existent :

| Compte         | Référence                                                  | Utilisation                                                                          |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| QR-IBAN        | Référence QR (QRR), 27 chiffres                            | Vous souhaitez un rapprochement automatique et votre banque vous a fourni un QR-IBAN |
| IBAN ordinaire | Référence créancier (SCOR), ISO 11649, commence par « RF » | Vous souhaitez un rapprochement automatique avec un compte ordinaire                 |
| IBAN ordinaire | Aucune référence (NON)                                     | Cas simples, faibles volumes ; rapprochement manuel                                  |

Pour les distinguer :

- Un **QR-IBAN** ressemble à un IBAN suisse ordinaire, mais son identifiant bancaire (positions 5 à 9) se situe entre 30000 et 31999. Votre banque le fournit pour le même compte que votre IBAN habituel.
- Une **référence QR** comporte 27 chiffres. Le dernier est un chiffre de contrôle (modulo 10 récursif) qui détecte les erreurs de saisie.
- Une **référence créancier** commence par « RF », suivi de deux chiffres de contrôle et de 21 caractères de votre choix au maximum.

La règle à l’origine de la plupart des rejets : **un QR-IBAN exige toujours une référence QR, et une référence QR ne fonctionne qu’avec un QR-IBAN.** Un IBAN ordinaire accepte une référence créancier ou aucune référence.

Avec une référence, votre banque la joint à chaque paiement dans son relevé électronique (camt.054 ou camt.053). Votre logiciel comptable peut ainsi marquer la bonne facture comme payée sans intervention manuelle.

## Adresses : structurées uniquement

Depuis l’entrée en vigueur de la version 2.3 des directives SIX en novembre 2025, le code QR n’accepte que les **adresses structurées** (type d’adresse « S »). Rue, numéro, code postal, localité et pays ont chacun leur champ. L’ancien type d’adresse combinée (« K »), où la rue et la localité étaient des lignes de texte libre, n’est plus autorisé. Cette version permet aussi le jeu de caractères étendu des Swiss Payment Standards.

Si votre outil de facturation ou vos fiches clients stockent encore les adresses en lignes de texte libre, corrigez cela en priorité. C’est la cause la plus fréquente des QR-factures d’anciens logiciels qui ne peuvent plus être scannées.

## Présentation de la section de paiement

Les directives imposent une présentation uniforme :

- Titre « Section paiement » en haut à gauche, code QR en dessous.
- Devise et montant sous le code.
- À droite : Compte / Payable à, Référence, Informations supplémentaires, Payable par.
- Si le montant ou le payeur reste à compléter, un cadre vide avec repères d’angle est imprimé à sa place.
- Polices : Arial, Frutiger, Helvetica ou Liberation Sans, en noir sur blanc. Les titres sont en gras.
- Le récépissé reprend le compte, la référence, le payeur et le montant, ainsi que « Point de dépôt ».

Les libellés doivent être dans une langue autorisée par les directives : allemand, français, italien ou anglais.

## La ligne de découpe

Le récépissé et la section de paiement sont destinés à être détachés et payés séparément. Le marquage dépend du support :

- **Impression papier :** les lignes séparant la facture de la QR-facture et le récépissé de la section de paiement doivent être perforées.
- **Envoi en PDF :** ces mêmes lignes sont continues ou en pointillés, avec un symbole de ciseaux ou le texte « À détacher avant le versement » au-dessus.

## Erreurs fréquentes

| Erreur                                                       | Conséquence                                 | Correction                                                    |
| ------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------- |
| QR-IBAN avec SCOR ou sans référence                          | Paiement rejeté par la banque               | Utiliser une référence QR ou l’IBAN ordinaire                 |
| IBAN ordinaire avec référence QR                             | Paiement rejeté                             | Utiliser SCOR ou aucune référence                             |
| Adresse non structurée (type K)                              | Code devenu invalide                        | Stocker séparément rue, numéro, code postal et localité       |
| Chiffre de contrôle erroné dans la référence                 | Code rejeté par les applications de lecture | Générer les références par logiciel, jamais à la main         |
| Code QR réduit ou impression floue                           | Code illisible                              | Imprimer nettement aux dimensions complètes de 46 × 46 mm     |
| Devise autre que CHF ou EUR                                  | Non autorisée                               | Facturer en CHF ou EUR pour utiliser une QR-facture           |
| Coordonnées de l’émetteur différentes du titulaire du compte | Retards ou demandes de clarification        | Utiliser les nom et adresse exacts enregistrés pour le compte |

Testez quelques factures avec votre application bancaire avant le premier envoi, puis après chaque mise à jour du logiciel.

## eBill et QR-facture

eBill est le service suisse de factures électroniques exploité par SIX. La facture arrive directement dans l’e-banking du client, qui l’approuve en un clic. Aucun PDF à télécharger ni code à scanner.

|                         | QR-facture                                  | eBill                                               |
| ----------------------- | ------------------------------------------- | --------------------------------------------------- |
| Transmission            | Papier ou PDF, par poste ou e-mail          | Dans l’e-banking du payeur                          |
| Action du payeur        | Scanner le code, confirmer                  | Approuver dans l’e-banking                          |
| Destinataires possibles | Tout le monde                               | Payeurs inscrits à eBill auprès de votre entreprise |
| Mise en place pour vous | Un compte bancaire (et un QR-IBAN pour QRR) | Un contrat avec un partenaire réseau eBill          |

Les deux sont complémentaires. Beaucoup d’entreprises proposent eBill aux clients inscrits et envoient une QR-facture aux autres. Une QR-facture peut aussi annoncer la disponibilité d’eBill dans son champ de procédures alternatives.

## Comment Helvetly vous aide

Helvetly ajoute une QR-facture à chaque facture en CHF ou EUR, avec référence QR pour un QR-IBAN ou référence créancier pour un IBAN ordinaire, et des adresses structurées. Les rappels et plans de paiement comportent leurs propres QR-factures : une pour le total restant dû sur chaque rappel, et une avec sa propre référence pour chaque échéance.

## Sources

- [QR-facture – SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html)
- [Swiss Implementation Guidelines pour la QR-facture, version 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf)
- [Guide des changements de la QR-facture, version 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-delta-guide-v2.3-en.pdf)
- [Nouvelles exigences de la QR-facture : fiche pour les PME – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/factsheet-qr-bill-transition-period-sme-en.pdf)
- [eBill – SIX](https://www.ebill.ch/en/)
