# Riga di comando wfm

`wfm` esegue i piani di test da una pipeline: avvia un run, lo attende, ne scrive i report ed
esce con un codice su cui la pipeline decide. Parla solo con l'[API REST](./api), quindi basta una
chiave con gli scope `runs:write` e `runs:read`. Le ricette per ogni sistema di CI sono in
[Integrazione CI](../CI_INTEGRATION).

## Ottenerla

Ogni installazione serve la propria build della CLI, sempre allineata al server. Richiede
Node.js 18 o successivo e nient'altro:

```bash
curl -fsSL "$WFM_URL/cli/wfm.mjs" -o wfm.mjs
node wfm.mjs run 12 --wait --junit junit.xml
```

## Comandi

| Comando | Cosa fa |
|---|---|
| `wfm run PLAN_ID` | Avvia un run del piano. Senza `--wait` né un'opzione di report, stampa il run ed esce. |
| `wfm status RUN_ID` | Stampa lo stato di un run. |
| `wfm junit RUN_ID --junit FILE` | Scrive il JUnit XML di un run concluso. |
| `wfm export RUN_ID --html FILE` | Scrive i report di un run concluso (`--html`, `--pdf`, `--allure`). |
| `wfm help` | Stampa l'uso. |

## Opzioni

| Opzione | Default | Significato |
|---|---|---|
| `--url URL` | `$WFM_URL` | L'indirizzo del server. |
| `--key KEY` | `$WFM_API_KEY` | La chiave API. |
| `--wait` | no | Attende la fine del run ed esce con il suo esito. Implicita con qualsiasi opzione di report. |
| `--timeout SECONDS` | 1800 | Quanto attendere prima di rinunciare. |
| `--poll SECONDS` | 5 | Ogni quanto chiedere se il run è finito. |
| `--junit FILE` | — | Scrive il JUnit XML del run quando è concluso. |
| `--html FILE` | — | Scrive il report HTML autonomo. |
| `--pdf FILE` | — | Scrive il report PDF. |
| `--allure FILE` | — | Scrive uno zip di risultati Allure. |
| `--environment ID` | — | Esegue su questo ambiente. |
| `--update-baselines` | no | Accetta gli screenshot di questo run come nuove baseline visive. |
| `--idempotency-key KEY` | `$WFM_IDEMPOTENCY_KEY` | Avvia al massimo un run per questa chiave: passate l'id della build, e uno step ripetuto segue il run già avviato. |
| `--no-ci` | — | Non invia build, commit e branch letti dal sistema di CI. |
| `--json` | no | Stampa il run finale in JSON, come lo restituisce l'API. |

## Codici di uscita

| Codice | Significato |
|---|---|
| `0` | Il run è passato. I fallimenti dei test in quarantena non contano. |
| `1` | Il run è terminato e non è passato: fallito, in errore, annullato o scaduto. |
| `2` | Il comando non è stato eseguito: uso errato, nessuna chiave, server irraggiungibile o che rifiuta, o attesa scaduta. |

Uno step di pipeline che esegue `wfm run … --wait` fallisce quindi esattamente quando deve.

## Cosa legge dal sistema di CI

Salvo `--no-ci`, la CLI riconosce il sistema di CI dal suo ambiente e invia la build insieme al
run, così report, notifiche ed esportazioni la mostrano e la collegano:

| Sistema di CI | Riconosciuto da | Invia |
|---|---|---|
| GitHub Actions | `GITHUB_ACTIONS=true` | repository, commit, branch, pull request, id e link del run, autore |
| GitLab CI | `GITLAB_CI` | percorso del progetto, commit, branch, merge request, id e link della pipeline, utente |
| Azure Pipelines | `TF_BUILD=true` | repository, commit, branch, pull request, numero e link della build, richiedente |
| Bitbucket Pipelines | `BITBUCKET_BUILD_NUMBER` | repository, commit, branch, pull request, numero e link della build |
| CircleCI | `CIRCLECI=true` | repository, commit, branch, pull request, numero e link della build, utente |
| Jenkins | `JENKINS_URL` | repository (senza credenziali), commit, branch, change id, job e build, utente |

Un valore che il server rifiuterebbe viene scartato invece che inviato, quindi questo non può mai
impedire l'avvio di un run.

Su GitHub Actions imposta anche gli output dello step `run-id`, `status` e `report-url`, e scrive
un riepilogo del run nella pagina del job.
