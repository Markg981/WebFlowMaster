# Operatività

Gestire un'installazione una volta avviata: aggiornarla senza interrompere i run a metà, farne
il backup per poterla ripristinare, leggerne i log, e dove guardare quando qualcosa non va.

## Aggiornamento

Una release può cambiare lo schema del database, quindi l'ordine conta.

1. **Svuotate i runner.** In **Impostazioni → Runner** svuotate ogni runner. Un runner in
   svuotamento finisce ciò che ha e non prende altro; aspettate che i job in corso arrivino a
   zero. I run richiesti nel frattempo restano in coda e partono dopo l'aggiornamento.
2. **Fermate i processi web e i worker.**
3. **Fate il backup del database** (vedi [Backup](#backup)).
4. **Applicate le migrazioni** con la nuova versione: `node dist/apply-migrations.js`, oppure il
   servizio `migrate` in Compose (`docker compose up migrate`). `npm run db:doctor` riporta lo
   stato dello schema ed esce con codice diverso da zero quando c'è qualcosa da fare, quindi può
   fare da controllo in un deployment.
5. **Avviate i processi web, poi i worker.** I nuovi worker si registrano come nuovi runner; le
   voci vecchie risultano offline e spariscono dopo una settimana.

Con Compose, `docker compose up -d --build` esegue i passi 2, 4 e 5 in ordine, perché `api` e
`worker` aspettano che `migrate` finisca.

**Agenti locali.** Il Playwright di un agente deve avere la stessa versione major e minor di
quello dei runner. Quando una release cambia la versione di Playwright, aggiornate anche gli
agenti (una nuova immagine, o un nuovo `wfm-agent.mjs` da `/cli/wfm-agent.mjs`). Un agente con
una versione diversa resta connesso ma non viene scelto per i run, e
**Impostazioni → Agenti locali** mostra il motivo.

## Backup {#backup}

| Cosa | Dove | Come |
|---|---|---|
| **Database** | PostgreSQL | `pg_dump`, o gli snapshot del servizio gestito. Tutto ciò che il prodotto sa è qui. |
| **`ENCRYPTION_KEY`** | Il vostro secret manager | Conservata separatamente dal backup del database. Senza di essa i segreti cifrati di un database ripristinato sono illeggibili. |
| **Artefatti** | `results/` e `data/visual-baselines/`, oppure il bucket S3 | Backup dei file o del bucket. Contano le baseline visive: perderle significa approvarne di nuove. Screenshot, video e trace vengono comunque rimossi dalla conservazione. |
| **Redis** | Redis | Facoltativo. Contiene code, sessioni e le schedulazioni BullMQ, che vengono ricostruite dal database all'avvio del processo web. |

Se Redis perde i dati, tutti vengono disconnessi, e i run che aspettavano in coda restano
*in coda* senza partire: annullateli e avviateli di nuovo.

### Ripristino

1. Ripristinate il database in un server PostgreSQL vuoto con gli stessi ruoli. Dopo il
   ripristino verificate che il ruolo di connessione sia ancora membro di `app_user` e abbia
   `BYPASSRLS`: i dump non portano con sé gli attributi dei ruoli, e senza di essi il processo
   web non parte (vedi [Preparare PostgreSQL](./installation#preparare-postgresql)).
2. Avviate i processi con la stessa `ENCRYPTION_KEY`.
3. Ripristinate gli artefatti negli stessi percorsi o chiavi del bucket; i report vi fanno
   riferimento per percorso.

## Conservazione degli artefatti

Screenshot, video e trace dei run terminati da più di `ARTIFACT_RETENTION_DAYS` giorni (90 di
default) vengono rimossi dal processo web. I run, i loro risultati, step e verdetti restano, e
il report indica quando le immagini sono state rimosse. Le baseline visive non vengono mai
rimosse. `0` conserva tutto.

## Log

Entrambi i processi scrivono log JSON strutturati:

- sullo standard output (testo leggibile in sviluppo, JSON in produzione), perché la piattaforma
  dei container li raccolga;
- in `logs/app-AAAA-MM-GG.log` accanto all'applicazione, ruotati ogni giorno, compressi, e
  rimossi dopo il periodo di conservazione dei log (7 giorni di default);
- su Grafana Loki, quando `LOKI_URL` è impostata. `docker-compose.observability.yml` avvia Loki
  e un Grafana con Loki già configurato come sorgente dati.

Ogni riga di una richiesta porta un correlation id, che anche il client web invia e mostra nei
messaggi di errore. Chi segnala "non ha funzionato" può darvi l'id, e con quello si trovano
tutte le righe di quella richiesta. Password, token e valori segreti vengono mascherati prima
che la riga sia scritta.

**Livello e conservazione dei log** sono impostazioni dell'intera installazione, in
**Impostazioni → Sistema**, salvate nel database. `LOG_LEVEL` e `LOG_RETENTION_DAYS` forniscono
solo il valore del primo avvio; dopo vince l'impostazione salvata. Un nuovo livello si applica
subito al processo web che lo ha salvato; gli altri processi lo leggono al riavvio, e lo stesso
vale per un nuovo periodo di conservazione.

## Monitoraggio

| Cosa | Segnale |
|---|---|
| Processo web attivo | `GET /api/user` risponde `401` a una richiesta anonima. `5xx` o nessuna risposta significa che è giù. |
| Worker | **Impostazioni → Runner**: online, in svuotamento o offline, con i job in corso e la versione. Un runner non sentito da `RUNNER_OFFLINE_AFTER_MS` è offline. |
| Pressione sulla coda | **Impostazioni → Utilizzo dei run**: run in corso e in attesa dell'organizzazione rispetto ai suoi limiti, e quanti runner sono online. |
| Run persi | Run che terminano in *errore* con motivo `worker_lost`: un worker è morto o è stato riavviato durante il run. |
| Timeout | Run che terminano *scaduti*: oltre `RUN_MAX_DURATION_MS`. |
| Integrazioni | Gli errori di invio sono mostrati su ogni collegamento GitHub/GitLab e issue tracker in Impostazioni. |

## Capacità e limiti {#capacita-e-limiti}

Tre numeri decidono quanto gira contemporaneamente; ciascuno è descritto nel
[riferimento della configurazione](./configuration#esecuzione-dei-piani).

- **Per worker:** `WORKER_CONCURRENCY` piani alla volta, e `BROWSER_TASK_CONCURRENCY` anteprime e
  caricamenti di pagina alla volta, su una coda separata.
- **Per run:** il parallelismo del piano, limitato da `RUN_MAX_PARALLEL` sessioni browser.
- **Per organizzazione:** `ORG_MAX_CONCURRENT_RUNS` in corso e `ORG_MAX_QUEUED_RUNS` in attesa.
  Oltre il secondo, un nuovo run viene rifiutato con `429`. Tra i run in attesa passa prima
  l'organizzazione che ne ha meno in corso.

I limiti di una singola organizzazione si impostano sulla sua riga nel database. L'applicazione
non ha il permesso di modificare queste colonne, quindi un'organizzazione non può alzarsi i
limiti da sola:

```sql
-- come proprietario del database; NULL torna al default dell'installazione
UPDATE organizations SET max_concurrent_runs = 5, max_queued_runs = 300 WHERE id = 42;
```

## Risoluzione dei problemi

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| Il server esce all'avvio citando `app_user`, `BYPASSRLS` o `SET ROLE` | I ruoli del database non sono come li richiede la tenancy | Eseguite il comando indicato nel messaggio (vedi [Preparare PostgreSQL](./installation#preparare-postgresql)). |
| Il server esce dicendo che il database è stato creato con `db:push` | Tabelle presenti senza il journal delle migrazioni | `npm run db:doctor`; ricreate il database con `db:migrate`. |
| `SESSION_SECRET must be set` o `ENCRYPTION_KEY is missing` | Un segreto non è impostato in quel processo | Impostatelo (vedi [Segreti](./installation#segreti)); anche i worker hanno bisogno di `ENCRYPTION_KEY`. |
| I segreti salvati non si decifrano dopo uno spostamento o un ripristino | Una `ENCRYPTION_KEY` diversa | Usate la chiave con cui sono stati salvati; non c'è altro modo di leggerli. |
| `Session Redis is not connected. Refusing to start in production` | Redis non raggiungibile all'avvio | Controllate `REDIS_URL` e che Redis accetti connessioni da questa macchina. |
| La registrazione risponde "Accounts on this installation are created by invitation" | `REGISTRATION=invitation` (il default) e un account esiste già | Invitate la persona da **Impostazioni → Membri**, oppure impostate `REGISTRATION=open` se la registrazione deve essere pubblica. |
| L'accesso risponde OK ma la pagina successiva risulta disconnessa | Cookie Secure su HTTP semplice | Servite su HTTPS; solo per uno stack locale, `SESSION_COOKIE_SECURE=false`. |
| `403` su ogni salvataggio dietro un proxy | L'origine pubblica è diversa dall'`Host` che vede il server | Aggiungetela a `CSRF_TRUSTED_ORIGINS`. |
| I run restano *in coda* | Nessun runner online, l'organizzazione al limite, o runner svuotati | Impostazioni → Runner e Impostazioni → Utilizzo dei run. |
| I run terminano *errore: worker lost* | Worker riavviati o terminati (spesso per memoria esaurita) | Log e memoria dei worker; abbassate `WORKER_CONCURRENCY` o il parallelismo del piano. |
| Anteprime e caricamenti di pagina falliscono con "No worker is running to open a browser" | `BROWSER_TASKS=worker` e nessun worker attivo | Avviate un worker, o `BROWSER_TASKS=inline` su una sola macchina. |
| Anteprime e caricamenti di pagina rispondono `504` | Il task ha superato `BROWSER_TASK_TIMEOUT_MS`, di solito perché i worker sono occupati | Più worker o un `BROWSER_TASK_CONCURRENCY` più alto. |
| Screenshot mancanti nei report | Worker e processo web su dischi diversi con l'archivio locale | `ARTIFACT_STORE=s3`. |
| Ogni schedulazione parte due volte | Più processi web con `SCHEDULER_BACKEND=cron` | `SCHEDULER_BACKEND=bullmq` su tutti. |
| I run su un agente locale falliscono con "relay could not be reached" | I worker non sanno dove sia il relay | `AGENT_RELAY_URL` sui worker; lo stesso `AGENT_RELAY_SECRET` ovunque. |
| Le funzioni AI non compaiono | Nessuna chiave AI | Impostate `GEMINI_API_KEY`; tutto il resto funziona anche senza. |
