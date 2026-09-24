# Eseguire i piani di test dalla CI

Una pipeline avvia un piano di test di WebFlowMaster e ne aspetta l'esito. Fa fallire la build se
il piano fallisce, e pubblica i risultati nel report dei test del sistema di CI. In
[`integrations/`](../../integrations) ci sono integrazioni pronte:
- una GitHub Action;
- un template per GitLab CI;
- uno step di shared library per Jenkins;
- un template per Azure Pipelines.

Sono tutte involucri sottili attorno alla CLI `wfm`. Qualsiasi altro sistema con Node 18 o
successivo può usare direttamente la CLI.

## 1. Cosa serve

- **L'indirizzo del server**, per esempio `https://webflowmaster.example.com`. Impostate anche
  `APP_BASE_URL` sul server, così le esecuzioni portano il link al loro report.
- **Una chiave API** con gli scope `runs:write` e `runs:read` (Impostazioni → Chiavi API).
  - La chiave agisce per conto di chi l'ha creata, mai oltre il suo ruolo.
  - Per una pipeline conviene crearla su un **account di servizio** (Impostazioni → Account di
    servizio): così continua a funzionare quando le persone cambiano.
- **L'id del piano**, dalla pagina del piano o da `GET /api/v1/plans`.

La chiave va salvata come segreto nel sistema di CI, mai nel repository.

## 2. La CLI

Il server distribuisce la propria build della CLI, quindi la CLI corrisponde sempre al server:

```bash
curl -fsSL "$WFM_URL/cli/wfm.mjs" -o wfm.mjs
node wfm.mjs run <planId> --wait --junit junit.xml --html report.html
```

| Comando | Cosa fa |
| --- | --- |
| `wfm run <planId>` | Avvia un'esecuzione. Con `--wait` (implicito con qualsiasi opzione di report) aspetta ed esce con l'esito. |
| `wfm status <runId>` | Stampa lo stato di un'esecuzione. |
| `wfm junit <runId> --junit <file>` | Scrive il JUnit XML di un'esecuzione finita. |
| `wfm export <runId> --html/--pdf/--allure <file>` | Scrive i report di un'esecuzione finita. |

Opzioni:
- `--url` o `$WFM_URL`, e `--key` o `$WFM_API_KEY`;
- `--environment <id>`;
- `--timeout <secondi>` (predefinito 1800);
- `--junit`, `--html`, `--pdf`, `--allure <file>`;
- `--update-baselines`;
- `--idempotency-key <chiave>` o `$WFM_IDEMPOTENCY_KEY`;
- `--no-ci` e `--json`.

**Il codice di uscita è l'interfaccia:**
- `0`: l'esecuzione è passata.
- `1`: l'esecuzione è fallita. Vale anche per errore, annullamento e tempo scaduto.
- `2`: lo step non è stato eseguibile. Per esempio manca la chiave, l'URL è sbagliato, il server
  non risponde o l'attesa è scaduta.

I fallimenti dei test in quarantena non fanno fallire l'esecuzione.

**Da dove viene l'esecuzione.** Dentro GitHub Actions, GitLab CI, Jenkins, Azure Pipelines,
Bitbucket Pipelines o CircleCI, la CLI legge dall'ambiente del job repository, commit, branch,
pull request e link alla build, e li invia con l'esecuzione.
- **Dove compare:** report, notifica, export HTML e risultati Allure mostrano quella build e ci
  rimandano.
- **Come disattivarla:** con `--no-ci`.
- **Valori non validi:** un valore che il server rifiuterebbe viene scartato invece che inviato,
  quindi questo contesto non può mai impedire l'avvio di un'esecuzione.

**Idempotenza.** Passate l'id della build come `--idempotency-key`: uno step ripetuto seguirà
l'esecuzione già avviata invece di avviarne un'altra.

## 3. GitHub Actions

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: Markg981/WebFlowMaster/integrations/github-action@main
        id: wfm
        with:
          url: ${{ vars.WFM_URL }}
          api-key: ${{ secrets.WFM_API_KEY }}
          plan: ${{ vars.WFM_PLAN_ID }}
          html: webflowmaster-report.html
      - uses: mikepenz/action-junit-report@v4
        if: always()
        with:
          report_paths: webflowmaster-junit.xml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: webflowmaster-report
          path: webflowmaster-report.html
```

Lo step fallisce se il piano fallisce. Inoltre:
- scrive l'esecuzione nella pagina di riepilogo del job;
- aggiunge un'annotazione sul fallimento;
- imposta gli output `run-id`, `status` e `report-url`, che si possono usare per esempio per
  commentare una pull request.

## 4. GitLab CI

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/Markg981/WebFlowMaster/main/integrations/gitlab/webflowmaster.gitlab-ci.yml'

e2e:
  extends: .webflowmaster
  stage: test
  variables:
    WFM_PLAN_ID: "id-del-piano"
```

Impostate `WFM_URL` e `WFM_API_KEY` (mascherata e protetta) in Settings → CI/CD → Variables. I
risultati JUnit compaiono nella scheda Tests della pipeline e nella merge request. Il report HTML
resta come artifact.

## 5. Jenkins

1. Registrate questo repository come Global Pipeline Library (Manage Jenkins → System → Global
   Pipeline Libraries), con nome `webflowmaster` e Library Path `integrations/jenkins`.
2. Aggiungete una credenziale Secret text con la chiave e id `webflowmaster-api-key`.
3. Nella pipeline l'agente deve avere Node 18 o successivo, per esempio `docker { image 'node:20' }`:

```groovy
@Library('webflowmaster') _
// …
steps {
  webflowmaster plan: 'id-del-piano', url: 'https://webflowmaster.example.com'
}
```

I risultati JUnit vengono pubblicati con lo step `junit` e il report HTML viene archiviato.
- **Esito:** di default un piano fallito fa fallire la build. Con `onFailure: 'unstable'` la build
  viene segnata come instabile.
- **Altri parametri:** `environment`, `timeout`, `credentialsId`, `junit`, `html`.
- **Esempio completo:** [`Jenkinsfile.example`](../../integrations/jenkins/Jenkinsfile.example).

## 6. Azure Pipelines

```yaml
resources:
  repositories:
    - repository: webflowmaster
      type: github
      name: Markg981/WebFlowMaster
      endpoint: la-vostra-service-connection-github

steps:
  - template: integrations/azure-pipelines/webflowmaster.yml@webflowmaster
    parameters:
      plan: id-del-piano
```

Definite `WFM_URL` e `WFM_API_KEY` (segreta) nelle variabili della pipeline o in un variable
group. I risultati vanno nella scheda Tests dell'esecuzione e il report HTML resta come artifact
della pipeline.

## 7. Altri sistemi

Qualsiasi sistema che esegue Node 18 può usare le due righe della sezione 2. Senza Node, l'API
dietro la CLI è documentata in `GET /api/v1/openapi.json`:
1. `POST /api/v1/plans/{planId}/runs`;
2. interrogare `GET /api/v1/runs/{runId}` finché `status` non è più `queued`, `running` o
   `cancelling`;
3. scaricare `GET /api/v1/runs/{runId}/junit` e `/export/{html|pdf|allure}`.
