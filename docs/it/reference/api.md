# API REST

`/api/v1` è l'API per pipeline e script: elencare i piani, avviare run, attenderli e raccoglierne
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
| `runs:read` | viewer | Leggere i run, il loro stato, JUnit e i report esportati. |
| `runs:write` | editor | Avviare run e annullarli. |

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
