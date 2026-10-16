# WebFlowMaster - Piano di implementazione e consolidamento

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or
> superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chiudere le undici criticità C01-C11 e i quattro miglioramenti M01-M04 dell'audit, senza perdere le
funzionalità esistenti, e produrre evidenze di affidabilità e installabilità.

**Architecture:** Conservare API/worker separati, executor Playwright condiviso, PostgreSQL/RLS, BullMQ e formati
di reporting esistenti. Introdurre identità persistenti di unità/tentativi e dipendenze eseguibili congelate; usare
questi contratti per correggere verdetti, artefatti e recupero degli shard. Niente riscrittura dello stack, nuovo
scheduler o promessa di exactly-once sul sistema testato.

**Tech Stack:** React/TypeScript, Node/Express, Playwright, PostgreSQL/Drizzle, PGlite, Redis/BullMQ, Vitest,
Playwright Test, Docker e GitHub Actions.

---

## Chunk 1: Piano master, suddiviso in lotti verificabili

### Perimetro, stato e regole

- Baseline verificata: `dcce7c71c0cdf2a4c13629754d1d5a34802393fa`, 15 ottobre 2026.
- Questo file è un piano, non una dichiarazione di implementazione completata.
- Il repository è rimasto invariato durante la preparazione. Nessun commit, push o modifica al database applicativo.
- Ogni Pxx è un lotto revisionabile separatamente. Non eseguire tutto come un unico refactoring.
- I nomi dei nuovi file sono proposte concrete; quelli indicati come esistenti sono stati individuati nel repository.
- Le migrazioni 0091-0093 proposte presuppongono la baseline, che termina con 0090. All'esecuzione verificare
  eventuali nuove migrazioni e assegnare il successivo numero libero prima di generarle.
- Ogni modifica va verificata nel checkout autorizzato per l'implementazione, sulla revisione effettiva. Non
  cambiare branch automaticamente. Lasciare modifiche non staged; commit e push richiedono richiesta esplicita.
- Non avviare stress test, restore, rotazioni o test di caos contro produzione o servizi condivisi.
- Gli effort sono giornate-persona, includono regressioni del lotto e non rappresentano un calendario già concordato.

### Requisiti e tracciabilità

| ID audit       | Requisito di chiusura                                                                                         | Lotti         |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ------------- |
| C01            | File locali e destinazioni WebSocket vietate non raggiungibili attraverso le superfici di esecuzione protette | P02, P18      |
| C02            | Una scrittura persa o una unità automatica mancante non produce successo                                      | P01, P07, P11 |
| C03            | Viewer non recupera trace grezze; niente DSN con credenziali nei log; percorsi alternativi controllati        | P03, P08, P18 |
| C04            | Versioni pubblicate, review ed esecuzioni conservano le dipendenze effettivamente selezionate                 | P09           |
| C05            | Healing riferito alla sorgente giusta, senza overwrite concorrente o pubblicazione implicita                  | P10           |
| C06            | Abort/deadline rilasciano effettivamente le risorse della sessione                                            | P05           |
| C07            | Locale, righe dati e tentativi hanno evidenze distinte e navigabili                                           | P07, P08      |
| C08            | Nessuna scrittura autorevole del proprietario scaduto; esiti incerti non rieseguiti indiscriminatamente       | P07, P11      |
| C09            | Confronto visuale richiesto ma non eseguibile produce errore esplicito, non match/pass implicito              | P06           |
| C10            | Quickstart vincolato a localhost; overlay condivisi espliciti e verificati                                    | P04           |
| C11            | Recorder cattura le interazioni supportate negli shadow root aperti                                           | P12           |
| M01            | Capacità, latenza, consumo e comportamento a 10x misurati su un ambiente noto                                 | P16           |
| M02            | Riparazioni proposte, approvate e pubblicate distinguibili e auditabili                                       | P13           |
| M03            | Triage unico per retry interni e instabilità fra run comparabili                                              | P14           |
| M04            | Export fedele del sottoinsieme supportato; export incompleti esplicitamente riconosciuti                      | P15           |
| Dipendenze     | Triage e trattamento documentato della catena Monaco/DOMPurify                                                | P17           |
| Qualificazione | Release installabile, aggiornabile, verificata e osservata su un pilot                                        | P18, P19      |

### Decisioni raccomandate da approvare prima di cambiare comportamento

- **Raw trace:** accesso negato ai viewer; consentito solo a principal esplicitamente autorizzati. Sessioni e API
  key devono rispettare sia permessi applicativi sia scope.
- **Healing:** correggere subito la destinazione della persistenza; il modello finale separa proposta e
  approvazione. Una riparazione non pubblica da sola una nuova definizione.
- **Worker perso:** per default esito indeterminato, non replay automatico di effetti potenzialmente non
  idempotenti. Una policy esplicita può autorizzare replay sicuro.
- **Snapshot storici:** leggibili, ma non dichiarati completamente riproducibili se mancano dipendenze. Nessuna
  ricostruzione retroattiva spacciata per lo stato originale.
- **Export:** modalità strict per uso CI; bozza esplicita per intervento umano. Versionare o deprecare il
  comportamento HTTP esistente, non romperlo di nascosto.
- Preservare le politiche esistenti di skip, quarantena, manuale/Pending, suite concatenate e retry. Una modifica
  ulteriore di queste politiche richiede una decisione distinta.
- Definire in P00 SLO e matrice supportata. Le soglie di esempio degli strumenti di carico non sono
  automaticamente SLO di prodotto.
- Stabilire un rilascio minimo di compatibilità, qui chiamato **R1** come nome di progetto e non come release già
  esistente. Deve leggere i nuovi dati oppure rifiutarne esplicitamente l'esecuzione, senza fallback live. Dopo la
  prima scrittura del nuovo formato non è consentito retrocedere al codice precedente a R1.

### Contratti condivisi, prima del codice dei singoli fix

**Identità di esecuzione.** Distinguere quattro livelli, senza usare nomi del test o label tradotte come chiavi:

```ts
export interface ExecutionUnitRef {
  executionId: string;
  unitId: string;
}

export interface ExecutionAttemptRef extends ExecutionUnitRef {
  attempt: number;
}

export interface EvidenceSliceRef extends ExecutionAttemptRef {
  datasetRow: number | null;
}

export interface WorkClaimRef {
  workItemKey: string;
  owner: string;
  epoch: number;
}
```

- `unitId` è assegnato una volta e persistito nel manifest della run, non rigenerato a ogni claim.
- Conservare separatamente identità della selezione nel piano, tipo/id test, matrice richiesta, locale e target
  mobile/BDD. Due occorrenze dello stesso test non devono collidere.
- Una riga dataset UI resta figlia del tentativo: non trasformarla automaticamente in un job indipendente. Il retry
  del test deve continuare a ripetere l'ambito che ripete oggi.
- Le righe BDD già rappresentate come unità dal planner restano tali. Non duplicarle anche nel conteggio delle
  righe UI.
- `attempt` è monotono nell'unità ed è distinto da `epoch`, che indica la proprietà del lavoro. Non riutilizzare uno
  spazio artefatti dopo una riassegnazione.
- Chiavi di storage opache, ad esempio `results/<plan>/<run>/units/<unit>/attempt_2/row_3`; mai valori di dataset o
  segreti nei percorsi.
- Il fingerprint per confrontare varianti fra run è distinto da `unitId`, che appartiene alla singola run.

**Verdetto.** Il set delle unità attese deve coincidere con quello dei risultati autorevoli ammessi dalla policy.
Non basta `count >= selectedTests.length`; duplicati e matrici rendono sbagliato quel confronto. I tentativi non
moltiplicano il numero dei test finali.

**Provenienza.** Uno step risolto conserva sorgente, `stepId`, percorso delle chiamate ai gruppi, fingerprint della
sorgente e riferimento all'eventuale elemento condiviso. Iterazioni dei loop e occorrenze di un gruppo sono
identità di esecuzione distinte, non nuovi step sorgente.

**Storage proposto.** Aggiungere `execution_units` come manifest persistente e `execution_unit_attempts` come
registro dei tentativi. Conservare `report_test_case_results` come proiezione compatibile, collegata all'unità con
unicità per i nuovi dati. Non introdurre un sistema completo di event sourcing.

### Mappa delle responsabilità

| Superficie        | File esistenti o nuovi proposti                                                                                                                     | Responsabilità                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Verdetto          | `server/execution/plan-run/report-entry.ts`, `finalize.ts`, `execute-lanes.ts`, `run-unit.ts` nella stessa directory                                | Scrittura autorevole, errori di persistenza, aggregazione                            |
| Identità          | Nuovi `shared/execution-identity.ts`, `server/execution/execution-units.ts`; `shared/schema/execution.ts`; `server/execution/plan-run/lanes.ts`     | Contratto comune e manifest, non una seconda implementazione del planner             |
| Snapshot          | `server/execution/execution-definitions.ts`, `execution-snapshot.ts`, `execution-provenance.ts`, `execution-orchestrator.ts`                        | Cattura e lettura degli input                                                        |
| Compilazione      | Nuovo `server/authoring/executable-definition.ts`; `server/authoring/step-groups.ts`, `step-elements.ts`, `custom-actions.ts`                       | Riutilizzare risolutori puri su dati forniti, senza query nascoste durante un replay |
| Versioni          | `server/authoring/test-version-store.ts`, `test-versions.ts`, `test-publishing.ts`                                                                  | Congelare prima della review; pubblicazione e rollback riusano gli stessi dati       |
| Browser           | `server/web/browser-session.ts`, `server/web/step-executor.ts`, `server/web/playwright/test-runner.ts`, `server/platform/egress-policy.ts`          | Policy, deadline, sessioni e orchestrazione degli step                               |
| Evidenze          | `server/runtime/run-evidence.ts`, `server/execution/run-test.ts`, `server/web/playwright/run-helpers.ts`, `server/execution/plan-run/artifacts.ts`  | Identità, acquisizione e pubblicazione                                               |
| Accesso artefatti | Nuovo `server/tenancy/artifact-access.ts`; `server/http/routes/artifacts.routes.ts`; `server/tenancy/artifact-store.ts`                             | Policy comune riusabile, separata dal trasporto HTTP                                 |
| Reporting         | `server/reporting/report-model.ts`, `report-export.ts`, `allure-export.ts`, `junit-report.ts`; `server/http/routes/reports.routes.ts`               | Proiezioni coerenti e autorizzate                                                    |
| API pubblica      | `server/http/routes/api-v1.routes.ts`, `server/http/api-v1/openapi.ts`, `scripts/wfm-cli.ts`                                                        | Contratti versionati, scope, serializzazione pubblica e codici di uscita             |
| UI report         | `client/src/pages/TestReportPage.tsx`, `client/src/components/reports/StepDetailsDialog.tsx`, `AttemptsBadge.tsx`, `FlakyTestsCard.tsx`             | Riga/tentativo, motivi di errore, healing e triage                                   |
| Shard             | `server/runtime/run-shards.ts`, `server/execution/run-watch.ts`, `run-recovery.ts`; `server/execution/plan-run/execute-lanes.ts`                    | Lease, ownership, lavoro indeterminato e arresto                                     |
| Recorder          | `server/authoring/recorder-script.ts`, `shared/recording.ts`                                                                                        | Eventi e selettori coerenti con il motore                                            |
| Healing           | `server/web/playwright-reporter.ts`, `server/authoring/ai-automation-service.ts`, `step-elements.ts`; nuovo `server/authoring/healing-proposals.ts` | Applicazione runtime distinta da mutazione approvata                                 |
| Portabilità       | `server/integrations/playwright-export.ts`, `server/http/routes/tests.routes.ts`                                                                    | Export strict/draft e semantica del sottoinsieme supportato                          |
| Capacità          | `scripts/wfm-load.ts`, `wfm-volume.ts`, `wfm-resilience.mjs`; `server/worker.ts`; `server/platform/observability/metrics.ts`                        | Riutilizzare strumenti esistenti, evitare un nuovo framework di benchmark            |

Documentazione da aggiornare nei lotti interessati, in entrambe le lingue:

| Codice   | Percorsi                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| D-SEC    | `docs/en/security/hardening.md`, `docs/it/security/hardening.md`, `docs/en/security/data-protection.md`, `docs/it/security/data-protection.md` |
| D-RUN    | `docs/en/internals/execution.md`, `docs/it/internals/execution.md`, `docs/en/guide/running.md`, `docs/it/guide/running.md`                     |
| D-REPORT | `docs/en/guide/results.md`, `docs/it/guide/results.md`                                                                                         |
| D-AUTHOR | `docs/en/guide/web-tests.md`, `docs/it/guide/web-tests.md`                                                                                     |
| D-CI     | `docs/en/integrations/ci.md`, `docs/it/integrations/ci.md`                                                                                     |
| D-OPS    | `docs/en/admin/operations.md`, `docs/it/admin/operations.md`, `docs/en/admin/releases.md`, `docs/it/admin/releases.md`                         |

Nuove stringhe UI: aggiornare `client/src/locales/{en,it,fr,de}/translation.json`.

### Regola di lavoro comune a ogni lotto

1. Verificare stato Git, revisione, file esistenti e cambiamenti dell'utente prima di editare.
2. Aggiungere il caso negativo specificato nel lotto; eseguirlo e osservare il fallimento previsto.
3. Implementare il comportamento minimo, riusando helper e servizi esistenti.
4. Eseguire lo stesso caso e i regressivi indicati; nessun test ignorato perché il file non esiste.
5. Aggiornare documentazione e localizzazione direttamente interessate.
6. Controllare diff, errori pubblici, compatibilità e assenza di segreti; lasciare le modifiche non staged.

Ogni comando sotto ha un risultato atteso, non un risultato già ottenuto da questa implementazione.
Per i test Vitest in memoria, riapplicare in ogni nuova shell:

```powershell
$env:DATABASE_URL='memory://'
$env:REDIS_URL='redis://127.0.0.1:65431'
$env:GEMINI_API_KEY=''
$env:ENCRYPTION_KEY='0' * 64
```

- La porta Redis indicata è usata nelle prove isolate dell'audit, non per i test delle code reali.
- Test RLS/integrazione richiedono un PostgreSQL e un Redis dedicati; non ereditare il DSN di un'installazione
  esistente.
- Non installare dipendenze a ogni lotto: `npm ci` solo quando manca una dipendenza richiesta o cambia il manifest.

### P00 - Baseline, criteri e ambiente isolato

**Copre:** prerequisito di tutti i lotti. **Dipendenze:** nessuna. **Effort:** 0,5-1 giorno.

**File:** script dell'audit nei file di sessione; `server/tests/factories.ts`, `server/tests/setup.ts`,
`.github/workflows/ci.yml`, `e2e/playwright.config.ts`; nessun nuovo framework.

- [ ] Concordare target iniziale, matrice obbligatoria, modello di fiducia e decisioni elencate sopra. Proposte in baseline §5, in attesa di approvazione.
- [x] Registrare SHA, versione Node/Playwright, limiti hardware e profilo di esecuzione del collaudo.
- [ ] Raccogliere valuta, tariffe/costi interni, retention e volume mensile di riferimento per il modello
      economico; distinguere dati forniti dal responsabile e ipotesi di dimensionamento.
- [x] Preparare istanze temporanee senza credenziali reali per prove DB, rete, browser e recovery.
- [ ] Conservare `audit-browser-probes.mjs`, `audit-engine-probes.mjs` e `audit-durability-probes.mjs` come
      riproduttori; non scambiare il loro exit 0 per assenza dei bug.
- [ ] Portare i casi nelle suite normali durante i lotti, sostituendo le asserzioni del difetto con quelle del
      comportamento corretto.
- [x] Eseguire `npm run check` e `npm run build`; risultato atteso: exit 0 sulla baseline disponibile.

Esito di P00: [`collaudo/audit-c01-c11-p00-baseline.md`](../../../collaudo/audit-c01-c11-p00-baseline.md). Campi economici (§6) da fornire dal responsabile; script `audit-*-probes.mjs` non presenti nel repository (§3).

**Chiusura:** ogni ID ha riproduttore, lotto, criterio di successo e ambiente autorizzato; nessun accesso a
produzione.
