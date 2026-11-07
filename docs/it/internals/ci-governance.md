# Governance della CI

Come i controlli della CI bloccano il merge su `main` e cosa deve configurare il maintainer su
GitHub. Il repository non può farlo da solo: il ruleset del branch sta nelle impostazioni GitHub.

## Il job di gate

Un check obbligatorio saltato conta come superato. Alcuni job vengono saltati di proposito quando
una pull request tocca solo file in `docs/`, `marketing/` o `.md` (job `changes`): richiederli uno
a uno lascia passare un job saltato, e richiederne solo alcuni lascia `build`, `secret-scan`,
`large-files` e `dependency-audit` fuori dal gate.

Il job `ci-gate` in `.github/workflows/ci.yml` risolve entrambi i casi. Gira sempre, ha `needs` su
tutti gli altri job e fallisce quando:

- un job è fallito o è stato annullato;
- un job è stato saltato, a meno che la pull request tocchi solo documentazione e il job saltato sia
  uno di quelli di installazione condizionati da `changes` (resilience tool, helm-prometheus,
  restore drill, network, UI su installazione reale, RLS su Postgres reale).

Quando aggiungi un job a `ci.yml`, aggiungilo anche all'elenco `needs` di `ci-gate`.

## Ruleset consigliato

Ruleset "Protect Main" (id 24315754):

- check obbligatorio: solo `ci-gate` (copre i cinque check obbligatori oggi e i quattro che non lo
  sono: `build`, `secret-scan`, `large-files`, `dependency-audit`);
- `strict_required_status_checks_policy`: `true`, così il branch deve essere aggiornato rispetto a
  `main` prima del merge (oppure usare una merge queue);
- almeno un'approvazione, oppure una regola CODEOWNERS.

## Applicazione

La modifica sotto è lasciata al maintainer. Prima leggi il ruleset attuale e mantieni le altre
regole invariate:

```bash
gh api repos/<owner>/<repo>/rulesets/24315754 > ruleset.json
```

Poi sostituisci la regola `required_status_checks` con la seguente (modifica `ruleset.json`,
mantieni le altre regole) e rimandalo:

```json
{
  "type": "required_status_checks",
  "parameters": {
    "strict_required_status_checks_policy": true,
    "required_status_checks": [{ "context": "ci-gate" }]
  }
}
```

```bash
gh api -X PUT repos/<owner>/<repo>/rulesets/24315754 --input ruleset.json
```

Fai prima il merge della pull request che introduce `ci-gate`, così il check esiste prima di
diventare obbligatorio; altrimenti ogni pull request aspetta un check che non viene mai riportato.
