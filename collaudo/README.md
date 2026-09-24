# Ambiente di collaudo

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
| `agente` | l'agente locale (profilo `agente`), avviato quando il suo token esiste | — |

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

## 5. Dati di partenza

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

## 6. Valori per i casi

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

La console di Keycloak (per cambiare un'e-mail o fermare il provider) è su
https://keycloak.collaudo.test, utente `admin`, password `admin`.

**OAuth 2.0 client credentials (API-04).** Token URL
`https://keycloak.collaudo.test/realms/acme/protocol/openid-connect/token`, client `api-client`,
secret `collaudo-api-secret`.

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

**Database (OPS-03, SEC-09).** `localhost:55432`, utente `postgres`, password `password`,
database `webflowmaster`. Per agire come l'applicazione: `SET ROLE app_user;`.

**Più worker e guasti (OPS-04…OPS-06).**

```bash
wfmc up -d --scale worker=2 worker
wfmc kill worker            # durante un run
wfmc restart redis
```

## 7. Cosa non copre

- **La registrazione dei test** (WEB-11, ENV-04) apre un browser sulla macchina del server:
  in questo stack non c'è uno schermo, quindi quei casi si eseguono con l'applicazione avviata in
  locale (`npm run dev`) oppure si segnano N/A.
- **Jira o Azure DevOps, GitHub e i sistemi di CI** sono servizi esterni: servono un progetto,
  un repository e i token di prova.
- Il repository GitHub del caso INT-06 deve raggiungere l'installazione: da una macchina di
  sviluppo serve un runner self-hosted sulla stessa macchina, oppure un tunnel.
