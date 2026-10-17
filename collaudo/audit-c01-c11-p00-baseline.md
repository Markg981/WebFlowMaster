# Audit C01-C11 / M01-M04 - P00: baseline, criteri e ambiente isolato

Lotto P00 del piano [`docs/superpowers/plans/2026-10-15-audit-c01-c11-consolidation.md`](../docs/superpowers/plans/2026-10-15-audit-c01-c11-consolidation.md).
Questo documento registra la baseline e i criteri per i lotti successivi. Non cambia il comportamento del prodotto.

## 1. Revisione e ambiente registrati

| Voce                         | Valore                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Baseline del piano           | `dcce7c71c0cdf2a4c13629754d1d5a34802393fa` (merge PR #436)                                         |
| Revisione verificata in P00  | `793ad5c` (merge PR #437): rispetto alla baseline aggiunge solo il documento del piano             |
| Ultima migrazione            | `0090_execution_outbox.sql`: le nuove partono dal primo numero libero (oggi `0091`)                |
| Node                         | `.nvmrc` = 24 (CI); locale 24.8.0; `engines` >= 22                                                 |
| Playwright                   | `playwright` e `@playwright/test` 1.63.0 (versione del lockfile, usata anche come chiave cache CI) |
| Hardware del collaudo locale | Intel Core i7-13850HX, 28 thread logici, 64 GB RAM, Windows 11 Enterprise                          |
| Hardware CI                  | runner GitHub `ubuntu-latest` standard; nessun runner dedicato                                     |

Profilo di esecuzione del collaudo (job di `.github/workflows/ci.yml`, tutti su istanze usa e getta):

| Job                               | Cosa prova                                                                          | Database                                | Browser                     |
| --------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------- | --------------------------- |
| `static-checks`                   | guardie di release e sicurezza, `npm run check`, lint, budget `any`, domini, format | -                                       | -                           |
| `server-tests`                    | suite server con coverage                                                           | PGlite `memory://` per file (superuser) | Chromium, headed sotto xvfb |
| `client-tests`                    | suite client con coverage                                                           | -                                       | -                           |
| `collaudo`                        | test applicativi del collaudo e catalogo di accettazione                            | PGlite                                  | Chromium                    |
| `build`                           | `npm run build` e documentazione con controllo link                                 | -                                       | -                           |
| `rls-on-real-postgres`            | RLS e tenancy con ruolo non superuser                                               | Postgres 16 dedicato                    | -                           |
| `ui-on-real-installation`         | percorsi UI sui bundle di produzione con worker reale                               | Postgres 16 + Redis 7 dedicati          | Chromium, Firefox, WebKit   |
| `network-on-guarded-installation` | policy di destinazione, firewall reali, proxy, tre motori                           | installazione isolata                   | Chromium, Firefox, WebKit   |
| `application-restore-drill`       | backup e restore su installazione isolata                                           | istanza temporanea                      | Chromium                    |
| `resilience-tool`                 | unit test dello strumento di resilienza                                             | -                                       | -                           |

I job di installazione girano solo se la PR tocca codice, e comunque su `main` e nella run notturna.

## 2. Ambienti isolati per le prove

Nessuna prova dei lotti usa credenziali reali, servizi condivisi o produzione.

| Prova    | Ambiente autorizzato                                                                                                                                    | Credenziali                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Unità    | Vitest con PGlite `memory://`, un'istanza per file (`server/tests/setup.ts`)                                                                            | nessuna; chiave `'0' * 64`              |
| DB / RLS | Postgres dedicato con ruolo `CREATEROLE BYPASSRLS` non superuser (job `rls-on-real-postgres`); in locale un container usa e getta, mai un DSN esistente | password usa e getta del job            |
| Code     | Redis dedicato del job; per le prove isolate in memoria `redis://127.0.0.1:65431` (porta senza server, voluta)                                          | nessuna                                 |
| Rete     | `network-on-guarded-installation` (firewall e proxy reali in namespace isolati)                                                                         | nessuna                                 |
| Browser  | Chromium in `server-tests`; matrice a tre motori in `ui-on-real-installation`                                                                           | segreti di sessione usa e getta del job |
| Recovery | `application-restore-drill` e `npm run load:resilience` contro un'installazione locale usa e getta                                                      | nessuna                                 |
| Capacità | `npm run load` / `npm run volume` solo contro un'installazione dedicata (P16); `volume` rifiuta database non autorizzati                                | utente di prova dell'installazione      |

Variabili per i test Vitest in memoria, da riapplicare in ogni nuova shell:

```powershell
$env:DATABASE_URL='memory://'
$env:REDIS_URL='redis://127.0.0.1:65431'
$env:GEMINI_API_KEY=''
$env:ENCRYPTION_KEY='0' * 64
```

`server/tests/setup.ts`, `server/tests/factories.ts`, `e2e/playwright.config.ts` e `ci.yml` coprono già questi ambienti:
P00 non li modifica. I lotti estendono le factory solo quando un caso negativo lo richiede.

## 3. Riproduttori

`audit-browser-probes.mjs`, `audit-engine-probes.mjs` e `audit-durability-probes.mjs` sono rimasti nei file di
sessione dell'audit: non sono nel repository né su questa macchina. Il report dell'audit con il dettaglio C01-C11
non è nel repository. Quindi:

- ogni lotto scrive per primo il proprio caso negativo come test della suite normale e lo vede fallire sulla
  baseline (regola comune del piano, passo 2);
- se gli script vengono recuperati, vanno conservati in `collaudo/audit-probes/` come riproduttori storici. Il loro
  exit 0 non prova l'assenza dei difetti: fa fede il test della suite normale.

## 4. Matrice di chiusura

| ID         | Riproduttore (caso negativo da scrivere nel lotto)                                                          | Lotti         | Criterio di successo                                                                 | Ambiente                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------ | ----------------------------------------- |
| C01        | step che apre `file://` o una WebSocket verso destinazione vietata da una superficie di esecuzione protetta | P02, P18      | richiesta bloccata con errore esplicito su ogni superficie protetta                  | Unità + `network-on-guarded-installation` |
| C02        | scrittura del risultato che fallisce o unità attesa senza risultato                                         | P01, P07, P11 | la run non è `passed`; il set atteso coincide con i risultati autorevoli             | Unità                                     |
| C03        | utente viewer che scarica una trace grezza; DSN con password nei log                                        | P03, P08, P18 | 403 per viewer e scope insufficienti; nessuna credenziale nei log                    | Unità + `rls-on-real-postgres`            |
| C04        | versione pubblicata la cui dipendenza (gruppo, elemento, azione) cambia dopo la review                      | P09           | review ed esecuzione usano la dipendenza congelata                                   | Unità                                     |
| C05        | healing applicato a step di un gruppo condiviso o in concorrenza con una modifica                           | P10           | persistenza sulla sorgente giusta, nessun overwrite, nessuna pubblicazione implicita | Unità                                     |
| C06        | abort o deadline durante uno step lungo                                                                     | P05           | contesto, pagina e browser chiusi; nessuna sessione residua                          | Unità (Chromium)                          |
| C07        | test con più locale, righe dataset e retry                                                                  | P07, P08      | evidenze distinte per locale/riga/tentativo e navigabili nel report                  | Unità + `ui-on-real-installation`         |
| C08        | worker con lease scaduta che scrive ancora; shard perso a metà                                              | P07, P11      | scrittura rifiutata per epoch superata; esito indeterminato, nessun replay cieco     | Unità + `rls-on-real-postgres`            |
| C09        | confronto visuale richiesto senza baseline o con motore non disponibile                                     | P06           | errore esplicito, mai match o pass implicito                                         | Unità                                     |
| C10        | quickstart esposto su interfaccia non locale; overlay condiviso non dichiarato                              | P04           | bind solo su localhost; overlay esplicito e verificato                               | Unità + compose locale                    |
| C11        | click e input dentro uno shadow root aperto durante la registrazione                                        | P12           | eventi catturati con selettore eseguibile dal motore                                 | Unità (Chromium headed)                   |
| M01        | -                                                                                                           | P16           | report di capacità, latenza, consumo e comportamento a 10x su ambiente noto          | installazione dedicata                    |
| M02        | run che ripara un locator e scrive test/gruppo/elemento senza approvazione; approvazione su step cambiato   | P13           | proposta, approvazione e pubblicazione distinguibili e auditate                      | Unità                                     |
| M03        | -                                                                                                           | P14           | un solo triage per retry interni e instabilità fra run comparabili                   | Unità                                     |
| M04        | test con step fuori dal sottoinsieme esportabile                                                            | P15           | export strict fallisce; bozza marcata come incompleta                                | Unità                                     |
| Dipendenze | `npm audit` sulla catena Monaco/DOMPurify                                                                   | P17           | triage e trattamento documentati                                                     | `static-checks`                           |
| Release    | -                                                                                                           | P18, P19      | release installabile, aggiornabile, verificata, osservata su un pilot                | installazione dedicata + pilot            |

## 5. Decisioni da concordare

Proposte, non ancora approvate. Restano aperte finché il responsabile non le conferma; i lotti che cambiano
comportamento non partono prima.

| Tema                 | Proposta                                                                                                                       | Stato        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Target iniziale      | installazione self-hosted single-tenant e SaaS multi-tenant con RLS, come oggi                                                 | da approvare |
| Matrice obbligatoria | Chromium su ogni superficie; Firefox e WebKit sui percorsi UI e di rete (come i job attuali); mobile e griglia fuori dal gate  | da approvare |
| Modello di fiducia   | autori e viewer non fidati verso il server; target testati non fidati; amministratore di organizzazione fidato solo nel tenant | da approvare |
| Decisioni del piano  | raw trace, healing, worker perso, snapshot storici, export, politiche esistenti, rilascio R1 (sezione omonima del piano)       | da approvare |
| SLO                  | da definire in P16 sui dati misurati; le soglie di default di `wfm-load` e `wfm-volume` non sono SLO                           | da definire  |

## 6. Dati per il modello economico

| Dato                              | Fonte                | Valore                                                                                |
| --------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| Valuta                            | responsabile         | da fornire                                                                            |
| Tariffe e costi interni           | responsabile         | da fornire                                                                            |
| Retention di run, log e artefatti | responsabile         | da fornire                                                                            |
| Volume mensile di riferimento     | responsabile         | da fornire                                                                            |
| Ipotesi di dimensionamento        | default `wfm-volume` | 300 run/giorno, 20 risultati e 40 log per run, 12 mesi: **ipotesi**, non dato fornito |

## 7. Verifiche sulla baseline

Sulla revisione `793ad5c`, Windows 11, Node 24.8.0:

| Comando         | Esito  |
| --------------- | ------ |
| `npm run check` | exit 0 |
| `npm run build` | exit 0 |

Il primo tentativo era fallito per due cause locali, non della baseline: `node_modules` installato prima
dell'aggiornamento del manifest (`monaco-editor/editor` non risolto, corretto con `npm ci`) e file
`server/__repro__/*.repro.ts` ignorati da git ma inclusi da `tsc -b`. Prima di eseguire `check` su una macchina
di sviluppo, verificare che `server/__repro__/` non contenga residui di sessioni precedenti.

## 8. Matrice di compatibilità dei dati (R1)

R1 è il rilascio minimo che legge i formati qui sotto oppure ne rifiuta esplicitamente l'esecuzione, senza
ripiegare sul piano o sulle dipendenze correnti. Dopo la prima scrittura di un formato introdotto da R1 non si
retrocede a codice precedente. La fonte nel codice è `SUPPORTED_EXECUTION_PROTOCOLS` in
`shared/execution-provenance.ts`; ogni lotto che introduce un formato aggiunge qui la sua riga.

| Dato                                                | Formati letti da R1 | Introdotto da | Formato assente / legacy                           | Corrotto o non supportato                                          |
| --------------------------------------------------- | ------------------- | ------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `test_plan_executions.configuration_snapshot`       | `version` 1         | prima di R1   | `{}` o null: il worker usa il piano attuale        | run in `error` (`corrupt_snapshot`, `unsupported_snapshot`)        |
| `configuration_snapshot.definitions.version`        | 1, 2                | 2: P09        | 1: gruppi/elementi/azioni letti dal vivo           | run in `error` (`unusable_snapshot`)                               |
| bundle delle dipendenze in una definizione accodata | `protocol` 1        | P09           | assente in formato 2: `unusable_snapshot`          | impronta non corrispondente: `unusable_snapshot`                   |
| `test_versions.snapshot.executable` (versioni UI)   | `protocol` 1        | P09           | senza chiave: dipendenze catturate all'accodamento | il test fallisce con messaggio esplicito, mai come copia di lavoro |

Un worker precedente a R1 che riceve `definitions.version` 2 lo considera non disponibile e rifiuta il run (non
lo esegue con dipendenze correnti). Limiti dichiarati: variabili e segreti dell'ambiente, browser, griglie, agenti
e stato dell'applicazione sotto test restano correnti; le versioni mobile hanno gruppi propri e non sono coperte
da P09.

## Chiusura di P00

- [x] SHA, versioni, hardware e profilo del collaudo registrati.
- [x] Ambienti isolati identificati per DB, rete, browser e recovery, senza credenziali reali.
- [x] Ogni ID ha riproduttore da scrivere, lotto, criterio di successo e ambiente autorizzato.
- [x] `npm run check` e `npm run build` eseguiti sulla baseline.
- [ ] Decisioni della sezione 5 approvate dal responsabile.
- [ ] Dati economici della sezione 6 forniti dal responsabile.
- [ ] Script `audit-*-probes.mjs` recuperati (facoltativo: i casi negativi dei lotti li sostituiscono).
