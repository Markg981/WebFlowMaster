# Test di carico ed endurance della piattaforma

Per il Collaudo locale, `npm run collaudo:carico` prepara due tenant e rimuove i propri dati di prova.
Il runner usa il Node corrente con il loader `tsx`, anche su Windows, senza invocare una shell
con le chiavi API. Conservare il JSON prima di una nuova esecuzione. Per misurare la capacità
senza il limite API, disabilitarlo solo nello stack di prova e ripristinare il valore originale
al termine; annotare questa configurazione insieme a durata, concorrenza e risorse.

Servono chiavi API con scope `plans:read`, `runs:read` e `runs:write`, e un piano esistente economico per organizzazione. I run rimangono nello storico del piano e utilizzano i runner dell'installazione.

```sh
npx tsx scripts/wfm-load.ts --url https://wfm.example.com \
  --target <chiave-org-a>:<piano-a> --target <chiave-org-b>:<piano-b> \
  --readers 10 --runs 10 --max-concurrent 2 \
  --soak-seconds 3600 --interval-seconds 30 \
  --run-timeout 600 --request-timeout 30 --json endurance.json
```

Senza `--soak-seconds` viene eseguito il test esistente: fase di lettura e singolo burst. Con una durata positiva, ogni ciclo avvia contemporaneamente un burst su tutti i target mentre i reader elencano continuamente piani e run. Il ciclo successivo attende la conclusione del precedente e l'intervallo minimo tra gli avvii. I cicli non si sovrappongono. L'ultimo burst accettato viene seguito fino alla conclusione o a `--run-timeout`: la durata totale può superare quella del soak. Le letture terminano alla scadenza del soak; le richieste già avviate possono terminare entro il proprio timeout HTTP.

Ogni ciclo emette metriche JSON ed è incluso nell'array `cycles` del report: avvio, durata, statistiche delle letture, statistiche dei run per target e violazioni. Le letture al livello principale coprono tutto il soak; i run al livello principale descrivono l'ultimo ciclo. I contatori includono ogni richiesta. I percentili di latenza usano un campione uniforme di massimo 10.000 richieste per ciclo e per l'intero soak (`latencySampleSize`), quindi sono stime oltre tale numero. La memoria dei campioni resta limitata; riepiloghi dei cicli e ID accettati sono conservati per report e verifica dei duplicati.

Ogni esecuzione/ciclo usa chiavi di idempotenza distinte. Gli ID accettati sono interrogati singolarmente: la lista degli ultimi 100 run di un piano occupato non può nasconderli. ID restituiti duplicati, stati finali di errore, ID mai recuperati, run incompleti, errori di avvio e soglie superate fanno fallire il test. Un ID mancante indica che non è mai stato recuperato correttamente entro la scadenza: verificare disponibilità API/rete e possibili run persi. Le letture con risposta `429` sono conteggiate separatamente come limitazione delle richieste. Negli avvii dei run, soltanto `queue_quota_exceeded` (o il codice storico `queue_full`) indica un rifiuto atteso della coda; `rate_limited` e risposte `429` sconosciute sono errori di avvio. Un carico positivo senza alcun run accettato fa fallire quel target/ciclo, anche se tutti i rifiuti sono dovuti alla coda piena. `--max-concurrent` misura soltanto i run di questo test: usare organizzazioni altrimenti inattive per verificare il limite configurato.

Reader e concorrenza devono essere interi positivi; i run devono essere un intero tra 0 e 100 per target/ciclo. Poll, intervallo, timeout HTTP e timeout dei run devono essere positivi. La soglia del tasso di errore delle letture è una frazione tra 0 e 1. La scadenza HTTP copre intestazioni e corpo della risposta e interrompe le richieste bloccate.

Codici di uscita: `0` soglie rispettate, `1` violazioni, `2` errore di strumento/configurazione. `npx vitest run scripts/wfm-load.test.ts` verifica il comportamento con un orologio virtuale. Le simulazioni non dimostrano endurance reale della piattaforma. Prima di dichiararla verificata, conservare report di un'esecuzione reale, ambiente/versione, limiti delle organizzazioni e log di runner/worker.

## Dimensionare un worker di carico

I [test di carico](../guide/load-tests) che gli utenti avviano dalla pagina **Test di carico** non
sono lo script qui sopra: ogni esecuzione è un job `load-run` sulla coda `load-queue`, e un worker
lo esegue con il motore di `server/api-tests/load-runner.ts`. Il processo web si limita a metterla in coda
(`queued`); il worker che la prende la segna `running` con il proprio nome, scrive il riepilogo
ogni due secondi e batte ogni `WORK_ITEM_HEARTBEAT_MS`; un'esecuzione il cui worker tace per
`STALE_CLAIM_MS` termina come `worker_lost`. Un riavvio del web non cambia nulla per
un'esecuzione; un riavvio del worker con un `WORKER_SHUTDOWN_GRACE_MS` sufficiente la lascia
finire prima.

Un'esecuzione di carico è traffico HTTP, non un browser: un worker che manda 200 utenti virtuali
lungo uno scenario di poche richieste usa parte di un core e qualche centinaio di megabyte, molto
meno di un run di un piano. A limitarlo sono la rete fra il worker e il sistema sotto test, e la
capacità del sistema stesso — un worker che satura il proprio collegamento misura il collegamento.
Tenetelo sulla stessa rete del sistema sotto test, o almeno su una con latenza nota e stabile, e
non sull'host che serve il processo web.

- `LOAD_WORKER_CONCURRENCY` (default `1`) è quante esecuzioni di carico un worker esegue insieme.
  Uno è il valore onesto: due esecuzioni sullo stesso worker si dividono CPU e collegamento e si
  misurano a vicenda. `0` fa sì che un worker non ne prenda nessuna, per i worker riservati ai
  piani.
- `LOAD_MAX_VIRTUAL_USERS` e `LOAD_MAX_DURATION_S` (default `200` e `3600`) limitano ciò che
  un'esecuzione può chiedere; il processo web rifiuta un test o un'esecuzione oltre il limite,
  indicandolo, e il worker limita l'esecuzione al proprio valore. Alzateli quando i worker e la
  rete hanno dimostrato di reggerli. I campi dell'editor si fermano ai default di fabbrica: valori
  più alti passano dall'API.
- `LOAD_MAX_RUNS_PER_ORGANIZATION` (default `1`) è quante esecuzioni di un'organizzazione possono
  essere in coda o in corso insieme. Più organizzazioni hanno ciascuna le proprie.

Un'esecuzione viene eseguita da un solo worker, per intero: i suoi utenti virtuali non vengono
divisi fra più worker. Oltre quanto un worker riesce a inviare, la strada è più worker che
eseguono più esecuzioni — di più organizzazioni, o di una sola con il limite alzato — ciascuna
che misura il proprio scenario. Ogni worker ascolta la coda di carico, quindi scalare i worker
scala le esecuzioni di carico insieme ai run dei piani:

```sh
docker compose up -d --scale worker=3
```

Con `LOAD_WORKER_CONCURRENCY=1` quello stack esegue tre esecuzioni di carico insieme, una per
worker, e una quarta aspetta `queued` finché una non finisce. La profondità della coda e la
capacità dei worker sono sull'endpoint delle metriche del worker come `load-queue` (vedere
[Telemetria](./telemetry)).

## Test a volume

`npm run volume` risponde a una domanda diversa dal test di carico: come si comportano le tabelle di log e risultati dopo un anno di esecuzioni. Genera mesi di run, risultati e righe di log direttamente in PostgreSQL, misura le query più usate con `EXPLAIN (ANALYZE, BUFFERS)` come ruolo applicativo sotto row-level security e verifica quanto costa cancellare un mese.

```sh
npm run volume -- --database-url postgres://postgres:PASSWORD@HOST:PORTA/wfm_volume
```

Sicurezza: lo strumento scrive milioni di righe, quindi richiede un database di prova dedicato, di proprietà di un superutente o del proprietario dello schema, con le migrazioni applicate. Non legge mai `DATABASE_URL`, perché indica il database dell'installazione. Rifiuta un database che contiene organizzazioni non create da lui (chiamate `wfm-volume-N`). Non puntarlo mai alla produzione.

Opzioni (default tra parentesi): `--months` [12], `--runs-per-day` [300], `--orgs`, `--plans`, `--tests`, `--results-per-run` [20], `--logs-per-run` [40], `--repeat` (campioni per query, si riporta la mediana), `--max-ms` [250] e `--seq-scan-rows` [50000] (soglie), `--json PERCORSO` (file del report, default `.local/volume/`), `--measure-only` (salta la generazione), `--reset` (elimina i dati generati in precedenza), `--no-delete-probe`.

Fasi: generazione, ANALYZE, misura, prova di cancellazione (un mese di run con la cascata su risultati e log, in una transazione che viene annullata), report. Codici di uscita: `0` entro le soglie, `1` una query supera `--max-ms` o legge sequenzialmente più di `--seq-scan-rows` righe di una tabella dei run, `2` errore di preparazione o database rifiutato. Per i test unitari: `npx vitest run scripts/wfm-volume.test.ts`.

### Risultati misurati

12 mesi, 300 run al giorno su 3 organizzazioni: 103.800 run, 2,08 milioni di risultati, 4,15 milioni di righe di log (circa 1,2 GB di tabelle, 0,6 GB di indici), PostgreSQL 16, mediana dei campioni.

| Query                                                           |                          Prima |   Dopo |
| --------------------------------------------------------------- | -----------------------------: | -----: |
| Console dei log di un run (recente o di 11 mesi fa)             |                         0,1 ms | 0,1 ms |
| Risultati di un run                                             |                         0,1 ms | 0,1 ms |
| Pulizia della retention (indice parziale della migrazione 0026) |                         0,0 ms | 0,0 ms |
| Storico dei run, prima pagina                                   |                          39 ms | 0,1 ms |
| Dashboard, totali a 30 giorni                                   |                         747 ms |  94 ms |
| Dashboard, ultimi run                                           | 660 ms (scansione sequenziale) | 1,5 ms |
| Risultati di un test, ultimi 30 giorni                          |                          19 ms |  24 ms |

La dashboard e lo storico ordinano per `coalesce(started_at, queued_at)` dentro una organizzazione; senza un indice su quell'espressione il database leggeva e ordinava tutti i run dell'organizzazione. La migrazione 0088 aggiunge `test_plan_executions_org_run_time_idx (organization_id, coalesce(started_at, queued_at) DESC)`. Le ricerche su log e risultati erano già servite dai loro indici.

### Partizionamento per mese

Cancellare un mese (3.000 run con risultati e log) richiede circa 1 s a questa dimensione, quindi eliminare una partizione mensile oggi non darebbe un vantaggio. Il partizionamento va riconsiderato solo ben oltre, ad esempio decine di milioni di righe al mese, o quando esisterà una retention sulle righe. Oggi la retention elimina solo gli artefatti: `execution_logs` e `report_test_case_results` non hanno retention sulle righe e crescono in modo lineare con il numero di run.

## Scenari automatici di resilienza

```sh
npm run test:resilience
npm run load:resilience -- --cycles 3 --recovery-timeout 180 --observation-seconds 40
```

Servono Node.js 22.19+ e Docker Compose con risorse per costruire le immagini API/worker di produzione e avviare PostgreSQL, Redis e due agenti Chromium reali. Il comando crea uno stack locale con nome casuale e due organizzazioni. Non accetta progetti, URL o credenziali esistenti; rimuove soltanto i propri container e volumi. I report restano in `.local/resilience/<id>/`. Credenziali generate e artefatti sono esclusi da Git e dai contesti di build Docker.

La baseline riusa il runner endurance per letture API pubbliche e burst concorrenti dei piani. Ogni ciclo verifica scheduler BullMQ con scadenze una tantum durante lo stop del worker, run accodati, restart controllato SIGTERM del worker durante una sessione browser dell’agente osservata e stop/start di Redis con coda persistita tramite AOF. Gli agenti vengono riavviati tra i run e devono riconnettersi e completare nuovo lavoro. Il restart Redis conserva i dati: non simula perdita della persistenza. La terminazione dell’agente durante un run attivo resta fuori da questo scenario.

Eseguire separatamente `npm run load:resilience -- --worker-restart crash` per verificare il SIGKILL. Soltanto il run osservato attivo prima del kill deve terminare `error` con `failureCode: worker_lost`; gli altri devono completarsi. Il run interrotto deve restare presente con lo stesso ID, senza replay automatico. È rilevamento del crash, non prosecuzione riuscita: il report espone `scenarioPurpose`, `expectedWorkerLostIds`, `crashDetectionPassed` e `successfulRecovery: false`. Il default `--worker-restart graceful` non ammette run falliti e deve produrre `successfulRecovery: true`. La diagnosi crash può terminare exit 0 solo rispettando tutte queste condizioni; altri errori, ID mancanti e duplicati restano violazioni. Lo shutdown del worker attende i job attivi entro il periodo di grazia esistente di 30 secondi; per job più lunghi serve prima il drain.

Ogni richiesta accettata viene ripetuta con la stessa chiave di idempotenza e deve restituire lo stesso ID. L’inventario paginato viene riconciliato con tutti gli ID accettati e un solo run per schedule. ID mancanti o extra, duplicati, run incompleti o falliti, risultati dei test mancanti/duplicati/falliti ed evidenze screenshot vuote o non scaricabili fanno fallire la prova. Gli artefatti finali includono dimensioni e checksum SHA-256. Una finestra di almeno 40 secondi dopo il recupero intercetta le riconsegne dei job stalled; l’evidenza è limitata a questa finestra.

`resilience.json` registra revisione, checkout modificato, immagini, parametri, durate delle fasi, ID accettati/schedulati/osservati, artefatti, violazioni ed errori di pulizia. `operations.log` e `containers.log` aiutano la diagnosi. Exit `0` indica scenari e pulizia riusciti; qualsiasi errore, prerequisito assente, timeout o errore di pulizia produce exit `1` e report fallito. Default: un ciclo, recupero entro 180 secondi, osservazione di 40 secondi. Massimo 100 cicli; la durata totale include build, timeout per scenario e osservazioni. Una prova sintetica locale riuscita non dimostra RTO produttivi, resilienza S3/dispositivi/grid o accettazione manuale. Procedura: `collaudo/automatic-resilience.md`.

## Crescita a dieci volte {#benchmark}

```sh
npm run test:benchmark
WFM_BENCHMARK_CONFIG=bench.json npm run benchmark -- --profile baseline
WFM_BENCHMARK_CONFIG=bench.json npm run benchmark -- --profile tenfold-tests     # N → 10N piani e test
WFM_BENCHMARK_CONFIG=bench.json npm run benchmark -- --profile tenfold-readers   # U → 10U client API
WFM_BENCHMARK_CONFIG=bench.json npm run benchmark -- --profile tenfold-runs      # R → 10R avvii e storico delle esecuzioni
```

`scripts/wfm-benchmark.mjs` non è un secondo motore di carico: chiama `main(argv)` di `wfm-load` e `wfm-volume` nel proprio processo, legge le metriche dei worker prima, durante e dopo, dà un prezzo a quanto è stato usato e restituisce un verdetto. Ogni profilo moltiplica per dieci **un solo** asse; `tenfold-combined` gira solo se la configurazione indica una `combination` concordata (`axes`, `agreedBy`). Eseguire prima la baseline: i profili successivi si confrontano con l'ultima baseline dello stesso ambiente.

**Dove gira.** Solo su un'installazione dedicata e su un database di prova dedicato. Il file indicato da `WFM_BENCHMARK_CONFIG` viene rifiutato se manca, se `environment.production` non è esplicitamente `false` o il nome contiene _prod_, se `target.url` è l'installazione in uso (`WFM_URL`, `WEBFLOW_PUBLIC_URL`) o se il DSN di prova coincide con il `DATABASE_URL` dell'applicazione. Non esiste un target predefinito.

**Credenziali.** Il file nomina solo variabili: `keyEnv`, `tokenEnv` e `databaseUrlEnv` devono essere `WFM_BENCHMARK_*`. Una chiave, un token, una password o un DSN scritti nel file vengono rifiutati. Poiché i due strumenti girano nello stesso processo, chiavi e DSN non compaiono mai negli argomenti dei processi del sistema operativo; quanto viene stampato e il report sono oscurati.

La configurazione registra su cosa sono stati misurati i numeri e rispetto a cosa vengono giudicati:

| Sezione       | Contenuto                                                                                                                                                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment` | `name`, `production: false`, `version`, `browser`, `hardware`, `concurrency` (`WORKER_CONCURRENCY`, `BROWSER_TASK_CONCURRENCY`, `ORG_MAX_CONCURRENT_RUNS`), `steps`, `artifacts`, `mix` `{ web, api }`                                                                                                      |
| `target`      | `url`, `targets` `[{ keyEnv, planId }]`, `maxConcurrent`, `metrics` `[{ name, url, tokenEnv }]` — una voce per replica del worker                                                                                                                                                                           |
| `volume`      | `databaseUrlEnv`: il database di prova che `wfm-volume` azzera                                                                                                                                                                                                                                              |
| `baseline`    | `plans`, `tests`, `readers`, `runs`, `readSeconds`, `months`, `runsPerDay`, `orgs` — N, U e R                                                                                                                                                                                                               |
| `slo`         | `approvedBy`, `approvedAt`, `maxP95Ms`, `maxErrorRate`, `maxQueueWaitP95Ms`, `maxQueryMs`, `maxSeqScanRows`; facoltativi `maxRunP95Ms`, `max429Rate`, `maxBrowserResidentBytes`, `maxCostPerSuccessfulRun`                                                                                                  |
| `cost`        | `basis` (`tariff`, oppure `on-prem` con `amortisation`), `currency`, `rateSource`, `rates` (`infrastructurePerHour`, `storagePerGbMonth`, `trafficPerGb`, `aiPerRun` se `ai.used`), `retentionDays`, `trafficBytesPerArtifactByte`, `monthlyRuns`, `peakFactor`, `assumptions`, `exclusions`, `maintenance` |

**Report.** `.local/benchmark/<profilo>-<ora>.json` (oppure `output.dir`), accanto ai grezzi `load.json` e `volume.json`. `measured` contiene solo misure: p50/p95/p99 delle API, errori e 429; esecuzioni ammesse, rifiutate, completate, fallite, attesa in coda e durata p50/p95, tempo al primo fallimento ed esecuzioni completate all'ora; picco di memoria e CPU del worker e dei browser che ha avviato; byte di artifact per tentativo; byte di database per esecuzione e le sonde `EXPLAIN (ANALYZE, BUFFERS)`. `cost` contiene le stime: `usage`, `rates`, `currency`, `rateSource`, `assumptions`, `exclusions`, `costPerRun`, `costPerSuccessfulRun`, `monthlyCostBaseline`, `monthlyCost10x`. Hanno un costo anche i tentativi falliti e la capacità predisposta per tutta la finestra: i retry non sono mai gratuiti. Una tariffa non fornita è elencata in `cost.missing`, i totali restano `null` — mai zero — e `cost.gate` resta `unvalidated`. Il tempo umano di manutenzione è riportato a parte, in `cost.maintenance`, dal pilota. `verdict` elenca ogni soglia superata; `limits` dice se questa scala è sostenibile; `comparison` divide le cifre principali per quelle della baseline.

**Codici di uscita.** `0` entro gli SLO approvati, `1` una soglia è stata superata (il profilo è fallito; il report riporta comunque tutti i numeri), `2` rifiutato o uno strumento non è potuto partire.

**Leggere la saturazione.** La pressione deve finire in una coda esplicita (`wfm_queue_jobs{state="waiting"}`, attesa in coda) o in un rifiuto (HTTP 429), mai in un crash, in risultati persi o in una violazione di quota: un cambio dell'ora di avvio di un processo durante un profilo è una violazione (probabile memoria esaurita), e le esecuzioni `missing` fanno fallire `wfm-load`. `WORKER_CONCURRENCY` e `BROWSER_TASK_CONCURRENCY` valgono **per processo worker**; `ORG_MAX_CONCURRENT_RUNS` per organizzazione. Aggiungere un budget globale di sessioni browser solo se i numeri mostrano che i limiti per processo non bastano. Prima di cambiare un indice o una query, misurarli con `wfm-volume` (`EXPLAIN (ANALYZE, BUFFERS)`).

Un risultato è una misura su quell'ambiente con quelle ipotesi: non promette dieci volte il throughput né risparmi altrove.
