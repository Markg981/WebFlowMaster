# Test di carico ed endurance della piattaforma

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

## Scenari automatici di resilienza

```sh
npm run test:resilience
npm run load:resilience -- --cycles 3 --recovery-timeout 180 --observation-seconds 40
```

Servono Node.js 22.19+ e Docker Compose con risorse per costruire le immagini API/worker di produzione e avviare PostgreSQL, Redis e due agenti Chromium reali. Il comando crea uno stack locale con nome casuale e due organizzazioni. Non accetta progetti, URL o credenziali esistenti; rimuove soltanto i propri container e volumi. I report restano in `resilience-artifacts/<id>/`. Credenziali generate e artefatti sono esclusi da Git e dai contesti di build Docker.

La baseline riusa il runner endurance per letture API pubbliche e burst concorrenti dei piani. Ogni ciclo verifica scheduler BullMQ con scadenze una tantum durante lo stop del worker, run accodati, SIGKILL del worker durante una sessione browser dell’agente osservata e stop/start di Redis con coda persistita tramite AOF. Gli agenti vengono riavviati tra i run e devono riconnettersi e completare nuovo lavoro. Il restart Redis conserva i dati: non simula perdita della persistenza. La terminazione dell’agente durante un run attivo resta fuori da questo scenario.

Ogni richiesta accettata viene ripetuta con la stessa chiave di idempotenza e deve restituire lo stesso ID. L’inventario paginato viene riconciliato con tutti gli ID accettati e un solo run per schedule. ID mancanti o extra, duplicati, run incompleti o falliti, risultati dei test mancanti/duplicati/falliti ed evidenze screenshot vuote o non scaricabili fanno fallire la prova. Gli artefatti finali includono dimensioni e checksum SHA-256. Una finestra di almeno 40 secondi dopo il recupero intercetta le riconsegne dei job stalled; l’evidenza è limitata a questa finestra.

`resilience.json` registra revisione, checkout modificato, immagini, parametri, durate delle fasi, ID accettati/schedulati/osservati, artefatti, violazioni ed errori di pulizia. `operations.log` e `containers.log` aiutano la diagnosi. Exit `0` indica scenari e pulizia riusciti; qualsiasi errore, prerequisito assente, timeout o errore di pulizia produce exit `1` e report fallito. Default: un ciclo, recupero entro 180 secondi, osservazione di 40 secondi. Massimo 100 cicli; la durata totale include build, timeout per scenario e osservazioni. Una prova sintetica locale riuscita non dimostra RTO produttivi, resilienza S3/dispositivi/grid o accettazione manuale. Procedura: `collaudo/automatic-resilience.md`.
