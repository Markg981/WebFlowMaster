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

| Dati | Esempi | Dove si conservano | Per quanto |
|---|---|---|---|
| Account | Username (può essere un indirizzo e-mail), ruolo, data di creazione | Database | Finché il membro non viene rimosso o l'organizzazione cancellata |
| Identità del single sign-on | L'issuer del provider e il suo identificativo della persona (non l'indirizzo e-mail), primo e ultimo accesso | Database | Finché l'account non viene rimosso |
| Credenziali | Hash della password (scrypt), segreto del secondo fattore (cifrato), codici di recupero (hash) | Database | Come gli account |
| Sessioni | Id di sessione, id utente | Redis | 7 giorni, o fino all'uscita |
| Registro di audit | Nome di chi ha agito, azione, oggetto, indirizzo IP del client, chiave usata, ora | Database | Fino alla cancellazione dell'organizzazione; l'applicazione non può cancellarlo |
| Log dell'applicazione | Id utente, percorsi delle richieste, correlation id, errori | File di log, standard output, Loki se configurato | 7 giorni di default (configurabile) |
| Test e piani | Step, indirizzi, descrizioni degli elementi, schedulazioni, indirizzi di notifica, commenti alle revisioni | Database | Finché non vengono cancellati, o l'organizzazione cancellata |
| Segreti salvati | Password degli account di test, token | Database, cifrati | Finché non vengono cancellati |
| Risultati dei run | Verdetti, esiti degli step, messaggi di errore, chi ha avviato il run, contesto CI (repository, commit, branch, build) | Database | Fino alla cancellazione dell'organizzazione |
| Evidenze dei run | Screenshot, video, trace di Playwright, catture di rete senza corpi né credenziali | Archivio degli artefatti (disco o S3) | `ARTIFACT_RETENTION_DAYS`, 90 giorni di default |
| Baseline visive | Screenshot di riferimento | Archivio degli artefatti | Finché non vengono sostituite o rimosse |
| Link di reset della password | Di chi è, chi l'ha emesso, un hash del token | Database | Un giorno, o fino all'uso; esclusi dalle esportazioni |
| Inviti | Username invitato, ruolo, chi ha invitato | Database | Fino alla revoca; il token scade dopo 7 giorni |
| Fogli di calcolo caricati | Casi di test importati | Disco locale durante la lettura | Cancellati appena letti |

I backup fatti dall'operatore contengono copie del database e dell'archivio degli artefatti per
tutto il tempo in cui l'operatore li conserva.

## Chi vede cosa

- Tutto ciò che un'organizzazione contiene è visibile solo ai suoi membri, secondo i loro ruoli
  e, per i progetti riservati, secondo l'appartenenza al progetto. Lo impone il database.
- Il registro di audit è visibile solo agli owner dell'organizzazione.
- Chi gestisce l'installazione ha accesso tecnico al database, ai log e all'archivio degli
  artefatti, come qualsiasi fornitore di hosting. I segreti salvati sono cifrati con una chiave
  che anche l'operatore possiede.

## Terze parti

Il prodotto invia dati a terze parti solo dove un'organizzazione o l'operatore lo configura:

| Destinatario | Quando | Cosa |
|---|---|---|
| Google (API Gemini) | Solo se l'operatore imposta `GEMINI_API_KEY` | Le frasi che descrivono i test; su uno step che fallisce, l'errore e fino a 30.000 caratteri dell'HTML della pagina. Vedi [Funzioni AI](./#funzioni-ai). |
| Fornitore di storage compatibile S3 | Se l'operatore sceglie `ARTIFACT_STORE=s3` | Evidenze dei run e baseline. |
| Grafana Loki | Se l'operatore imposta `LOKI_URL` | Log dell'applicazione. |
| Jira, Azure DevOps | Se un'organizzazione collega un issue tracker | I dettagli del fallimento dei run che aprono una issue. |
| GitHub, GitLab | Se un'organizzazione li collega | Stato del run, verdetto e link, sul commit testato. |
| Slack o Microsoft Teams | Se le notifiche di un piano indicano un webhook | Riepiloghi dei run. (Sul piano si possono salvare indirizzi e-mail, ma nessuna e-mail viene inviata.) |

Le applicazioni sotto test ricevono ciò che i test inviano loro: è lo scopo di un test.

Dove risiedono fisicamente i dati dipende da dove l'operatore esegue l'installazione, il
database, lo storage e i log.

## Diritti degli interessati

| Richiesta | Come |
|---|---|
| Accesso, portabilità | Un owner esporta l'intera organizzazione in JSON (`GET /api/organization/export`); vedi [Esportazione e cancellazione](../admin/administration#esportazione-e-cancellazione). Le voci di una persona si trovano nell'esportazione e nel registro di audit tramite lo username. |
| Cancellazione di una persona | Un owner rimuove il membro da **Impostazioni → Membri**. Vengono cancellati l'account, le sue chiavi API, il secondo fattore e le preferenze; ciò che la persona ha creato per l'organizzazione (test, piani, ambienti…) passa a un altro membro. Il registro di audit conserva il nome con cui la persona ha agito, come traccia di ciò che è successo. Vedi [Membri e inviti](../admin/administration#membri-e-inviti). |
| Cancellazione di un'organizzazione | Un owner la cancella: tutte le righe, compresi tutti gli account dei membri e il registro di audit, in una sola transazione. |
| Rettifica | Gli username non si possono cambiare; una persona con lo username sbagliato viene invitata di nuovo con quello giusto. |
| Limitazione | Un owner può portare un membro a viewer, o riservare dei progetti. |

## Cosa raggiunge la cancellazione {#cosa-raggiunge-la-cancellazione}

Cancellare un'organizzazione rimuove in una volta tutte le sue righe dal database. **Non**:

- rimuove i suoi file dall'archivio degli artefatti (screenshot, video e trace sotto
  `results/<planId>/`, baseline sotto `visual-baselines/org_<id>/`), che la conservazione non
  trova più una volta spariti i run;
- rimuove le righe di log già scritte (scadono con la conservazione dei log);
- rimuove le copie nei backup dell'operatore, o nei sistemi a cui era collegata (issue tracker,
  stati dei commit, messaggi Slack o Teams).

L'operatore completa la cancellazione rimuovendo i file; gli id dei piani sono nell'esportazione
fatta prima di cancellare.

## Conservazione in sintesi

| Cosa | Default | Impostazione |
|---|---|---|
| Evidenze dei run | 90 giorni | `ARTIFACT_RETENTION_DAYS` |
| Log dell'applicazione | 7 giorni | **Impostazioni → Sistema**, primo valore da `LOG_RETENTION_DAYS` |
| Sessioni | 7 giorni | Fisso |
| Token degli inviti | 7 giorni | Fisso |
| Runner che non si fanno più sentire | 7 giorni | Fisso |
| Risultati, test, registro di audit | Conservati | Rimossi con l'organizzazione |

## Raccomandazioni per le organizzazioni

- Testate con **dati sintetici o mascherati** dove possibile, non con dati personali di
  produzione.
- Conservate solo le evidenze che servono: screenshot solo in caso di fallimento invece che
  sempre, video e trace solo dove aiutano la diagnosi.
- Salvate le credenziali di test come **segreti** degli ambienti, mai nei valori degli step.
- Lasciate spente le funzioni AI a meno che inviare il contenuto delle pagine a Google sia
  accettabile per le applicazioni testate.
