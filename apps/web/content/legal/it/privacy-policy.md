# Informativa sulla privacy

## 1. Chi siamo

Helvetly («Helvetly», «noi») gestisce il sito helvetly.com, la documentazione docs.helvetly.com,
la piattaforma Helvetly e il portale clienti. Contatto per la protezione dei dati:
[support@helvetly.com](mailto:support@helvetly.com).

Helvetly è un servizio per imprese. Non è rivolto ai minori.

## 2. Due ruoli

- **Titolare del trattamento** per i dati delle persone che usano Helvetly: dati di account e accesso,
  fatturazione dei piani Helvetly, dati di sicurezza, feedback e richieste di assistenza, nonché il sito.
- **Responsabile del trattamento** per i dati aziendali che i nostri clienti conservano nei propri
  spazi di lavoro: clienti e contatti (comprese le persone che accedono al portale clienti del cliente),
  fatture, spese, documenti, richieste di firma e firmatari, incarichi, importazioni IA, conversazioni
  con Heidi e dati del personale e dei salari dei dipendenti. Il cliente è titolare di questi dati;
  li trattiamo solo su sue istruzioni, in base al nostro [accordo sul trattamento dei dati](dpa.md).
  Se sei cliente, contatto, firmatario o dipendente di un nostro cliente, rivolgiti a lui per i tuoi dati.

**Dati dei dipendenti e dei salari.** Un cliente con piano Business può conservare in Helvetly dati
del personale e dei salari: identità (nome, numero dipendente), contatti, dati del rapporto di lavoro
(posizione, reparto, tipo di contratto, date, termine di disdetta, orario, luogo e paese di lavoro,
paese di residenza e di assicurazione sociale, status di frontaliere), condizioni retributive e cifre
salariali che inserisce o importa, numeri di assicurazione sociale (come il numero AVS svizzero),
identificativi fiscali, coordinate bancarie, assoggettamento e cantone per l’imposta alla fonte e
documenti caricati per un dipendente (come contratti, conteggi paga o permessi). Helvetly non calcola
retribuzioni, imposte o contributi, non conserva dati sulla salute o sulle assenze e non ha campi per
altre categorie particolari di dati; i documenti caricati dal cliente possono contenerne, sotto la sua
responsabilità. Helvetly non recupera i dati dei dipendenti e dei salari per le richieste a OpenAI. Questi dati non
sono disponibili tramite MCP o token API personali. Spetta al cliente, in qualità di titolare del
trattamento, determinare la base giuridica applicabile (ad esempio ai sensi degli art. 6(1)(b) e (c)
e 88 GDPR, della nLPD, dell’art. 328b del Codice delle obbligazioni svizzero o degli art. 50e–50g LAVS
per il numero AVS); l’[accordo sul trattamento dei dati](dpa.md) descrive i dettagli.

## 3. Cosa trattiamo come titolare, perché e su quale base

| Dati                                                                                                                                                                                                                                         | Finalità                                            | Base (GDPR)                                                                       | Conservazione                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Indirizzo email, nome, immagine del profilo (da Google, se usato, o foto caricata), identità di accesso, passkey (solo chiavi pubbliche), impostazioni a due fattori (segreto cifrato con AES-GCM; codici di recupero memorizzati come hash) | Creare e proteggere l’account, consentire l’accesso | Contratto (art. 6(1)(b))                                                          | Fino all’eliminazione dell’account; poi i dati di accesso vengono eliminati e il profilo anonimizzato (email sostituita, nome e foto rimossi) |
| Sessioni: browser, sistema operativo, indirizzo IP, ora di accesso, ultima attività                                                                                                                                                          | Mostrare e terminare le sessioni attive, sicurezza  | Legittimo interesse alla sicurezza (art. 6(1)(f))                                 | Fino alla fine o scadenza della sessione (30 giorni per impostazione predefinita); le sessioni scadute vengono rimosse                        |
| Codici di accesso monouso e tentativi a due fattori falliti                                                                                                                                                                                  | Prevenire l’appropriazione dell’account             | Legittimo interesse (art. 6(1)(f))                                                | Codici: validi per pochi minuti, rimossi dopo 24 ore; tentativi falliti: fino al successivo accesso riuscito                                  |
| Token API personali: nome, ambiti, primi caratteri, creazione e ultimo utilizzo (il token stesso solo come hash SHA-256)                                                                                                                     | Consentire di collegare i propri strumenti          | Contratto                                                                         | Fino alla revoca o scadenza del token; rifiutati dopo la chiusura dell’account                                                                |
| Email del titolare dello spazio di lavoro, nome dello spazio, indirizzo di fatturazione e numero fiscale inseriti al pagamento, piano, posti e stato del pagamento (i dati della carta restano con Stripe)                                   | Fatturare i piani Helvetly                          | Contratto; obbligo legale di conservazione dei documenti contabili (art. 6(1)(c)) | 10 anni per i documenti contabili (art. 958f del Codice delle obbligazioni svizzero)                                                          |
| Chi ha iniziato una prova gratuita, come impronte unidirezionali dell’account, della sua email e dell’impronta della carta (mai la carta)                                                                                                    | Offrire una sola prova a ogni cliente               | Legittimo interesse a prevenire abusi delle prove (art. 6(1)(f))                  | 24 mesi dall’inizio della prova, poi eliminati                                                                                                |
| Feedback e segnalazioni di problemi: descrizione, pagina in cui ti trovavi, fino a cinque screenshot, account e spazio di lavoro                                                                                                             | Risponderti e migliorare Helvetly                   | Legittimo interesse (art. 6(1)(f))                                                | 2 anni dalla chiusura della segnalazione; le segnalazioni vengono inviate anche alla casella email del nostro team                            |
| Email che ti inviamo: codici di accesso, inviti, avvisi, allarmi di sicurezza, riepiloghi                                                                                                                                                    | Gestire il servizio                                 | Contratto                                                                         | Per il periodo in cui il fornitore email conserva i log di consegna                                                                           |
| Log degli errori (percorso, errore, ora) e log del nostro fornitore di hosting (che possono contenere indirizzi IP)                                                                                                                          | Gestire e proteggere il servizio                    | Legittimo interesse                                                               | 30 giorni. L’applicazione non scrive un registro degli accessi; registra gli errori senza i token degli URL                                   |

Non vendiamo dati personali, non li usiamo per pubblicità, non effettuiamo profilazione e non
prendiamo decisioni su di te con mezzi esclusivamente automatizzati (art. 21 nLPD, art. 22 GDPR).

**Cookie e archiviazione nel browser.** Il sito (www.helvetly.com) usa Google Analytics 4 per contare
le visite e capire quali pagine e canali portano visitatori; imposta i cookie Google `_ga` (fino a
2 anni) e invia a Google visualizzazioni di pagina e dati del dispositivo. Google usa l’indirizzo IP
solo per ricavare una posizione approssimativa e non lo conserva (legittimo interesse, art. 6(1)(f)).
Bloccare cookie o script nel browser disattiva questa funzione. La documentazione non imposta cookie
e non usa analisi, pubblicità o tracciamento. La piattaforma (app.helvetly.com) usa Google Analytics 4
allo stesso modo, ma invia solo l’indirizzo di ogni pagina senza query o frammento, mai ciò che
inserisci o i dati dello spazio di lavoro. Dopo l’accesso aggiunge uno pseudonimo del tuo account e dello
spazio di lavoro (un’impronta con chiave che Google non può ricondurre a te) e il tuo ruolo, così le visite da più
dispositivi contano come una sola persona. Il portale clienti non carica strumenti di analisi.
A parte i cookie Google `_ga`, piattaforma e portale impostano solo i cookie strettamente necessari
per l’accesso:

| Nome                      | Impostato da    | Finalità                                                | Durata                                   |
| ------------------------- | --------------- | ------------------------------------------------------- | ---------------------------------------- |
| `helvetly_session`        | Piattaforma     | Mantiene l’accesso                                      | Fino alla disconnessione o per 30 giorni |
| `helvetly_login`          | Piattaforma     | Protegge l’accesso con Google mentre è in corso         | 10 minuti                                |
| `helvetly_portal_session` | Portale clienti | Mantiene l’accesso del cliente di un cliente al portale | Fino alla disconnessione o alla scadenza |

La piattaforma conserva inoltre preferenze di visualizzazione nell’archiviazione locale del browser
(ad esempio barra laterale compressa, colonne delle tabelle, periodo della dashboard, avviso chiuso).
Non lasciano mai il browser. L’ambiente di prova API della documentazione conserva il token API che
incolli solo nell’archiviazione di sessione della scheda del browser.

## 4. Heidi, importazione IA e OpenAI

Approvi una sola volta il tuo utilizzo dell’IA in ogni spazio di lavoro. L’approvazione copre tutte
le funzioni IA di quello spazio; non vale per altri membri né in altri spazi. Se rifiuti o chiudi la
finestra di approvazione, non viene avviata alcuna azione IA. Helvetly registra la versione di questa
informativa che hai approvato: quando l’informativa cambia, le approvazioni precedenti non valgono
più e ogni membro approva una volta la nuova versione prima che i suoi contenuti vengano di nuovo
inviati. Puoi revocare l’approvazione in qualsiasi momento; da allora nulla di ciò che invii o
carichi in quello spazio viene trasmesso a OpenAI.

Heidi risponde a molte domande usando i dati dello spazio di lavoro senza servizi esterni. Per altre
domande, per l’**importazione IA**, che legge file caricati e propone record, per la lettura delle
ricevute, per il suggerimento del nome dello spazio e per l’**archiviazione automatica** dei
documenti che carichi, Helvetly usa l’API di OpenAI (OpenAI, USA) solo dopo la tua approvazione per
questo spazio. L’importazione IA, la lettura delle ricevute e l’archiviazione automatica sono
disponibili nei piani che includono l’importazione IA.

Cosa viene inviato:

- Heidi invia il messaggio che scrivi, fino a 20 messaggi precedenti della conversazione (che possono
  contenere cifre mostrate da Heidi) e i file allegati a quel messaggio. Viene inviato a OpenAI anche
  un breve controllo per stabilire se il messaggio riguarda Helvetly o l’attività.
- L’importazione IA invia il contenuto dei file selezionati, una parte alla volta; la lettura delle
  ricevute invia la ricevuta selezionata.
- Il suggerimento del nome dello spazio invia solo il nome dell’azienda inserito.
- **Archiviazione automatica:** dopo che carichi un file in Documents, Helvetly invia in background
  il nome e il tipo del file, l’inizio del suo testo (fino a circa 6000 byte) oppure, se non ha
  testo leggibile, il PDF o l’immagine stessi (fino a 4 MiB; un file più grande solo con il suo
  nome), insieme ai nomi di al massimo 200 cartelle dello spazio e di al massimo 50 tag in uso. Il
  modello propone tag e una cartella; puoi annullare il risultato.
- Prima di ogni richiesta lo stesso contenuto viene inviato anche al servizio di conteggio dei token
  di OpenAI, per verificarlo rispetto al budget IA dello spazio.

Helvetly non recupera i dati di Employees o Payroll, né i file conservati con un dipendente, per le
richieste IA, e le importazioni dei salari vengono lette senza IA. Se incolli tali dati in un
messaggio, li alleghi o li carichi in Documents invece che nella scheda del dipendente, vengono
inviati come qualsiasi altro contenuto: ti chiediamo di non farlo.

Chiediamo a OpenAI di non conservare richieste e risposte come stato applicativo memorizzato
(`store: false`). Ciò è distinto dalla conservazione propria di OpenAI: secondo le condizioni API di
OpenAI, i dati API possono essere conservati fino a 30 giorni per rilevare abusi e non vengono usati
per addestrare i modelli, a meno che il cliente dell’API acconsenta a condividerli con OpenAI.
Helvetly conserva i propri dati separatamente: le conversazioni con Heidi sono memorizzate in
Helvetly, per ora senza un termine di cancellazione fissato, fino all’eliminazione del tuo account
(in uno spazio eliminato restano memorizzate con gli altri dati); file importati, record e documenti
archiviati restano nello spazio come qualsiasi altro dato. Heidi è indicata come assistente IA; le sue
risposte, i record importati e le proposte di archiviazione possono essere errati e sono
suggerimenti da verificare.

## 5. Destinatari e trasferimenti all’estero

I servizi che trattano dati per noi sono elencati in [subprocessors.md](subprocessors.md). Alcuni si
trovano negli USA (Stripe, Google, OpenAI, Cloudflare). Comunichiamo dati all’estero solo nei casi
consentiti dagli art. 16–17 nLPD e dal capo V GDPR: verso paesi riconosciuti adeguati dal Consiglio
federale o dalla Commissione europea (per gli USA, aziende certificate ai sensi dei Data Privacy
Framework Svizzera–USA e UE–USA), oppure in base a clausole contrattuali standard riconosciute
dall’IFPDT e dalla Commissione europea.

Helvetly non invia nulla alle autorità fiscali o alle reti di fatturazione elettronica: i clienti
scaricano rendiconti IVA e file di fatture elettroniche e li presentano autonomamente.

## 6. I tuoi diritti

Puoi chiedere accesso ai dati (art. 25 nLPD, art. 15 GDPR), rettifica o cancellazione, opporti al
trattamento o limitarlo e ricevere i dati in un formato comune leggibile da macchina (art. 28 nLPD,
art. 20 GDPR). Rispondiamo entro 30 giorni (GDPR: un mese, prorogabile ove consentito dalla legge).
La maggior parte delle operazioni è disponibile direttamente:

- **Scaricare i dati:** Account settings → Your data fornisce un file JSON con profilo, metodi di
  accesso, passkey, sessioni, token API (senza i token stessi), spazi di lavoro, messaggi Heidi e
  feedback inviati.
- **Dati dello spazio di lavoro:** il titolare scarica tutto ciò che lo spazio contiene (record e
  file) in uno ZIP in Settings → Workspace → Export all data, compresi dati dei dipendenti e dei
  salari in una cartella separata.
- **Eliminare l’account:** Account settings → Delete account. Metodi di accesso, sessioni,
  appartenenze e conversazioni con Heidi vengono eliminati e il profilo anonimizzato. I record che
  hai creato in uno spazio di lavoro appartengono allo spazio e restano senza il tuo nome o
  indirizzo; chiedi al titolare dello spazio o a noi se vuoi che vengano rimossi.

Il titolare che ha eliminato uno spazio di lavoro può ripristinarlo entro 30 giorni. Poco dopo
l’eliminazione un processo in background conserva inoltre una copia d’archivio: uno ZIP dei record e
dei file dello spazio, compresi i dati dei dipendenti e dei salari, con una nota su chi l’ha
eliminato, quando, e sui suoi membri. Rispecchia lo spazio com’è nel momento in cui il processo viene
eseguito.

Nessuno può più accedere a uno spazio di lavoro eliminato, ma i suoi dati, i file e la copia
d’archivio restano memorizzati; Helvetly non li cancella ancora automaticamente e non è ancora stato
fissato un termine di cancellazione. I dati che la normativa contabile impone di conservare (fatture,
ricevute, registro di audit: 10 anni, art. 958f CO e Olc) vengono mantenuti almeno per quel periodo.
Scrivi a [support@helvetly.com](mailto:support@helvetly.com) per far cancellare i dati prima, ove la
legge lo consente, o per qualsiasi altra richiesta; potremmo
prima chiederti di confermare l’identità. Puoi presentare un reclamo a noi, all’Incaricato federale
della protezione dei dati e della trasparenza (IFPDT, www.edoeb.admin.ch) oppure, nell’UE, alla tua
autorità locale di protezione dei dati.

## 7. Sicurezza

Accesso senza password (Google, codici email, passkey) con autenticazione a due fattori facoltativa;
token di sessione e API conservati solo come hash SHA-256; connessioni cifrate; dati di ogni spazio
di lavoro separati in ogni interrogazione; dati finanziari in un registro concatenato tramite hash
che consente solo aggiunte; ove lo storage sia configurato per farlo, fatture emesse e ricevute
contabilizzate protette dall’eliminazione (S3 Object Lock); dati a riposo cifrati e sottoposti a
backup regolari.

## 8. Modifiche

Pubblichiamo qui le modifiche con la relativa data. Ultima modifica: 18 novembre 2026.
