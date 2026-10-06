# Ambiente di collaudo

## Pagina di collaudo locale

Catalogo corrente: protocollo **30**, **539 casi** in **24 aree**. LIB-35…LIB-41 coprono
paginazione, filtri lato server, isolamento e dettaglio su richiesta nei gestori UI/API/mobile
e dati condivisi; preparazione in [catalog-pagination-2026-10-06.md](./catalog-pagination-2026-10-06.md).
I nuovi casi sono **Da eseguire** in un nuovo ciclo; i cicli storici restano congelati.

Dalla radice del repository:

```bash
npm run dev:collaudo
```

Aprire **http://localhost:4322**. La pagina riprende stile, filtri, indice, schede,
avanzamento ed esiti dell'artifact originale. Funziona senza Claude e senza avviare
Docker o il database del prodotto. `npm run dev:docs` resta dedicato alla documentazione.
Per una porta diversa impostare `COLLAUDO_PORT` prima del comando.

- **Casi:** `collaudo/casi.json`, versionato in Git. Contiene i 358 casi originali
  e i 46 nuovi casi delle funzionalità 6–13, più OPS-17…OPS-19 per storico e backup locali:
  più 32 casi di versioni e approvazioni API/mobile (API-29…API-36, MOB-25…MOB-32,
  LIB-27…LIB-34, SEC-37…SEC-44), più AGT-06…AGT-10 per gRPC/WebSocket sugli agenti:
  Il catalogo attuale contiene 517 casi, 24 aree, protocollo versione 25.
  MOB-33…MOB-40 coprono flussi nativi, gruppi, matrici dispositivi e catalogo mobile.
  La procedura e i limiti delle evidenze sono in `docs/mobile-flow-matrix-acceptance.md`.
  QUO-01…QUO-14 coprono quote per organizzazione, inventario artifact e minuti di esecuzione;
  TEL-01…TEL-12 coprono metriche Prometheus, tracing OpenTelemetry e operatività delle repliche.
  Prerequisiti, copertura e verifiche sono in `collaudo/allineamento-2026-10-05.md`.
  I nuovi casi sono da eseguire in un nuovo ciclo; i cicli storici restano congelati.
  Gli ID esistenti non si rinominano. Dopo una modifica riavviare il comando e ricaricare la pagina.
- **Catalogo attuale:** nel selettore Ciclo, questa voce mostra il protocollo aggiornato anche
  quando esistono cicli storici. È una consultazione senza scritture: note, esiti e CSV sono
  disabilitati finché non si sceglie o crea un ciclo. Un avviso indica quando il ciclo selezionato
  conserva un catalogo diverso da quello attuale. **Nuovo ciclo** usa sempre il catalogo corrente;
  indicare commit e ambiente effettivamente installati, dopo averli verificati.
- **Cicli, esiti e note:** `collaudo/.local/state.json`, escluso da Git.
  Le note si salvano automaticamente; il nome del collaudatore si imposta in fondo alla pagina.
  Nuovo ciclo parte sempre da esiti da eseguire e congela il catalogo corrente, comprese
  istruzioni, aree e presentazione. Pagina e CSV dei cicli storici usano questa copia.
  `catalogHash` identifica la copia con SHA-256; `caseHash` collega ogni esito alla sua definizione.
  Modificare il catalogo e creare un nuovo ciclo per collaudare le definizioni aggiornate.
  Alla prima apertura dopo questo aggiornamento, i cicli esistenti congelano il catalogo
  presente nello storico locale, prima di applicare quello del repository. Le definizioni
  precedentemente sovrascritte non possono essere ricostruite.
- **Backup:** Esporta backup JSON conserva catalogo e storico. Importa backup JSON
  aggiunge i dati e rifiuta conflitti, senza sostituire esiti diversi già presenti.
  Esporta CSV produce un riepilogo del ciclo selezionato, non un backup ripristinabile.
  Prima di ogni salvataggio e migrazione lo stato precedente viene copiato in
  `collaudo/.local/backups/auto-*.json`: si conservano gli ultimi 30 backup automatici,
  mentre i file manuali non vengono eliminati. Se la copia fallisce, il salvataggio viene rifiutato.
  I backup automatici usano lo stesso formato dell'esportazione e si possono importare
  dalla pagina (limite 50 MiB). L'importazione aggiunge cicli mancanti e rifiuta esiti diversi:
  per tornare a uno stato precedente, arrestare il server, conservare una copia della cartella
  `.local`, rinominare `state.json`, riavviare e importare il backup scelto.
  Copiare periodicamente i backup su un altro disco per proteggersi da guasti della macchina.
- **Verifica tecnica:** `npm run test:collaudo` controlla persistenza, import e conflitti.
  `npm run test:collaudo:browser` verifica in Chromium storico, note, consultazione del catalogo,
  nuovo ciclo e filtro Telemetria su viewport mobile, usando uno storage temporaneo.
  Installare il browser con `npx playwright install chromium` se non è già disponibile.

Su questa macchina è stato trasferito il ciclo visibile nell'artifact del 27/09/2026
(299 esiti: 290 superati, 8 bloccati, 1 N/A), comprese note e attribuzioni visibili.
Il relativo backup è in `collaudo/.local/backups/artifact-migrato.json`.
Questi dati locali non sono distribuiti con il repository: su una nuova macchina
importare il backup oppure creare un ciclo. Non sono stati recuperati altri cicli.
I 46 nuovi casi erano **Da eseguire** al momento della migrazione; i cicli già congelati
mantengono il proprio elenco di casi. La fatturazione SaaS resta sospesa.

## Installazione del prodotto da collaudare

L'installazione su cui si esegue il **protocollo di collaudo manuale**: il prodotto come lo avvia
`docker-compose.yml`, in modalità produzione e dietro HTTPS, più tutto ciò che i casi richiedono
intorno:

| Servizio | A cosa serve | Indirizzo |
|---|---|---|
| `caddy` | HTTPS con un'autorità di certificazione propria | https://wfm.collaudo.test, https://keycloak.collaudo.test |
| `api`, `worker`, `postgres`, `redis`, `migrate` | il prodotto | https://wfm.collaudo.test |
| `keycloak` | identity provider per l'area SSO e per OAuth 2.0 (API-04) | https://keycloak.collaudo.test |
| `intranet` | applicazione su una rete privata, raggiungibile solo dall'agente (area AGT) | http://intranet.acme.local, solo dall'agente |
| `ricevitore` | riceve e stampa i webhook delle notifiche (PLN-13) | http://ricevitore:8080, dall'interno |
| `mailpit` | la casella di test: vi arrivano le email di Keycloak (WEB-45…WEB-47) | http://localhost:8025; SMTP `mailpit:1025` dall'interno |
| `display` | lo schermo su cui si apre la finestra di registrazione (WEB-11, ENV-04) | http://localhost:6080 |
| `simulatori` | TestRail, Jira, Xray, Zephyr Scale, Azure DevOps, GitHub, GitLab e Gemini simulati (aree TMG, TRC, INT, analisi AI) | http://localhost:8090; dall'interno `http://simulatori:8080/<servizio>` |
| `loki`, `grafana` | i log dell'applicazione (OPS-09) | http://localhost:13001 (admin / admin); Loki su http://localhost:13100 |
| `agente` | l'agente locale (profilo `agente`), avviato quando il suo token esiste | — |
| `agente-diverso` | un agente con un'altra versione di Playwright (profilo `agente-diverso`, AGT-05) | — |

I valori (password, segreti, chiavi) sono solo per il collaudo: non vanno mai riusati altrove.

## 1. Requisiti

- Docker Desktop (o Docker Engine con Compose 2.24 o successivo), con almeno 8 GB di memoria.
- Le porte **80** e **443** libere, e la **55432** per l'accesso diretto al database.
- Uscita verso internet per le immagini e per i siti di prova (the-internet.herokuapp.com,
  httpbin.org, jsonplaceholder.typicode.com).

## 2. Nomi degli host

Aggiungere questa riga al file hosts della macchina di chi collauda (su Windows
`C:\Windows\System32\drivers\etc\hosts`, aperto come amministratore; su macOS e Linux `/etc/hosts`):

```text
127.0.0.1  wfm.collaudo.test keycloak.collaudo.test
```

## 3. Avvio

Tutti i comandi si danno dalla radice del repository. Per non riscrivere ogni volta i parametri:

```bash
# bash / zsh
alias wfmc='docker compose -p wfm-collaudo -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml'
```

```powershell
# PowerShell
function wfmc { docker compose -p wfm-collaudo -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml @args }
```

```bash
wfmc up -d --build      # la prima volta costruisce le immagini: alcuni minuti
wfmc ps                 # api "healthy", migrate e ca-export "exited (0)"
```

Il nome di progetto `wfm-collaudo` tiene separati database e volumi da un eventuale stack di
sviluppo. `wfmc down -v` cancella tutto e riporta l'installazione a vuoto, per un nuovo ciclo.

## 4. Fidarsi del certificato

Caddy firma i certificati con una propria autorità. Il prodotto e l'agente la conoscono già; il
browser di chi collauda va istruito una volta:

```bash
wfmc cp caddy:/data/caddy/pki/authorities/local/root.crt ./collaudo-root.crt
```

- **Windows** (Chrome, Edge): `certutil -addstore -user Root collaudo-root.crt`
- **macOS**: aprire il file con Accesso Portachiavi, nel portachiavi Sistema, e impostarlo come
  «Fidati sempre».
- **Firefox**: Impostazioni → Privacy e sicurezza → Certificati → Mostra certificati → Autorità →
  Importa.

Un nuovo `down -v` genera un'autorità nuova: va importata di nuovo.

**Su Windows:**
- Il `curl` di Windows controlla la revoca dei certificati, che un'autorità locale non pubblica:
  aggiungere `--ssl-no-revoke`, per esempio
  `curl --ssl-no-revoke --cacert collaudo-root.crt https://wfm.collaudo.test/api/user`.
- In Git Bash i percorsi assoluti passati ai container vengono convertiti in percorsi Windows
  (`/collaudo/seed.mjs` diventa `C:/Program Files/Git/collaudo/seed.mjs`): anteporre
  `MSYS_NO_PATHCONV=1` ai comandi `wfmc exec`. PowerShell non ha questo problema.

## 5. Preparare e verificare l'ambiente (ogni ciclo)

Prima di ogni ciclo, e dopo ogni modifica all'applicazione, questi tre comandi portano lo stack a
uno stato noto e dicono se è pronto. Un caso che fallisce dopo un controllo «Pronto» fallisce per
l'applicazione, non per l'ambiente.

```bash
npm run collaudo:up        # costruisce l'immagine con il codice attuale e avvia tutto, attende i servizi
npm run collaudo:prepare   # persone, sessioni per ruolo e dati di partenza (ripetibile)
npm run collaudo:check     # «Pronto» o, per ogni problema, cosa fare
```

`collaudo:prepare` (richiede Node 18+ e `collaudo/collaudo-root.crt`, passo 4):

| Crea | Per i casi |
|---|---|
| le persone di `seed.mjs` | tutti, se si salta l'area Accesso |
| una sessione aperta per owner.a, editor.a e viewer.a in `collaudo/.sessions/` (`curl --cookie collaudo/.sessions/viewer.a.cookies …`) | MEM-04…MEM-06 e ogni verifica via API, senza consumare tentativi di accesso |
| l'ambiente **Staging** con `baseUrl`, `USERNAME`, `PASSWORD`, `apiBase`, `token` | ENV, WEB, API-05 |
| il test **Login ok** e il piano **Collaudo · rete e trace**, già eseguito una volta | PLN, REP-04 (pannello Rete e HAR) |
| **Progetto P**, riservato, con editor.a come viewer | MEM-06 |

`collaudo:check` controlla i servizi (compresi Loki e Grafana per OPS-09), HTTPS e Keycloak,
Mailpit, le sessioni con il loro ruolo e i dati. Segnala come avviso i siti pubblici usati dai casi
(the-internet, httpbin, jsonplaceholder): se non rispondono, quei casi vanno segnati Bloccati, non
Falliti.

**Limite agli accessi.** L'applicazione accetta 20 accessi ogni 15 minuti per indirizzo, ed è ciò
che ACC-07 verifica. Un ciclo automatico, che accede molte volte, alza il limite e lo riporta a 20
per ACC-07:

```bash
AUTH_RATE_LIMIT=1000 wfmc up -d api   # ciclo automatico
wfmc up -d api                        # di nuovo 20, per ACC-07
```

Anche `wfmc restart api` azzera i tentativi contati.

**Ripartire da zero:** `npm run collaudo:reset`, poi i tre comandi sopra.

### Servizi esterni simulati

Il servizio `simulatori` risponde come TestRail, Jira (anche Xray Server), Xray Cloud, Zephyr Scale,
Azure DevOps e Gemini, con i dati che i casi si aspettano. Così TMG-01…07, TRC-03/04 e l'analisi
AI (REP-15…22) si eseguono senza account esterni. `npm run collaudo:simulatori` crea le connessioni
«Simulato · …» e ne verifica ciascuna attraverso il prodotto.

| Strumento | Indirizzo (nel prodotto) | Credenziali | Dati |
|---|---|---|---|
| TestRail | `http://simulatori:8080/testrail` | `collaudo@acme.test` / `collaudo-testrail` | progetto `3`, casi C1, C2, C3 |
| Xray Cloud | `http://simulatori:8080/xray` | client id `collaudo`, secret `collaudo-xray` | progetto `SHOP`, test SHOP-45 e SHOP-46, Test Plan SHOP-100 |
| Jira / Xray Server | `http://simulatori:8080/jira` | `collaudo@acme.test` / `collaudo-jira` | epic SHOP-1 con le story SHOP-10 e SHOP-11 |
| Zephyr Scale | `http://simulatori:8080/zephyr` | token `collaudo-zephyr` | progetto `SHOP`, casi SHOP-T1 e SHOP-T2 |
| Azure DevOps | `http://simulatori:8080/ado` | PAT `collaudo-ado` | progetto `Shop`: Epic 1, Feature 2, User Story 3 |
| GitHub (INT-07) | `http://simulatori:8080/github` | token `collaudo-github` | repository `acme/shop`, ogni commit esadecimale |
| GitLab (INT-07) | `http://simulatori:8080/gitlab` | token `collaudo-gitlab` | progetto `acme/shop`, ogni commit esadecimale |

Gli stati dei commit ricevuti sono sulla pagina http://localhost:8090 e su `/_admin/statuses`.
`npm run collaudo:simulatori` verifica anche INT-10 (tracker con token sbagliato), WEB-16 (elemento
`WEB16 · username` con `#usernameX`, corretto in `#username` dal Gemini simulato) e INT-07 (GitHub
collegato, run avviato con una chiave API su un commit casuale).

Nei casi che chiedono l'indirizzo «vuoto» (Xray Cloud in TMG-04) si usa quello della tabella: il
default verso il servizio vero è già verificato dai test automatici.

Ciò che i servizi hanno ricevuto (run di TestRail con esiti e commenti, Test Execution di Xray,
test cycle di Zephyr, issue e work item, ultime richieste) si legge su **http://localhost:8090**;
i corpi completi delle richieste su http://localhost:8090/_admin/requests (REP-17: il prompt
inviato all'AI). Le azioni che un caso fa «nel tool»:

```bash
# TRC-03: rinominare SHOP-11 e spostarla In Progress
curl -X POST -H 'Content-Type: application/json' -d '{"summary":"Pagare con bonifico istantaneo","status":"In Progress"}' http://localhost:8090/_admin/jira/SHOP-11
# Ripartire dai dati iniziali
curl -X POST http://localhost:8090/_admin/reset
```

**Analisi AI (REP-15…22).** Si attiva con il Gemini simulato, e si spegne di nuovo per i casi che
verificano il prodotto senza chiave (WEB-10):

```bash
GEMINI_API_KEY=finto GEMINI_BASE_URL=http://simulatori:8080/gemini wfmc up -d api worker
wfmc up -d api worker                      # di nuovo senza AI
```

Il Gemini simulato legge il prompt di analisi. Con una richiesta fallita 5xx risponde «Bug
dell'applicazione»; con uno step fallito su un selettore risponde «Locator» e propone
`button[type="submit"]` per i bottoni. `npm run collaudo:simulatori` crea il test «REP15 · bottone
con classe cambiata», che ha proprio quel fallimento. Al prompt di self-healing risponde con l'`id`
della pagina più simile al selettore rotto. Per fissare la risposta successiva:
`curl -X POST -d '<json della risposta>' http://localhost:8090/_admin/gemini/next`.

**Codice OTP (WEB-48, WEB-49).** In Keycloak, l'utente `mfa` ha l'azione «Configure OTP», come nel
caso. L'utente `mfa-pronto` ha già l'OTP con la chiave `INXWY3DBOVSG6VDPORYDEMBSGZFWK6JB`, da usare
come `secret_mfa` (e nell'app del telefono, per il confronto del passo 4). Entrambi hanno la password
`Collaudo.2026!`. Il Chromium dei run si fida dell'autorità di collaudo (`collaudo/worker/trust-ca.sh`,
all'avvio del worker), quindi i test raggiungono https://keycloak.collaudo.test; Firefox no. Gli
utenti arrivano con l'import del realm: su uno stack già avviato,
`wfmc up -d --force-recreate keycloak`.

**Debug abbandonato (WEB-43).** `DEBUG_IDLE_TIMEOUT_MS=60000 wfmc up -d api worker` chiude una sessione
in pausa dopo un minuto invece di 15.

## 6. Dati di partenza

- **Ciclo completo**: il database parte vuoto e i casi ACC-01…ACC-03 creano owner.a, editor.a e
  viewer.a dall'interfaccia. Per l'organizzazione B serve la registrazione aperta per il tempo
  di un account:

  ```bash
  REGISTRATION=open wfmc up -d api     # registrare owner.b da /auth
  wfmc up -d api                       # di nuovo su invito
  ```

  (In PowerShell: `$env:REGISTRATION='open'; wfmc up -d api; Remove-Item Env:REGISTRATION; wfmc up -d api`.)

- **Ciclo parziale**, che salta l'area Accesso: lo script crea le due organizzazioni e le persone
  del protocollo, tutte con password `Collaudo.2026!`:

  ```bash
  wfmc exec api node /collaudo/seed.mjs
  ```

  | Utente | Organizzazione | Ruolo |
  |---|---|---|
  | `owner.a` | Acme | owner |
  | `editor.a` | Acme | editor |
  | `viewer.a` | Acme | viewer |
  | `marco@acme.test` | Acme | editor (collegato via SSO in SSO-04) |
  | `owner.b` | Beta | owner |
  | `luca@acme.test` | Beta | editor (rifiutato via SSO in SSO-05) |

## 7. Valori per i casi

**Single sign-on (SSO-01).** In Impostazioni → Sicurezza → Single sign-on di owner.a:

| Campo | Valore |
|---|---|
| Issuer | `https://keycloak.collaudo.test/realms/acme` |
| Client ID | `webflowmaster` |
| Client secret | `collaudo-sso-secret` |
| Domini e-mail | `acme.test` |

Il redirect URI mostrato dall'applicazione (`https://wfm.collaudo.test/api/sso/callback`) è già
registrato nel client. Utenti Keycloak, tutti con password `Collaudo.2026!`:

| Utente Keycloak | E-mail | Per il caso |
|---|---|---|
| `anna` | anna@acme.test | SSO-02, SSO-03 (primo accesso, poi cambio e-mail) |
| `marco` | marco@acme.test | SSO-04 (collegamento a un account esistente) |
| `nonverificata` | nonverificata@acme.test, non verificata | SSO-05 |
| `fuori` | fuori@altro.test | SSO-05: avviare con un indirizzo `@acme.test`, accedere come fuori |
| `luca` | luca@acme.test | SSO-05: il suo account è nell'organizzazione B |
| `reimposta` | reimposta@acme.test | WEB-45: la sua password viene reimpostata via email a ogni esecuzione |

Per SAML avanzato (avvio IdP, cifratura, logout) ed email HTML con rimbalzi, usare anche i
[casi di collaudo amministrazione](../docs/administration-acceptance.md), con chiavi e relay di test.
La fatturazione è sospesa per decisione del 2026-10-02; non configurare pagamenti per questi casi.

**Single sign-on SAML (SSO-13…SSO-17, SEC-31).** Il realm `acme` ha anche un client SAML con
client ID `https://wfm.collaudo.test/api/sso/saml/1` (Acme è l'organizzazione 1), ACS
`https://wfm.collaudo.test/api/sso/saml/1/acs`, asserzione firmata, NameID persistent e attributo
`email`. In Impostazioni → Sicurezza → Single sign-on scegliere Protocollo **SAML 2.0** e incollare
i metadati di `https://keycloak.collaudo.test/realms/acme/protocol/saml/descriptor`; dominio
`acme.test`. Gli utenti sono gli stessi della tabella sopra. Un'organizzazione usa un protocollo
alla volta: per tornare ai casi OIDC, rimettere Protocollo **OpenID Connect** e il client secret.

**Ruoli dai gruppi e verifica dei domini (SSO-18…SSO-22).** Il realm ha i gruppi `wfm-viewer`,
`wfm-editor` e `wfm-owner`, inviati come claim `groups` (OIDC) e attributo `groups` (SAML), con il
solo nome del gruppo. `anna` è in `wfm-editor`, `marco` in nessun gruppo; per spostare qualcuno
fra i gruppi: console di Keycloak → Users → l'utente → Groups. I domini `.test` non hanno un DNS
pubblico: nel collaudo il pulsante **Verifica** può solo dire che il record TXT manca, e la
verifica riuscita è coperta dai test automatici (`server/sso.test.ts`).

**Provisioning SCIM (SSO-23…SSO-26).** Keycloak non ha un client SCIM: fa da provider lo script
`npm run collaudo:scim`, che parla come Entra ID e Okta. Richiede il single sign-on di Acme
configurato (SSO-01) e la mappatura `wfm-editor` → editor (SSO-18); emette un token come `owner.a`
(sostituendo quello eventualmente emesso prima), crea `scim.ada@acme.test`, la mette nel gruppo,
la disattiva (e controlla che **Impostazioni → Membri** la segni come *disattivata*) e la
riattiva, poi rimuove utente e gruppo. Il token resta emesso: revocarlo da **Impostazioni →
Single sign-on → Provisioning (SCIM)** fa parte di SSO-23.

La console di Keycloak (per cambiare un'e-mail o fermare il provider) è su
https://keycloak.collaudo.test, utente `admin`, password `admin`.

**OAuth 2.0 client credentials (API-04).** Token URL
`https://keycloak.collaudo.test/realms/acme/protocol/openid-connect/token`, client `api-client`,
secret `collaudo-api-secret`.

**Email (WEB-45…WEB-47).** Keycloak manda le email di reimpostazione della password al Mailpit
dello stack, che il worker legge da `MAILPIT_URL=http://mailpit:8025`. La posta arrivata si vede su
http://localhost:8025.

**Notifiche (PLN-13).** URL del webhook nel piano: `http://ricevitore:8080/notifiche`. Le
chiamate ricevute si leggono con `wfmc logs -f ricevitore`.

**Agente locale (area AGT).** Creare l'agente in Impostazioni → Agenti locali, poi avviarlo con
il token mostrato:

```bash
WFM_AGENT_TOKEN=wfa_... wfmc --profile agente up -d --build agente
wfmc logs -f agente
```

Il test di AGT-02 usa `http://intranet.acme.local` (titolo «Intranet Acme», testo
«Benvenuto nell'intranet»): dall'agente passa, dai runner del server fallisce.

**Protocolli privati (AGT-06/07/09/10).** Dopo `collaudo:prepare`, con lo stack e il worker
avviati, eseguire `npm run collaudo:protocolli`. Il comando crea una volta l'agente
`agente-protocolli` nel pool `interno`, salva il token soltanto in
`collaudo/.sessions/agent-interno.json` (ignorato da Git), e avvia il profilo `protocolli`.
Riutilizza lo stesso agente alle esecuzioni successive. Se è stato revocato, rimuovere quel
file locale per crearne uno nuovo. `DOCKER_BIN` permette di scegliere il percorso del CLI Docker.

Il pool usa un solo slot; l'agente mobile nel pool `lab` continua a funzionare. Il servizio
`protocolli` appartiene soltanto alla rete privata e non pubblica porte: gRPC su
`grpc://protocolli:50051/collaudo.Echo/Say`, WebSocket su `ws://protocolli:8080/echo`, OAuth
su `http://protocolli:8080/token`; la definizione è `collaudo/protocolli/echo.proto`.

Il catalogo versione 22 aggiunge API-37–48 per streaming, mTLS, conversazioni e bundle SOAP.
L’agente aggiornato è 1.2.0: ricostruirlo dopo l’aggiornamento. `Echo/Server` emette `first`,
`complete`; `Echo/Client` concatena i testi con virgole; `Echo/Bidi` invia `challenge` e poi
restituisce i messaggi ricevuti. `/conversation` invia subito `{"token":"private-challenge"}`
e attende quel token, rispondendo con `accepted=true`; usa il medesimo Bearer token di `/echo`.
Il timeout locale ora fallisce l’esecuzione, senza accettare risposte parziali. La definizione
storica AGT-10 e i suoi esiti rimangono conservati; nel nuovo ciclo verificare API-40.
API-44/45 richiedono un servizio mTLS di prova con hostname/certificati validi e segreti
appartenenti all’ambiente selezionato. API-47/48 richiedono i bundle WSDL/XSD indicati nelle
precondizioni; esempi riproducibili sono in `server/tests/soap-bundle-fixtures.ts`.
Le credenziali OAuth di fixture sono `collaudo` / `fixture-secret`, il bearer di fixture
è `private-fixture-token`. `Wait` non risponde, per verificare il deadline.

La prova usa il runner API e il relay del worker reali: verifica isolamento della rete,
metadati e asserzioni gRPC, sostituzione delle variabili, asserzioni ed estrazione WebSocket,
OAuth privato e riuso dello slot dopo un deadline gRPC. Non crea piani o report e non
segna automaticamente i casi del protocollo manuale: la verifica UI/report e AGT-08 con
un agente legacy restano procedure distinte. Non cancella volumi, cicli o risultati storici.

Per verificare anche le esecuzioni complete, avviare prima le fixture e poi eseguire
`npm run collaudo:protocolli:piani`. Il comando crea test API pubblicati e piani nominati
«AGT acceptance …», che conserva per ispezionarne i report. Verifica cinque test sul pool
`interno` (gRPC, WebSocket, estrazione riusata da OAuth, deadline di 30 secondi e recupero)
e un piano sui runner del server che deve fallire perché gli endpoint sono privati.
Salva gli ID e i link ai report in `collaudo/.sessions/protocol-plan-all-evidence.json`.
Ogni esecuzione crea nuovi test e piani; non modifica quelli esistenti.
Se un agente originale 1.0.0 è collegato in un pool dedicato, impostare
`WFM_LEGACY_POOL` per verificare anche HTTP funzionante e rifiuto esplicito di WebSocket.
`WFM_PROTOCOL_SCOPE=server` oppure `legacy` limita la prova al controllo selezionato e
salva le evidenze in un file separato, utile quando si riprende una verifica interrotta.

**Agente con un'altra versione di Playwright (AGT-05).** Creare un secondo agente in un pool
proprio (per esempio `diverso`) e avviarlo con il suo token: l'immagine installa Playwright
1.60.0 invece della versione del server.

```bash
WFM_AGENT_TOKEN_DIVERSO=wfa_... wfmc --profile agente-diverso up -d --build agente-diverso
```

La scheda dell'agente mostra la versione diversa; un piano che esegue sul pool `diverso` fallisce
con «The agents of pool "diverso" run Playwright 1.60.0, and this server 1.63.0: they must
match». Un'altra versione si sceglie con `AGENT_PLAYWRIGHT_VERSION` (deve cambiare il minore).

**Emulatore Android (area MOB, Appium locale).** Un emulatore vero, con Appium, nel container
`budtmo/docker-android`. Serve `/dev/kvm`, che **Docker Desktop non ha**: il container gira nel
Docker Engine installato dentro la distro WSL `Ubuntu-24.04` (che ha `/dev/kvm`; `.wslconfig` con
`networkingMode=mirrored`), separato da quello di Docker Desktop.

```powershell
npm run collaudo:mobile          # avvia, scarica l'immagine (~10 GB) e l'apk, aspetta il boot
npm run collaudo:mobile -- stop  # lo ferma
```

Appium risponde su http://localhost:4723, lo schermo dell'emulatore si guarda su
http://localhost:6081 (noVNC). L'apk di prova, `WikipediaSample.apk`, sta in
`collaudo/mobile/apps/` (non versionata, la scarica lo script) ed è vista da Appium come
`/apps/WikipediaSample.apk`: nel test mobile **App** è quel percorso (è il percorso nel container
di Appium, non sul PC) e **Dispositivo** `emulator-5554`.

Per farlo raggiungere dal prodotto servono un agente locale e una griglia:

1. Impostazioni → Agenti locali: agente nel pool `lab`; avviarlo come sopra
   (`WFM_AGENT_TOKEN=wfa_... wfmc --profile agente up -d --build agente`).
2. Impostazioni → Griglie di browser → **Local Appium (agent)**: pool `lab`, indirizzo
   `http://host.docker.internal:4723` (l'agente gira in Docker Desktop, Appium nel Docker di WSL:
   si incontrano sull'host Windows). **Verifica connessione** deve dire «Connected through pool "lab"».

`npm run collaudo:check` controlla Appium e l'emulatore. I casi MOB scritti per BrowserStack o
LambdaTest (upload `bs://`, video e dashboard della griglia) non si eseguono qui; quelli iOS
non si eseguono senza un Mac.

**Impostazioni che alcuni casi cambiano per un momento.** Si passano come variabili e si
applicano riavviando i servizi interessati; senza variabile tornano al valore di default:

| Variabile | Casi | Esempio |
|---|---|---|
| `INSTALLATION_ADMINS` | ADM-01…ADM-03 | `INSTALLATION_ADMINS=owner.a wfmc up -d api` |
| `ORG_MAX_CONCURRENT_RUNS`, `ORG_MAX_QUEUED_RUNS` | PLN-11 | `ORG_MAX_CONCURRENT_RUNS=1 ORG_MAX_QUEUED_RUNS=2 wfmc up -d api worker` |
| `RUN_MAX_DURATION_MS` | PLN-15 | `RUN_MAX_DURATION_MS=60000 wfmc up -d api worker` |
| `API_RATE_LIMIT`, `WEBHOOK_RATE_LIMIT` | INT-11 | `API_RATE_LIMIT=5 wfmc up -d api` |
| `GEMINI_API_KEY` | WEB-10, WEB-16 | `GEMINI_API_KEY=... wfmc up -d api worker` |
| `REGISTRATION` | ACC, organizzazione B | vedi sopra |

**Registrazione (WEB-11, ENV-04).** La finestra di registrazione si apre sul server, cioè nel
container `api`, che la disegna sullo schermo virtuale del servizio `display`. Prima di avviare
la registrazione aprire **http://localhost:6080** in un'altra scheda e poi «Connect»: la finestra
compare lì e si usa con mouse e tastiera come qualsiasi altra. Lo schermo non ha password ed è
raggiungibile solo da questa macchina.

Se il prodotto dice «This server has no display», il container `api` è stato creato prima che
lo schermo esistesse: `wfmc up -d --build display api`. Se la pagina 6080 si apre ma resta nera o
non si connette, lo schermo non è partito: `wfmc logs display` e `wfmc up -d --build display`.

**Credenziali perse (tutti i casi).** Dopo i casi su password e secondo fattore le credenziali
iniziali di owner.a, editor.a o viewer.a possono non valere più. Senza toccare il database:

```bash
wfmc exec api node dist/password-reset-link.js owner.a   # link valido un giorno, una volta
```

Aprire il link e reimpostare `Collaudo.2026!`. Il secondo fattore di un membro lo toglie un owner
da Impostazioni → Membri; quello di owner.a, che non ha un owner sopra di sé, si toglie da
Impostazioni → Sicurezza con un codice di recupero. Il registro di audit riporta entrambe le
operazioni.

**Scadenza delle evidenze (REP-09).** La pulizia gira nel container `api` 5 minuti dopo l'avvio
e poi ogni 6 ore, su tutti i run conclusi da più di `ARTIFACT_RETENTION_DAYS` giorni (90 se non
impostato). Per provarla su un solo run, senza toccare gli altri, si invecchia solo quel run:

```sql
-- un run con file in /app/results/<piano>/<run>/ (wfmc exec api ls /app/results/<piano>/<run>)
UPDATE test_plan_executions
   SET completed_at = now() - interval '100 days', artifacts_purged_at = NULL
 WHERE id = '<run>';
```

Con il default di 90 giorni solo quel run è scaduto (controllare con
`SELECT count(*) FROM test_plan_executions WHERE completed_at < now() - interval '90 days'`).
Poi `wfmc restart api`, attendere 5 minuti e verificare: `wfmc logs api | grep "Artifact retention"`
riporta `purgedRuns: 1`, la cartella del run è vuota, il report dice che le evidenze sono state
rimosse ed esiti e step restano. Le baseline visuali (`/app/data/visual-baselines`) non cambiano.

**Database (OPS-03, SEC-09).** `localhost:55432`, utente `postgres`, password `password`,
database `webflowmaster`. Per agire come l'applicazione: `SET ROLE app_user;`.

**Backup e ripristino (OPS-11…OPS-14).** Lo strumento è `scripts/wfm-backup.ts` (documentato in Operatività →
Backup). Sullo stack di collaudo:

```bash
npm run backup:create -- -p wfm-collaudo -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml
npm run backup:verify -- backups/wfm-backup-<ora> -p wfm-collaudo -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml
```

Il ripristino (OPS-13, OPS-14) si prova su un secondo stack usa-e-getta, mai su quello del collaudo: un file
`drill.yml` con `ports: !reset []` su redis, postgres, mailpit e api e `image: wfm-collaudo-api:latest` /
`wfm-collaudo-worker:latest` su migrate, api e worker, poi

```bash
docker compose -p wfm-drill -f docker-compose.yml -f drill.yml up -d --no-build
npm run backup:restore -- backups/wfm-backup-<ora> -p wfm-drill -f docker-compose.yml -f drill.yml --yes
docker compose -p wfm-drill -f docker-compose.yml -f drill.yml down -v     # alla fine
```

**Più worker e guasti (OPS-04…OPS-06).**

```bash
wfmc up -d --scale worker=2 worker
wfmc kill worker            # durante un run
wfmc restart redis
```

**Prova di carico (OPS-15…OPS-17).** `npm run collaudo:carico` carica lo stack con
`scripts/wfm-load.ts` (Operatività → Capacità e limiti): in Acme e in Beta crea un test API
«CARICO · salute» verso i simulatori, un piano che lo contiene e una chiave, poi 10 client leggono
per 30 secondi (OPS-15: p95 entro 1 s, nessun errore) e partono 10 run per organizzazione insieme
(OPS-16: mai più di 2 in corso per organizzazione, tutti `completed`; OPS-17: le due organizzazioni
servite alla pari, come dicono primo avvio e ultima fine di ciascuna). Alla fine cancella piani, run, risultati, test e chiavi, anche se la prova
fallisce; l'esito resta in `collaudo/carico-esito.json`. Il limite delle API va spento per la
misura:

```bash
API_RATE_LIMIT=0 wfmc up -d api
npm run collaudo:carico            # CARICO_ARGOMENTI="--runs 30 --readers 20" per caricare di più
wfmc up -d api
```

**Jenkins (INT-08).** `npm run collaudo:jenkins` crea una chiave API (runs:write, runs:read),
avvia Jenkins (http://localhost:8088, `admin` / `Collaudo.2026!`) configurato da
`collaudo/jenkins/casc.yaml` e lancia il job **INT-08**. Il job usa la shared library di
`integrations/jenkins` presa da questo repository (ramo `main`, quindi il template come è stato
unito) sul piano «Collaudo · rete e trace» in Staging. Pubblica JUnit e report HTML; il run nel
prodotto riporta la build Jenkins con il link. L'agente è il nodo integrato con Node, non
`docker { image 'node:20' }` dell'esempio. `npm run collaudo:jenkins -- stop` lo ferma.
**Isolamento dei test mobili (SEC-25…30).** Con l'emulatore avviato e MOB-16 eseguito (test
«Ricerca Wikipedia», griglia «Lab»): `npm run collaudo:sicurezza-mobile` esegue tutti i passi via API.
Accede da sé come owner.b e come `marco@acme.test` (editor fuori da «Progetto P») e lascia in B
griglia, test, progetto, requisito e connessione «SEC · …». L'agente di B nel pool `lab` di SEC-28
non serve: la griglia di B risponde che nessun agente del pool è connesso mentre quello di A lo è,
cioè il pool vale dentro l'organizzazione.

## 8. Cosa non copre

- **Jira o Azure DevOps, GitHub e i sistemi di CI** sono servizi esterni: servono un progetto,
  un repository e i token di prova.
- Il repository GitHub del caso INT-06 deve raggiungere l'installazione: da una macchina di
  sviluppo serve un runner self-hosted sulla stessa macchina, oppure un tunnel.
