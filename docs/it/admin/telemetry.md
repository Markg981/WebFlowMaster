# Metriche e tracing distribuito

WebFlowMaster espone metriche Prometheus ed esporta span OpenTelemetry tramite OTLP/HTTP JSON. Entrambe le integrazioni sono disabilitate per impostazione predefinita. I correlation ID restano nei log; i log strutturati includono anche `traceId` e `spanId` quando uno span è attivo.

## Attivare le metriche

Impostare `WFM_METRICS_ENABLED=true` e `WFM_METRICS_TOKEN` su API e worker. Senza token l'avvio fallisce. Il listener dedicato usa `127.0.0.1`, porta **9464** per API e **9465** per worker. `WFM_METRICS_HOST` e `WFM_METRICS_PORT` si configurano per processo. Solo `GET /metrics` autenticato è disponibile, senza sessione applicativa.

```bash
curl -H "Authorization: Bearer $WFM_METRICS_TOKEN" http://127.0.0.1:9464/metrics
curl -H "Authorization: Bearer $WFM_METRICS_TOKEN" http://127.0.0.1:9465/metrics
```

Con Compose usare `docker compose -f docker-compose.yml -f docker-compose.telemetry.yml up -d --build`. L'overlay trasmette la configurazione ad API e worker ed espone le porte metriche **solo sulla rete Compose**. Prometheus deve trovarsi sulla stessa rete o raggiungere esplicitamente i listener. L'overlay non installa un backend. Proteggere l'accesso di rete e usare TLS quando si attraversa una rete non fidata.

Configurazione Prometheus di esempio, montando il token nel file `/run/secrets/wfm_metrics_token`:

```yaml
scrape_configs:
  - job_name: wfm-api
    static_configs:
      - targets: ['api:9464']
    authorization:
      type: Bearer
      credentials_file: /run/secrets/wfm_metrics_token
  - job_name: wfm-worker
    static_configs:
      - targets: ['worker:9465']
    authorization:
      type: Bearer
      credentials_file: /run/secrets/wfm_metrics_token
```

Scoprire e interrogare **ogni replica worker separatamente**: un unico indirizzo bilanciato nasconderebbe le metriche delle altre repliche.

| Metrica                                                                  | Significato                                                                                                                                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wfm_http_duration_seconds`                                              | Durata HTTP per metodo, template di route e stato; il conteggio dell'istogramma permette di calcolare richieste ed errori. Le route sconosciute hanno una label fissa. |
| `wfm_job_wait_seconds`                                                   | Età del job all'inizio di un tentativo: comprende ritardi intenzionali, rinvii per quota e retry, oltre all'attesa dello scheduler.                                    |
| `wfm_job_duration_seconds`                                               | Durata del tentativo di elaborazione sulle code dei piani e dei browser.                                                                                               |
| `wfm_jobs_total`                                                         | Tentativi con esito `success`, `error` o `deferred`; un rinvio non indica un run completato.                                                                           |
| `wfm_worker_active_jobs`, `wfm_worker_capacity`                          | Tentativi in corso e concorrenza configurata per coda/processo. Durante il drain la capacità indica ancora quella configurata.                                         |
| `wfm_queue_jobs`                                                         | Profondità globale per coda/stato, esposta dai worker. Un errore Redis restituisce HTTP 503 senza presentare un successo con valori obsoleti.                          |
| `wfm_agent_connected`, `wfm_agent_capacity`, `wfm_agent_active_sessions` | Aggregati locali del relay: agenti connessi, slot degli agenti non in drain e sessioni attive. Sommare sulle repliche API.                                             |
| Altre metriche di processo `wfm_*`                                       | CPU, memoria, ritardo dell'event loop e garbage collection Node.                                                                                                       |

La profondità delle code è duplicata sulle repliche worker: usare `max by (queue, state) (wfm_queue_jobs)`, **non la somma**. Utilizzo worker: `sum by (queue) (wfm_worker_active_jobs) / sum by (queue) (wfm_worker_capacity)`. Attesa p95: `histogram_quantile(0.95, sum by (le, queue) (rate(wfm_job_wait_seconds_bucket[5m])))`. I contatori misurano i tentativi worker e gli errori infrastrutturali; un'asserzione fallita restituita come normale risultato del test resta un job elaborato con successo.

## Allarmi

`observability/prometheus-alerts.yml` è un gruppo di regole Prometheus costruito solo sulle metriche
sopra e su `up`, la serie che Prometheus mantiene per ogni target. Copre un arretrato che cresce
(`wfm_queue_jobs`, stati waiting e prioritized, massimo fra le repliche), tentativi worker terminati
in errore (`wfm_jobs_total{outcome="error"}`), un target worker che smette di rispondere
(`up{job="wfm-worker"}`, la condizione che fa terminare i suoi run come `worker_lost`), nessun worker
raggiungibile, la quota di risposte 5xx (`wfm_http_duration_seconds_count`) e il target API non
raggiungibile. Un run che termina `worker_lost` è uno stato nel database, non un contatore, e
`GET /readyz` non è una metrica: il file lo spiega e mostra la regola da aggiungere con il blackbox
exporter per la readiness. I nomi dei job sono `wfm-api` e `wfm-worker`, come nella configurazione
di scrape sopra; se i vostri sono diversi, rinominateli nel file.

Caricatelo in Prometheus con `rule_files` e instradate gli allarmi al vostro Alertmanager:

```yaml
rule_files:
  - /etc/prometheus/wfm-alerts.yml # montare lì observability/prometheus-alerts.yml
alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']
```

`promtool check rules observability/prometheus-alerts.yml` valida il file prima di ricaricarlo. Le
soglie (20 job in attesa, 5% di 5xx, cinque minuti senza scrape) e le label `severity` sono punti di
partenza, non valori misurati: impostatele in base alla dimensione dei piani, al numero di worker e al
traffico, e rivedetele dopo le prime settimane di allarmi. `docker-compose.telemetry.yml` espone le
porte metriche sulla rete Compose e non installa Prometheus; il file è per quello che gestite voi.

## Log in Loki e Grafana

`docker-compose.observability.yml` avvia Loki e una Grafana con Loki già configurato come sorgente
dati (`observability/`), per i log che i processi inviano quando `LOKI_URL` è impostata
([Configurazione](./configuration)). Richiede `GRAFANA_ADMIN_PASSWORD` in `.env` e senza non parte,
come fa `docker-compose.yml` per i suoi segreti; l'utente Grafana è `admin`. Entrambe le immagini
sono fissate: Grafana 11.6 e Loki 2.9. Loki resta sulla 2.9 perché `observability/loki-config.yml`
attiva la retention nel compactor, che Loki 3.x rifiuta senza un `delete_request_store`; passare
alla 3.x significa modificare quel file nello stesso passaggio, dopo le note di aggiornamento della
3.0. Cambiate una versione deliberatamente, con le note di rilascio della versione scelta.

## Attivare il tracing

Configurare API, ogni worker e gli agenti locali aggiornati:

```dotenv
WFM_TRACING_ENABLED=true
WFM_TRACE_SAMPLE_RATIO=0.1
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces
```

Usare un collector esistente con receiver OTLP HTTP: il formato dell'exporter è **JSON**. `OTEL_EXPORTER_OTLP_TRACES_HEADERS` configura l'autenticazione del collector; `OTEL_SERVICE_NAME` può sostituire i nomi predefiniti `webflowmaster-api`, `webflowmaster-worker` e `webflowmaster-agent`. Endpoint e autenticazione seguono la [configurazione OpenTelemetry](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/). Il sampling segue il parent, con rapporto dei trace radice tra 0 e 1. Le decisioni di sampling ricevute vengono preservate. Per il collaudo usare `1`, quindi impostare un valore operativo.

La catena è richiesta HTTP → invio alla coda → tentativo worker → operazione client agente → sessione agente. `traceparent` e `tracestate` W3C viaggiano nei job e nei ticket firmati del relay. I job schedulati senza richiesta iniziano un trace nuovo; gli shard ereditano quello del worker che li invia. Lo span di connessione browser misura l'acquisizione; quello della sessione agente termina al rilascio. Gli span client API/BDD includono attesa slot ed esecuzione. La sessione BDD copre l'esecuzione senza strumentare gli step cliente nel processo figlio.

Attraversano i confini solo i campi del trace: niente baggage, payload, URL del sistema testato, messaggi di eccezione o label utente/tenant. Gli agenti precedenti ignorano il campo opzionale e continuano a funzionare, ma non esportano span locali. Ricostruire/reinstallare l'agente aggiornato con le dipendenze indicate in [Agenti locali](../integrations/local-agents.md), configurando il suo collector separatamente. La telemetria non apre listener in ingresso sull'agente.

## Verifica operativa

Il catalogo Collaudo locale include TEL-01…TEL-12 (protocollo 25) per metriche,
tracing, riservatezza, aggregazione delle repliche e recupero dai guasti. Selezionare
**Catalogo attuale** per consultare le procedure e creare un nuovo ciclo per registrare gli esiti manuali.

1. Attivare metriche e tracing con sampling `1`, ricostruire API, worker e agente e configurare un collector raggiungibile.
2. Verificare HTTP 401 senza token e 200 con token; il worker deve esporre entrambe le code e i gauge di concorrenza.
3. Avviare un piano e una preview, anche tramite agente locale. Controllare profondità coda, slot attivi e istogrammi; provocare un errore infrastrutturale e verificare il contatore.
4. Nel backend verificare che gli span API, producer, worker e agente condividano il trace ID e cercarlo nei log strutturati. I rinvii devono contare come `deferred`; i job attivi devono tornare a zero.

I test automatici coprono privacy delle route, autenticazione listener, contatori job, propagazione W3C, invio OTLP e regressioni del relay. Deployment del backend e comportamento sotto carico in produzione richiedono la verifica operativa sopra.
