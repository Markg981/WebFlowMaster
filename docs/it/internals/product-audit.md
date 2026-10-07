# Audit del prodotto e della documentazione

Analisi del 6 ottobre 2026, basata su `main` al commit `1604f95`. È una mappa di capacità e
opportunità per decidere i prossimi interventi. Le proposte non sono funzionalità già consegnate.
Per capire la suite prima di discuterne l'evoluzione, leggere il [manuale completo](./suite-handbook).

## Perimetro e attendibilità

Aggiornamento implementazione: i run accodati congelano dataset web/BDD e valori condivisi della
prima riga in `configuration_snapshot.datasets`; vedere [dati fissati all'accodamento](../guide/running#dati-fissati-all-accodamento).
La tabella delle priorità sotto conserva le evidenze della baseline originale. Hash dedicato,
interfaccia nel report e replay storico esplicito restano miglioramenti separati; i retry
automatici riutilizzano i dati acquisiti. Non vengono congelate tutte le definizioni o lo stato
dei sistemi esterni.

Aggiornamento implementazione: l'[authoring pubblico](../reference/api#risorse-di-authoring)
crea progetti, test UI/manuali/BDD, dataset condivisi e piani con scope dedicati, versioni e audit.
Import/export portabile comprende definizioni UI/manuali/BDD; l'authoring nativo API/mobile resta
fuori dal contratto. Lo [strumento di carico](../admin/load-testing) supporta `--soak-seconds` e
`--interval-seconds` con osservazioni per ciclo. Questi interventi coprono parte delle due voci
P2 della baseline sotto. Resistenza multi-tenant con agenti reali, scheduler, artefatti e riavvii
controllati resta Da eseguire nel Collaudo API-49–API-51 e OPS-27–OPS-28; i controlli automatici
locali non certificano durata o capacità in produzione.

Aggiornamento implementazione: i [test di carico](../guide/load-tests) eseguono test API salvati
come scenari composti da utenti virtuali, per una durata e lungo stage di salita/mantenimento (fino
a 200 utenti e un'ora), con un warm-up escluso dall'esito, una riga di dati distinta per utente
virtuale (o per iterazione), soglie p50–p99/errori/throughput ed esecuzioni persistite con timeline
dal vivo. Girano sul server separati dai piani, uno per organizzazione alla volta. Questo copre la
voce P2 "Profili performance ramp/soak" sotto; la generazione di carico distribuita dagli agenti
resta fuori.

È stato inventariato il repository: 1.264 file tracciati prima di questa revisione, tra cui 494
in `server/`, 331 in `client/`, 44 in `shared/`, 40 in `scripts/`, 87 in `migrations/`, 41
in `collaudo/`, 29 in `deployment/`, 8 in `e2e/` e 7 in `integrations/`. Sono presenti 347
file `.test.*` o `.spec.*`: il conteggio indica file, non scenari superati o percentuale di copertura.

L'analisi collega inventario, grafo delle dipendenze, flussi principali, configurazioni, test e
documentazione. Non è una revisione riga per riga di ogni file né un penetration test. Il grafo è
stato usato per orientarsi; le evidenze riportate sotto sono state controllate sul codice corrente.
Non sono stati rieseguiti l'intero Collaudo, i provider cloud, i dispositivi e tutte le integrazioni.
La presenza di un job CI non dimostra che l'ultima esecuzione sia passata.

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

## Priorità consigliate

P1 indica interventi da valutare prima di estendere molto il perimetro commerciale; P2 un'evoluzione
di prodotto o di accettazione; P3 una manutenzione mirata. L'impegno è qualitativo, non una stima
contrattuale. Nessuno dei rilievi statici qui elencati è presentato come un incidente in produzione.

| Priorità | Opportunità e categoria                                        | Evidenza nel codice                                                                                                                                                                                | Risultato da accettare                                                                                                                           | Impegno    |
| -------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| P1       | **Congelare i dataset condivisi dei run**. Riproducibilità     | `server/test-data.ts:17` e `:26` leggono valori/righe correnti; `server/test-execution-service.ts:864` e `:1005` li risolve in esecuzione; `server/execution-snapshot.ts:35` non cattura i dataset | Un dataset modificato mentre un run è in coda non ne cambia input ed esito; report con versione/hash e possibilità di rieseguire gli stessi dati | Medio      |
| P1       | **Allargare l'accettazione UI critica**. Validazione           | Nove scenari in `e2e/installation.spec.ts:9`, uno in `e2e/bdd.spec.ts:8`; non coprono via UI tutto SSO/MFA/SCIM, registrazione dei test, mobile, review, quote e cancellazione                     | Percorsi reali accesso federato/MFA, authoring->review->run, quote e cancellazione; screenshot/trace in CI                                       | Medio      |
| P1 | **Restore drill applicativo e oggetti S3**. Operazioni | `scripts/restore-drill.mjs` prova ripristino isolato DB/artefatti locali, login/report UI, hash evidenze, baseline recuperata, rifiuto tenant e nuovo run con segreto decifrato; la CI conserva i tempi per fase. Il recupero oggetti S3 resta esterno. | Eseguire OPS-31 su versioning/replica reali verso un bucket distinto e verificare obiettivi con dati rappresentativi; età del backup sintetico distinta da RPO produttivo. | Medio-alto |
| P1       | **Release versionate e riproducibili**. Delivery               | Nel repository c'è `.github/workflows/ci.yml`, su main/PR; bundle CI conservati sette giorni (`:116`); `package.json:3` riporta `1.0.0`                                                            | Tag versione, immagini API/worker/agent per digest, manifest migrazioni, changelog e upgrade provato dalla versione precedente                   | Medio      |
| P1       | **Gate per dipendenze e immagini**. Supply chain               | Workflow CI con check/test/build/docs, senza job SBOM o scansione immagini; basi a tag in `Dockerfile:20` e `Dockerfile.worker:9`, senza `USER` esplicito                                          | Inventario componenti, scansioni, gestione eccezioni e prova del runtime con utente esplicito compatibile con browser e file                     | Medio      |
| P2       | **Profili performance ramp/soak**. Nuova capacità              | `shared/api-performance.ts:13`: massimo 200 iterazioni e 10 concorrenti; `server/api-performance.ts:26`: stessa richiesta e stessi valori                                                          | Workload a durata/progressivo, dataset per utente virtuale, warm-up, percentili ed esiti persistiti; esecuzione isolata dai test funzionali      | Alto       |
| P2       | **Endurance della piattaforma**. Validazione                   | `scripts/wfm-load.ts:16` include letture e burst; `:104` limita a 100 run per target                                                                                                               | Prova multi-tenant prolungata con agenti, scheduler, artefatti e restart controllati; nessun run perso o duplicato                               | Medio-alto |
| P2       | **API pubblica per definire la suite**. Nuova capacità         | `server/routes/api-v1.routes.ts:22` delimita il contratto pubblico a piani/run/report; l'authoring resta nelle API interne                                                                         | API stabile per progetti/test/dataset/import-export, scope e versionamento; provisioning da pipeline senza usare endpoint privati                | Alto       |
| P2       | **Certificare le matrici reali**. Compatibilità                | UI E2E su Desktop Chrome (`e2e/playwright.config.ts:16`); `server/browsers.ts:220` segnala che OS/versioni richiesti non vengono applicati dal runner locale                                       | Percorsi completi sui tre engine, una griglia e un dispositivo Appium; report con configurazione richiesta ed effettiva                          | Medio-alto |
| P2       | **Ampliare import WSDL**. Interoperabilità                     | `server/wsdl-import.ts:78`, `:109`, `:111`, `:268`, `:272`: rifiuti espliciti di restriction, gruppi/wildcard, compositori annidati e RPC/encoded                                                  | WSDL reali con compositori annidati e gruppi, skeleton valido e avvisi precisi; RPC/encoded solo con esigenza cliente                            | Medio-alto |
| P3       | **Separare responsabilità dei grandi servizi**. Manutenibilità | `server/playwright-service.ts`: 2.377 righe; `server/routes.ts`: 1.814 righe                                                                                                                       | Estrazione incrementale di recorder/detection/ad hoc e rotte residue, mantenendo contratti e test; nessuna riscrittura generale                  | Medio      |

### Tre interventi da cui partire

1. **Riproducibilità dei dati**: definire quali input devono essere congelati, incluso il trattamento dei
   segreti; implementare una prova di modifica del dataset mentre il run aspetta in coda.
2. **Accettazione dei percorsi sensibili**: aggiungere pochi scenari completi che coprano accessi,
   pubblicazione ed esecuzione, poi estendere browser e device in modo misurato.
3. **Release e ripristino**: rendere identificabile ciò che il cliente installa e provarne upgrade e
   restore prima di promettere tempi di recupero o capacità.

Il tool di performance API, il load tool, il backup e i job RLS esistono già. Non vanno sostituiti
per principio: ogni proposta ne estende un limite osservabile.

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
