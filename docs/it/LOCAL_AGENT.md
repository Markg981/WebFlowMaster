# Agenti locali

Un agente locale gira **dentro la tua rete** e presta i suoi browser a WebFlowMaster. I piani
impostati per girare sul pool dell'agente aprono le pagine da quella macchina, quindi possono
testare applicazioni che il server WebFlowMaster non raggiunge: una intranet, uno staging dietro
VPN, `localhost` sul portatile di uno sviluppatore.

L'agente **si connette solo in uscita**, in HTTPS/WSS verso il server. Non servono porte in
ingresso, VPN o modifiche al firewall oltre all'accesso in uscita verso il server.

## Come funziona

```
 la tua rete                                    WebFlowMaster
┌───────────────────────────┐        WSS        ┌──────────────────────────────┐
│ wfm-agent                 │ ───── control ──▶ │ relay (web server)           │
│  └─ browser (Playwright)  │ ───── session ──▶ │   ▲                          │
│        │                  │                   │   │ ticket (60 s, firmato)   │
│        ▼                  │                   │ runner / worker              │
│  applicazione sotto test  │                   │  esegue gli step del piano   │
└───────────────────────────┘                   └──────────────────────────────┘
```

1. L'agente tiene una connessione di controllo verso il server e dichiara quali browser ha.
2. Quando parte un run di un piano impostato sul suo pool, il runner chiede un browser al relay con
   un ticket firmato di breve durata. Il relay sceglie l'agente connesso meno occupato di quel pool
   nella stessa organizzazione.
3. L'agente avvia il browser in locale e apre una seconda connessione in uscita. Il relay inoltra il
   protocollo Playwright fra il runner e quel browser.
4. Il runner lo pilota come farebbe con il proprio: step, screenshot, video, trace, HAR e controlli
   di accessibilità funzionano invariati, e il report indica il pool (`chromium on agent pool "onprem"`).
5. Anche **test API, precondizioni API e richieste di token OAuth** del run partono dall'agente,
   attraverso lo stesso tipo di browser in prestito (l'API request di Playwright gira dove gira il
   browser). Ogni richiesta parte senza cookie, esattamente come dal server. Il browser per queste
   richieste viene preso alla prima richiesta, quindi un piano senza chiamate API non ne chiede.
   Per questo l'agente deve avere Chromium installato, qualunque browser usino i test UI del piano.

## Configurazione

### 1. Crea l'agente (owner)

**Settings → Agenti locali**: dagli un nome e un pool (per esempio `onprem`, `lab`,
`portatile-marco`). Il token (`wfa_…`) viene mostrato **una sola volta**, insieme ai comandi da
eseguire. Più agenti nello stesso pool si dividono il carico.

### 2. Avvialo

Con Docker (consigliato; browser inclusi):

```bash
docker build -f Dockerfile.agent -t webflowmaster-agent .
docker run -d --restart unless-stopped \
  -e WFM_URL=https://webflowmaster.example.com \
  -e WFM_AGENT_TOKEN=wfa_... \
  webflowmaster-agent
```

Con Node 20 o successivo:

```bash
curl -fsSL https://webflowmaster.example.com/cli/wfm-agent.mjs -o wfm-agent.mjs
npm install playwright@<versione del server> ws
npx playwright install chromium        # e firefox / webkit / msedge se i piani li usano
WFM_URL=https://webflowmaster.example.com WFM_AGENT_TOKEN=wfa_... node wfm-agent.mjs
```

| Variabile | Significato |
|---|---|
| `WFM_URL` | Il server WebFlowMaster |
| `WFM_AGENT_TOKEN` | Il token da Settings |
| `WFM_AGENT_MAX_SESSIONS` | Browser prestati contemporaneamente (default 2, max 16) |

L'agente si riconnette da solo quando la connessione cade. Esce con codice **2** quando il server
rifiuta il token (revocato) o la versione del protocollo: sono errori che non si risolvono
riprovando. `SIGTERM`/`Ctrl+C` lascia prima finire i run che usano i suoi browser.

### 3. Imposta il piano sul pool

In **Run settings → Esegui su** del piano scegli *Agenti locali: &lt;pool&gt;*. La lista dei browser
del piano resta valida: ogni browser viene preso in prestito dal pool.

## Configurazione del server

| Variabile | Dove | Significato |
|---|---|---|
| `AGENT_RELAY_SECRET` | web e worker | Firma i ticket. Di default `SESSION_SECRET`; impostala esplicitamente se il worker non condivide il session secret del web server. |
| `AGENT_RELAY_URL` | worker | Dove il runner raggiunge il relay. Di default `http://127.0.0.1:$PORT`, corretto quando il worker gira nel processo web. Con worker separati, puntala al web server (o al suo load balancer). |
| `AGENT_RELAY_ADVERTISE_URL` | web, con più web server | L'indirizzo di questo web server come lo raggiungono gli altri web server (IP del pod, nome del container — non il load balancer). Impostarla attiva la directory condivisa in Redis. |

Il relay vive nel processo web e accetta upgrade WebSocket su `/api/agent/v1/*`: un reverse proxy
davanti deve inoltrare gli upgrade WebSocket su quei percorsi.

### Più web server

Ogni web server ha il proprio relay, e un agente è connesso a quello che gli ha assegnato il load
balancer. Con `AGENT_RELAY_ADVERTISE_URL` impostata su ogni web server, questi pubblicano i propri
agenti su Redis (lo stesso che usa già la coda) ogni pochi secondi. Una richiesta che arriva a un
server che non ha l'agente necessario — quella del runner per un browser, o la seconda connessione
dell'agente stesso — viene passata al server che ce l'ha, direttamente al suo indirizzo pubblicato.
Non servono sessioni sticky, e i web server devono potersi raggiungere fra loro su quegli indirizzi.

Un agente revocato viene disconnesso subito dal server che lo ospita se la richiesta dell'owner è
arrivata a quel server, altrimenti al suo heartbeat successivo (entro 20 secondi). Un server che si
ferma ritira la propria voce; uno che va in crash smette di essere scelto entro 15 secondi, e nel
frattempo un runner indirizzato lì riceve un rifiuto che lo nomina.

## Limiti

- **Le versioni di Playwright devono coincidere** (major.minor) fra agente e server. Settings
  segnala un agente non allineato; l'immagine Docker ha il tag della versione del server.
- Se nessun agente del pool è connesso, il passaggio su quel browser fallisce con un motivo chiaro
  (`No agent of pool "onprem" is connected`) invece di girare altrove.

## Sicurezza

- Il token è salvato solo come hash SHA-256; revocarlo (Settings) disconnette subito l'agente.
- Un agente serve solo la propria organizzazione, e solo run di piani impostati sul suo pool.
- I ticket sono firmati HMAC, legati a organizzazione, pool e browser, e scadono dopo 60 secondi.
- Creare e revocare agenti è riservato agli owner ed è registrato nell'audit log.
- L'agente esegue dentro la tua rete ciò che fanno gli step del piano: assegna il pool a piani che
  lasceresti girare da quella macchina.
