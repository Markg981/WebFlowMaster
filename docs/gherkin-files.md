# Gherkin / Cucumber files

The CLI uses the same import/export workflow with a full-access API key:

```sh
wfm tests export --project 12 --format gherkin --out specs/shop.feature
wfm tests import specs/shop.feature --project 12 --dry-run
wfm tests import specs/shop.feature --project 12
```

Import detects Gherkin from the content; it does not require `--format`. Export uses the server's filename unless `--out` is supplied, with `tests.feature` as the fallback.

In **Tests as files**, choose **Gherkin** to export web tests to a `.feature` file. API tests are excluded; YAML/JSON bundles continue to include both kinds. Import a `.feature` file or select Gherkin before pasting text, preview the changes, then import. Existing names update with a new version; new tests use the selected project. Access follows organization roles and project visibility.

The official Gherkin parser supports every official dialect through `# language:`, `Rule`, Feature/Rule backgrounds, descriptions, tagged Examples, doc strings and escaped DataTables. Every Examples row creates a separate test with its original source-location selector. Structured arguments and inherited tags stay with the steps.

Choose **manual** execution to retain prose and arguments for a tester's verdict, or **Cucumber** with an authorized profile to execute real JavaScript/TypeScript definitions on your organization's dedicated agent. Import does not generate definitions or browser actions. World `this.parameters` contains the run variables. Plans execute once per saved scenario/dataset row, independently of the browser/language matrix. Undefined, ambiguous, pending, skipped and failed steps/hooks never count as passed.

An operator installs Cucumber.js **12.9.0**, support files and dependencies, then starts agent **1.3.0** with `WFM_BDD_PROFILES` pointing to its manifest. Only public profile IDs, labels, revisions and limits are advertised. An organization owner associates an advertised profile and pool with the organization or one project. Executable paths, commands and loaders remain operator configuration. See `deployment/bdd-agent/README.md` for deployment and project layout. Process limits and the provided dedicated container are operational isolation; Node is not a sandbox for hostile support code.

Portable executable imports require an explicit authorized destination binding. For CLI import add `--bdd-mode cucumber --bdd-profile DESTINATION_UUID --bdd-revision SUPPORT_REVISION`; use a binding from `/api/bdd/profiles`, preview with `--dry-run`, then repeat without it. YAML/JSON bundles also retain BDD definitions. Missing/revoked profiles or mismatching revisions fail before support modules load. Published test versions retain their feature source and pinned support revision.

WebFlowMaster exports include `# wfm-test:` metadata preserving original actions/BDD configuration and fields, including datasets, setup and cleanup. Readable steps, structured arguments, tags and Rule context must agree with the metadata. Remove that scenario's metadata before explicitly importing edited prose. Selected BDD exports contain only the chosen scenarios/Examples rows; an Outline with exactly one row preserves otherwise unrepresentable whitespace/multiline arguments. Export one dialect per file. Unruled scenarios precede Rules because Gherkin has no end-Rule marker.

Files are limited to **20 MiB**, **2,000** expanded tests, **100,000** steps and **64 MiB** combined persisted source/argument expansion. Runtime limits are **300 seconds**, **8 MiB** output and **1 MiB** total attachments. Only plain-text attachments are retained; HTML/binary attachments are omitted. Reports escape text and redact credentials/variables. A test without steps cannot export to Gherkin. Inspect literal values before committing files; repository element, group and custom-action references remain installation-specific.

## Italiano

La CLI usa gli stessi endpoint con una chiave API ad accesso completo: `wfm tests export --project 12 --format gherkin --out specs/shop.feature`, seguito da `wfm tests import specs/shop.feature --project 12 --dry-run` per l'anteprima e dallo stesso comando senza `--dry-run` per importare. Il formato Gherkin viene rilevato dal contenuto durante l'importazione.

In **Test come file**, scegliere **Gherkin** per esportare i test web in un file `.feature`. I test API sono esclusi; i bundle YAML/JSON comprendono entrambi. Importare un file `.feature` oppure scegliere Gherkin prima di incollare il testo, verificare l'anteprima e importare. I nomi esistenti vengono aggiornati con una nuova versione; i nuovi test vengono assegnati al progetto scelto.

Il parser ufficiale supporta tutti i dialetti tramite `# language:`, `Rule`, Background di Feature e Rule, descrizioni, Examples con tag, doc string e DataTable con escape. Ogni riga Examples diventa un test distinto con i selettori del sorgente originale. Argomenti e tag restano nei passi. Scegliere importazione **manuale** per il verdetto del tester oppure **Cucumber** con un profilo autorizzato per eseguire vere definizioni JavaScript/TypeScript sull'agente dedicato dell'organizzazione. Le variabili sono disponibili nel World come `this.parameters`. Ogni riga del dataset viene eseguita una volta, senza moltiplicarla per browser o lingue.

L'operatore installa Cucumber.js **12.9.0** e configura `WFM_BDD_PROFILES` nell'agente **1.3.0**. Il proprietario dell'organizzazione associa un profilo annunciato al pool e, facoltativamente, a un progetto. Percorsi, comandi e loader restano sotto controllo dell'operatore. La versione pubblicata conserva sorgente e revisione del supporto; profili non disponibili o revisioni diverse vengono rifiutati prima del caricamento del codice. Il deployment dedicato è descritto in `deployment/bdd-agent/README.md`; Node non è una sandbox.

L'importazione portabile eseguibile richiede un binding di destinazione esplicito: aggiungere alla CLI `--bdd-mode cucumber --bdd-profile UUID_DESTINAZIONE --bdd-revision REVISIONE`. Verificare l'anteprima prima di ripetere senza `--dry-run`. I commenti `# wfm-test:` conservano azioni, configurazione BDD e altri campi; testo, argomenti, tag e Rule devono corrispondere ai metadati. Gli export contengono solo gli scenari e le righe scelti, usando quando necessario un Outline con una sola riga per preservare spazi e argomenti multilinea. Esportare un dialetto per file.

Limiti: **20 MiB**, **2.000** scenari, **100.000** passi, **64 MiB** di sorgenti/argomenti persistiti; **300 secondi**, **8 MiB** di output e **1 MiB** complessivo di allegati. Si conservano solo allegati di testo semplice; i report applicano escape al testo e oscurano credenziali e variabili. I passi indefiniti, ambigui, pending, saltati o falliti non producono un risultato superato.
