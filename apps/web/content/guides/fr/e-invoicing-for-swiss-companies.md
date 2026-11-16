---
title: La facturation électronique pour les entreprises suisses qui exportent
description: Pourquoi les clients de l’UE demandent des factures électroniques aux fournisseurs suisses, et ce que XRechnung, ZUGFeRD, Peppol, le KSeF polonais et l’e-Factura roumain impliquent pour vous.
category: E-invoicing
categoryLabel: Facturation électronique
updated: 2026-11-11
readingMinutes: 8
---

La Suisse n’impose pas d’obligation générale de facturation électronique entre entreprises. De nombreux pays de l’UE le font déjà ou le feront bientôt. Si vous vendez à des clients en Allemagne, en Pologne, en Roumanie ou ailleurs dans l’UE, l’un d’eux finira par vous écrire : « Nous n’acceptons que les factures au format XRechnung » ou « Merci d’envoyer votre facture via Peppol ».

Ce guide explique l’origine de ces demandes, les règles qui s’appliquent réellement à un vendeur suisse et les éléments à préparer.

## Ce qui constitue une facture électronique

Dans l’UE, une facture électronique n’est pas un PDF envoyé par e-mail. C’est un **fichier structuré** (XML) que le logiciel de l’acheteur peut lire et comptabiliser sans saisie manuelle.

La base commune est la norme européenne **EN 16931**. Elle définit le contenu d’une facture (vendeur, acheteur, lignes, ventilation de TVA, données de paiement) et autorise deux syntaxes XML : UBL et UN/CEFACT CII. Les formats nationaux comme XRechnung, Peppol BIS Billing ou RO_CIUS en Roumanie ajoutent leurs propres règles à EN 16931. Le KSeF polonais utilise sa propre structure nationale.

## Pourquoi vos clients de l’UE demandent des factures électroniques

La plupart de ces demandes découlent de leurs obligations, plutôt que des vôtres :

- **Leur comptabilité fournisseurs se numérise.** Les entreprises qui doivent recevoir et envoyer des factures électroniques dans leur pays souhaitent un processus unique pour tous leurs fournisseurs, y compris étrangers.
- **Les organismes publics l’exigent.** Les administrations de l’UE doivent accepter les factures électroniques conformes à EN 16931 ; beaucoup, dont les autorités fédérales allemandes, n’acceptent rien d’autre.
- **La déclaration transfrontalière arrive.** Le paquet européen « La TVA à l’ère du numérique » (ViDA) prévoit une déclaration numérique fondée sur les factures électroniques pour les opérations B2B intra-UE dès le 1er juillet 2030.

Même sans obligation légale vous concernant, savoir envoyer une facture électronique valide vous aide donc à rester un fournisseur agréé et à être payé plus vite.

## Allemagne : le calendrier B2B

L’Allemagne a introduit progressivement la facturation électronique obligatoire pour les opérations B2B nationales :

| Date                      | Changement                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1er janvier 2025          | Toute entreprise établie en Allemagne doit pouvoir **recevoir** des factures électroniques                                                                                                                  |
| Jusqu’au 31 décembre 2026 | Les émetteurs peuvent encore utiliser le papier, ou d’autres formats électroniques avec l’accord de l’acheteur                                                                                              |
| 1er janvier 2027          | Les entreprises dont le chiffre d’affaires total de l’année précédente dépasse EUR 800,000 doivent **envoyer** des factures électroniques ; les plus petites peuvent conserver l’ancien système durant 2027 |
| 1er janvier 2028          | Toutes les entreprises établies en Allemagne doivent envoyer des factures électroniques, sous réserve d’exceptions légales comme les petites entreprises au sens du §19 UStG                                |

L’obligation couvre les prestations **entre entreprises toutes deux établies en Allemagne** (siège, direction ou établissement stable). Une entreprise suisse sans établissement en Allemagne n’y est généralement pas soumise, même si elle possède un numéro de TVA allemand. Vos clients allemands peuvent néanmoins exiger des factures électroniques comme condition commerciale, et beaucoup le font.

Pour les clients allemands du **secteur public**, la situation diffère : les autorités fédérales exigent des factures électroniques depuis novembre 2020 ; les Länder et communes ont leurs propres règles. Ces factures nécessitent la **Leitweg-ID** de l’acheteur.

## XRechnung et ZUGFeRD

Les deux formats sont acceptés comme factures électroniques en Allemagne s’ils respectent EN 16931.

|                                          | XRechnung                                                 | ZUGFeRD                                                                         |
| ---------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Nature                                   | Fichier XML seul, déclinaison allemande (CIUS) d’EN 16931 | Format hybride : PDF/A-3 contenant le XML                                       |
| Syntaxe                                  | UBL ou CII                                                | CII                                                                             |
| Lisible par une personne                 | Avec un visualiseur uniquement                            | Oui, c’est aussi un PDF ordinaire                                               |
| Usage courant                            | Secteur public, grandes entreprises                       | B2B privé, petites entreprises                                                  |
| Facture électronique valide en Allemagne | Oui                                                       | Uniquement à partir du profil EN 16931 ; MINIMUM et BASIC WL ne conviennent pas |

ZUGFeRD est techniquement identique au format français Factur-X. Si un client allemand demande simplement une « facture électronique », demandez quel format son système peut lire. Dans le doute, XRechnung est le choix le plus sûr.

## Peppol BIS Billing

**Peppol** est un réseau international d’échange de documents commerciaux, régi par OpenPeppol. Au lieu de l’e-mail, les factures passent par des **points d’accès** certifiés : vous envoyez la facture à votre point d’accès, qui la transmet à celui de l’acheteur, lequel la remet à l’acheteur. Chaque participant est identifié par un **identifiant de participant Peppol**, souvent fondé sur un numéro de TVA ou d’entreprise.

**Peppol BIS Billing 3.0** est le format de facture utilisé sur le réseau. Il repose sur UBL et respecte EN 16931. De nombreux organismes publics et entreprises européens ne reçoivent leurs factures que via Peppol ; le format allemand XRechnung peut aussi être transmis par ce réseau.

Pour envoyer via Peppol, il vous faut un fournisseur de point d’accès. Créer un fichier Peppol BIS valide constitue une première étape ; sa transmission par le réseau en est une seconde.

## Pologne : KSeF

Le système national polonais de facturation électronique (**KSeF**, Krajowy System e-Faktur) est une plateforme gouvernementale centrale. Les factures y sont envoyées dans la structure XML nationale **FA(3)** ; KSeF attribue un numéro à chacune, et l’acheteur les télécharge depuis la plateforme.

| Date                      | Changement                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1er février 2026          | Tous les contribuables reçoivent les factures via KSeF ; les plus grandes entreprises (ventes 2024 supérieures à PLN 200 millions) y émettent aussi leurs factures |
| 1er avril 2026            | Tous les autres contribuables doivent émettre leurs factures dans KSeF                                                                                             |
| Jusqu’au 31 décembre 2026 | Les entreprises dont les ventes facturées ne dépassent pas PLN 10,000 par mois peuvent encore émettre hors KSeF                                                    |

L’obligation vise les contribuables disposant d’un **siège ou d’un établissement stable en Pologne**. Selon la FAQ officielle KSeF, un vendeur étranger ne disposant ni de l’un ni de l’autre n’est pas tenu d’émettre ses factures dans KSeF et peut facturer hors de ce système ; une utilisation volontaire reste possible. Les clients polonais peuvent néanmoins préférer la structure KSeF, adaptée à leur comptabilité.

## Roumanie : RO e-Factura

La Roumanie dispose d’un système central de facturation électronique, **RO e-Factura**, exploité par l’administration fiscale (ANAF) et accessible via son portail en ligne (SPV) ou son API. Les factures suivent **RO_CIUS**, la déclinaison roumaine d’EN 16931, en UBL ou CII. Depuis 2024, les factures entre entreprises établies en Roumanie doivent passer par ce système pour être valides.

Comme en Pologne, les règles visent les entreprises établies dans le pays. Si vous êtes immatriculé à la TVA en Roumanie sans y être établi, demandez à un conseiller roumain si le système s’applique à vous et comment. Votre client roumain aura de toute façon besoin de données de facturation qu’il peut enregistrer.

## Ce qu’un vendeur suisse doit préparer

Quel que soit le format, les mêmes données déterminent l’acceptation de la facture électronique. Recueillez-les dès la création du client, sans attendre le rejet de la première facture.

| Donnée                                                                    | Source                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Votre numéro de TVA suisse (CHE-…MWST) et les coordonnées de l’entreprise | Vos propres données                                                                                          |
| Numéro de TVA de l’acheteur (p. ex. DE…, PL NIP, RO CUI)                  | Le client                                                                                                    |
| Référence acheteur ou numéro de commande                                  | Le client ; XRechnung exige une référence acheteur                                                           |
| Leitweg-ID                                                                | Acheteurs du secteur public allemand ; utilisée comme référence acheteur                                     |
| Identifiant de participant Peppol                                         | Le client, s’il reçoit via Peppol                                                                            |
| Format et canal souhaités                                                 | Le client : XRechnung UBL ou CII, ZUGFeRD, Peppol, e-mail                                                    |
| Catégorie de TVA par ligne                                                | Votre conseiller fiscal : p. ex. taux normal (S), autoliquidation (AE) ou opération hors champ de la TVA (O) |
| Coordonnées bancaires et devise                                           | Généralement un IBAN et EUR                                                                                  |

Deux conseils pratiques :

- **Validez avant l’envoi.** Un fichier qui échoue à la validation de l’acheteur est rejeté comme s’il n’avait jamais été envoyé ; le délai de paiement ne commence pas.
- **Archivez le XML envoyé.** Le fichier structuré constitue la facture originale, et non sa représentation PDF.

## Comment Helvetly vous aide

Helvetly exporte une facture émise en XML XRechnung (UBL ou CII), Peppol BIS Billing, KSeF FA(3) polonais ou e-Factura roumain (RO_CIUS), avec les codes d’exonération pour les lignes exonérées de TVA. La Leitweg-ID est enregistrée sur le client et reprise comme référence acheteur ; chaque fichier exporté est archivé. La transmission sur le réseau Peppol nécessite un fournisseur de point d’accès. L’export XML de factures électroniques fait partie de Business ; Helvetly ne transmet pas lui-même les factures via Peppol, KSeF ou le réseau roumain.

## Sources

- [E-Rechnung : questions fréquentes – ministère fédéral allemand des Finances](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html)
- [XRechnung – xeinkauf.de (KoSIT)](https://xeinkauf.de/xrechnung/)
- [Facturation électronique et EN 16931 – Commission européenne](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/eInvoicing)
- [La TVA à l’ère du numérique (ViDA) – Commission européenne](https://taxation-customs.ec.europa.eu/taxation/vat/vat-digital-age-vida_en)
- [Peppol BIS Billing 3.0 – OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/)
- [Peppol – OpenPeppol](https://peppol.org/)
- [Règles d’application de KSeF et dispositions légales – ksef.podatki.gov.pl](https://ksef.podatki.gov.pl/ksef-news/zasady-obowiazywania-ksef-i-przepisy-prawne/)
- [KSeF – système national de facturation électronique](https://ksef.podatki.gov.pl/)
- [Informations techniques RO e-Factura – ministère roumain des Finances](https://mfinante.gov.ro/en/web/efactura/informatii-tehnice)
- [ANAF – administration fiscale nationale roumaine](https://www.anaf.ro/)
