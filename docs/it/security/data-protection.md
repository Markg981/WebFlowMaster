# Protezione dei dati

Quali dati personali conserva WebFlowMaster, dove, per quanto tempo, e come un'organizzazione li
riottiene o li fa cancellare. Serve a supporto di una valutazione sulla protezione dei dati (per
esempio ai sensi del GDPR); descrive il prodotto, non è una consulenza legale, e i ruoli giuridici
dipendono da come l'installazione viene gestita e contrattualizzata.

## Due tipi di dati

I **dati degli account** riguardano le persone che usano il prodotto: username, ruoli, accessi e
azioni. Servono al prodotto per funzionare.

I **dati dei test** sono ciò che le organizzazioni mettono nei loro test e ciò che i run
catturano: indirizzi, account di test, valori digitati nei moduli, e screenshot, video e trace
delle applicazioni sotto test. Non li sceglie il prodotto, e il prodotto non può sapere se
contengono dati personali. Un'organizzazione che testa su dati simili a quelli di produzione deve
presumere di sì.

## Inventario dei dati

| Dati                         | Esempi                                                                                                                 | Dove si conservano                                | Per quanto                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| Account                      | Username (può essere un indirizzo e-mail), ruolo, data di creazione                                                    | Database                                          | Finché il membro non viene rimosso o l'organizzazione cancellata                |
| Identità del single sign-on  | L'issuer del provider e il suo identificativo della persona (non l'indirizzo e-mail), primo e ultimo accesso           | Database                                          | Finché l'account non viene rimosso                                              |
| Credenziali                  | Hash della password (scrypt), segreto del secondo fattore (cifrato), codici di recupero (hash)                         | Database                                          | Come gli account                                                                |
| Sessioni                     | Id di sessione, id utente                                                                                              | Redis                                             | 7 giorni, o fino all'uscita                                                     |
| Registro di audit            | Nome di chi ha agito, azione, oggetto, indirizzo IP del client, chiave usata, ora                                      | Database                                          | Fino alla cancellazione dell'organizzazione; l'applicazione non può cancellarlo |
| Log dell'applicazione        | Id utente, percorsi delle richieste, correlation id, errori                                                            | File di log, standard output, Loki se configurato | 7 giorni di default (configurabile)                                             |
| Test e piani                 | Step, indirizzi, descrizioni degli elementi, schedulazioni, indirizzi di notifica, commenti alle revisioni             | Database                                          | Finché non vengono cancellati, o l'organizzazione cancellata                    |
| Segreti salvati              | Password degli account di test, token                                                                                  | Database, cifrati                                 | Finché non vengono cancellati                                                   |
| Risultati dei run            | Verdetti, esiti degli step, messaggi di errore, chi ha avviato il run, contesto CI (repository, commit, branch, build) | Database                                          | Fino alla cancellazione dell'organizzazione                                     |
| Evidenze dei run             | Screenshot, video, trace di Playwright, catture di rete senza corpi ([evidenze grezze](#evidenze-grezze))              | Archivio degli artefatti (disco o S3)             | `ARTIFACT_RETENTION_DAYS`, 90 giorni di default                                 |
| Baseline visive              | Screenshot di riferimento                                                                                              | Archivio degli artefatti                          | Finché non vengono sostituite o rimosse                                         |
| Link di reset della password | Di chi è, chi l'ha emesso, un hash del token                                                                           | Database                                          | Un giorno, o fino all'uso; esclusi dalle esportazioni                           |
| Inviti                       | Username invitato, ruolo, chi ha invitato                                                                              | Database                                          | Fino alla revoca; il token scade dopo 7 giorni                                  |
| Fogli di calcolo caricati    | Casi di test importati                                                                                                 | Disco locale durante la lettura                   | Cancellati appena letti                                                         |

I backup fatti dall'operatore contengono copie del database e dell'archivio degli artefatti per
tutto il tempo in cui l'operatore li conserva.

## Chi vede cosa

- Tutto ciò che un'organizzazione contiene è visibile solo ai suoi membri, secondo i loro ruoli
  e, per i progetti riservati, secondo l'appartenenza al progetto. Lo impone il database.
- Il registro di audit è visibile solo agli owner dell'organizzazione.
- Trace, file HAR e file del run non riconosciuti sono solo per editor e owner
  ([Evidenze grezze](#evidenze-grezze)).
- Chi gestisce l'installazione ha accesso tecnico al database, ai log e all'archivio degli
  artefatti, come qualsiasi fornitore di hosting. I segreti salvati sono cifrati con una chiave
  che anche l'operatore possiede.

## Come sono cifrati i segreti salvati {#come-sono-cifrati-i-segreti-salvati}

I segreti salvati — segreti degli ambienti, stati di login, chiavi delle griglie di browser, token
di issue tracker, source host e strumenti di test management, password SMTP, client secret e
chiavi di firma del single sign-on, segreti del secondo fattore — sono cifrati con AES-256-GCM
prima di arrivare nel database e mai restituiti dall'API.

Le chiavi formano una busta (envelope). Ogni organizzazione ha una chiave dati propria, generata
la prima volta che salva un segreto; i suoi segreti sono cifrati con quella chiave, e ogni valore è
legato alla sua organizzazione e alla versione della chiave, così un valore copiato nelle righe di
un'altra organizzazione lì non si decifra. Anche le chiavi dati sono nel database, avvolte da
un'unica chiave master derivata da `ENCRYPTION_KEY`, che vive solo nell'ambiente
dell'installazione. I valori salvati prima di questo schema (migrazione 0084) sono cifrati
direttamente con la chiave master e si leggono ancora; `npm run key:rotate` li sposta sulle chiavi
delle organizzazioni.

Cosa dà e cosa non dà:

- Il database da solo — un dump, un backup, una copia — non rivela alcun segreto: le chiavi dati
  che contiene sono avvolte.
- La chiave master protegge ancora tutto. Chi la possiede insieme al database può aprire la chiave
  di ogni organizzazione, come prima; non esiste una chiave dell'organizzazione che l'operatore non
  abbia. Il guadagno è l'isolamento del materiale crittografico e una rotazione economica, non un
  segreto tenuto nascosto all'operatore.
- Ruotare la chiave di un'organizzazione (`npm run key:rotate -- --organization <id>`) ricifra
  solo i segreti di quella organizzazione; ruotare la chiave master riavvolge le chiavi dati e
  lascia i segreti come sono. Vedi [Ruotare la chiave di cifratura](../admin/operations#ruotare-la-chiave-di-cifratura).

## Terze parti

Il prodotto invia dati a terze parti solo dove un'organizzazione o l'operatore lo configura:

| Destinatario                        | Quando                                                                                                                                                  | Cosa                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google (API Gemini)                 | Solo se l'operatore imposta `GEMINI_API_KEY` e un proprietario abilita l'AI per l'organizzazione (spenta di default, `PUT /api/organization/ai-policy`) | Le frasi che descrivono i test; il testo di una story da cui si propongono test; su uno step che fallisce, l'errore e fino a 30.000 caratteri dell'HTML della pagina; per un'analisi del fallimento chiesta da un report, step, errori, richieste e screenshot del test fallito. Vedi [Funzioni AI](./#funzioni-ai). |
| Fornitore di storage compatibile S3 | Se l'operatore sceglie `ARTIFACT_STORE=s3`                                                                                                              | Evidenze dei run e baseline.                                                                                                                                                                                                                                                                                         |
| Grafana Loki                        | Se l'operatore imposta `LOKI_URL`                                                                                                                       | Log dell'applicazione.                                                                                                                                                                                                                                                                                               |
| TestRail, Xray, Zephyr Scale        | Se un piano vi pubblica i suoi risultati                                                                                                                | Per ogni run pubblicato: il nome del piano, quando è terminato, l'ambiente, i nomi dei test con l'esito per browser, il motivo di ogni fallimento (fino a 1000 caratteri) e l'indirizzo del report. Nessuno screenshot, video, trace, valore degli step o secret.                                                    |
| Jira, Azure DevOps                  | Se un'organizzazione collega un issue tracker                                                                                                           | I dettagli del fallimento dei run che aprono una issue. Un import di requisiti invia solo le chiavi o la query; titoli, tipi e stati letti vengono conservati con i requisiti.                                                                                                                                       |
| BrowserStack, LambdaTest (app)      | Se un test di app mobile gira sulla griglia, o vi si carica un'app                                                                                      | Il file dell'app caricato (WebFlowMaster non lo conserva), e tutto ciò che il test fa sul dispositivo: i valori digitati, variabili e segreti compresi, le schermate mostrate, registrate in video dalla griglia.                                                                                                    |
| BrowserStack, LambdaTest            | Se un'organizzazione aggiunge una griglia di browser e un piano gira su di essa                                                                         | Tutto ciò che i test fanno nel browser: le pagine dell'applicazione sotto test, i valori digitati (compresi i segreti usati negli step), e screenshot, video e log di ogni sessione del fornitore, conservati secondo i suoi termini.                                                                                |
| GitHub, GitLab                      | Se un'organizzazione li collega                                                                                                                         | Stato del run, verdetto e link, sul commit testato.                                                                                                                                                                                                                                                                  |
| Slack o Microsoft Teams             | Se le notifiche di un piano indicano un webhook                                                                                                         | Riepiloghi dei run.                                                                                                                                                                                                                                                                                                  |
| Il server SMTP dell'installazione   | Se `SMTP_URL` è impostata                                                                                                                               | Link di invito e di reset (alla persona interessata), riepiloghi dei run (agli indirizzi del piano e alla persona che ha avviato il run, se l'ha chiesto).                                                                                                                                                           |

Le applicazioni sotto test ricevono ciò che i test inviano loro: è lo scopo di un test.

Dove risiedono fisicamente i dati dipende da dove l'operatore esegue l'installazione, il
database, lo storage e i log.

## Diritti degli interessati

| Richiesta                          | Come                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accesso, portabilità               | Un owner esporta l'intera organizzazione in JSON (`GET /api/organization/export`); vedi [Esportazione e cancellazione](../admin/administration#esportazione-e-cancellazione). Le voci di una persona si trovano nell'esportazione e nel registro di audit tramite lo username.                                                                                                                                            |
| Cancellazione di una persona       | Un owner rimuove il membro da **Impostazioni → Membri**. Vengono cancellati l'account, le sue chiavi API, il secondo fattore e le preferenze; ciò che la persona ha creato per l'organizzazione (test, piani, ambienti…) passa a un altro membro. Il registro di audit conserva il nome con cui la persona ha agito, come traccia di ciò che è successo. Vedi [Membri e inviti](../admin/administration#membri-e-inviti). |
| Cancellazione di un'organizzazione | Un owner la cancella: tutte le righe, compresi tutti gli account dei membri e il registro di audit, in una sola transazione.                                                                                                                                                                                                                                                                                              |
| Rettifica                          | Gli username non si possono cambiare; una persona con lo username sbagliato viene invitata di nuovo con quello giusto.                                                                                                                                                                                                                                                                                                    |
| Limitazione                        | Un owner può portare un membro a viewer, o riservare dei progetti.                                                                                                                                                                                                                                                                                                                                                        |

## Cosa raggiunge la cancellazione {#cosa-raggiunge-la-cancellazione}

Cancellare un'organizzazione rimuove in una volta tutte le sue righe dal database. **Non**:

- rimuove le righe di log già scritte (scadono con la conservazione dei log);
- rimuove le copie nei backup dell'operatore, o nei sistemi a cui era collegata (issue tracker,
  stati dei commit, messaggi Slack o Teams).

Rimuove invece i file dell'organizzazione dall'archivio degli artefatti, disco locale o bucket
compatibile S3 (screenshot, video e trace sotto `results/<planId>/<runId>/`, baseline sotto
`visual-baselines/org_<id>/`), dopo le righe. Un prefisso che non si riesce a rimuovere finisce
nel log (`Organization erased, but some of its files could not be removed`) e l'operatore lo
rimuove a mano.

Poiché il registro di audit se ne va con l'organizzazione, ogni cancellazione è scritta anche in
`organization_erasures`, una tabella fuori dalle tabelle tenant, senza row level security e senza
privilegi per il ruolo dell'applicazione: id e nome dell'organizzazione, chi l'ha chiesta,
quando, righe eliminate per tabella e file rimossi o rimasti. Non contiene dati del tenant e si
conserva.

La cancellazione della singola persona (GDPR art. 17) non è ancora implementata: i membri si
possono rimuovere, ma le loro voci di audit e i risultati continuano a nominarli. È un punto
aperto.

## Evidenze grezze e credenziali esposte {#evidenze-grezze}

Un run può conservare tre tipi di file che mostrano più di un verdetto: screenshot e video (ciò che
era sullo schermo), trace di Playwright (il contenuto della pagina, la console e ogni richiesta
**con il suo corpo**) e file HAR (ogni richiesta, senza corpi, con gli header e i parametri da
credenziale conosciuti sostituiti da `[redacted]`).

**Cosa garantisce WebFlowMaster**

- Trace, file HAR e qualsiasi file del run con un nome che non riconosce sono **evidenze grezze**:
  solo editor e owner possono scaricarli, e una chiave API ha bisogno anche dello scope
  `runs:evidence`. Il server lo decide a ogni download, elenco e report — il report,
  `/api/v1/runs/…/evidence` e `/api/v1/runs/…/artifacts/…` — che i file siano su disco o su S3; non
  si affida al link nascosto. I file scritti prima di questa regola ne sono coperti così come sono:
  conta il nome del file, non un flag salvato con esso.
- I file di un test in un progetto riservato sono raggiungibili solo da chi è nel progetto e dagli
  owner; per chiunque altro nell'organizzazione rispondono come un file che non esiste.
- Gli export (HTML, PDF, Allure, JUnit) contengono gli screenshot dei test falliti e nessun'altra
  evidenza.
- Un test che gestisce in modo visibile una credenziale (un valore `{{secret_…}}`, o qualcosa che si
  chiama _password_) non registra la trace, anche se il piano la chiede.
- Lo script delle migrazioni e `db:doctor` stampano il driver del database, non `DATABASE_URL`.

**Cosa non garantisce.** Niente toglie un segreto da uno screenshot, da un video o da una trace.
Riconoscere un campo password è un'euristica; un token può comparire ovunque in una pagina, in un
indirizzo o in un header personalizzato. Ogni file conservato va trattato come se potesse contenere
ciò che l'applicazione testata ha mostrato o inviato.

**Acquisizione prudente per i flussi sensibili.** Per i flussi che usano credenziali reali o dati
personali: account di test dedicati con i minimi diritti che funzionano; **Trace** _Mai_, **Video**
_Mai_ o _Quando il test fallisce_, **Rete (HAR)** solo durante la diagnosi;
`ARTIFACT_RETENTION_DAYS` più breve possibile per l'organizzazione.

### Quando delle credenziali possono essere già esposte {#credenziali-esposte}

Prima di questa release chiunque in un'organizzazione potesse vedere un run poteva scaricarne le
trace, e lo script delle migrazioni stampava `DATABASE_URL` — password compresa — nel suo output.
Procedura per un'installazione aggiornata da una release di quel tipo:

1. **Inventario.** Elencate le evidenze grezze ancora conservate: le chiavi sotto `results/` che
   finiscono in `_trace.zip` o `.har` (su disco, nella directory dei risultati; su S3, un elenco del
   prefisso `results/`). Annotate piani e run a cui appartengono e quali segreti usano quei test.
   Elencate dove è stato conservato l'output delle migrazioni: log dei job di CI, log di deploy,
   registrazioni del terminale.
2. **Valutazione.** Entro la retention dei log, il log delle richieste dell'applicazione mostra chi
   ha richiesto percorsi `/artifacts/…_trace.zip` o `…_network.har`. Considerate esposto ogni
   segreto usato da un test la cui trace era raggiungibile da un viewer, e la password del database
   se l'output delle migrazioni era leggibile da persone che non dovrebbero averla.
3. **Decisione — con il responsabile.** Cancellare le evidenze e ruotare le credenziali è una
   decisione dell'owner dell'organizzazione (per i suoi account di test) e dell'operatore (per la
   password del database), non di chi esegue questa procedura. Registrate la decisione.
4. **Rotazione**, dopo l'approvazione: cambiate prima la password o il token nell'applicazione
   testata, poi il segreto dell'ambiente in WebFlowMaster; cambiate insieme la password del
   database e `DATABASE_URL`, riavviando il processo web e i runner.
5. **Cancellazione**, dopo l'approvazione: rimuovete i file di trace e HAR dall'archivio degli
   artefatti (i loro link rispondono poi "non trovato"), e le copie nei log dove il sistema di log
   lo permette. I backup conservano le loro copie fino alla scadenza.

## Conservazione in sintesi

| Cosa                                    | Default    | Impostazione                                                                      |
| --------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| Evidenze dei run                        | 90 giorni  | `ARTIFACT_RETENTION_DAYS`                                                         |
| Log dell'applicazione                   | 7 giorni   | **Impostazioni → Sistema**, primo valore da `LOG_RETENTION_DAYS`                  |
| Sessioni                                | 7 giorni   | Fisso                                                                             |
| Token degli inviti                      | 7 giorni   | Fisso                                                                             |
| Runner che non si fanno più sentire     | 7 giorni   | Fisso                                                                             |
| Risultati, test                         | Conservati | Rimossi con l'organizzazione                                                      |
| Registro di audit                       | Conservato | `AUDIT_LOG_RETENTION_DAYS` (se non impostata resta); rimosso con l'organizzazione |
| Riferimenti alle evidenze dei tentativi | Conservati | `EVIDENCE_RETENTION_DAYS` (se non impostata restano)                              |
| Backup di database e file               | Operatore  | **La finestra di conservazione dei backup è responsabilità dell'operatore**       |

### Retention opzionale sul database

Due impostazioni, spente se non impostate, vuote o `0` (il comportamento di prima):

- `AUDIT_LOG_RETENTION_DAYS` elimina le voci di audit più vecchie di quei giorni. La tabella è
  append-only per l'applicazione; lo sweep usa la connessione privilegiata, la stessa della
  cancellazione di un'organizzazione. Scegliere una finestra coerente con i propri obblighi di
  accountability: le voci eliminate non si recuperano.
- `EVIDENCE_RETENTION_DAYS` svuota i riferimenti alle evidenze e il motivo di fallimento dei
  tentativi terminati prima di quella soglia. Tentativo ed esito restano.

I HAR sono ripuliti alla registrazione: i body non vengono mai salvati, gli header
`Authorization`, `Cookie`, `Set-Cookie` e simili, i parametri di query che sembrano credenziali e
i form inviati sono sostituiti da `[redacted]`. I trace Playwright non sono redatti e seguono
`ARTIFACT_RETENTION_DAYS`.

I backup di database e artifact store conservano le proprie copie per quanto stabilisce la
politica di backup dell'operatore. **La finestra di conservazione dei backup è responsabilità
dell'operatore**: una cancellazione o uno sweep di retention li raggiunge solo alla loro scadenza.

## Raccomandazioni per le organizzazioni

- Testate con **dati sintetici o mascherati** dove possibile, non con dati personali di
  produzione.
- Conservate solo le evidenze che servono: screenshot solo in caso di fallimento invece che
  sempre, video e trace solo dove aiutano la diagnosi.
- Salvate le credenziali di test come **segreti** degli ambienti, mai nei valori degli step.
- Lasciate spente le funzioni AI a meno che inviare il contenuto delle pagine a Google sia
  accettabile per le applicazioni testate.
