# Il primo run da una pipeline

Per chi si occupa di DevOps e rilasci. Alla fine un job CI avvia un piano di test di
WebFlowMaster, lo attende, fa fallire la build quando il piano fallisce e pubblica i risultati nel
report dei test del sistema CI. Serve un piano che passa già quando lo si esegue a mano
([Il primo test in 10 minuti](./qa)) e un **owner** che crei l'account di servizio, oppure il ruolo
di owner.

## 1. Un account di servizio e la sua chiave (5 minuti)

Una pipeline non deve dipendere dall'account di una persona.

1. **Impostazioni → Chiavi API**, riquadro **Account di servizio**: un nome che richiami la
   pipeline ("ci-shop"), ruolo **editor** (avviare i run richiede almeno questo), **Crea account**.
2. Nel riquadro **Chiavi API** sopra: un nome, **Assegnata a** l'account di servizio, **Cosa può
   fare la chiave** → _Solo ciò che scelgo, tramite /api/v1_ con **Avviare i run e annullarli**
   (`runs:write`) e **Leggere i run, il loro stato e i report JUnit** (`runs:read`); aggiungete
   **Elencare i piani di test** (`plans:read`) se il job cerca i piani. Impostate **Scade tra
   (giorni)** secondo la vostra politica di rotazione, poi **Crea chiave**.
3. Copiate la chiave da **Copia ora questa chiave**: è mostrata **una sola volta** e il server ne
   conserva solo l'hash.

Salvatela come segreto nel sistema CI (`WFM_API_KEY`), mai nel repository. Salvate l'indirizzo del
server come `WFM_URL` e l'id del piano, dalla pagina del piano o da `GET /api/v1/plans`, come
`WFM_PLAN_ID`. Dettagli: [Chiavi API e account di servizio](../admin/administration#chiavi-api-e-account-di-servizio).

## 2. Provarlo dalla propria macchina (3 minuti)

Il server distribuisce una CLI sempre allineata alla sua versione:

```bash
curl -fsSL "$WFM_URL/cli/wfm.mjs" -o wfm.mjs
node wfm.mjs run "$WFM_PLAN_ID" --wait --junit junit.xml
echo $?
```

**Il codice di uscita è il contratto:** `0` il piano è passato, `1` è fallito (compresi errore,
annullamento e timeout), `2` il passo stesso non si è potuto eseguire: indirizzo sbagliato, chiave
non valida, server irraggiungibile. I fallimenti dei test in quarantena non fanno fallire il run.
Dettagli: [La CLI](../integrations/ci#_2-la-cli).

## 3. Aggiungerlo alla pipeline (10 minuti)

GitHub Actions, con l'action del repository:

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: Markg981/WebFlowMaster/integrations/github-action@main
        with:
          url: ${{ vars.WFM_URL }}
          api-key: ${{ secrets.WFM_API_KEY }}
          plan: ${{ vars.WFM_PLAN_ID }}
          idempotency-key: ${{ github.run_id }}-${{ github.run_attempt }}
```

Quando funziona, fissate l'action a un tag di release o a un commit invece di `@main`. GitLab CI,
Jenkins, Azure Pipelines, Bitbucket Pipelines e CircleCI hanno modelli pronti che funzionano allo
stesso modo: [Eseguire i piani di test dalla CI](../integrations/ci).

La **chiave di idempotenza** fa sì che un passo CI ripetuto segua il run già avviato invece di
avviarne un secondo.

## 4. Controllare il risultato (2 minuti)

Fate push di un commit. Il job esegue il piano e:

- passa o fallisce con il piano;
- scrive `webflowmaster-junit.xml`, che il report dei test del sistema CI legge;
- invia con il run repository, commit, branch e link alla build, così il report di WebFlowMaster
  rimanda alla build.

## Poi

- Solo i test toccati da una modifica: `changed-since` e la [mappa d'impatto](../guide/running#impatto).
- Uno stato sul commit o sulla pull request: [Stato del commit su GitHub e GitLab](../integrations/ci#_10-stato-del-commit-su-github-e-gitlab).
- Report HTML, PDF o Allure come artefatti della build: gli input `html`, `pdf` e `allure`.
- Applicazioni raggiungibili solo dentro la vostra rete: [Agenti locali](../integrations/local-agents).
- Tutto il resto che l'API sa fare: [API REST](../reference/api).
