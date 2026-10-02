# Gherkin / Cucumber files

The CLI uses the same import/export workflow with a full-access API key:

```sh
wfm tests export --project 12 --format gherkin --out specs/shop.feature
wfm tests import specs/shop.feature --project 12 --dry-run
wfm tests import specs/shop.feature --project 12
```

Import detects Gherkin from the content; it does not require `--format`. Export uses the server's filename unless `--out` is supplied, with `tests.feature` as the fallback.

In **Tests as files**, choose **Gherkin** to export web tests to a `.feature` file. API tests are excluded; YAML/JSON bundles continue to include both kinds. Import a `.feature` file or select Gherkin before pasting text, preview the changes, then import. Existing names update with a new version; new tests use the selected project. Access follows organization roles and project visibility.

English `Feature`, one `Background` before scenarios, `Scenario`, `Scenario Outline`, `Examples`, and feature/scenario tags are supported. Background steps are prepended. Each Examples row creates a concrete test with substituted placeholders and a numbered name. Tags and original keywords are retained on the manual sequence steps, rather than creating library tag records. `Then` steps and their subsequent `And`/`But` steps supply expected results.

Ordinary prose imports as **manual steps**. Runs wait for a tester's verdict; importing Gherkin does not generate browser actions or Cucumber step definitions. WebFlowMaster exports include an explicit `# wfm-test:` JSON comment preserving the original web-test actions and fields, including datasets, setup and cleanup. Reimporting this metadata restores those actions. Cucumber ignores the comment and still needs your own step definitions. If you edit the readable scenario while keeping its metadata, import reports an error; remove that scenario's metadata comment to import the edited prose as manual steps.

Descriptions, `Rule`, doc strings, step data tables, Examples tags, escaped table cells, and non-English dialects are rejected with an explicit error. Files are limited to 20 MiB, 2,000 expanded tests and 100,000 expanded steps. A web test without steps cannot be exported to Gherkin. As with YAML bundles, literal values inside web steps are preserved: inspect files before adding them to source control. References to repository elements, action groups and custom actions remain installation-specific.

## Italiano

La CLI usa gli stessi endpoint con una chiave API ad accesso completo: `wfm tests export --project 12 --format gherkin --out specs/shop.feature`, seguito da `wfm tests import specs/shop.feature --project 12 --dry-run` per l'anteprima e dallo stesso comando senza `--dry-run` per importare. Il formato Gherkin viene rilevato dal contenuto durante l'importazione.

In **Test come file**, scegliere **Gherkin** per esportare i test web in un file `.feature`. I test API sono esclusi; i bundle YAML/JSON comprendono entrambi. Importare un file `.feature` oppure scegliere Gherkin prima di incollare il testo, verificare l'anteprima e importare. I nomi esistenti vengono aggiornati con una nuova versione; i nuovi test vengono assegnati al progetto scelto.

Sono supportati i costrutti inglesi `Feature`, un `Background` prima degli scenari, `Scenario`, `Scenario Outline`, `Examples` e i tag di feature/scenario. Ogni riga Examples crea un test concreto; il Background viene aggiunto all'inizio. Tag e parole chiave restano nei passi manuali, senza creare tag nella libreria. Il testo libero produce **passi manuali**, che richiedono il verdetto di un tester: non genera azioni del browser o definizioni Cucumber.

Il commento JSON `# wfm-test:` conserva azioni e campi dei test web esportati. La reimportazione ripristina quelle azioni; Cucumber richiede comunque definizioni dei passi. Se si modifica lo scenario mantenendo il commento, l'importazione segnala un errore. Rimuovere il commento dello scenario per importare il testo modificato come passi manuali. Descrizioni, `Rule`, doc string, tabelle nei passi, tag Examples, celle con escape e dialetti diversi dall'inglese vengono rifiutati esplicitamente.
