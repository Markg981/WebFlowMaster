# API REST

`/api/v1` è l'API per pipeline e script: creare progetti, test, dataset e piani, avviare run, attenderli e raccoglierne
i risultati. È versionata e resta stabile; gli altri endpoint del server servono il client web e
possono cambiare senza preavviso.

La descrizione leggibile dalle macchine è servita da ogni installazione a
**`/api/v1/openapi.json`** (OpenAPI 3.1), e un test la mantiene identica a ciò che il server
risponde. Generateci un client, o importatela in Postman o Insomnia.

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

Una chiave **senza scope** può fare tutto ciò che può il suo account, su ogni endpoint. Una chiave
**con scope** funziona solo su `/api/v1`, e su ogni endpoint solo se ha lo scope che l'endpoint
richiede:

| Scope | Ruolo minimo | Consente |
|---|---|---|
| `plans:read` | viewer | Elencare i piani di test. |
| `projects:read` / `projects:write` | viewer / editor | Leggere / creare e aggiornare i progetti accessibili. |
| `tests:read` / `tests:write` | viewer / editor | Leggere / creare e aggiornare test e versioni. |
| `datasets:read` / `datasets:write` | viewer / editor | Leggere / creare, sostituire ed eliminare dataset. |
| `plans:write` | editor | Creare e aggiornare i piani di test. |
| `suites:read` / `suites:write` | viewer / editor | Esportare / importare suite portabili. |
| `runs:read` | viewer | Leggere i run, il loro stato, JUnit e i report esportati. |
| `runs:write` | editor | Avviare run e annullarli. |

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

| Codice | Stato | Significato |
|---|---|---|
| `unauthenticated` | 401 | Nessuna chiave, o una chiave sconosciuta, revocata o scaduta. |
| `insufficient_scope` | 403 | Alla chiave manca lo scope richiesto dall'endpoint. |
| `insufficient_role` | 403 | L'account della chiave ha un ruolo inferiore a quello richiesto dallo scope. |
| `invalid_request` | 400 | Un corpo, un parametro o un header non validi. |
| `invalid_format` | 400 | Un formato di esportazione diverso da `html`, `pdf`, `allure`. |
| `plan_not_found` | 404 | Nessun piano (o ambiente) così in questa organizzazione. |
| `run_not_found` | 404 | Nessun run così in questa organizzazione. |
| `not_found` | 404 | Nessun endpoint così sotto `/api/v1`. |
| `run_already_ended` | 409 | Annullare un run già concluso. |
| `queue_quota_exceeded` | 429 | La coda dei run in attesa dell'organizzazione è piena. |
| `rate_limited` | 429 | Troppe richieste da questa chiave nell'ultimo minuto. |
| `export_failed`, `internal_error` | 500 | Qualcosa è andato storto sul server; il log lo riporta. |

## Risorse di authoring

Questi endpoint usano autenticazione con chiave API, limiti di frequenza e formato errori dei run.
La creazione restituisce `201`; lettura e aggiornamento `200`. Gli elenchi seguono la paginazione
indicata sopra. Il documento OpenAPI dell'installazione contiene gli schemi completi delle richieste
e delle risposte.

| Risorsa | Endpoint sotto `/api/v1` | Scope richiesto |
|---|---|---|
| Progetti | `GET /projects`, `GET /projects/{projectId}` | `projects:read` |
| Progetti | `POST /projects`, `PATCH /projects/{projectId}` | `projects:write` |
| Test | `GET /tests`, `GET /tests/{testId}` | `tests:read` |
| Test | `POST /tests`, `PATCH /tests/{testId}` | `tests:write` |
| Dataset | `GET /datasets`, `GET /datasets/{datasetId}` | `datasets:read` |
| Dataset | `POST /datasets`, `PUT /datasets/{datasetId}`, `DELETE /datasets/{datasetId}` | `datasets:write` |
| Piani | `GET /plans`, `GET /plans/{planId}` | `plans:read` |
| Piani | `POST /plans`, `PATCH /plans/{planId}` | `plans:write` |
| Export suite | `POST /suites/export` | `suites:read` |
| Import suite | `POST /suites/import` | `suites:write` |

Le risposte includono solo risorse accessibili. Organizzazione e autore derivano dalla chiave;
il client non può assegnare la risorsa a un'altra organizzazione. L'accesso al progetto riservato
è verificato per ogni risorsa e riferimento collegato. Lo scope di lettura non consente scritture;
l'account deve anche soddisfare il ruolo minimo.

### Limiti delle richieste e versioni

Creazione/aggiornamento progetto accettano `{ "name": "…" }`. La creazione test richiede
`name`, `url` e `sequence`; `elements`, `projectId`, `bdd`, `preconditions`, `cleanups`, `dataset`
e i campi di classificazione seguono gli schemi OpenAPI. Il contratto crea test UI, manuali e
BDD; non crea definizioni native API/mobile. I piani possono selezionare test UI/API/mobile
esistenti tramite `selectedTests: [{ "id": 12, "type": "ui" }]`.

Ogni creazione/aggiornamento test registra versione ed evento audit nella stessa transazione.
L'aggiornamento non pubblica il test e non modifica `publishedVersion`: restano valide le
politiche di review/pubblicazione. I campi sconosciuti, inclusi `organizationId`, `userId` e
`publishedVersion`, sono rifiutati. Nel PATCH di un piano `selectedTests` sostituisce i membri;
omettendolo si conservano quelli esistenti.

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
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WFM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result.error));
  return result;
}
const suffix = Date.now();
const project = await create("projects", { name: `Pipeline ${suffix}` });
const dataset = await create("datasets", {
  name: `customers_${suffix}`, columns: ["customer"], rows: [{ customer: "Ada" }],
});
const test = await create("tests", {
  name: `Smoke ${suffix}`, projectId: project.id, url: process.env.WFM_TARGET_URL,
  sequence: [], elements: [], dataset: [{ $sharedSet: String(dataset.id) }],
});
const plan = await create("plans", {
  name: `Pipeline smoke ${suffix}`, selectedTests: [{ id: test.id, type: "ui" }],
  maxParallelTests: 1, captureScreenshots: "on_failed_steps",
});
console.log({ projectId: project.id, testId: test.id, datasetId: dataset.id, planId: plan.id });
```

Avviare il piano restituito con `POST /api/v1/plans/{planId}/runs` come descritto sotto.
La creazione non usa un header di idempotenza: conservare gli ID e usare `PATCH` / `PUT` per
gli aggiornamenti successivi.

### Import/export di suite portabili

Corpo export: `{ "projectId": 12, "format": "json" }`; formato `json` (default), `yaml` o
`gherkin`. La risposta `200` contiene `format`, `content`, `fileName`, `secretsReplaced` e `withReferences`.
L'export comprende definizioni UI/manuali/BDD e dataset inline; non include definizioni
native API/mobile, risorse dataset condivise o segreti di ambiente. Creare separatamente i
dataset condivisi e rimappare i relativi ID nell'organizzazione di destinazione.

Corpo import: `{ "projectId": 12, "content": "…", "format": "json", "dryRun": true }`.
Il formato può essere dedotto se omesso. `dryRun` restituisce `200` con `{ "dryRun": true,
"results": [{ "name": "…", "outcome": "created" }] }` senza scritture. L'import reale
restituisce `201`; ogni risultato include `id` e `outcome` (`created` o `updated`). I nomi di
test nel progetto destinazione ne aggiornano la definizione; un nome di un altro progetto
accessibile genera conflitto. L'import è atomico, registra versioni/audit e accetta massimo
500 test UI/manuali/BDD e 2.000.000 caratteri. Definizioni native API/mobile sono rifiutate.

| Errore authoring | Stato | Significato |
|---|---|---|
| `project_not_found`, `test_not_found`, `dataset_not_found`, `plan_not_found` | 404 | Risorsa assente o non accessibile. |
| `project_read_only` | 403 | Il progetto riservato non consente la modifica. |
| `manual_step_empty` | 400 | Uno step manuale vuoto non è valido. |
| `name_conflict` | 409 | Nome già usato. |
| `dataset_in_use` | 409 | Esistono test che usano il dataset. |
| `suite_too_large` | 400 | Export oltre 500 test. |
| `invalid_request` | 400 | Corpo, riferimenti, bundle o dimensioni import non validi. |

## Run

Un run ha uno di questi stati:

| Stato | Concluso | Significato |
|---|---|---|
| `queued` | no | In attesa di un runner, o del limite dell'organizzazione. |
| `running` | no | In esecuzione. |
| `cancelling` | no | Richiesto di fermarsi; termina allo step in corso. |
| `completed` | sì | Tutti i test sono passati (i fallimenti dei test in quarantena non contano). |
| `failed` | sì | Almeno un test è fallito. |
| `error` | sì | Il run non è stato portato a termine (il runner si è fermato, una preparazione è fallita). |
| `cancelled` | sì | Fermato da qualcuno. |
| `timed_out` | sì | Ha superato il tempo concesso. |

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

| Campo | Significato |
|---|---|
| `environmentId` | L'ambiente i cui segreti usa il run. |
| `updateBaselines` | Rende gli screenshot di questo run le nuove baseline visive. |
| `ci` | La build che ha chiesto il run: `provider` (obbligatorio: `github`, `gitlab`, `jenkins`, `azure`, `bitbucket`, `circleci` o `other`), `repository`, `commit` (da 7 a 64 caratteri esadecimali), `branch`, `pullRequest`, `buildId`, `buildUrl` (http o https), `actor`. Compare nel report, nelle notifiche e nelle esportazioni. |

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
(`202`) e termina allo step successivo. `409 run_already_ended` se era già concluso.

### JUnit XML

`GET /api/v1/runs/{runId}/junit` · scope `runs:read`

Il run come JUnit XML, per il report dei test del sistema di CI: una test suite per browser, un
test case per test, con il messaggio di errore. Il fallimento di un test in quarantena è
riportato come saltato, così non fa diventare rossa la build.

### Esportazione

`GET /api/v1/runs/{runId}/export/{format}` · scope `runs:read`

`format` è `html` (un unico file autonomo), `pdf`, o `allure` (uno zip di risultati Allure). Un
PDF richiede un browser sul server; senza, la risposta è `503` — l'HTML ha lo stesso contenuto.

## Webhook dei piani

Un piano si può avviare anche con un **webhook**: un URL e un token creati sul piano (**Piani di
test → Webhooks** sulla riga del piano), per i sistemi che possono fare una chiamata HTTP ma non
conservare una chiave API.

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

| Endpoint GET | Filtri aggiuntivi | Definizione completa |
|---|---|---|
| `/api/catalog/tests` | `tagIds`, `projectId`, `status` | `/api/tests/:id` |
| `/api/catalog/api-tests` | `tagIds`, `projectId` | `/api/api-tests/:id` |
| `/api/catalog/mobile-tests` | `tagIds`, `projectId` | `/api/mobile-tests/:id` |
| `/api/catalog/test-data` | Nessuno | `/api/test-data/:id` |

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
