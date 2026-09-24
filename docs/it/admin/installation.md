# Installazione

Questa pagina porta un'installazione da zero al primo owner che accede: cosa avviare, di cosa
ha bisogno e quali impostazioni devono essere corrette prima che chiunque altro possa
raggiungerla. Ogni variabile citata è descritta nel
[riferimento della configurazione](./configuration).

## Cosa si installa

WebFlowMaster è composto da due programmi costruiti dallo stesso codice e da due archivi che
condividono.

| Parte | Comando | Cosa fa |
|---|---|---|
| Processo web | `node dist/index.js` | L'API, il client web, le schedulazioni, il relay degli agenti locali, i log in tempo reale, la registrazione. |
| Worker | `node dist/worker.js` | Esegue i piani di test e i task browser che una persona aspetta (anteprime, caricamento pagine, rilevazione degli elementi). |
| PostgreSQL 15+ | | Tutto ciò che il prodotto sa. La row-level security isola le organizzazioni. |
| Redis 6.2+ o Valkey | | Le code dei run, le sessioni e le schedulazioni. |
| Archivio degli artefatti (facoltativo) | | Screenshot, video, trace e baseline visive, sul disco locale o in un bucket S3. |

Il processo web non avvia mai un browser per un run di un piano: lo fanno i worker, e possono
essere quanti ne servono al carico. Come le parti comunicano è descritto nella
[panoramica dell'architettura](../internals/).

## Scegliere la configurazione

| Configurazione | Adatta a | Database | Artefatti | Worker |
|---|---|---|---|---|
| **Una macchina, dai sorgenti** | Sviluppo, valutazione | PGlite (una cartella) | Disco locale | Uno, o nessuno con `BROWSER_TASKS=inline` |
| **Docker Compose** | Un server di team, un progetto pilota | Container PostgreSQL | Disco locale o S3 | Si scalano con `--scale worker=N` |
| **Produzione** | Più team, continuità di servizio | PostgreSQL gestito | Bucket compatibile S3 | Più d'uno, su macchine dedicate |

PGlite è Postgres compilato in WebAssembly e salvato in una cartella: comodo su un portatile,
non pensato per la produzione. La row-level security funziona come progettata solo su un vero
server PostgreSQL (vedi [Tenancy](../internals/tenancy)).

## Requisiti

- **Node.js 20 o successivo** e npm 10, per le installazioni dai sorgenti.
- **Docker** con Compose v2, per le configurazioni a container. Le immagini partono da
  `mcr.microsoft.com/playwright:v1.61.1-jammy`, che contiene già i browser.
- **PostgreSQL 15 o successivo** per tutto ciò che va oltre la valutazione.
- **Redis 6.2 o successivo, oppure Valkey**, raggiungibile dal processo web e da ogni worker.
- Accesso di rete in uscita dai worker verso le applicazioni da testare, oppure un
  [agente locale](../LOCAL_AGENT) dentro la rete in cui si trovano.
- Memoria, come ordine di grandezza: circa 1 GB per il processo web, e 1–2 GB su un worker per
  ogni browser che esegue contemporaneamente (`WORKER_CONCURRENCY` × il parallelismo del piano).
  Misuratelo con le vostre suite.

## Opzione 1: Docker Compose

Il repository include un `docker-compose.yml` che è stato costruito e avviato da capo a fondo.
Avvia Valkey, PostgreSQL, un servizio `migrate` che applica le migrazioni del database e poi
termina, il processo web (`api`) e un worker.

```bash
git clone https://github.com/Markg981/WebFlowMaster.git
cd WebFlowMaster
docker compose up -d --build
```

Aprite `http://localhost:5000` e registratevi: il primo account crea la prima organizzazione e
ne è owner (vedi [Primo accesso](#primo-accesso)).

Più worker, per più run contemporanei:

```bash
docker compose up -d --scale worker=3
```

::: warning Il file Compose è un punto di partenza, non un deployment
Parte senza configurazione, quindi contiene valori che nessuno dovrebbe usare in esercizio.
Prima che lo stack sia raggiungibile da altri:

1. Sostituite `SESSION_SECRET` e `ENCRYPTION_KEY` in tutti i servizi con valori nuovi (vedi
   [Segreti](#segreti)). `ENCRYPTION_KEY` deve essere la stessa in `api`, `worker` e `migrate`.
2. Cambiate la password di PostgreSQL e non pubblicate più le porte `5432` e `6379` sull'host.
3. Mettete TLS davanti alla porta 5000 e togliete `SESSION_COOKIE_SECURE=false`.
4. Con più di un worker, o con worker su altre macchine, usate `ARTIFACT_STORE=s3`: ogni
   container ha il proprio disco, e il processo web non può servire uno screenshot che un worker
   ha scritto sul suo.
:::

## Opzione 2: dai sorgenti

```bash
git clone https://github.com/Markg981/WebFlowMaster.git
cd WebFlowMaster
npm install                     # il client è un workspace npm e viene installato anch'esso
npx playwright install --with-deps chromium firefox webkit
cp .env.example .env            # poi modificatelo: vedi sotto
npm run db:migrate
```

Per lo sviluppo, avviate il processo web e un worker in due terminali (`npm run dev`,
`npm run dev:worker`) e il server di sviluppo del client in un terzo (`npm run dev:client`); i
dettagli sono nella [guida sviluppatore](../internals/developer-guide).

Per una build di produzione su una macchina o una VM:

```bash
npm run build                   # client, server, worker, migrator, CLI e agente in dist/
node dist/apply-migrations.js   # applica le migrazioni con il migrator compilato
NODE_ENV=production node dist/index.js
NODE_ENV=production node dist/worker.js   # su ogni macchina worker
```

Fate girare ogni processo sotto un supervisore (systemd, un orchestratore di container) che lo
riavvii se termina. Entrambi i processi si fermano in modo pulito su `SIGTERM`.

::: danger Non inizializzate mai un database con `db:push`
`npm run db:push` crea le tabelle a partire dallo schema senza le policy di row-level security,
i ruoli e i permessi che aggiungono le migrazioni, e senza registrare nulla nel journal delle
migrazioni. Le organizzazioni non sarebbero isolate, e `db:migrate` non potrebbe più girare.
Usate sempre `db:migrate` (o `dist/apply-migrations.js`). Il server si rifiuta di partire su un
database in quello stato e spiega come uscirne.
:::

## Preparare PostgreSQL {#preparare-postgresql}

Le migrazioni creano tutto, compreso il ruolo `app_user` a cui si applica la row-level
security. Non possono però dare al ruolo di connessione i diritti che solo un superuser può
concedere. All'avvio il processo web verifica tre condizioni e, se una è falsa, si rifiuta di
partire indicando il comando da eseguire:

| Condizione | Perché | Correzione |
|---|---|---|
| Il ruolo `app_user` esiste | Ogni query di un'organizzazione gira con quel ruolo | Eseguire le migrazioni |
| Il ruolo di connessione è membro di `app_user` | Vi passa con `SET LOCAL ROLE` | `GRANT app_user TO <ruolo>;` |
| Il ruolo di connessione è superuser o ha `BYPASSRLS`, e `app_user` no | Le poche query a livello di installazione devono vedere tutte le righe; quelle dei tenant no | `ALTER ROLE <ruolo> BYPASSRLS;` (da superuser) |

Alcuni servizi PostgreSQL gestiti non permettono ai clienti di concedere `BYPASSRLS`: verificate
che il vostro lo consenta prima di sceglierlo. Una configurazione tipica:

```sql
-- come amministratore del server PostgreSQL
CREATE ROLE webflowmaster LOGIN PASSWORD '…' BYPASSRLS;
CREATE DATABASE webflowmaster OWNER webflowmaster;
```

Poi eseguite le migrazioni come `webflowmaster`: la migrazione `0005` gli concede
l'appartenenza a `app_user`. Se in seguito l'applicazione si connette con un ruolo diverso,
concedetela a mano.

`DATABASE_URL` contiene la stringa di connessione:
`postgres://webflowmaster:…@db.internal:5432/webflowmaster`.

## Segreti {#segreti}

Tre valori proteggono l'installazione. Generateli separatamente:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variabile | Protegge | Se cambia | Se trapela |
|---|---|---|---|
| `SESSION_SECRET` | I cookie di sessione (e i ticket degli agenti, se `AGENT_RELAY_SECRET` non è impostata) | Tutti vengono disconnessi | Le sessioni si possono falsificare: sostituitelo |
| `ENCRYPTION_KEY` | Segreti degli ambienti, token di tracker e source host, stati di login salvati, segreti del secondo fattore | **Tutto ciò che è cifrato con essa diventa illeggibile** | Quei segreti sono esposti: ruotateli alla fonte |
| `AGENT_RELAY_SECRET` | I ticket con cui un runner prende in prestito il browser di un agente locale | I run sugli agenti falliscono finché ogni processo non ha il nuovo valore | Chi raggiunge il relay potrebbe usare i browser degli agenti |

`ENCRYPTION_KEY` non ha una procedura di rotazione: conservatela in un secret manager, date lo
stesso valore al processo web, a ogni worker e al migrator, e fatene un backup separato dal
database. Un backup del database senza la chiave non restituisce quei segreti.

## Dietro un reverse proxy

Terminate TLS davanti al processo web e inoltrate alla sua porta (5000, se `PORT` non dice
altrimenti).

- **WebSocket.** Inoltrate le intestazioni `Upgrade` e `Connection`. Ne dipendono due funzioni:
  i log in tempo reale su `/ws` e il relay degli agenti locali su `/api/agent/v1/`. Consentite
  connessioni di lunga durata (un timeout di inattività di almeno qualche minuto) su quei percorsi.
- **Intestazioni inoltrate.** Il server si fida di un solo proxy (`X-Forwarded-For`,
  `X-Forwarded-Proto`), ed è da lì che prendono l'indirizzo IP l'audit e i limiti di frequenza.
  Mettete esattamente un proxy davanti, altrimenti gli indirizzi registrati sono quelli del proxy.
- **Origine.** Le richieste che modificano dati devono venire dalla stessa origine della pagina.
  Se l'indirizzo pubblico è diverso dall'`Host` che vede il server, elencatelo in
  `CSRF_TRUSTED_ORIGINS`.
- **Cookie.** Con `NODE_ENV=production` il cookie di sessione è `Secure` e viaggia solo su HTTPS.
  Non impostate `SESSION_COOKIE_SECURE=false` su un'installazione raggiungibile.
- **Dimensione delle richieste.** Anche i file caricati (file di input di un test, import)
  passano dal proxy: alzatene il limite (nginx ha 1 MB di default) al file più grande che verrà
  caricato.
- Impostate `WEBFLOW_PUBLIC_URL` all'indirizzo pubblico, così notifiche e stati dei commit
  rimandano al run.

Un sito nginx minimo:

```nginx
server {
  listen 443 ssl;
  server_name webflowmaster.example.com;
  client_max_body_size 20m;

  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 1h;
  }
}
```

(`$connection_upgrade` è la consueta `map $http_upgrade $connection_upgrade { default upgrade; '' close; }`
nel blocco `http`.)

## Più processi web

Un processo web basta alla maggior parte delle installazioni. Per averne più d'uno dietro un
load balancer:

- Impostate `SCHEDULER_BACKEND=bullmq` su tutti. Con il default `cron` ogni processo web esegue
  ogni schedulazione per conto suo, e una schedulazione parte una volta per processo.
- Date a tutti gli stessi `SESSION_SECRET`, `ENCRYPTION_KEY` e Redis: le sessioni stanno in
  Redis, quindi non serve il routing sticky.
- Se le organizzazioni usano agenti locali, impostate su ciascuno `AGENT_RELAY_ADVERTISE_URL` con
  un indirizzo a cui gli altri lo raggiungono (vedi
  [Agenti locali, interni](../internals/agents)).
- Usate `ARTIFACT_STORE=s3`.

## Worker su altre macchine

Un worker ha bisogno degli stessi `DATABASE_URL`, `REDIS_URL` e `ENCRYPTION_KEY` del processo
web, e inoltre di:

- `ARTIFACT_STORE=s3` e delle impostazioni del bucket, così ciò che registra può essere servito
  e confrontato.
- `AGENT_RELAY_URL`: dove raggiungere il relay del processo web, se le organizzazioni usano
  agenti locali. Il default è la macchina del worker stesso, che funziona solo se i due girano
  sulla stessa.
- `AGENT_RELAY_SECRET` (o lo stesso `SESSION_SECRET`), per lo stesso motivo.
- `WEBFLOW_PUBLIC_URL`, perché è il worker a inviare notifiche e stati dei commit alla fine di
  un run.
- I browser: l'immagine Playwright li contiene; altrove eseguite
  `npx playwright install --with-deps`.

Ogni worker compare in **Impostazioni → Runner** appena parte.

## Primo accesso {#primo-accesso}

Aprite l'indirizzo web e scegliete **Registrati**. Un account registrato senza invito crea una
nuova organizzazione e ne diventa owner. Tutti gli altri entrano in quell'organizzazione con un
invito (vedi [Membri e inviti](./administration#membri-e-inviti)).

::: warning La registrazione è aperta
Chiunque raggiunga il server può registrarsi e ottenere una propria organizzazione, isolata
dalle altre. Non esiste ancora un'impostazione per disattivarla. Se l'installazione è per una
sola azienda, rendetela raggiungibile solo dalla rete o dalla VPN di quell'azienda.
:::

## Verificare l'installazione

| Verifica | Come |
|---|---|
| Il processo web è attivo | `GET /api/user` risponde `401` senza accesso (lo usa l'healthcheck del container). |
| I worker sono attivi | **Impostazioni → Runner** li mostra *online*. |
| Un run funziona da capo a fondo | Create un test su una pagina pubblica, aggiungetelo a un piano, eseguitelo. |
| Le evidenze vengono servite | Il report del run mostra i suoi screenshot. |
| I link funzionano | Una notifica o uno stato del commit rimanda al run all'indirizzo pubblico. |

Prossimo passo: [Operatività](./operations) tratta aggiornamenti, backup, log e risoluzione dei
problemi.
