# Verifiche streaming, mTLS, conversazioni e SOAP — 4 ottobre 2026

Branch: `codex/api-protocol-streaming-mtls`, da `main` dopo il merge #292 (`4814a60`).
Migrazione: `0078_api_protocol_config`; agente distribuito: **1.2.0**.

Le verifiche usano servizi gRPC/WebSocket reali e relay autenticati locali, PostgreSQL 16,
Redis separato e bundle di produzione. Non sono esiti del ciclo manuale `wfm-collaudo`.
Il catalogo passa a versione **22**, aggiungendo **API-37–48** (472 casi totali) senza
riscrivere casi o risultati precedenti. I nuovi casi manuali rimangono da eseguire.

| Verifica | Evidenza automatica |
| --- | --- |
| Unary, server/client/bidi, trailer, backpressure, annullamento, limiti e deadline senza false riuscite | `server/api-network-streaming.test.ts`, `server/api-protocols.test.ts` |
| mTLS verificato, PEM/chiave cifrata, trust/identity/hostname negativi | `server/grpc-tls.test.ts`, fixture sintetiche documentate |
| Streaming mTLS e conversazioni da agenti, upgrade richiesto ai precedenti, payload serializzati oltre 16 MiB | `server/agents/agent-protocol.test.ts` |
| Selezione e conversazione avanzata attraverso due relay | `server/agents/relay-cluster.test.ts` |
| Configurazione, riferimenti a segreti, catture riservate e redazione errori | `server/api-protocol-integration.test.ts`, `server/api-protocol-config.test.ts` |
| Transcript persistito oscurato, con estrazioni vive per le richieste successive | `server/api-protocol-report.test.ts` |
| Export/import tra organizzazioni, snapshot, pubblicazione immutabile e ripristino | `server/test-export.test.ts`, `server/typed-test-publishing.test.ts` |
| Isolamento reale PostgreSQL dei riferimenti TLS | `server/tests/typed-version-isolation.test.ts`, incluso in `npm run test:rls` |
| WSDL 1.1/2.0, import/include XSD, namespace, endpoint, policy e rifiuti XML/path/limiti | `server/wsdl-import.test.ts`, `server/api-import.test.ts` |
| Editor TLS/conversazioni, persistenza, export, identità e anteprime obsolete | test client protocollo e import |

## Installazione reale e distribuzione

- **9/9 percorsi Playwright** completati sulla build di produzione con DB dedicato
  `wfm_ci_e2e`: il nuovo percorso gRPC salva/rilegge configurazione, riceve lo stream,
  pubblica la revisione e modifica il draft con un limite incompatibile; il piano sul
  worker esegue correttamente la configurazione pubblicata e persiste il transcript.
  Seguono challenge WebSocket con cattura/invio dipendente e import WSDL/XSD multi-file.
- **483/483 test client**, **13/13 test dell’app di Collaudo**; typecheck e lint del
  progetto verificati. Il lint locale esclude `tmp/**`, contenente file utente preesistenti;
  nessun errore nei sorgenti, 10 warning già presenti.
- **108/108 test RLS** su PostgreSQL reale, con applicazione non superuser e ruolo
  tenant senza bypass; nessun database/volume del Collaudo esistente eliminato.
- Build di tutti i deliverable applicativi e documentazione EN/IT completate; traduzioni
  UI EN/IT/FR/DE aggiornate. Immagine standalone agente costruita e caricata con tutte
  le dipendenze, incluso Zod.
- **117 verifiche PASS** nel deployment con restrizioni di rete: proxy obbligatorio,
  bypass bloccati, HTTP/WebSocket/gRPC e tre browser. Verifica separata delle immagini
  API/worker di produzione, registrazione tenant, ruoli DB e worker di coda completata.

## Correzioni emerse durante revisione e verifiche

Ogni regressione è stata riprodotta prima della correzione: deadline gRPC locale
accettata come risposta riuscita; variabile d’ambiente `capture.*` che sostituiva una
cattura futura; URI SOAP 1.1 WSDL 2 rifiutato; riferimenti a policy/moduli senza avviso;
URL TLS parametrizzato bloccato nell’editor; relay troppo piccolo per transcript
validi; passphrase multibyte oltre il limite; amplificazione delle catture serializzate.
La qualificazione degli elementi SOAP ora segue lo schema anche nei documenti singoli:
campi locali senza `elementFormDefault="qualified"` restano non qualificati.

I selettori dei nuovi E2E e il limite auth della sola installazione isolata sono stati
corretti dopo il primo run. Un E2E dashboard preesistente ha fallito una volta per un
404 delle preferenze subito dopo la creazione; la riesecuzione completa è passata,
senza modificare il prodotto dashboard. La suite server completa è verificata anche
dalla CI sul commit della PR: consultare i job della PR per l’esito finale autorevole.
Nel run locale completo sono passati 2158 test, con 4 saltati e un timeout del test
preesistente di registrazione browser sotto carico concorrente; la suite di registrazione
rieseguita isolatamente è passata **8/8**. Il controllo aggiuntivo sulla redazione di
credenziali dentro catture JSON è passato **2/2** dopo aver riprodotto la perdita nel report.

La definizione storica AGT-10 resta conservata. Sul nuovo codice un deadline **locale**
è errore di esecuzione; gli stati di errore **remoti** restano valutabili dalle asserzioni.
Usare API-40 per il nuovo ciclo. API-44/45 richiedono un servizio mTLS e i segreti indicati;
le fixture private gRPC/WS del profilo `protocolli` sono state estese per gli altri casi.
