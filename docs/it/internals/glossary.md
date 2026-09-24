# Glossario

Le parole usate nel prodotto, in questa documentazione e nel codice, con la tabella o il modulo dove
ciascuna vive. I termini restano in inglese quando è così che compaiono nell'interfaccia o nel codice.

| Termine | Significato |
|---|---|
| **Action (azione)** | Cosa fa uno step: navigate, click, input, assert, wait… L'elenco chiuso è `ADHOC_ACTION_IDS` (`shared/recording.ts`). |
| **Agent (agente)** | Un processo dentro la rete di un cliente che presta browser Playwright ai run (`agents`, `scripts/wfm-agent.ts`). |
| **API key (chiave API)** | Una credenziale per pipeline e script (`wfm_…`), opzionalmente limitata da scope (`api_keys`). |
| **API test** | Una richiesta HTTP con asserzioni ed estrazioni (`api_tests`). |
| **Archivio artefatti** | Dove si tengono evidenze e baseline: disco locale o S3 (`server/artifact-store.ts`). |
| **Attempt (tentativo)** | Una prova di un run schedulato; un tentativo fallito con tentativi rimasti accoda il successivo (`attempt`, `max_attempts`). |
| **Audit log** | Il registro in sola aggiunta di chi ha fatto cosa (`audit_log`). |
| **Baseline** | Lo screenshot accettato di uno step, con cui confrontano i test visivi. |
| **Browser task** | Lavoro su browser che una persona aspetta (anteprima, singola esecuzione, rilevazione della pagina), eseguito da un worker sulla sua coda. |
| **CI context (contesto CI)** | Provider, repository, commit, branch e build che una pipeline invia con un run (`ci_context`, `shared/ci.ts`). |
| **Commit status (stato del commit)** | Lo stato di un run mostrato sul commit testato, in GitHub o GitLab (`server/commit-status.ts`). |
| **Corsia / passaggio per browser** | Il percorso di un browser su tutti i test di un piano, con i propri valori catturati. |
| **Dataset** | Righe di input su cui gira un test, un'esecuzione per riga; le chiavi di ogni riga diventano variabili. |
| **Detected elements (elementi rilevati)** | Elementi trovati su una pagina dal builder, per un test (`detected_elements`). |
| **Element repository** | Definizioni di elementi condivise in un progetto, che gli step possono richiamare (`project_elements`). |
| **Environment (ambiente)** | Una destinazione con un nome (Staging, Produzione) con i suoi valori segreti e un login salvato opzionale (`environments`, `secrets`). |
| **Evidenze** | Ciò che un run conserva oltre ai risultati: screenshot, video, trace, HAR, differenze visive. |
| **Execution / run** | Un'esecuzione di un piano di test (`test_plan_executions`). |
| **Extraction (estrazione)** | Un valore letto da una risposta API e reso disponibile alle richieste successive come variabile. |
| **Flaky test (test instabile)** | Un test il cui verdetto cambia senza spiegazione; individuato da `server/flaky.ts`. |
| **Healing (correzione automatica)** | Sostituire un selettore che non trova più nulla con uno proposto dall'AI, verificato da un nuovo tentativo. |
| **Heartbeat** | La scrittura periodica che prova che un worker sta ancora eseguendo un run (`heartbeat_at`), o che un runner è vivo. |
| **Idempotency key (chiave di idempotenza)** | Una chiave scelta da chi chiama che fa restituire lo stesso run a una seconda richiesta. |
| **Issue tracker** | Collegamento a Jira o Azure DevOps usato per segnalare i fallimenti (`issue_trackers`, `issue_links`). |
| **Login state (stato di login)** | Cookie e storage salvati dell'applicazione sotto test, perché i test partano già autenticati. |
| **Organization (organizzazione)** | Il tenant: ogni cosa appartiene a una (`organizations`). |
| **Orchestrator** | L'unico punto in cui nascono i run (`server/execution-orchestrator.ts`). |
| **Plan / test plan (piano)** | Cosa eseguire e come: test, suite, browser, policy, notifiche (`test_plans`). |
| **Pool** | Un gruppo di agenti con un nome su cui un piano può girare. |
| **Precondition (precondizione)** | Una chiamata API che prepara lo stato prima di un test UI, saltata se già soddisfatta. |
| **Project (progetto)** | Un gruppo di test, di solito un'applicazione; può essere riservato ad alcuni membri (`projects`). |
| **Publishing (pubblicazione)** | Indicare quale versione di un test eseguono i piani; opzionalmente dopo una revisione. |
| **Quarantine (quarantena)** | Mettere da parte un test: gira, ma il suo fallimento non fa fallire il run (`test_quarantines`). |
| **Quota** | I limiti di un'organizzazione sui run in esecuzione e in attesa (`organizations`, `server/tenant-quotas.ts`). |
| **Relay** | Il componente del processo web che accoppia i runner con i browser degli agenti (`server/agents/relay.ts`). |
| **RLS** | La row-level security di PostgreSQL, che separa le organizzazioni. |
| **Runner** | Un processo worker come registrato in `runners`, con heartbeat e stato desiderato (drenaggio). |
| **Schedule (schedulazione)** | Quando un piano gira automaticamente (`test_plan_schedules`). |
| **Scope** | Un permesso a cui una chiave API può essere limitata su `/api/v1` (`shared/api-scopes.ts`). |
| **Service account** | Un account non umano che possiede chiavi API e non può accedere. |
| **Snapshot** | La configurazione congelata di un run, scritta quando viene richiesto (`configuration_snapshot`). |
| **Source host** | Un GitHub o GitLab collegato per gli stati dei commit (`source_hosts`). |
| **Step** | Un'azione di un test UI, con elemento bersaglio e valore. |
| **Step group (gruppo di step)** | Una sequenza di step con un nome, richiamata dai test (`step_groups`). |
| **Suite** | Un insieme di test con un nome, statico (elencato) o dinamico (per tag), incluso nei piani (`test_suites`). |
| **Tag** | Un'etichetta propria dell'organizzazione per i test (`tags`, `test_tags`). |
| **Tenant context (contesto di tenant)** | L'organizzazione (e l'utente) legati alla richiesta o al job corrente, tramite AsyncLocalStorage. |
| **Test** | Un test UI: una sequenza di step (`tests`). |
| **Ticket** | Un permesso firmato di 60 secondi con cui un runner prende in prestito il browser di un agente. |
| **Variabile** | Un segnaposto `{{nome}}` risolto dall'installazione, dall'ambiente, da una riga del dataset o da un'estrazione. |
| **Version (versione)** | Uno stato salvato di un test (`test_versions`); ripristinarne una scrive una nuova versione. |
| **Visual testing (test visivi)** | Confrontare lo screenshot di ogni step con la sua baseline (`server/visual-testing.ts`). |
| **Webhook** | Un URL con un token che i sistemi di CI chiamano per avviare un piano (`test_plan_webhooks`). |
| **Worker** | Il processo che consuma le code ed esegue i piani con Playwright (`server/worker.ts`). |
