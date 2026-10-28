# API REST

## Replay storico (API web autenticata)

`POST /api/test-plan-executions/:executionId/replay` richiede editor/owner, un sorgente visibile e
`{ "mode": "historical" }`. `Idempotency-Key` opzionale (1–200 caratteri) evita duplicati per quel
sorgente. `202` restituisce `{id,testPlanId,status}` senza snapshot. Parametri/input forniti dal
client non validi: `400`; sessione/ruolo: `401`/`403`; sorgente/piano assente: `404`; input vecchi o
non verificati: `409`; quote enforce: `429`. Il run manuale conserva definizioni, dataset e
impostazioni accodati; dipendenze esterne e review attuale restano applicabili. La route usa
l’autenticazione web e non aggiunge uno scope pubblico `/api/v1` per API key.

`/api/v1` è l'API per pipeline e script: creare progetti, test, dataset e piani, avviare run, attenderli e raccoglierne
i risultati. È versionata e resta stabile; gli altri endpoint del server servono il client web e
possono cambiare senza preavviso.

La descrizione leggibile dalle macchine è servita da ogni installazione a
**`/api/v1/openapi.json`** (OpenAPI 3.1), e un test la mantiene identica a ciò che il server
risponde. Generateci un client, o importatela in Postman o Insomnia.

Ogni operazione, con parametri, corpo della richiesta, risposte e scope richiesto, è elencata in
[Endpoint dell’API](./api-endpoints), pagina generata dallo stesso documento: questa pagina spiega
autenticazione, convenzioni e flussi, quella non può restare indietro rispetto al server.

Per la maggior parte delle pipeline la [CLI `wfm`](./cli) è più semplice che chiamare l'API
direttamente.

## Autenticazione

Inviate una chiave API, creata in **Impostazioni → Chiavi API**, in uno dei due header:

```http
Authorization: Bearer wfm_…
X-API-Key: wfm_…
```

Una chiave agisce per l'account a cui appartiene, e mai oltre il ruolo di quell'account. Create le
chiavi per le pipeline su un **account di servizio**, così continuano a funzionare quando le
persone se ne vanno. Una chiave può avere una scadenza, e si revoca dalla stessa pagina.

### Scope

Una chiave **senza scope** non è più accettata (quelle che non ne avevano sono state migrate a soli scope di lettura). Una chiave
**con scope** funziona solo su `/api/v1`, e su ogni endpoint solo se ha lo scope che l'endpoint
richiede:

| Scope                                      | Ruolo minimo    | Consente                                                                                                                          |
| ------------------------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `plans:read`                               | viewer          | Elencare i piani di test.                                                                                                         |
| `projects:read` / `projects:write`         | viewer / editor | Leggere / creare, aggiornare ed eliminare i progetti accessibili.                                                                 |
| `tests:read` / `tests:write`               | viewer / editor | Leggere / creare, aggiornare ed eliminare test UI, manuali e BDD.                                                                 |
| `api-tests:read` / `api-tests:write`       | viewer / editor | Leggere (segreti letterali sostituiti da variabili) / creare, aggiornare ed eliminare test API.                                   |
| `mobile-tests:read` / `mobile-tests:write` | viewer / editor | Leggere / creare, aggiornare ed eliminare test mobile nativi.                                                                     |
| `datasets:read` / `datasets:write`         | viewer / editor | Leggere / creare, sostituire ed eliminare dataset.                                                                                |
| `plans:write`                              | editor          | Creare, aggiornare ed eliminare i piani di test.                                                                                  |
| `suites:read` / `suites:write`             | viewer / editor | Esportare / importare suite portabili; i test API e mobile di una suite richiedono anche il proprio scope di lettura / scrittura. |
| `runs:read`                                | viewer          | Leggere i run, il loro stato, JUnit, i report esportati e i file di evidenza.                                                     |
| `runs:write`                               | editor          | Avviare run e annullarli.                                                                                                         |
| `schedules:read` / `schedules:write`       | viewer / editor | Leggere / creare, aggiornare, sospendere, riprendere ed eliminare le pianificazioni dei piani.                                    |
| `environments:read` / `environments:write` | viewer / editor | Leggere gli ambienti e i nomi dei loro segreti / creare ed eliminare ambienti.                                                    |
| `secrets:write`                            | editor          | Impostare, ruotare ed eliminare i segreti di un ambiente; i valori non si rileggono mai.                                          |
| `tags:read` / `tags:write`                 | viewer / editor | Leggere i tag e i loro conteggi / creare, rinominare ed eliminare tag.                                                            |
| `quarantine:read` / `quarantine:write`     | viewer / editor | Elencare i test in quarantena / mettere in quarantena e rilasciare test.                                                          |
| `billing:read`                             | viewer          | Leggere il piano dell'organizzazione, lo stato dell'abbonamento, i limiti in vigore e il consumo rispetto a essi.                 |
| `webhooks:read` / `webhooks:write`         | editor / editor | Elencare i webhook di un piano (solo prefissi dei token) / crearli ed eliminarli.                                                 |

Il provisioning richiede gli scope di scrittura delle risorse create; aggiungere i corrispondenti
scope di lettura per verificarle e `suites:read` / `suites:write` per export / import. Gli scope
rispettano isolamento dell'organizzazione e accesso ai progetti riservati. Gli ID di un'altra
organizzazione o di un progetto non accessibile non consentono di collegare test a un piano.

A una pipeline servono `runs:write` e `runs:read`; aggiungete `plans:read` se cerca i piani per
nome.

## Convenzioni

- **Errori**: sempre `{ "error": { "code": "…", "message": "…" } }`, con un `code` stabile su
  cui decidere e un `message` per le persone.
- **Paginazione**: gli endpoint di elenco accettano `limit` (da 1 a 100, default 20) e `offset`
  (default 0), e rispondono `{ "items": [...], "limit": 20, "offset": 0 }`.
- **Limite di frequenza**: ogni chiave può fare `API_RATE_LIMIT` richieste al minuto (600 di
  default). Oltre, la risposta è `429 rate_limited`, con `Retry-After` e gli header `RateLimit`.
- **Idempotenza**: l'avvio di un run accetta un header `Idempotency-Key` (fino a 255 caratteri).
  La stessa chiave restituisce lo stesso run, così una richiesta ripetuta non ne avvia mai un
  secondo. Usate l'id della build.

| Codice                            | Stato | Significato                                                                  |
| --------------------------------- | ----- | ---------------------------------------------------------------------------- |
| `unauthenticated`                 | 401   | Nessuna chiave, o una chiave sconosciuta, revocata o scaduta.                |
| `insufficient_scope`              | 403   | Alla chiave manca lo scope richiesto dall'endpoint.                          |
| `insufficient_role`               | 403   | L'account della chiave ha un ruolo inferiore a quello richiesto dallo scope. |
| `invalid_request`                 | 400   | Un corpo, un parametro o un header non validi.                               |
| `invalid_format`                  | 400   | Un formato di esportazione diverso da `html`, `pdf`, `allure`, `junit`.      |
| `plan_not_found`                  | 404   | Nessun piano (o ambiente) così in questa organizzazione.                     |
| `run_not_found`                   | 404   | Nessun run così in questa organizzazione.                                    |
| `not_found`                       | 404   | Nessun endpoint così sotto `/api/v1`.                                        |
| `run_already_ended`               | 409   | Annullare un run già concluso.                                               |
| `artifact_not_found`              | 404   | Nessun file di evidenza così nella cartella del run.                         |
| `artifact_store_unavailable`      | 502   | L'archivio degli artefatti non è raggiungibile.                              |
| `queue_quota_exceeded`            | 429   | La coda dei run in attesa dell'organizzazione è piena.                       |
| `rate_limited`                    | 429   | Troppe richieste da questa chiave nell'ultimo minuto.                        |
| `export_failed`, `internal_error` | 500   | Qualcosa è andato storto sul server; il log lo riporta.                      |

## Risorse di authoring

Questi endpoint usano autenticazione con chiave API, limiti di frequenza e formato errori dei run.
La creazione restituisce `201`; lettura e aggiornamento `200`. Gli elenchi seguono la paginazione
indicata sopra. Il documento OpenAPI dell'installazione contiene gli schemi completi delle richieste
e delle risposte.

| Risorsa        | Endpoint sotto `/api/v1`                                                                                                                                          | Scope richiesto      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Progetti       | `GET /projects`, `GET /projects/{projectId}`                                                                                                                      | `projects:read`      |
| Progetti       | `POST /projects`, `PATCH /projects/{projectId}`, `DELETE /projects/{projectId}`                                                                                   | `projects:write`     |
| Test           | `GET /tests`, `GET /tests/{testId}`                                                                                                                               | `tests:read`         |
| Test           | `POST /tests`, `PATCH /tests/{testId}`, `DELETE /tests/{testId}`                                                                                                  | `tests:write`        |
| Test API       | `GET /api-tests`, `GET /api-tests/{apiTestId}`                                                                                                                    | `api-tests:read`     |
| Test API       | `POST /api-tests`, `PATCH /api-tests/{apiTestId}`, `DELETE /api-tests/{apiTestId}`                                                                                | `api-tests:write`    |
| Test mobile    | `GET /mobile-tests`, `GET /mobile-tests/{mobileTestId}`                                                                                                           | `mobile-tests:read`  |
| Test mobile    | `POST /mobile-tests`, `PATCH /mobile-tests/{mobileTestId}`, `DELETE /mobile-tests/{mobileTestId}`                                                                 | `mobile-tests:write` |
| Dataset        | `GET /datasets`, `GET /datasets/{datasetId}`                                                                                                                      | `datasets:read`      |
| Dataset        | `POST /datasets`, `PUT /datasets/{datasetId}`, `DELETE /datasets/{datasetId}`                                                                                     | `datasets:write`     |
| Piani          | `GET /plans`, `GET /plans/{planId}`                                                                                                                               | `plans:read`         |
| Piani          | `POST /plans`, `PATCH /plans/{planId}`, `DELETE /plans/{planId}`                                                                                                  | `plans:write`        |
| Export suite   | `POST /suites/export`                                                                                                                                             | `suites:read`        |
| Import suite   | `POST /suites/import`                                                                                                                                             | `suites:write`       |
| Pianificazioni | `GET /schedules`, `GET /schedules/{scheduleId}`                                                                                                                   | `schedules:read`     |
| Pianificazioni | `POST /schedules`, `PATCH /schedules/{scheduleId}`, `DELETE /schedules/{scheduleId}`, `POST /schedules/{scheduleId}/pause`, `POST /schedules/{scheduleId}/resume` | `schedules:write`    |
| Ambienti       | `GET /environments`, `GET /environments/{environmentId}`, `GET /environments/{environmentId}/secrets`                                                             | `environments:read`  |
| Ambienti       | `POST /environments`, `DELETE /environments/{environmentId}`                                                                                                      | `environments:write` |
| Segreti        | `PUT /environments/{environmentId}/secrets/{keyName}`, `DELETE /environments/{environmentId}/secrets/{keyName}`                                                   | `secrets:write`      |
| Evidenze run   | `GET /runs/{runId}/evidence`, `GET /runs/{runId}/artifacts/{path}`                                                                                                | `runs:read`          |
| Tag            | `GET /tags`, `GET /tags/{tagId}`                                                                                                                                  | `tags:read`          |
| Tag            | `POST /tags`, `PATCH /tags/{tagId}`, `DELETE /tags/{tagId}`                                                                                                       | `tags:write`         |
| Quarantena     | `GET /quarantine`                                                                                                                                                 | `quarantine:read`    |
| Quarantena     | `POST /quarantine`, `POST /quarantine/{quarantineId}/release`                                                                                                     | `quarantine:write`   |
| Webhook        | `GET /plans/{planId}/webhooks`                                                                                                                                    | `webhooks:read`      |
| Webhook        | `POST /plans/{planId}/webhooks`, `DELETE /webhooks/{webhookId}`                                                                                                   | `webhooks:write`     |

Le risposte includono solo risorse accessibili. Organizzazione e autore derivano dalla chiave;
il client non può assegnare la risorsa a un'altra organizzazione. L'accesso al progetto riservato
è verificato per ogni risorsa e riferimento collegato. Lo scope di lettura non consente scritture;
l'account deve anche soddisfare il ruolo minimo.

### Limiti delle richieste e versioni

Creazione/aggiornamento progetto accettano `{ "name": "…" }`. La creazione test richiede
`name`, `url` e `sequence`; `elements`, `projectId`, `bdd`, `preconditions`, `cleanups`, `dataset`
e i campi di classificazione seguono gli schemi OpenAPI. I piani possono selezionare test UI, API
e mobile tramite `selectedTests: [{ "id": 12, "type": "ui" }]` (`type` è `ui`, `api` o `mobile`).

La creazione di un test API richiede `name`, `method` e `url` (assoluto, o che inizia con una
variabile come `{{baseUrl}}`); i campi di richiesta, asserzioni, estrazioni, performance,
autorizzazione, body e protocollo sono quelli salvati dal builder dei test API. In lettura ogni
segreto letterale di `authParams` è sostituito da una variabile, come nell'export di suite: un
bearer token si legge come `{{bearer_token}}`. Rimandare la stessa variabile in un `PATCH`
conserva il segreto salvato, quindi una definizione si può leggere, modificare e riscrivere senza
perdere la credenziale. I nomi dei test API sono unici nell'organizzazione.

La creazione di un test mobile richiede `name`, `platform` (`android` o `ios`), `app` (`bs://…`,
`lt://…`, un indirizzo `http(s)://` o un percorso Appium locale), `deviceName` e `steps`;
`osVersion`, `deviceMatrix`, `projectId` e `gridId` (una griglia BrowserStack o LambdaTest) sono
facoltativi. Un `PATCH` invia solo i campi che cambiano e il risultato è verificato come test
completo: gli step devono essere adatti alla piattaforma e i gruppi di step devono esistere. I
nomi dei test mobile sono unici nell'organizzazione, senza distinzione tra maiuscole e minuscole.

Ogni creazione/aggiornamento test, di qualsiasi tipo, registra versione ed evento audit nella stessa transazione.
L'aggiornamento non pubblica il test e non modifica `publishedVersion`: restano valide le
politiche di review/pubblicazione. I campi sconosciuti, inclusi `organizationId`, `userId` e
`publishedVersion`, sono rifiutati. Nel PATCH di un piano `selectedTests` sostituisce i membri;
omettendolo si conservano quelli esistenti.

`DELETE` risponde `204` e registra un evento di audit. Eliminare un test di qualsiasi tipo porta
con sé versioni, tag, quarantena e appartenenza ai piani, e richiede il permesso di modifica sul
suo progetto (altrimenti `project_read_only`). Eliminare un piano porta con sé pianificazioni,
webhook e storico dei run, ed è rifiutato con `409 plan_running` finché un suo run è in coda, in
esecuzione o in annullamento: annullate prima il run. Un progetto lo elimina solo l'account che
lo ha creato (`403 project_not_owned`); i suoi test restano, senza progetto.

I dataset sono tabelle dell'organizzazione, non risorse di un progetto. Creazione e `PUT`
richiedono il corpo completo `{ "name", "description"?, "columns", "rows" }`: 1–50 colonne
uniche e 1–1.000 righe con valori stringa. Le colonne mancanti ricevono stringa vuota; quelle
sconosciute sono rifiutate. Il nome segue `[a-z][a-z0-9_]{0,49}`. `DELETE` restituisce `204`;
un dataset referenziato non può essere eliminato. I valori sono normali dati di test; per le
credenziali usare i segreti di ambiente. Il marker nel test è `[{ "$sharedSet": "12" }]`.

### Creare progetto, test, dataset e piano

Usare una chiave editor con `projects:write`, `tests:write`, `datasets:write`, `plans:write`;
aggiungere gli scope di lettura per verificare le risorse e `runs:write` / `runs:read` per
eseguirle e raccogliere i risultati. L'esempio crea un test UI senza azioni; aggiungere la
sequenza validata per l'applicazione prima di eseguirlo.

```javascript
// Node.js 20+: set WFM_URL, WFM_API_KEY and WFM_TARGET_URL.
const base = process.env.WFM_URL;
async function create(path, value) {
  const response = await fetch(`${base}/api/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WFM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result.error));
  return result;
}
const suffix = Date.now();
const project = await create('projects', { name: `Pipeline ${suffix}` });
const dataset = await create('datasets', {
  name: `customers_${suffix}`,
  columns: ['customer'],
  rows: [{ customer: 'Ada' }],
});
const test = await create('tests', {
  name: `Smoke ${suffix}`,
  projectId: project.id,
  url: process.env.WFM_TARGET_URL,
  sequence: [],
  elements: [],
  dataset: [{ $sharedSet: String(dataset.id) }],
});
const plan = await create('plans', {
  name: `Pipeline smoke ${suffix}`,
  selectedTests: [{ id: test.id, type: 'ui' }],
  maxParallelTests: 1,
  captureScreenshots: 'on_failed_steps',
});
console.log({ projectId: project.id, testId: test.id, datasetId: dataset.id, planId: plan.id });
```

Avviare il piano restituito con `POST /api/v1/plans/{planId}/runs` come descritto sotto.
La creazione non usa un header di idempotenza: conservare gli ID e usare `PATCH` / `PUT` per
gli aggiornamenti successivi.

### Import/export di suite portabili

Corpo export: `{ "projectId": 12, "format": "json", "include": ["tests", "apiTests", "mobileTests"] }`;
formato `json` (default), `yaml` o `gherkin`. `include` sceglie i tipi di test e vale per default
`["tests"]` (UI, manuali e BDD), quindi chi lo usa già riceve lo stesso file di prima. `apiTests`
richiede anche `api-tests:read` e `mobileTests` richiede `mobile-tests:read`; Gherkin contiene solo
`tests`. La risposta `200` contiene `format`, `content`, `fileName`, `secretsReplaced` e
`withReferences`. I test API sono esportati con i segreti letterali sostituiti da variabili
(elencati in `secretsReplaced`); i test mobile portano con sé i gruppi di step che chiamano, per
piattaforma e nome. L'export non include risorse dataset condivise, segreti di ambiente, griglie
o app caricate. Creare separatamente i
dataset condivisi e rimappare i relativi ID nell'organizzazione di destinazione.

Corpo import: `{ "projectId": 12, "content": "…", "format": "json", "dryRun": true }`.
Il formato può essere dedotto se omesso. `dryRun` restituisce `200` con `{ "dryRun": true,
"results": [{ "kind": "test", "name": "…", "outcome": "created" }] }` senza scritture.
L'import reale restituisce `201`. Ogni risultato ha `kind` (`test`, `api_test`, `mobile_test` o
`mobile_step_group`), `name`, `outcome` (`created`, `updated` o `unchanged`) e, per i test UI e API,
`id`. I nomi di test nel progetto destinazione ne aggiornano la definizione; un nome di un altro
progetto genera conflitto. Una suite con test API richiede anche `api-tests:write`, una con test o
gruppi di step mobile `mobile-tests:write`. Un test API il cui segreto contiene ancora la variabile
esportata conserva il segreto salvato. L'import è atomico: un solo test non valido, di qualsiasi
tipo, annulla tutto. Registra versioni ed eventi audit e accetta massimo 500 test (tutti i tipi
insieme), 500 gruppi di step mobile e 2.000.000 caratteri. I test mobile importati non hanno
griglia: impostare `gridId` dopo con `PATCH /mobile-tests/{mobileTestId}`.

| Errore authoring                                                                                                                | Stato | Significato                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| `project_not_found`, `test_not_found`, `api_test_not_found`, `mobile_test_not_found`, `dataset_not_found`, `plan_not_found`     | 404   | Risorsa assente o non accessibile.                                                              |
| `schedule_not_found`, `environment_not_found`, `secret_not_found`, `tag_not_found`, `quarantine_not_found`, `webhook_not_found` | 404   | Risorsa assente o non accessibile.                                                              |
| `project_read_only`                                                                                                             | 403   | Il progetto riservato non consente la modifica.                                                 |
| `project_not_owned`                                                                                                             | 403   | Solo l'account che ha creato un progetto può eliminarlo.                                        |
| `plan_running`                                                                                                                  | 409   | Un run del piano non è concluso; `runId` lo indica.                                             |
| `already_quarantined`, `already_released`                                                                                       | 409   | Il test è già in quarantena / già rientrato.                                                    |
| `manual_step_empty`                                                                                                             | 400   | Uno step manuale vuoto non è valido.                                                            |
| `name_conflict`                                                                                                                 | 409   | Nome già usato.                                                                                 |
| `dataset_in_use`                                                                                                                | 409   | Esistono test che usano il dataset.                                                             |
| `insufficient_scope`                                                                                                            | 403   | La suite include test API o mobile e la chiave non ha il loro scope; `requiredScope` lo indica. |
| `suite_too_large`                                                                                                               | 400   | Export oltre 500 test.                                                                          |
| `invalid_request`                                                                                                               | 400   | Corpo, riferimenti, bundle o dimensioni import non validi.                                      |

## Run

Un run ha uno di questi stati:

| Stato        | Concluso | Significato                                                                                |
| ------------ | -------- | ------------------------------------------------------------------------------------------ |
| `queued`     | no       | In attesa di un runner, o del limite dell'organizzazione.                                  |
| `running`    | no       | In esecuzione.                                                                             |
| `cancelling` | no       | Richiesto di fermarsi; lo step in corso viene interrotto.                                  |
| `completed`  | sì       | Tutti i test sono passati (i fallimenti dei test in quarantena non contano).               |
| `failed`     | sì       | Almeno un test è fallito.                                                                  |
| `error`      | sì       | Il run non è stato portato a termine (il runner si è fermato, una preparazione è fallita). |
| `cancelled`  | sì       | Fermato da qualcuno.                                                                       |
| `timed_out`  | sì       | Ha superato il tempo concesso.                                                             |

Interrogate un run finché il suo stato non è più `queued`, `running` o `cancelling`. Ogni pochi
secondi è più che sufficiente; la CLI lo fa ogni cinque.

L'oggetto run:

```json
{
  "id": "4f1c…",
  "planId": "12",
  "planName": "Checkout, notturno",
  "status": "failed",
  "trigger": "api",
  "attempt": 1,
  "maxAttempts": 1,
  "queuedAt": "2026-09-24T02:00:00.000Z",
  "startedAt": "2026-09-24T02:00:03.120Z",
  "completedAt": "2026-09-24T02:06:41.905Z",
  "durationMs": 398785,
  "tests": { "total": 42, "passed": 40, "failed": 2, "skipped": 0, "quarantinedFailures": 1 },
  "runner": "build-1:4211:ab12",
  "failure": null,
  "ci": { "provider": "github", "repository": "acme/shop", "commit": "9fceb02", "branch": "main" },
  "links": {
    "self": "/api/v1/runs/4f1c…",
    "junit": "/api/v1/runs/4f1c…/junit",
    "report": "https://webflowmaster.example.com/test-plans/12/executions/4f1c…/report"
  }
}
```

`trigger` è `manual`, `scheduled`, `webhook` o `api`. `failure` spiega un run terminato in
`error`, `cancelled` o `timed_out`. `links.report` è null quando il server non conosce il proprio
indirizzo (`WEBFLOW_PUBLIC_URL`).

## Endpoint

### Elencare i piani

`GET /api/v1/plans` · scope `plans:read`

```bash
curl -s -H "Authorization: Bearer $WFM_API_KEY" "$WFM_URL/api/v1/plans?limit=50"
```

Risponde una pagina di `{ "id", "name", "description", "createdAt" }`, per nome.

### Avviare un run

`POST /api/v1/plans/{planId}/runs` · scope `runs:write`

```bash
curl -s -X POST "$WFM_URL/api/v1/plans/12/runs" \
  -H "Authorization: Bearer $WFM_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: build-$BUILD_ID" \
  -d '{ "environmentId": 3, "ci": { "provider": "github", "repository": "acme/shop", "commit": "9fceb02" } }'
```

Il corpo è facoltativo:

| Campo             | Significato                                                                                                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environmentId`   | L'ambiente i cui segreti usa il run.                                                                                                                                                                                                                                                                                              |
| `updateBaselines` | Rende gli screenshot di questo run le nuove baseline visive.                                                                                                                                                                                                                                                                      |
| `ci`              | La build che ha chiesto il run: `provider` (obbligatorio: `github`, `gitlab`, `jenkins`, `azure`, `bitbucket`, `circleci` o `other`), `repository`, `commit` (da 7 a 64 caratteri esadecimali), `branch`, `pullRequest`, `buildId`, `buildUrl` (http o https), `actor`. Compare nel report, nelle notifiche e nelle esportazioni. |

Risponde `202` con il run, e il suo indirizzo in `Location`. Inoltre `400`, `404` per un piano o
un ambiente sconosciuti, `429 queue_quota_exceeded`, e `503` quando il run non è stato
consegnato a un worker — riprovate con la stessa `Idempotency-Key`.

### Elencare i run

`GET /api/v1/runs` · scope `runs:read`

Dal più recente. Filtrate con `planId` e `status`; paginato.

### Leggere un run

`GET /api/v1/runs/{runId}` · scope `runs:read`

### Annullare un run

`POST /api/v1/runs/{runId}/cancel` · scope `runs:write`

Un run in coda viene annullato subito (`200`); uno in esecuzione viene invitato a fermarsi
(`202`): il worker lo vede al battito successivo, interrompe lo step in corso e chiude il browser del test. `409 run_already_ended` se era già concluso.

### JUnit XML

`GET /api/v1/runs/{runId}/junit` · scope `runs:read`

Il run come JUnit XML, per il report dei test del sistema di CI: una test suite per browser, un
test case per test, con il messaggio di errore. Il fallimento di un test in quarantena è
riportato come saltato, così non fa diventare rossa la build.

### Esportazione

`GET /api/v1/runs/{runId}/export/{format}` · scope `runs:read`

`format` è `html` (un unico file autonomo), `pdf`, `allure` (uno zip di risultati Allure) o `junit` (lo stesso XML di `/junit`). Un
PDF richiede un browser sul server; senza, la risposta è `503` — l'HTML ha lo stesso contenuto.

### Evidenze

`GET /api/v1/runs/{runId}/evidence` · scope `runs:read`

I file lasciati dal run, per percorso sotto la cartella del run, ciascuno con `kind`
(`screenshot`, `video`, `trace`, `log`, `report`, `data` o `other`), `contentType`, `size` e l'`url`
da cui è servito; paginato, con `total`. Un run le cui evidenze sono state rimosse dalla
conservazione risponde una pagina vuota con `purged: true`.
`GET /api/v1/runs/{runId}/artifacts/{path}` trasmette un file con il suo content type; un percorso
fuori dalla cartella del run è `400`, un file assente `404 artifact_not_found`, un archivio non
raggiungibile `502 artifact_store_unavailable`. L'oggetto run rimanda all'elenco in
`links.evidence`.

## Pianificazioni

`GET|POST /api/v1/schedules`, `GET|PATCH|DELETE /api/v1/schedules/{scheduleId}`,
`POST /api/v1/schedules/{scheduleId}/pause|resume` · scope `schedules:read` / `schedules:write`

Lo stesso payload del modulo di pianificazione dell'applicazione web: `testPlanId`,
`scheduleName`, `frequency` (`once`, `daily`, `weekly`, `every_N_minutes`, `every_N_hours` o
`cron:<espressione>`), `nextRunAt` (data-ora ISO 8601 o secondi Unix), `timezone` (IANA, `UTC` di
default), `environment`, `browsers`, `notificationConfigOverride`, `executionParameters`,
`isActive` e `retryOnFailure` (`none`, `once`, `twice`). Per una frequenza CRON o `every_N`,
`nextRunAt` diventa la prima occorrenza del pattern a partire dal momento inviato, nel fuso della
pianificazione; un `PATCH` che cambia `frequency`, `timezone` o `nextRunAt` lo ricalcola. Un fuso
o un'espressione CRON sconosciuti sono `400`. I run pianificati sono eseguiti per conto
dell'account che ha creato la pianificazione. `pause` e `resume` impostano `isActive`; l'elenco
filtra con `testPlanId`.

## Ambienti e segreti

`GET|POST /api/v1/environments`, `GET|DELETE /api/v1/environments/{environmentId}` · scope
`environments:read` / `environments:write`

Un ambiente è `{ "name", "description"? }`; i nomi sono unici nell'organizzazione, senza
distinzione di maiuscole (`409 name_conflict`). Eliminarne uno elimina i suoi segreti. Gli
ambienti non hanno `PATCH`, come nell'applicazione web: createne un altro ed eliminate il vecchio.

`GET /api/v1/environments/{environmentId}/secrets` · scope `environments:read` — i nomi dei suoi
segreti (`keyName`, date), mai un valore.

`PUT /api/v1/environments/{environmentId}/secrets/{keyName}` con `{ "value": "…" }` · scope
`secrets:write` — imposta il segreto (`201`) o ruota uno esistente (`200`), sostituendo il valore
salvato. `keyName` corrisponde a `[\w.]+`, così si risolve come `{{keyName}}` nei test. Il valore
è cifrato con la chiave dell'organizzazione e non viene restituito da nessun endpoint, né scritto
nel log di audit. `DELETE` sullo stesso percorso risponde `204`.

## Tag

`GET|POST /api/v1/tags`, `GET|PATCH|DELETE /api/v1/tags/{tagId}` · scope `tags:read` /
`tags:write`

Un tag è `{ "name" }` (fino a 60 caratteri; spazi compattati). Ognuno riporta `uiCount`,
`apiCount` e `mobileCount`. `POST` risponde `201` per un tag nuovo e `200` con quello esistente
quando il nome è già in uso, senza distinzione di maiuscole, così due pipeline che chiedono `smoke`
ottengono lo stesso tag. Una rinomina (`PATCH`) è seguita da ogni test che porta il tag; una
rinomina su un nome esistente è `409 name_conflict`. `DELETE` toglie il tag da ogni test e risponde
`200` con `removedFrom`, quanti lo portavano.

## Quarantena

`GET|POST /api/v1/quarantine`, `POST /api/v1/quarantine/{quarantineId}/release` · scope
`quarantine:read` / `quarantine:write`

`POST` con `{ "testType": "ui" | "api" | "mobile", "testId", "reason" }` mette da parte un test: i
suoi fallimenti vengono ancora riportati ma non decidono più lo stato di un run (vedi
`tests.quarantinedFailures` del run). Risponde `201` con la quarantena, `409 already_quarantined`
se lo è già, `403 project_read_only` per un progetto riservato. L'elenco mostra ogni test in
quarantena con il nome, chi lo ha messo da parte e come è andato da allora. `release` con un
`{ "note" }` facoltativo lo fa rientrare (`200`); di nuovo, `409 already_released`.

## Fatturazione

`GET /api/v1/billing` · scope `billing:read`

Il piano dell'organizzazione (`plan`: codice, nome, prezzi in unità minime, valuta, `quotas`
incluse), il suo abbonamento (`subscription.status`: `trialing`, `active`, `past_due`, `suspended` o
`cancelled`, con periodo e fine della prova), cosa consente ora (`entitlement.runsBlocked`,
`entitlement.reason`, `entitlement.graceEndsAt`), i limiti in vigore (`quotas`: l'override
dell'amministratore dell'installazione, altrimenti quelli del piano, altrimenti il default) e il
consumo rispetto a essi (`usage`: `running`, `queued`, `tests`, `artifactBytes`, `executionMs` nel
mese UTC). Finché `entitlement.runsBlocked` è vero, `POST /api/v1/runs` e ogni altro modo di avviare
lavoro risponde `402 subscription_suspended`; leggere run ed evidenze continua a funzionare. Vedi
[Fatturazione](../admin/administration#fatturazione).

## Webhook dei piani

Un piano si può avviare anche con un **webhook**: un URL e un token creati sul piano (**Piani di
test → Webhooks** sulla riga del piano, oppure `POST /api/v1/plans/{planId}/webhooks` con
`{ "name" }`, scope `webhooks:write`), per i sistemi che possono fare una chiamata HTTP ma non
conservare una chiave API. L'API risponde `201` con il webhook e, una sola volta, il suo `token`;
`GET /api/v1/plans/{planId}/webhooks` (scope `webhooks:read`, ruolo editor, come la pagina web) li
elenca con i soli prefissi dei token, e `DELETE /api/v1/webhooks/{webhookId}` ne revoca uno
(`204`).

```bash
curl -s -X POST "$WFM_URL/api/webhooks/execute" -H "X-Webhook-Token: $WFM_WEBHOOK_TOKEN"
```

Il token viene mostrato una sola volta, alla creazione, e salvato solo come hash. Si può inviare
anche come `Authorization: Bearer`. Avvia quel solo piano e nient'altro; un header
`Idempotency-Key` funziona come sopra. La risposta è `202` con `{ "success": true,
"testPlanRunId": "…", "status": "queued" }`; `401` per un token mancante o revocato. I webhook
sono limitati a `WEBHOOK_RATE_LIMIT` chiamate al minuto per indirizzo (120 di default).

Leggere l'esito del run richiede una chiave API: preferite l'API, o la CLI, ogni volta che chi
chiama può conservarne una.

## Cataloghi del client web

Il client web autenticato usa questi endpoint di riepilogo, separati da `/api/v1`:

| Endpoint GET                | Filtri aggiuntivi               | Definizione completa    |
| --------------------------- | ------------------------------- | ----------------------- |
| `/api/catalog/tests`        | `tagIds`, `projectId`, `status` | `/api/tests/:id`        |
| `/api/catalog/api-tests`    | `tagIds`, `projectId`           | `/api/api-tests/:id`    |
| `/api/catalog/mobile-tests` | `tagIds`, `projectId`           | `/api/mobile-tests/:id` |
| `/api/catalog/test-data`    | Nessuno                         | `/api/test-data/:id`    |

Tutti accettano `page`, `pageSize` e `search` e restituiscono `{items, total, page, pageSize}`.
Le pagine partono da 1; la dimensione predefinita è 25, il massimo 100. I parametri di pagina
richiedono interi positivi; filtri con formato non valido restituiscono `400`. `total` conta
tutti i risultati accessibili prima della paginazione. La ricerca per nome è letterale e
ignora maiuscole/minuscole. `tagIds` contiene ID dei tag separati
da virgole: tutti i tag selezionati devono corrispondere. Isolamento dell'organizzazione e
visibilità del progetto si applicano sia ai risultati sia al totale.

I cataloghi omettono passi eseguibili completi, corpi delle richieste e valori dei dataset.
Caricare il dettaglio corrispondente quando si modifica o usa una definizione. Gli endpoint
di elenco preesistenti restano disponibili per selettori e integrazioni. Queste route del
client web non cambiano il contratto versionato dell'API pubblica o gli scope delle chiavi.
