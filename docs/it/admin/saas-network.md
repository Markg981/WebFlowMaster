# Isolamento di rete per un SaaS condiviso

Per un'installazione condivisa tra organizzazioni usare il deployment autonomo
`deployment/saas-network/compose.yml`. Le restrizioni sulle destinazioni coprono **API e
worker**: anche le anteprime interattive eseguono test nel processo API. Il Compose alla
radice resta destinato agli ambienti in cui l'operatore fornisce separatamente i controlli
di rete.

## Avviare il deployment isolato

Servono container Linux, Docker Compose 2.33.1 o successivo, iptables IPv4/IPv6 funzionanti
nei namespace dei container e un reverse proxy TLS sull'host. Non sovrapporre questo file
a `docker-compose.yml`: la configurazione di rete è autonoma.

1. Copiare `deployment/saas-network/.env.example` in un file di ambiente privato.
2. Generare **ciascuno** dei sei segreti separatamente con
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   Il validatore richiede 64 caratteri esadecimali minuscoli e rifiuta segreti uguali.
3. Impostare `WEBFLOW_PUBLIC_URL` con l'origine HTTPS pubblica. Il reverse proxy TLS deve
   raggiungere `127.0.0.1:5090` (oppure `WFM_SAAS_PORT`). PostgreSQL, Redis e proxy di uscita
   non pubblicano porte. Mantenere abilitati i cookie sicuri.
4. Autorizzare nomi host e porte esatti, per esempio:

   ```dotenv
   WFM_SAAS_ALLOWLIST='[{"host":"app.example.com","ports":[443]},{"host":"rpc.example.com","ports":[50051]}]'
   ```

   Una lista assente o vuota vieta tutte le destinazioni dei test. Wildcard, indirizzi IP
   e URL vengono rifiutati. Ogni destinazione di redirect, endpoint OAuth, risorsa del
   browser ed endpoint WebSocket/gRPC richiede una voce corrispondente.
5. Avviare dalla radice del repository:

   ```sh
   docker compose -p wfm-saas --env-file deployment/saas-network/.env -f deployment/saas-network/compose.yml up -d --build --wait
   ```

Il deployment crea i volumi PostgreSQL e Redis, applica le migrazioni con un ruolo
amministrativo e assegna i permessi al login separato `wfm_runtime`. Questo ha `BYPASSRLS`,
necessario ai bootstrap privilegiati dell'applicazione, ma non è superuser e non può creare
ruoli o database. Le query dei tenant passano a `app_user`, che non può aggirare RLS.
Registrare personalmente il primo account prima di esporre l'endpoint TLS.

## Controlli applicati

API e worker condividono namespace di rete distinti con piccoli container firewall.
Solo i firewall ricevono `NET_ADMIN`; applicazioni e proxy rinunciano a tutte le capability
e non possono cambiare le regole. L'uscita IPv4 e IPv6 è vietata per impostazione predefinita.
API e worker possono raggiungere soltanto le porte necessarie di PostgreSQL/Redis, il proxy
obbligatorio, il DNS Docker e i propri servizi locali; il worker raggiunge anche il relay API.

L'unica uscita esterna passa da Squid in un terzo namespace protetto. Il proxy accetta coppie
esatte host/porta e rifiuta loopback, reti private, link-local, metadata e indirizzi riservati,
anche quando un nome DNS li risolve. Il firewall del proxy vieta gli stessi indirizzi a
livello di pacchetto: risposte DNS cambiate o miste non aprono rotte private. La CI verifica
su reti Docker reali connessioni dirette, gateway dell'host, bypass e allowlist vuota.

Il firewall API partecipa anche a un bridge di ingresso dedicato, necessario perché Docker
pubblichi la porta su loopback. Il filtro in uscita continua a vietare nuove connessioni
esterne e permette soltanto le risposte alle richieste ricevute. Docker non pubblica porte
da un namespace collegato esclusivamente a reti interne.

`WFM_EGRESS_PROXY` è fissata nel Compose. La usano richieste HTTP, richieste OAuth/NTLM verso
i target, `fetch` Node, WebSocket e gRPC unary nativi, e avvii locali di Chromium/Firefox/WebKit.
Il bypass implicito del browser per localhost è disabilitato. Configurazioni proxy invalide
falliscono senza passare alla connessione diretta. Installazioni ordinarie e agenti dei
clienti mantengono il comportamento esistente quando la variabile non è impostata.

## Limiti e gestione

- L'allowlist vale **per tutta l'installazione**, è gestita dall'operatore e non rappresenta
  un'autorizzazione separata per tenant. CONNECT limita host e porta di destinazione; non
  ispeziona il contenuto cifrato né impone l'identità applicativa dentro il tunnel.
- Le porte necessarie dei servizi interni restano raggiungibili dai namespace applicativi.
  Autenticazione e isolamento tenant restano indispensabili. Non viene creato un namespace
  separato per ogni singolo test.
- Protocolli TCP diretti, come test database e SMTP, grid browser esterne e SDK senza
  supporto proxy falliscono. Per applicazioni private usare un
  [agente locale](../LOCAL_AGENT), con restrizioni di rete dedicate. Autorizzare un nome
  privato non concede una rotta privata.
- Il DNS passa dal resolver Docker; le query DNS non sono filtrate dall'allowlist HTTP.
  Questo profilo isola le destinazioni e non impedisce ogni possibile canale di esfiltrazione
  né sostituisce aggiornamenti di container e host.
- Gli artefatti usano volumi locali condivisi. Le integrazioni esterne richiedono trasporti
  compatibili con il proxy e destinazioni pubbliche autorizzate prima dell'abilitazione.
- Le reti sono `172.29.240.0/24` e `172.29.241.0/24`. In caso di conflitti aggiornare **sia**
  Compose **sia** `guard.sh`, mantenendo un'allocazione di rete dedicata.
- Dopo modifiche all'allowlist ricreare `egress`. Se si sostituisce un firewall namespace,
  ricreare anche i suoi container applicativi, altrimenti possono conservare il vecchio
  namespace. Aggiornare con runner svuotati e backup database verificato.

Per ripetere il collaudo temporaneo senza modificare l'installazione:

```sh
npm run test:network:unit
npm run build:network-probe
# Impostare WFM_SAAS_TRANSPORT_BUNDLE con il percorso assoluto di tmp/saas-transports.mjs
# e WFM_SAAS_NODE_MODULES con il percorso assoluto di node_modules.
npm run test:network
```

Il controllo crea e rimuove un progetto Docker con volumi propri. Con entrambe le variabili
di percorso impostate verifica anche i trasporti HTTP, WebSocket e gRPC di produzione e i
tre motori browser dal namespace protetto del worker.
`npm run test:network:production` compila e avvia anche le immagini API/worker reali con
segreti nuovi, verifica prima registrazione, privilegi database e worker sulla coda, poi
rimuove il proprio progetto temporaneo. Entrambi i controlli sono eseguiti in CI.
