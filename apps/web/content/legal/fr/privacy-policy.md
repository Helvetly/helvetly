# Politique de confidentialité

## 1. Qui nous sommes

Helvetly (« Helvetly », « nous ») exploite le site helvetly.com, la documentation sur
docs.helvetly.com, la plateforme Helvetly et le portail client. Contact pour la protection des
données : [support@helvetly.com](mailto:support@helvetly.com).

Helvetly est un service destiné aux entreprises. Il ne s’adresse pas aux enfants.

## 2. Deux rôles

- **Responsable du traitement** pour les données des personnes utilisant Helvetly : données de
  compte et de connexion, facturation des formules Helvetly, données de sécurité, retours et
  demandes d’assistance, et site web.
- **Sous-traitant** pour les données de gestion conservées par nos clients dans leurs espaces :
  clients et contacts (dont les personnes se connectant à leur portail client), factures, dépenses,
  documents, demandes de signature et signataires, mandats, imports par IA, conversations avec
  Heidi, dossiers du personnel et des salaires de leurs employés. Le client est responsable de
  ces données ; nous les traitons uniquement sur ses instructions, conformément à
  l’[accord de traitement des données](dpa.md). Si vous êtes un client, contact, signataire ou
  employé de l’un de nos clients, adressez-vous à ce dernier au sujet de vos données.

**Données des employés et des salaires.** Un client Business peut conserver dans Helvetly les
dossiers de son personnel et des salaires : identité (nom, numéro d’employé), coordonnées, données
d’emploi (poste, service, type de contrat, dates, délai de congé, temps de travail, lieu et pays de
travail, pays de résidence et de sécurité sociale, statut frontalier), conditions de rémunération
et chiffres de paie saisis ou importés, numéros de sécurité sociale (comme le numéro AVS suisse),
identifiants fiscaux, coordonnées bancaires, statut et canton de l’impôt à la source, documents
importés pour un employé (contrats, fiches de salaire ou permis, par exemple). Helvetly ne calcule
ni rémunération, ni impôts, ni cotisations, ne conserve pas de données de santé ou d’absence et ne
prévoit aucun champ pour d’autres catégories particulières de données ; les documents importés par
le client peuvent en contenir, sous sa responsabilité. Helvetly ne récupère pas les données des employés et des salaires pour les requêtes à OpenAI. Ces
données ne sont pas accessibles via MCP ou les jetons d’API personnels.
Il appartient au client, en tant que responsable du traitement, de déterminer la base juridique
applicable (par exemple art. 6, par. 1, let. b et c, et art. 88 RGPD, nLPD, art. 328b du code suisse
des obligations ou art. 50e à 50g LAVS pour le numéro AVS) ; les détails figurent dans
l’[accord de traitement des données](dpa.md).

## 3. Données traitées comme responsable, finalités et bases juridiques

| Données                                                                                                                                                                                                                                   | Finalité                                             | Base (RGPD)                                                                    | Conservation                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-mail, nom, photo de profil (Google, si utilisé, ou photo importée), identités de connexion, clés d’accès (clés publiques uniquement), paramètres de double authentification (secret chiffré par AES-GCM ; codes de récupération hachés) | Créer et sécuriser le compte, permettre la connexion | Contrat (art. 6, par. 1, let. b)                                               | Jusqu’à la suppression du compte ; les données de connexion sont ensuite supprimées et le profil anonymisé (e-mail remplacé, nom et photo retirés) |
| Sessions : navigateur, système d’exploitation, adresse IP, heure de connexion, dernière activité                                                                                                                                          | Afficher et fermer les sessions actives, sécurité    | Intérêt légitime à la sécurité (art. 6, par. 1, let. f)                        | Jusqu’à la fin ou l’expiration de la session (30 jours par défaut) ; les sessions expirées sont supprimées                                         |
| Codes de connexion à usage unique et échecs de double authentification                                                                                                                                                                    | Empêcher la prise de contrôle des comptes            | Intérêt légitime (art. 6, par. 1, let. f)                                      | Codes : valables quelques minutes, supprimés après 24 heures ; échecs : jusqu’à la prochaine connexion réussie                                     |
| Jetons d’API personnels : nom, périmètres, premiers caractères, création et dernière utilisation (jeton lui-même conservé uniquement comme empreinte SHA-256)                                                                             | Vous permettre de connecter vos outils               | Contrat                                                                        | Jusqu’à révocation ou expiration ; refusés dès la fermeture du compte                                                                              |
| E-mail du propriétaire, nom de l’espace, adresse de facturation et numéro fiscal saisis au paiement, formule, places et statut de paiement (les données de carte restent chez Stripe)                                                     | Facturer les formules Helvetly                       | Contrat ; obligation légale de conservation comptable (art. 6, par. 1, let. c) | 10 ans pour les pièces comptables (art. 958f du code suisse des obligations)                                                                       |
| Identité de la personne ayant commencé un essai gratuit, sous forme d’empreintes à sens unique du compte, de son e-mail et de l’empreinte de la carte (jamais de la carte elle-même)                                                      | Accorder un essai à chaque client                    | Intérêt légitime à prévenir les abus d’essai (art. 6, par. 1, let. f)          | 24 mois après le début de l’essai, puis suppression                                                                                                |
| Retours et signalements : description, page affichée, jusqu’à cinq captures, compte et espace                                                                                                                                             | Vous répondre et améliorer Helvetly                  | Intérêt légitime (art. 6, par. 1, let. f)                                      | 2 ans après la clôture du signalement ; les signalements sont aussi envoyés à la boîte e-mail de notre équipe                                      |
| E-mails envoyés : codes de connexion, invitations, avis, alertes de sécurité, récapitulatifs                                                                                                                                              | Exploiter le service                                 | Contrat                                                                        | Pendant la durée de conservation des journaux d’envoi par le prestataire d’e-mail                                                                  |
| Journaux d’erreurs (route, erreur, heure) et journaux de l’hébergeur (pouvant contenir des adresses IP)                                                                                                                                   | Exploiter et sécuriser le service                    | Intérêt légitime                                                               | 30 jours. L’application ne produit aucun journal d’accès ; les erreurs sont journalisées sans les jetons des URL                                   |

Nous ne vendons pas de données personnelles, ne personnalisons pas la publicité,
n’établissons pas de profil et ne prenons aucune décision vous concernant sur une base exclusivement
automatisée (art. 21 nLPD, art. 22 RGPD).

**Mesure publicitaire facultative.** Avec votre accord, Google Ads peut relier un clic publicitaire à la création d’un compte Helvetly. Google reçoit l’identifiant du clic, des informations sur le navigateur et le réseau, ainsi qu’un identifiant de conversion aléatoire. L’événement ne contient ni adresse e-mail ni contenu de l’espace de travail. Google utilise des cookies internes d’attribution (`_gcl_*`). Helvetly conserve votre choix pendant 180 jours et le marqueur d’inscription pendant dix minutes au maximum. Vous pouvez refuser ou retirer votre consentement sous « Mesure publicitaire » en bas de page (art. 6, par. 1, let. a RGPD).

**Cookies et stockage du navigateur.** Le site (www.helvetly.com) utilise Google Analytics 4 pour
compter les visites et identifier les pages et canaux qui amènent des visiteurs ; il dépose les
cookies Google `_ga` (jusqu’à 2 ans) et transmet les pages vues et données d’appareil à Google, qui
utilise l’adresse IP uniquement pour déterminer une localisation approximative, sans la conserver
(intérêt légitime, art. 6, par. 1, let. f). Le blocage des cookies ou scripts dans votre navigateur
désactive cette fonction. La documentation ne dépose aucun cookie et n’utilise ni analyse, ni
publicité, ni suivi. La plateforme (app.helvetly.com) utilise Google Analytics 4 de la même manière,
mais transmet uniquement l’adresse de chaque page sans ses paramètres ni son fragment, jamais ce que
vous saisissez ni les données de l’espace. Une fois connecté, elle y ajoute un pseudonyme de votre compte et
de l’espace (une empreinte à clé que Google ne peut pas relier à vous) ainsi que votre rôle, afin que les visites
depuis plusieurs appareils comptent comme une seule personne. Le portail client ne charge aucun outil d’analyse.
Hormis la mesure publicitaire facultative et les cookies Google `_ga`, la plateforme et le portail ne déposent que les cookies
strictement nécessaires à la connexion :

| Nom                       | Déposé par     | Finalité                                                      | Durée                                  |
| ------------------------- | -------------- | ------------------------------------------------------------- | -------------------------------------- |
| `helvetly_session`        | Plateforme     | Maintenir votre connexion                                     | Jusqu’à la déconnexion ou 30 jours     |
| `helvetly_login`          | Plateforme     | Protéger une connexion Google en cours                        | 10 minutes                             |
| `helvetly_portal_session` | Portail client | Maintenir la connexion d’un client de notre client au portail | Jusqu’à la déconnexion ou l’expiration |

La plateforme conserve aussi des préférences d’affichage dans le stockage local du navigateur
(par exemple barre latérale repliée, colonnes choisies, période du tableau de bord, avis masqué).
Elles ne quittent jamais votre navigateur. L’espace d’essai de l’API dans la documentation conserve
le jeton d’API que vous collez uniquement dans le stockage de session de cet onglet du navigateur.

## 4. Heidi, import par IA et OpenAI

Vous approuvez une seule fois votre propre utilisation de l’IA dans chaque espace de travail. Votre
approbation couvre toutes les fonctions d’IA de cet espace ; elle ne vaut ni pour un autre membre ni
dans un autre espace. Refuser ou fermer la boîte de dialogue ne lance aucune action d’IA. Helvetly
enregistre la version de cette information que vous avez approuvée : lorsqu’elle change, les
approbations antérieures cessent de compter et chaque membre approuve une fois la nouvelle version
avant que son contenu soit de nouveau envoyé. Vous pouvez retirer votre approbation à tout moment ;
dès lors, rien de ce que vous envoyez ou téléversez dans cet espace n’est transmis à OpenAI.

Heidi répond à de nombreuses questions à partir des données de votre espace sans service externe.
Pour d’autres questions, pour **l’import par IA** (lecture de fichiers et proposition
d’enregistrements), pour la lecture des justificatifs, pour la suggestion de nom d’espace et pour le
**classement automatique** des documents que vous téléversez, Helvetly utilise l’API OpenAI
(OpenAI, États-Unis) uniquement après votre propre approbation pour cet espace. L’import par IA, la
lecture des justificatifs et le classement automatique sont disponibles dans les formules qui
incluent l’import par IA.

Données transmises :

- Heidi envoie votre message, jusqu’à 20 messages précédents de la conversation (pouvant contenir
  des chiffres affichés par Heidi) et les fichiers joints à ce message. Une vérification rapide
  visant à déterminer si le message concerne Helvetly ou votre activité est également envoyée à
  OpenAI.
- Selon votre demande, Heidi envoie aussi des résultats limités tirés des données de l’espace auxquelles vous avez accès (y compris des données commerciales et des données clients), le contenu du document dont vous demandez la lecture, les identifiants de la page et de ses commandes disponibles, ainsi que le style de réponse choisi.
- L’import par IA transmet le contenu des fichiers sélectionnés, partie par partie ; la lecture des
  justificatifs transmet le justificatif sélectionné.
- La suggestion de nom d’espace transmet uniquement le nom d’entreprise saisi.
- **Classement automatique :** après le téléversement d’un fichier dans Documents, Helvetly envoie
  en arrière-plan le nom et le type du fichier, le début de son texte (environ 6 000 octets au
  plus) ou, s’il n’a pas de texte lisible, le PDF ou l’image lui-même (4 Mio au plus ; un fichier
  plus volumineux uniquement par son nom), ainsi que les noms de 200 dossiers de l’espace au plus et
  de 50 étiquettes utilisées au plus. Le modèle propose des étiquettes et un dossier ; vous pouvez
  annuler le résultat.
- Avant chaque requête, le même contenu est également envoyé au service de décompte des tokens
  d’OpenAI, afin de le vérifier par rapport au quota d’IA de l’espace.

Helvetly ne récupère pas les données d’Employees ou de Payroll, ni les fichiers conservés avec un
employé, pour les requêtes d’IA, et les imports de salaires sont lus sans IA. Si vous collez de
telles données dans un message, les joignez ou les téléversez dans Documents au lieu de la fiche de
l’employé, elles sont transmises comme tout autre contenu ; veuillez donc ne pas le faire.

Nous demandons à OpenAI de ne pas conserver les requêtes et réponses comme état applicatif stocké
(`store: false`). Cela est distinct de la conservation propre à OpenAI : selon ses conditions API,
les données de l’API peuvent être conservées jusqu’à 30 jours pour détecter les abus, et elles ne
servent pas à entraîner les modèles, sauf si le client de l’API accepte de les partager avec OpenAI.
Helvetly conserve ses propres données séparément : les conversations avec Heidi sont stockées dans
Helvetly, sans durée d’effacement fixée à ce jour, jusqu’à la suppression de votre compte (dans un
espace supprimé, elles restent stockées avec ses autres données) ; les fichiers importés, les
enregistrements et les documents classés restent dans l’espace comme toute autre donnée. Heidi est
présentée comme une assistante IA ; ses réponses, les données importées et les propositions de
classement peuvent être erronées et sont des propositions à vérifier.

Helvetly compte les consultations et les actions réalisées par sujet pour vous suggérer des questions lors de vos prochaines conversations dans cet espace. Dans les paramètres du compte, vous pouvez consulter et effacer ces compteurs et votre style de réponse, ou désactiver la mémoire. Les compteurs restent dans Helvetly.

## 5. Destinataires et transferts à l’étranger

Les services traitant des données pour nous figurent dans la [liste des sous-traitants](subprocessors.md).
Certains se trouvent aux États-Unis (Stripe, Google, OpenAI, Cloudflare). Nous ne communiquons des
données à l’étranger que dans les conditions des art. 16 à 17 nLPD et du chapitre V du RGPD : vers des
pays reconnus adéquats par le Conseil fédéral ou la Commission européenne (pour les États-Unis,
entreprises certifiées au titre des Data Privacy Framework Suisse–États-Unis et UE–États-Unis), ou
sur la base des clauses contractuelles types reconnues par le PFPDT et la Commission européenne.

Helvetly n’envoie rien aux autorités fiscales ni aux réseaux de facturation électronique : les
clients téléchargent les décomptes TVA et fichiers de facturation électronique et les transmettent eux-mêmes.

## 6. Vos droits

Vous pouvez demander l’accès à vos données (art. 25 nLPD, art. 15 RGPD), leur rectification ou
suppression, vous opposer au traitement ou en demander la limitation, et les recevoir dans un format
courant lisible par machine (art. 28 nLPD, art. 20 RGPD). Nous répondons dans les 30 jours (RGPD : un
mois, prolongeable dans les cas prévus par la loi). Vous pouvez effectuer vous-même la plupart des démarches :

- **Télécharger vos données :** Account settings → Your data fournit un fichier JSON contenant
  votre profil, méthodes de connexion, clés d’accès, sessions, jetons d’API (sans les jetons
  eux-mêmes), espaces de travail, messages à Heidi et retours envoyés.
- **Données de l’espace :** un propriétaire télécharge toutes les données et tous les fichiers de
  l’espace au format ZIP dans Settings → Workspace → Export all data, y compris les données des
  employés et des salaires dans un dossier distinct.
- **Supprimer votre compte :** Account settings → Delete account. Vos méthodes de connexion,
  sessions et appartenances ainsi que vos conversations avec Heidi sont supprimées et votre profil
  anonymisé. Les enregistrements que vous avez créés dans un espace appartiennent à cet espace et y
  restent sans vos nom et adresse ; demandez au propriétaire ou à nous de les retirer.

Le propriétaire qui a supprimé un espace peut le restaurer dans les 30 jours. Peu après la
suppression, une tâche en arrière-plan conserve en outre une copie d’archive : un ZIP des
enregistrements et fichiers de l’espace, y compris les données des employés et des salaires, avec
une note indiquant qui l’a supprimé, quand, et ses membres. Elle reflète l’espace tel qu’il est au
moment où la tâche s’exécute.

Un espace supprimé devient inaccessible à tous, mais ses données, ses fichiers et la copie
d’archive restent stockés ; Helvetly ne les efface pas encore automatiquement et aucune durée
d’effacement n’a encore été fixée. Les pièces soumises à conservation comptable (factures,
justificatifs, journal d’audit : 10 ans, art. 958f CO et Olico) sont conservées au moins pendant
cette durée. Écrivez à [support@helvetly.com](mailto:support@helvetly.com) pour faire effacer des
données plus tôt lorsque la loi le permet. Pour toute autre
demande, écrivez-nous à la même adresse ; nous pouvons d’abord vous
demander de confirmer votre identité. Vous pouvez déposer une réclamation auprès du Préposé fédéral
à la protection des données et à la transparence (PFPDT, www.edoeb.admin.ch) ou, dans l’UE, auprès de
votre autorité nationale de protection des données.

## 7. Sécurité

Connexion sans mot de passe (Google, codes par e-mail, clés d’accès) avec double authentification
facultative ; jetons de session et d’API conservés uniquement sous forme d’empreintes SHA-256 ;
connexions chiffrées ; séparation des données de chaque espace dans toutes les requêtes ; écritures
financières dans un journal chaîné par hachage en ajout uniquement ; si le stockage est configuré à
cet effet, factures émises et justificatifs comptabilisés protégés contre la suppression (S3 Object
Lock) ; données au repos chiffrées et sauvegardées régulièrement.

## 8. Modifications

Nous publions ici les modifications avec leur date. Dernière modification : 18 novembre 2026.
