# Audit del prodotto e chiusura della v1

Aggiornato l'8 ottobre 2026 sul codice di main al commit `c24cbea` (PR #311 integrata).
Il prodotto copre il perimetro funzionale della suite. La chiusura della v1 richiede ancora
accettazione corrente, una release installata e prove sugli ambienti dichiarati ai clienti.
Leggere il [manuale completo](./suite-handbook) per ruoli e flussi.

## Perimetro e attendibilità

L'audit confronta codice, documentazione, catalogo Collaudo ed evidenze CI; non è un penetration
test né una certificazione dell'intero catalogo manuale. La CI di main su `c24cbea` è riuscita,
inclusi isolamento su PostgreSQL reale, restore applicativo, rete ed E2E UI sui tre motori.
La CI non equivale a una release pubblicata o installata.

La baseline del 6 ottobre è superata per paginazione, snapshot/replay, authoring API/mobile,
profili di carico, E2E critici, restore locale e import WSDL ampliato. Queste capacità sono
implementate e non devono essere riproposte come sviluppo mancante.

- Cataloghi paginati, filtri server-side e dettagli su richiesta: `server/catalog.ts` e
  `server/routes/catalog.routes.ts`.
- Definizioni UI/API/mobile e dataset fissati all'accodamento, hash/provenienza e replay storico:
  `server/execution-definitions.ts`, `server/execution-provenance.ts` e
  [esecuzione](../guide/running). Il replay usa sistemi esterni, dispositivi e segreti correnti.
- Authoring pubblico e import/export UI/manuale/BDD/API/mobile con scope, versioni e audit:
  [API pubblica](../reference/api).
- [Test di carico](../guide/load-tests): warm-up, ramp/hold, dati per utente/iterazione,
  percentili ed esiti persistiti. Limiti attuali: 200 utenti, un'ora, un run per organizzazione;
  generazione dal server.
- E2E critici su Chromium, Firefox e WebKit: `e2e/playwright.config.ts` e
  `e2e/critical-workflows.spec.ts`. Griglie e Appium hanno un comando di certificazione separato.
- Restore locale e resilienza su stack sacrificabili: `npm run backup:drill` e
  `npm run load:resilience`. Le fixture sintetiche non dimostrano RPO/RTO o capacità produttivi.
- [WSDL/XSD](../guide/api-tests): compositori e gruppi annidati, occorrenze e avvisi wildcard;
  compatibilità con contratti cliente da provare.
- [Release](../admin/releases): basi per digest, runtime non-root, build riproducibili,
  SBOM e gate di sicurezza già implementati. Pubblicazione e upgrade restano prove distinte.

Il catalogo corrente è `collaudo/casi.json`: protocollo 39, 579 casi. Lo storico locale del
27 settembre contiene 299 esiti (290 pass, 8 bloccati, 1 N/A) e conserva il proprio catalogo.
L'allineamento locale applica il catalogo corrente e crea un nuovo ciclo Da eseguire;
non assegna esiti manuali dai risultati automatici.

## Cosa esiste già

| Area                | Capacità presenti                                                                                                           | Fonti principali                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Autori e QA         | Recorder e builder web, descrizione in frasi, variabili, gruppi, condizioni/cicli, dataset, test manuali, API, mobile e BDD | `client/src/pages/`, `server/step-executor.ts`, `server/mobile-runner.ts`, `server/bdd-execution.ts`                       |
| Catalogo            | Progetti, tag, suite, versioni, review/pubblicazione, requisiti e copertura, quarantena                                     | `shared/schema.ts`, `server/test-publishing.ts`, `server/test-version-store.ts`, `server/routes/`                          |
| Esecuzione          | Snapshot del piano, code, worker, scheduler, matrice browser/mobile, griglie e agenti locali                                | `server/execution-orchestrator.ts`, `server/execution-snapshot.ts`, `server/test-execution-service.ts`, `server/worker.ts` |
| Evidenze            | Risultati per step, screenshot/video/trace/HAR secondo modalità, visual testing, accessibilità, export                      | `server/report-model.ts`, `server/report-export.ts`, `server/artifact-store.ts`                                            |
| Integrazioni        | CI, CLI, REST v1, webhook, tracker, commit status, test management, notifiche                                               | `integrations/`, `server/routes/api-v1.routes.ts`, `server/commit-status.ts`, `server/test-management.ts`                  |
| Sicurezza e governo | Tenant/RLS, ruoli, scope API, SSO OIDC/SAML, MFA, SCIM, audit, quote e retention                                            | `server/middleware/tenancy.ts`, `server/routes/`, `server/tenant-quotas.ts`                                                |
| Collaborazione      | Commenti, menzioni e dashboard condivise                                                                                    | `server/routes/comments.routes.ts`, `server/routes/dashboards.routes.ts`                                                   |
| Esercizio           | Docker, migrator, backup/verify/restore, controllo rete SaaS, log, Prometheus e OpenTelemetry                               | `scripts/wfm-backup.ts`, `deployment/saas-network/`, `server/observability/`                                               |

Non serve proporre come nuove funzionalità mobile, BDD, backup, SCIM, quote o telemetria: sono già
implementate. Il lavoro utile è migliorarne riproducibilità, prova operativa e fruibilità.

## Condizioni per chiudere la v1

| Priorità | Lavoro residuo | Evidenza richiesta |
| --- | --- | --- |
| Alta | Accettazione corrente e regressione | Nuovo ciclo sul commit realmente installato; tutti i P1 superati o N/A motivati, nessun P2 fallito senza decisione e almeno il 95% dei P2 eseguiti. Storico congelato. |
| Alta | Release installabile e upgrade | Candidato verificato, manifest/SBOM/digest coerenti, staging dalla baseline precedente, backup verificato, login/report/nuovo run e rollback provato secondo compatibilità schema. OPS-20…OPS-25. |
| Alta se S3 è nel perimetro | Recupero S3 reale | Bucket sacrificabile, inventario key/version/checksum al checkpoint, versioning/replica recuperabile e verifica report/baseline/tenant. OPS-31. |
| Alta | Capacità e recupero rappresentativi | Carico/dataset/risorse dichiarati, durata e soglie concordate, nessun run perso/duplicato, evidenze e tempi per fase. OPS-27…OPS-30, OPS-32…OPS-35. |
| Secondo il supporto dichiarato | Griglie e Appium reali | Sessioni/capabilities effettive corrispondenti ai target, risultato funzionale, report ed export. AUT-11…AUT-12. |
| Entro il 6 novembre 2026 | Dipendenza braces | Verifica upstream, mitigazione effettiva e scansioni nuove; rimuovere l'eccezione solo dopo un fix equivalente verificato. La scadenza non viene estesa automaticamente. OPS-26. |

La prova locale di restore verifica DB e artefatti locali. Il recupero degli oggetti S3 è esterno.
Il restart SIGTERM è verificato come recupero controllato; dopo SIGKILL, il run identificato
termina `worker_lost` senza replay automatico, per evitare doppie operazioni sul sistema sotto test.
Un esito positivo della diagnosi crash non certifica la prosecuzione del run interrotto.

Il registro operativo della chiusura è `collaudo/v1-closure-2026-10-08.md`; indica prove eseguite,
prerequisiti mancanti e riferimenti alle evidenze locali. La fatturazione SaaS resta sospesa.
Se entra nel perimetro commerciale richiede requisiti e un progetto separato.

## Evoluzioni condizionate ai requisiti

Carico distribuito, limiti superiori agli attuali, SOAP RPC/encoded/restriction complesse e
recupero automatico dopo crash richiedono una richiesta concreta e criteri verificabili.
Il refactoring incrementale dei servizi più grandi è manutenzione; non è una condizione generale
per chiudere la v1. Evitare riscritture e ampliamenti del perimetro durante l'accettazione.

## Audit della documentazione

Prima di questa revisione erano presenti **38 pagine tracciate per lingua**, 76 complessive, con guide utente,
amministrazione, sicurezza, API/CLI e interni. I documenti di design e i piani in `docs/superpowers/`
sono materiale storico: possono descrivere intenti e non devono essere letti come prova di delivery.

| Lacuna                                                              | Conseguenza per il lettore                                          | Correzione in questa revisione                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Introduzione degli interni centrata solo su web/API                 | Non rende evidente l'intera suite                                   | Intro aggiornata per mobile/BDD e manuale completo IT/EN                      |
| Overview con 59 migrazioni e limite `0058`                          | Mappa del repository obsoleta rispetto al journal fino a `0082`     | Riferimento al journal corrente, senza conteggio fragile                      |
| BDD disperso in documenti agenti/CLI                                | Difficile scoprire il percorso autore->versione->agente->risultato  | Guida utente BDD dedicata IT/EN                                               |
| Nessun percorso unico per un collega nuovo                          | Deve scegliere autonomamente tra molte pagine                       | Manuale della suite, ruoli, flussi, prerequisiti e rimandi                    |
| Convenzioni tecniche senza una guida pratica di contributo completa | Rischio di saltare tenancy, migration, API, test, locali o Collaudo | Guida di implementazione IT/EN con punti di estensione e verifiche            |
| Telemetria non visibile nella sidebar                               | Pagina già presente ma difficile da trovare                         | Collegamento nel menu amministrazione                                         |
| Confusione fra PGlite e prova RLS PostgreSQL reale                  | Può far scambiare test locali per evidenza di isolamento            | Testi di architettura corretti; prova RLS documentata come controllo distinto |
| README con sole due lingue UI e solo OIDC                           | Introduzione incompleta                                             | Quattro lingue UI, SAML e BDD indicati                                        |

Le nuove pagine sono collegate nel menu e nelle pagine introduttive. Il sito resta bilingue; i
materiali commerciali hanno edizioni separate IT ed EN. Il manuale non duplica tutte le opzioni:
spiega come si collega la suite e rimanda alle guide dettagliate, per evitare versioni divergenti.

## Come mantenere completa la documentazione

Per ogni miglioramento aggiornare, nella stessa modifica, contratto/dati, guida utente, prerequisiti
operativi, riferimento API se pubblico, architettura quando cambia il flusso, traduzioni e casi di
accettazione. Una nuova pagina deve avere l'equivalente nell'altra lingua e comparire nel menu.

La build `npm run docs:build` verifica i link e compila il sito, ma non prova che tutte le procedure
funzionino su un'installazione reale. `npm run docs:pdf` esporta le sezioni per lettura offline.
Registrare commit, ambiente, comandi ed esiti quando si verificano installazione, upgrade, restore,
provider o device. Evitare promesse commerciali non accompagnate da risultati misurati.

Il backlog sopra deve diventare piccoli interventi con criteri verificabili. La
[guida di implementazione](./contributing-guide) spiega come introdurli rispettando le invarianti
della suite.

## Avanzamento: release riproducibili

Il percorso di [release](../admin/releases) introduce basi per digest, lock Lighthouse, doppia build, SBOM CycloneDX e blocco HIGH/CRITICAL. Il manifest collega immagini, commit e impronte delle migrazioni. La verifica CI sul tag e il collaudo dell’upgrade restano evidenze distinte da registrare prima della distribuzione.
