# Dataset congelati all'accodamento

Branch: `codex/frozen-execution-datasets`, base `00fb617`. Nessuna nuova migrazione.
Aggiornare API e tutti i worker; mantenere i volumi. I casi PLN-40…PLN-42 sono **Da eseguire**:
i test automatizzati non equivalgono al collaudo manuale.

Per controllare l'attesa, fermare temporaneamente tutti i worker dell'ambiente sacrificabile,
lasciando API e Redis attivi. Accodare il piano e verificare stato `queued`; modificare i dati,
poi riavviare i worker. Per Docker usare il servizio `worker` del progetto di collaudo, non
interrompere il database. Se un worker resta attivo, la prova non garantisce la modifica prima
dell'avvio e va ripetuta.

Verificare nel run `configuration_snapshot.datasets`: valori `data.*`, righe per test, origine
del set (id, nome, updatedAt) o errore di riferimento. Non copiare dati personali o credenziali
nelle evidenze. Un nuovo run acquisisce i dati aggiornati; retry automatici e reinvio con la
stessa chiave di idempotenza conservano lo snapshot originale.

Limiti: i segreti d'ambiente restano risolti all'avvio; non vengono congelate tutte le definizioni
dei test, valori generati, risposte esterne o stato dei dispositivi. Run storici senza il campo
`datasets` mantengono la risoluzione all'avvio. I browser, agenti, Cucumber e dispositivi reali
richiedono un collaudo separato dai test con runner simulati.

## Verifiche locali

- 88 test passati in 8 file: snapshot/enqueue, risoluzione dataset, scheduler, BDD, mobile,
  shard e route dei set condivisi. Runner browser/API/mobile/Cucumber simulati nei test di wiring;
  coordinatore e helper shard eseguono i percorsi del servizio. Database PGlite per file:
  questi risultati non attestano RLS PostgreSQL reale né esecuzione su dispositivo/agente reale.
- 13 test di persistenza/collaudo passati; confronto strutturale conferma che tutti i 517 casi
  originali e le 24 aree sono invariati. Catalogo 26: 520 casi, con PLN-40…PLN-42 aggiunti.
- `npm run check`, `npm run build`, `npm run docs:build` e `git diff --check` riusciti.
- Revisione indipendente: corretto un difetto nel conteggio BDD quando un set mancante veniva
  riparato dopo l'accodamento; nessun rilievo importante residuo.
- La suite generale `vitest run --maxWorkers=2` è stata interrotta dopo diversi minuti senza
  risultati dei file: esito inconclusivo, non successo. Non attribuito a questa modifica.

Nessun deployment o esito manuale registrato; i nuovi casi restano Da eseguire.
