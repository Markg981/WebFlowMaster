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
| `AGENT_RELAY_URL` | worker | Dove il runner raggiunge il relay. Di default `http://127.0.0.1:$PORT`, corretto quando il worker gira nel processo web. Con worker separati, puntala al web server. |

Il relay vive nel processo web e accetta upgrade WebSocket su `/api/agent/v1/*`: un reverse proxy
davanti deve inoltrare gli upgrade WebSocket su quei percorsi.

## Limiti

- **Le versioni di Playwright devono coincidere** (major.minor) fra agente e server. Settings
  segnala un agente non allineato; l'immagine Docker ha il tag della versione del server.
- **Test API e precondizioni API** partono comunque dal server, non dall'agente.
- Con **più web server**, gli agenti si connettono a uno solo: `AGENT_RELAY_URL` deve portare
  all'istanza a cui sono connessi (un unico host per il relay, o routing sticky).
- Se nessun agente del pool è connesso, il passaggio su quel browser fallisce con un motivo chiaro
  (`No agent of pool "onprem" is connected`) invece di girare altrove.

## Sicurezza

- Il token è salvato solo come hash SHA-256; revocarlo (Settings) disconnette subito l'agente.
- Un agente serve solo la propria organizzazione, e solo run di piani impostati sul suo pool.
- I ticket sono firmati HMAC, legati a organizzazione, pool e browser, e scadono dopo 60 secondi.
- Creare e revocare agenti è riservato agli owner ed è registrato nell'audit log.
- L'agente esegue dentro la tua rete ciò che fanno gli step del piano: assegna il pool a piani che
  lasceresti girare da quella macchina.
