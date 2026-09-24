# Riferimento della configurazione

Tutte le variabili d'ambiente lette dal processo web, dai worker, dalla CLI e dall'agente
locale, con il loro default. Si mettono in un file `.env` accanto all'applicazione (sviluppo) o
nell'ambiente del processo (container, systemd). `.env.example` nel repository elenca quelle più
comuni con le stesse spiegazioni.

La colonna **Letta da** indica quale processo ha bisogno del valore: **web** è
`dist/index.js`, **worker** è `dist/worker.js`, **entrambi** significa dare lo stesso valore a
tutti e due. Nel dubbio, date al processo web e ai worker lo stesso ambiente: un valore che un
processo non legge non fa danni.

## Obbligatorie

| Variabile | Letta da | Default | Descrizione |
|---|---|---|---|
| `DATABASE_URL` | entrambi | `./data/local-pg` in `.env.example` | Una stringa di connessione `postgres://`, oppure il percorso di una cartella per un database PGlite incorporato (solo sviluppo). |
| `REDIS_URL` | entrambi | `redis://localhost:6379` | Redis o Valkey: code, sessioni, schedulazioni, la directory del relay degli agenti. |
| `SESSION_SECRET` | web | nessuno: il processo web non parte | Firma i cookie di sessione. Un valore lungo e casuale; vedi [Segreti](./installation#segreti). |
| `ENCRYPTION_KEY` | entrambi, e il migrator | nessuno: errore alla prima lettura o scrittura di un segreto | Cifra i segreti salvati con AES-256-GCM. 64 caratteri esadecimali (32 byte); qualsiasi altra stringa viene trasformata in chiave con SHA-256. **Non cambiatela mai** su un'installazione con segreti salvati. |
| `NODE_ENV` | entrambi | non impostata | `production` in ogni installazione reale: cookie sicuri, log JSON, endpoint diagnostici chiusi, nessuna eccezione TLS. |

## Server web e sicurezza

| Variabile | Letta da | Default | Descrizione |
|---|---|---|---|
| `PORT` | web | `5000` | La porta dell'API e del client web. Un valore non valido blocca l'avvio invece di ripiegare sul default. In sviluppo, indicatela al server del client con `VITE_API_PORT`. |
| `SESSION_COOKIE_SECURE` | web | `true` con `NODE_ENV=production` | `true` o `false`; ogni altro valore è ignorato. `false` invia il cookie di sessione su HTTP semplice: solo per uno stack locale senza TLS. |
| `CONTENT_SECURITY_POLICY` | web | `enforce` con `NODE_ENV=production`, altrimenti `off` | `enforce`, `report-only` (il browser segnala le violazioni nella console ma non blocca nulla) oppure `off`. Qualsiasi altro valore ferma l'avvio. `report-only` serve a verificare una modifica dietro un proxy che inietta script, prima di applicarla. |
| `API_RATE_LIMIT` | web | `600` | Richieste al minuto per ogni chiave API, e per ogni indirizzo che chiama `/api/v1` senza chiave. Oltre, la risposta è `429` con `Retry-After`. `0` lo disattiva. Contato per processo web. |
| `WEBHOOK_RATE_LIMIT` | web | `120` | Richieste al minuto per ogni indirizzo su `/api/webhooks`. `0` lo disattiva. |
| `INSTALLATION_ADMINS` | web | nessuno | Nomi utente, separati da virgola, che possono cambiare le impostazioni dell'installazione (livello e conservazione dei log, svuotamento dei runner). Se non impostata: gli owner, finché l'installazione ha una sola organizzazione. Vedi [Amministratori dell'installazione](./administration#amministratori-dell-installazione). |
| `CSRF_TRUSTED_ORIGINS` | web | nessuno | Origini separate da virgola accettate per le richieste che modificano dati, oltre all'`Host` della richiesta. Serve quando un proxy presenta un'origine pubblica diversa, per esempio `https://app.example.com`. |
| `REGISTRATION` | web | `invitation` | `invitation`: gli account si creano da un invito, tranne il primo dell'installazione. `open`: chiunque raggiunga il server può registrarsi e ottiene una propria organizzazione. Ogni altro valore blocca l'avvio. Vedi [Primo accesso](./installation#primo-accesso). |
| `MFA_ISSUER` | web | `WebFlowMaster` | Il nome che le app di autenticazione mostrano accanto ai codici. Impostatelo per installazione ("WebFlowMaster Staging") così chi ha più account li distingue. |
| `WEBFLOW_PUBLIC_URL` | entrambi | nessuno | L'indirizzo pubblico dell'installazione. Serve a collegare un run da notifiche e stati dei commit; senza, non contengono il link. |
| `WORKSPACE_NAME` | web | `WebFlowMaster` | Il nome mostrato nella barra laterale. Letta solo al primo avvio dell'installazione. |

## Esecuzione dei piani {#esecuzione-dei-piani}

| Variabile | Letta da | Default | Descrizione |
|---|---|---|---|
| `WORKER_CONCURRENCY` | worker | `1` | Piani eseguiti contemporaneamente da un processo worker. |
| `RUN_MAX_PARALLEL` | worker | `16` | Il massimo di sessioni browser che un run apre insieme, qualunque cosa chieda il piano. |
| `ORG_MAX_CONCURRENT_RUNS` | entrambi | `2` | Run di un'organizzazione in corso contemporaneamente. Gli altri aspettano. |
| `ORG_MAX_QUEUED_RUNS` | web | `100` | Run di un'organizzazione in attesa contemporaneamente. Oltre, un nuovo run viene rifiutato con `429`. |
| `RUN_DEFERRAL_MS` | worker | `10000` | Quanto aspetta un run trattenuto dal limite della sua organizzazione prima di essere riconsiderato. |
| `RUN_HEARTBEAT_INTERVAL_MS` | entrambi | `15000` | Ogni quanto un worker conferma che un run sta ancora andando. |
| `RUN_STALE_AFTER_MS` | web | il maggiore tra 8 heartbeat e `120000` | Un run il cui heartbeat tace per questo tempo termina come *error: worker lost*. |
| `RUN_MAX_DURATION_MS` | entrambi | `10800000` (3 ore) | Oltre questo tempo un run smette di avviare test e termina come *timed out*. Il processo web lo impone anche lui, cinque minuti dopo, nel caso il worker sia bloccato. |
| `SCHEDULER_BACKEND` | web | `cron` | `cron`: le schedulazioni girano nel processo web; va bene con un solo processo web. `bullmq`: le schedulazioni stanno in Redis, partono una volta sola comunque siano i processi web, e sopravvivono ai riavvii. Richiede un worker. |

## Task browser

Anteprime, esecuzione di un singolo test dall'editor, caricamento di pagine e rilevazione degli
elementi: i browser che una persona aspetta.

| Variabile | Letta da | Default | Descrizione |
|---|---|---|---|
| `BROWSER_TASKS` | web | `worker` | `worker` li invia ai worker, su una coda propria. `inline` li esegue nel processo web: un solo processo, adatto a un portatile. La registrazione gira sempre nel processo web, perché la sua finestra si apre su quella macchina. |
| `BROWSER_TASK_CONCURRENCY` | worker | `2` | Task browser eseguiti contemporaneamente da un worker. |
| `BROWSER_TASK_TIMEOUT_MS` | web | `300000` (5 minuti) | Quanto una richiesta aspetta il suo task prima di rispondere `504`. |
| `ELEMENT_DETECTION_LIMIT` | dove girano i task | `300` | Il massimo di elementi restituiti da una rilevazione. Il risultato indica quando è stato troncato. |

## Runner

| Variabile | Letta da | Default | Descrizione |
|---|---|---|---|
| `RUNNER_HEARTBEAT_INTERVAL_MS` | worker | `15000` | Ogni quanto un worker si fa sentire in **Impostazioni → Runner**. |
| `RUNNER_OFFLINE_AFTER_MS` | web | tre intervalli di heartbeat | Un runner non sentito per questo tempo risulta offline. |
| `APP_VERSION` | worker | nessuno | La versione che un runner dichiara, per distinguere le macchine durante un aggiornamento. |

## Sistema sotto test

| Variabile | Letta da | Default | Descrizione |
|---|---|---|---|
| `APP_BASE_URL` | entrambi | `http://localhost:7000` | Il valore di <code v-pre>{{baseUrl}}</code> in un run senza ambiente selezionato. Meglio un segreto `baseUrl` per ogni ambiente in Impostazioni, che è ciò che permette a un test di girare su più siti. |
| `DMO_BASE_URL` | entrambi | nessuno | Il vecchio nome di `APP_BASE_URL`, letto ancora se quella non è impostata. |
| `INSECURE_TLS_HOSTS` | entrambi | nessuno | Valori `host:porta` separati da virgola a cui è permesso presentare un certificato che Node rifiuterebbe (un server di sviluppo autofirmato). Per host, mai globale, e ignorato con `NODE_ENV=production`. |

## Artefatti

| Variabile | Letta da | Default | Descrizione |
|---|---|---|---|
| `ARTIFACT_STORE` | entrambi | `local` | `local`: il disco del processo che li ha scritti. `s3`: un bucket compatibile S3 condiviso da tutti i processi. Necessario appena worker e processo web non condividono un disco. |
| `VISUAL_BASELINE_DIR` | entrambi | `./data/visual-baselines` | Dove l'archivio locale tiene le baseline visive. Screenshot, video e trace vanno in `./results`. |
| `S3_BUCKET` | entrambi | nessuno (obbligatorio con `s3`) | Il bucket. |
| `S3_REGION` | entrambi | `us-east-1` | La regione del bucket. |
| `S3_ENDPOINT` | entrambi | nessuno | Per MinIO, Cloudflare R2 o un altro archivio compatibile S3. |
| `S3_FORCE_PATH_STYLE` | entrambi | `true` se `S3_ENDPOINT` è impostato | `true` indirizza il bucket per percorso invece che per sottodominio. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | entrambi | la catena predefinita di AWS | Credenziali esplicite. Se non impostate si usano ambiente, profilo o ruolo dell'istanza. |
| `S3_PREFIX` | entrambi | nessuno | Anteposto a ogni chiave, così un bucket può ospitare più installazioni. |
| `ARTIFACT_RETENTION_DAYS` | web | `90` | Giorni per cui un run terminato conserva screenshot, video e trace. Risultati e baseline restano. `0` conserva tutto. |

## Agenti locali

| Variabile | Letta da | Default | Descrizione |
|---|---|---|---|
| `AGENT_RELAY_SECRET` | entrambi | `SESSION_SECRET` | Firma i ticket di un minuto con cui un runner prende in prestito il browser di un agente. Deve essere uguale nei processi web e in ogni worker. |
| `AGENT_RELAY_URL` | worker | `http://127.0.0.1:<PORT>` | Dove i worker raggiungono il relay nel processo web. Impostatela ogni volta che i worker girano su altre macchine o container, per esempio `http://api:5000`. |
| `AGENT_RELAY_ADVERTISE_URL` | web | nessuno | Con più processi web: l'indirizzo con cui gli altri raggiungono questo. Gli agenti connessi a un'istanza diventano così utilizzabili da tutte. |

## Funzioni AI (facoltative)

| Variabile | Letta da | Default | Descrizione |
|---|---|---|---|
| `GEMINI_API_KEY` | entrambi | nessuno | Chiave Google Gemini. Senza, la descrizione dei test a frasi e la correzione AI dei selettori sono disattivate; tutto il resto funziona. |
| `GEMINI_MODEL` | web | `gemini-2.0-flash` | Il modello che trasforma le frasi in step. La correzione dei selettori usa il proprio. |

## Log

| Variabile | Letta da | Default | Descrizione |
|---|---|---|---|
| `LOG_LEVEL` | entrambi | `info` | `error`, `warn`, `info`, `http`, `verbose`, `debug` o `silly`. Solo il valore iniziale: dopo il primo avvio vince **Impostazioni → Sistema**. |
| `LOG_RETENTION_DAYS` | entrambi | `7` | Giorni di conservazione dei file di log. Stessa regola di `LOG_LEVEL`. |
| `CLIENT_LOG_LEVEL` | web | `info` | Livello iniziale dei log che il client web invia al server. |
| `LOKI_URL` | entrambi | nessuno | Un indirizzo Grafana Loki; i log vi vengono inviati anche lì, a lotti ogni cinque secondi. |

## CLI (`wfm`)

Si impostano nella pipeline, non sul server. Vedi [Integrazione CI](../CI_INTEGRATION).

| Variabile | Descrizione |
|---|---|
| `WFM_URL` | L'indirizzo dell'installazione. |
| `WFM_API_KEY` | Una chiave API, `wfm_…`, con gli scope che servono al comando. |
| `WFM_IDEMPOTENCY_KEY` | Avvia al massimo un run per questa chiave; uno step di pipeline ripetuto non avvia un secondo run. |

## Agente locale (`wfm-agent`)

Si impostano sulla macchina dell'agente. Vedi [Agenti locali](../LOCAL_AGENT).

| Variabile | Default | Descrizione |
|---|---|---|
| `WFM_URL` | nessuno | L'indirizzo dell'installazione. |
| `WFM_AGENT_TOKEN` | nessuno | Il token dell'agente, `wfa_…`, mostrato una volta quando un owner crea l'agente. |
| `WFM_AGENT_MAX_SESSIONS` | `2` | Browser che l'agente presta contemporaneamente (da 1 a 16). |

## Solo sviluppo

| Variabile | Descrizione |
|---|---|
| `VITE_API_PORT` | Dove il server di sviluppo del client inoltra le chiamate API, quando `PORT` non è 5000. |
