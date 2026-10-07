# Prove automatiche di resilienza — OPS-32…OPS-35

Eseguire da un checkout aggiornato con Node.js 22.19+ e Docker Compose. Il comando costruisce API/worker di produzione e crea PostgreSQL, Redis AOF, due organizzazioni e due agenti Chromium in uno stack sacrificabile `wfm-resilience-<id>`. Non usa lo stack di Collaudo esistente.

```sh
npm run test:resilience
npm run load:resilience -- --cycles 3 --recovery-timeout 180 --observation-seconds 40
```

Il default `--worker-restart graceful` riavvia con SIGTERM durante lavoro osservato attivo e richiede tutti i run completati. Per la diagnosi separata: `npm run load:resilience -- --worker-restart crash`. In questa modalità soltanto il run identificato prima del SIGKILL deve terminare `error` con codice `worker_lost`, mantenendo ID e risultati parziali senza replay; tutti gli altri run devono completarsi. `successfulRecovery` resta falso anche quando la diagnosi passa. Un exit 0 della diagnosi non certifica la prosecuzione del run interrotto. La grazia esistente del worker è 30 secondi: per job più lunghi usare il drain prima del restart.

Conservare `resilience-artifacts/<id>/resilience.json`, `operations.log` e `containers.log`, commit, flag dirty, immagini e risorse macchina. Non archiviare credenziali o il compose temporaneo. L’exit deve essere 0, con tutte le fasi riuscite e nessuna violazione né errore di pulizia. Un report con timeout, run falliti o persi non è prova di recupero.

| Caso | Verifica |
| --- | --- |
| OPS-32 | Due tenant, agenti reali e baseline API; scheduler una tantum scaduto durante indisponibilità del worker: esattamente un run completo per occorrenza. |
| OPS-33 | Replay della richiesta accettata con medesima chiave; restart SIGTERM del worker durante sessione agente osservata; tutti gli ID presenti e completati dopo recupero. |
| OPS-34 | Redis fermato con lavoro accodato e schedule pendenti; restart con AOF; nessun ID mancante/extra dopo la finestra di riconsegna. |
| OPS-35 | Restart agenti tra run, riconnessione e nuove esecuzioni; screenshot non vuoti e scaricabili, checksum nei report anche a fine prova. |

Ogni piano sintetico contiene un solo test browser: il runner richiede esattamente un risultato riuscito per run. L’inventario è paginato. Osservazione minima 40 secondi; i duplicati oltre la finestra richiedono una prova più lunga. Il tempo di recupero comprende il restart e la conclusione del lavoro, non build/setup. Sono esclusi perdita dei dati Redis, agenti uccisi durante sessioni attive, S3, griglie remote, dispositivi e SLO produttivi.

Nuovi casi **Da eseguire** in un nuovo ciclo; i risultati automatici non assegnano esiti manuali. Prerequisiti assenti: **Bloccato**. I cicli storici restano congelati.

## Evidenza automatica del 7 ottobre 2026

Prova locale su `54c979d` con checkout modificato: report `resilience-artifacts/2671d5b4e908/resilience.json`. Baseline riuscita; 14 ID attesi e osservati, nessun ID mancante o extra. Tredici run completati e 39 artefatti scaricabili con checksum; quattro occorrenze scheduler presenti una sola volta. Restart Redis e riconnessione agenti completati; pulizia senza errori, container temporanei rimossi.

Il run `2b1810ec-63a9-4810-bed2-fae7289dc096` interrotto con SIGKILL del worker è terminato `error`: **la prova complessiva fallisce con exit 1**, non dimostra il recupero riuscito del run attivo. Questa è evidenza di un limite della piattaforma, da risolvere separatamente; il runner lo rileva. La successiva correzione del report separa le violazioni dello scenario corrente da quelle dello storico e marca fallite le fasi con violazioni; verificata con test mirati, senza ripetere l'intera prova Docker. Non assegnare esiti manuali da questa evidenza.

Analisi successiva: `server/run-recovery.ts` applica deliberatamente `worker_lost` ai run abbandonati per evitare doppie operazioni sull'applicazione sotto test. Con la decisione dell'operatore, restart controllato e crash sono verificati separatamente come descritto sopra; non è stato introdotto replay automatico né modificata la politica di recupero della piattaforma.

Verifica della scelta su due nuovi stack, baseline `5a491bd` con checkout modificato:

- `a9c2587f4708`, modalità graceful: exit 0, 14/14 run completati, 42 artefatti, nessun ID mancante/extra/duplicato; worker recuperato in 34,3 s e Redis in 36,4 s, `successfulRecovery: true`.
- `9756ba78c73e`, modalità crash: exit 0 della diagnosi, 13 run completati e soltanto `d4e85595-328b-45c6-a5c4-1d99a4d926a7` in `error/worker_lost`, 39 artefatti, nessun ID mancante/extra/duplicato; diagnosi in 131,5 s, `successfulRecovery: false`.
- Entrambi gli stack rimossi senza errori. Dopo la revisione, aggiunti controlli contro link di artefatti scomparsi, risultati parziali duplicati e timeout cumulativi: 8 test mirati riusciti, oltre a verifica offline di hash/link conservati e durata dei due report reali. Queste sole asserzioni aggiuntive non hanno richiesto una nuova prova Docker. Il job CI `resilience-tool` esegue i test del runner su Node.js 22.

I nuovi casi manuali restano **Da eseguire**.
