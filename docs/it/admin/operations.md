# Operatività

Gestire un'installazione una volta avviata: aggiornarla senza interrompere i run a metà, farne
il backup per poterla ripristinare, leggerne i log, e dove guardare quando qualcosa non va.

## Aggiornamento

Nel Collaudo locale usare sempre il progetto `wfm-collaudo` e il suo overlay, mantenendo i volumi.
Il worker importa la CA privata di Chromium come `pwuser`; l'overlay abilita
`INSTALL_COLLAUDO_CA_TOOLS=1` per installare `certutil` durante la build. Se lo script segnala
che `certutil` manca, ricostruire il worker con l'overlay: l'avvio non installa pacchetti e non
richiede privilegi root. Verifica dedicata OPS-36 in `collaudo/casi.json`.

Una release può cambiare lo schema del database, quindi l'ordine conta.

1. **Svuotate i runner.** In **Impostazioni → Runner** svuotate ogni runner. Un runner in
   svuotamento finisce ciò che ha e non prende altro; aspettate che i job in corso arrivino a
   zero. I run richiesti nel frattempo restano in coda e partono dopo l'aggiornamento.
2. **Fermate i processi web e i worker.** Un worker a cui è stato chiesto di fermarsi non prende
   più job da nessuna delle sue code (piani di test, task browser, run di carico) e aspetta
   fino a `WORKER_SHUTDOWN_GRACE_MS` (30 secondi di default) i run che ha ancora; con Compose,
   impostate lo `stop_grace_period` del worker almeno altrettanto lungo, altrimenti Docker lo
   uccide prima.
3. **Fate il backup del database**: `npm run backup:create` (vedi [Backup](#backup)).
4. **Applicate le migrazioni** con la nuova versione: `node dist/apply-migrations.js`, oppure il
   servizio `migrate` in Compose (`docker compose up migrate`). `npm run db:doctor` riporta lo
   stato dello schema ed esce con codice diverso da zero quando c'è qualcosa da fare, quindi può
   fare da controllo in un deployment.
5. **Avviate i processi web, poi i worker.** I nuovi worker si registrano come nuovi runner; le
   voci vecchie risultano offline e spariscono dopo una settimana.

Con Compose, `docker compose up -d --build` esegue i passi 2, 4 e 5 in ordine, perché `api` e
`worker` aspettano che `migrate` finisca.

Non mescolate versioni di worker a cavallo della migrazione 0093: un worker precedente prende il
lavoro condiviso senza epoch né lease, quindi i worker nuovi non possono fermarlo. Svuotate e fermate
ogni vecchio worker (passi 1–2) prima di avviare quelli nuovi.

### Volumi di installazioni precedenti

API e worker attuali usano `pwuser` (UID 1000). Un volume creato da una vecchia immagine root
può mantenere proprietario `0:0`: una nuova build non cambia i permessi del volume. Il worker
può avviarsi, ma il run fallisce con `EACCES` quando crea la directory delle evidenze.

Dopo drain e backup verificato, controllare il proprietario di `/app/results` e
`/app/data/visual-baselines`. Solo se necessario, adeguare i due volumi con un container temporaneo.
Per il Collaudo locale:

```sh
docker compose -p wfm-collaudo --env-file collaudo/collaudo.env -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml run --rm --no-deps --user root api chown -R pwuser:pwuser /app/results /app/data/visual-baselines
```

Il comando modifica la proprietà conservando i contenuti; non elimina né ricrea i volumi.
Per altre installazioni usare il loro progetto e Compose verificati, mantenendo la prova separata
dalla produzione. Verificare poi worker UID 1000, report storico e nuovo run con evidenze scaricabili.
Un backup verificato o il solo login non provano questo percorso.

**Agenti locali.** Il Playwright di un agente deve avere la stessa versione major e minor di
quello dei runner. Quando una release cambia la versione di Playwright, aggiornate anche gli
agenti (una nuova immagine, o un nuovo `wfm-agent.mjs` da `/cli/wfm-agent.mjs`). Un agente con
una versione diversa resta connesso ma non viene scelto per i run, e
**Impostazioni → Agenti locali** mostra il motivo.

## Backup {#backup}

| Cosa                 | Dove                                                       | Come                                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Database**         | PostgreSQL                                                 | `npm run backup:create` (sotto), `pg_dump`, o gli snapshot del servizio gestito. Tutto ciò che il prodotto sa è qui.                                                                                                                            |
| **`ENCRYPTION_KEY`** | Il vostro secret manager                                   | Conservata separatamente dal backup del database, e mai al suo interno. Senza di essa i segreti cifrati di un database ripristinato sono illeggibili.                                                                                           |
| **Artefatti**        | `results/` e `data/visual-baselines/`, oppure il bucket S3 | Inclusi da `backup:create` quando l'archivio è locale; versioning o replica del bucket quando è S3. Contano le baseline visive: perderle significa approvarne di nuove. Screenshot, video e trace vengono comunque rimossi dalla conservazione. |
| **Redis**            | Redis                                                      | Facoltativo. Contiene code, sessioni e le schedulazioni BullMQ, che vengono ricostruite dal database all'avvio del processo web.                                                                                                                |

Se Redis perde i dati, tutti vengono disconnessi, e i run che aspettavano in coda restano
_in coda_ senza partire: annullateli e avviateli di nuovo.

### Lo strumento di backup

Per l'installazione Docker Compose fornita dal repository, `scripts/wfm-backup.ts` fa le tre cose che
servono a un operatore, dalla cartella del repository sull'host Docker. Richiede solo Docker e Node:
`pg_dump` e `pg_restore` girano nel container `postgres`, `tar` nel container `api`.

```bash
npm run backup:create                              # in ./.local/backups/wfm-backup-<ora UTC>/
npm run backup:verify  -- .local/backups/wfm-backup-20261001-020000
npm run backup:restore -- .local/backups/wfm-backup-20261001-020000 --yes
```

Con un altro progetto Compose o file aggiuntivi, si passano come a `docker compose`:
`npm run backup:create -- -p wfm-collaudo -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml`.
`--db-name` e `--db-user` cambiano i default (`webflowmaster`, `postgres`).

Un backup è una cartella:

| File                                  | Contenuto                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.dump`                       | `pg_dump --format=custom --no-owner`: tabelle, dati, permessi, policy di row-level security.                                                                                                                                                                                                                         |
| `results.tar`, `visual-baselines.tar` | Le evidenze dei run e le baseline visive (solo con archivio locale).                                                                                                                                                                                                                                                 |
| `manifest.json`                       | Quando e da quale versione è stato fatto; il numero di migrazioni applicate; quante tabelle hanno la row-level security; il numero esatto di righe delle tabelle principali; dimensione e SHA-256 di ogni file; un'**impronta** della chiave di cifratura (l'hash di un hash: identifica la chiave senza rivelarla). |

**`verify` è la verifica del ripristino database.** Controlla ogni file con il suo checksum, ripristina il dump in un
database di prova accanto a quello vivo (`webflowmaster_restore_check`), confronta righe, migrazioni,
row-level security e permessi di `app_user` con il manifest, dice se l'installazione in esecuzione ha la
chiave del backup, ed elimina il database di prova. Non tocca nulla di ciò che l'installazione usa, quindi
può girare ogni notte dopo `create`: un backup mai ripristinato è una speranza, non un backup.

**`restore` sostituisce i dati dell'installazione.** In ordine:

1. controlla i checksum, e **rifiuta** quando l'installazione in esecuzione ha una `ENCRYPTION_KEY`
   diversa da quella del backup (`--ignore-key` lo forza: i segreti vanno poi reinseriti) o quando il
   backup viene da una versione più recente del codice (più migrazioni);
2. chiede `--yes`; senza, dice cosa andrebbe perso e si ferma;
3. ferma `api` e `worker`, elimina e ricrea il database, crea il ruolo `app_user` se questo server
   PostgreSQL non lo ha, e ripristina il dump;
4. sostituisce le cartelle degli artefatti con gli archivi;
5. esegue `migrate`, che applica le migrazioni aggiunte dopo il backup, e avvia `api` e `worker`;
6. confronta di nuovo il risultato con il manifest.

Per spostare un'installazione su un server nuovo: installarla lì con `docker compose up -d` e la
**stessa** `ENCRYPTION_KEY`, copiare la cartella del backup, eseguire `backup:restore`. Le sessioni non
si spostano: le persone accedono di nuovo.

Codici di uscita: `0` fatto, `1` il controllo ha trovato un problema (un file danneggiato, un conteggio
diverso, un ripristino rifiutato), `2` il comando non si è potuto eseguire (Docker non raggiungibile,
argomenti sbagliati).

#### Pianificarlo

Un backup notturno con la sua prova, conservando quattordici giorni, da cron sull'host Docker:

```bash
0 2 * * *  cd /opt/webflowmaster && npm run -s backup:create && \
           latest=$(ls -d .local/backups/wfm-backup-* 2>/dev/null | tail -n 1) && \
           [ -n "$latest" ] && npm run -s backup:verify -- "$latest" && \
           find .local/backups -maxdepth 1 -name 'wfm-backup-*' -mtime +14 -exec rm -rf {} +
```

I nomi delle cartelle contengono l'ora UTC, quindi l'ultima nell'ordine di `ls` è la più recente; se non
ce n'è nessuna (la prima notte, o una cartella svuotata a mano) la catena si ferma prima di `verify`
invece di invocarlo con un argomento vuoto. La pulizia guarda in `.local/backups`, dove scrive `create`.

Copiate la cartella fuori dall'host (object storage, un'altra sede): un backup sullo stesso disco del
database non sopravvive al disco.

### Prova completa di ripristino applicativo

Eseguire `npm run backup:drill` dalla radice con Docker attivo, dipendenze installate e Chromium
disponibile (`npx playwright install chromium`). Costruisce le immagini produttive e crea due progetti
Compose con database, code e volumi propri. Pubblica solo API su una porta casuale di loopback;
non accetta argomenti per progetti, database o bucket esistenti.

La sorgente crea due tenant, un valore ambiente cifrato, un test browser pubblicato e un run con
screenshot. Dopo il backup distrugge container e volumi sorgenti. La destinazione verifica checksum,
DB e metadati RLS, ripristina DB ed entrambi gli archivi artefatti, avvia API/worker, esegue login da UI
e apre il report storico. Confronta SHA-256 e dimensioni delle evidenze. Il secondo tenant non deve
vedere i test e riceve 404 su report/artefatti. Un nuovo run avviato da UI deve decifrare il valore
ripristinato, terminare con successo sul worker e produrre nuove evidenze. La connessione applicativa
usa un ruolo non superuser e `app_user` per le query tenant.

`.local/restore-drill/<id>/` contiene `recovery.json`, log operativi/servizi, screenshot dei report,
dimensioni e hash. Ogni fase è misurata in millisecondi; `recoveryDurationMs` va dall'avvio della
destinazione al nuovo report riuscito, `backupAgeAtRecoveryMs` registra l'età del backup.
Build, preparazione fixture e backup hanno tempi separati. L'età non è un RPO produttivo e la fixture
non dimostra uno SLA. La CI conserva evidenze per sette giorni, escludendo backup e Compose temporaneo
con credenziali. Successo ed errori rimuovono gli stack e volumi. Dopo terminazione forzata eliminare
solo i progetti del proprio ID `wfm-drill-source-<id>` e `wfm-drill-target-<id>`.

La prova automatica copre lo **storage locale**. Per S3 recuperare con la procedura esterna di
versioning/replica le versioni oggetto corrispondenti al checkpoint DB in un bucket distinto,
configurare l'installazione isolata con quel bucket e chiave originale, ripetere login, report con
confronto hash, rifiuto dell'altro tenant e nuovo run riuscito. Registrare ID restore/versioni,
conteggi/hash, checkpoint replica/DB e tempi. Senza evidenze del recupero oggetti il collaudo S3 resta
bloccato. Procedura nel repository: `collaudo/application-restore-drill.md`, OPS-29…OPS-31.

### Ripristino senza lo strumento

Per un PostgreSQL gestito, o un'installazione non eseguita con Compose:

1. Ripristinate il database in un server PostgreSQL vuoto: create prima il ruolo `app_user`
   (`CREATE ROLE app_user NOLOGIN`), poi `pg_restore --no-owner`. Verificate che il ruolo di connessione
   sia membro di `app_user` e abbia `BYPASSRLS`: i dump non portano con sé gli attributi dei ruoli, e
   senza di essi il processo web non parte (vedi [Preparare PostgreSQL](./installation#preparare-postgresql)).
2. Avviate i processi con la stessa `ENCRYPTION_KEY`. Prima `node dist/apply-migrations.js` se il codice
   è più recente del backup.
3. Ripristinate gli artefatti negli stessi percorsi o chiavi del bucket; i report vi fanno
   riferimento per percorso.

## Worker persi {#worker-persi}

Un worker che muore o viene isolato a metà esecuzione non riesce mai a scrivere un risultato che
contraddica il verdetto dell'esecuzione (lotto P11):

- **Un worker per esecuzione.** Lo sweep di recupero chiude come `error` / `worker_lost` un'esecuzione
  il cui heartbeat tace da `RUN_STALE_AFTER_MS`. I suoi test in corso diventano _indeterminati_; ciò
  che il worker scrive dopo viene rifiutato. L'esecuzione viene riaccodata solo quando l'impostazione
  **Se un runner si perde durante un test** del piano è _Riesegui il test_ (`worker_loss_policy =
replay`) e ha ancora tentativi — mai per il solo numero di tentativi o per la riesecuzione su
  fallimento.
- **Esecuzioni condivise.** Ogni pezzo di lavoro è tenuto sotto una lease (`WORK_CLAIM_LEASE_MS`,
  default `STALE_CLAIM_MS`, 2 minuti) rinnovata ogni `WORK_ITEM_HEARTBEAT_MS` (15 s). Un worker che
  non riesce a confermare la lease prima della lease meno `WORK_CLAIM_MARGIN_MS` (10 s) ferma da solo
  il pezzo. Un pezzo la cui lease scade dopo l'inizio del test termina _indeterminato_, a meno che il
  piano consenta di rieseguire un singolo test. Le sequenze API concatenate non vengono mai riprese a
  metà.

Tenete `WORK_ITEM_HEARTBEAT_MS` ben sotto la lease meno il margine, e l'orologio dell'host del
database affidabile: la lease si misura con l'orologio del database, il margine con quello monotono
del worker.

Dove guardare: la console dell'esecuzione nomina ogni pezzo perso e il suo epoch; `GET
/api/test-plan-executions/<run>/units` (o `wfm units <run>`) elenca ogni unità attesa con il suo
stato — le unità `indeterminate` riportano il motivo, e i loro tentativi risultano `abandoned`.
Un'esecuzione _completata_ ha sempre un risultato per ogni unità attesa.

**Prova.** Solo su uno stack usa-e-getta — mai su produzione o servizi condivisi —
`npm run load:resilience -- --cycles 1 --worker-restart crash --recovery-timeout 180 --observation-seconds 40`
uccide un worker a metà esecuzione e verifica che l'esecuzione riporti `worker_lost` in modo esplicito,
che nessuna esecuzione completata manchi del risultato di un'unità, che nessuna unità resti `running`
e che nessuna esecuzione ripeta quella persa. Locking e concorrenza su un cluster PostgreSQL reale si
verificano nel pilota (lotto P18).

## Conservazione degli artefatti

Screenshot, video e trace dei run terminati da più di `ARTIFACT_RETENTION_DAYS` giorni (90 di
default) vengono rimossi dal processo web. I run, i loro risultati, step e verdetti restano, e
il report indica quando le immagini sono state rimosse. Le baseline visive non vengono mai
rimosse. `0` conserva tutto.

## Log

Entrambi i processi scrivono log JSON strutturati:

- sullo standard output (testo leggibile in sviluppo, JSON in produzione), perché la piattaforma
  dei container li raccolga;
- in `logs/app-AAAA-MM-GG.log` accanto all'applicazione, ruotati ogni giorno, compressi, e
  rimossi dopo il periodo di conservazione dei log (7 giorni di default);
- su Grafana Loki, quando `LOKI_URL` è impostata. `docker-compose.observability.yml` avvia Loki
  e un Grafana con Loki già configurato come sorgente dati.

Ogni riga di una richiesta porta un correlation id, che anche il client web invia e mostra nei
messaggi di errore. Chi segnala "non ha funzionato" può darvi l'id, e con quello si trovano
tutte le righe di quella richiesta. Password, token e valori segreti vengono mascherati prima
che la riga sia scritta.

**Livello e conservazione dei log** sono impostazioni dell'intera installazione, in
**Impostazioni → Sistema**, salvate nel database. `LOG_LEVEL` e `LOG_RETENTION_DAYS` forniscono
solo il valore del primo avvio; dopo vince l'impostazione salvata. Un nuovo livello si applica
subito al processo web che lo ha salvato; gli altri processi lo leggono al riavvio, e lo stesso
vale per un nuovo periodo di conservazione.

## Recuperare l'accesso {#recuperare-l-accesso}

Un membro che ha dimenticato la password riceve un link di reset da un owner della sua
organizzazione (**Impostazioni → Membri**). Quando nessuno può emetterlo — è proprio l'unico owner
a essere rimasto fuori — lo emette l'operatore dalla riga di comando, su una macchina con
l'ambiente dell'installazione:

```bash
node dist/password-reset-link.js alice               # un'installazione compilata
docker compose exec api node dist/password-reset-link.js alice
npm run user:reset-link -- alice                     # dai sorgenti
```

Stampa un link, valido un giorno e utilizzabile una volta, costruito su `WEBFLOW_PUBLIC_URL`. Il
registro di audit dell'organizzazione annota che l'ha emesso l'operatore. Consegnatelo alla
persona con un canale che ne confermi l'identità.

## Ruotare la chiave di cifratura {#ruotare-la-chiave-di-cifratura}

I segreti salvati sono cifrati con una chiave per organizzazione, e quelle chiavi con la chiave
master derivata da `ENCRYPTION_KEY` ([come sono cifrati i segreti salvati](../security/data-protection#come-sono-cifrati-i-segreti-salvati)).
Entrambe si possono sostituire senza perdere un segreto. Il comando si esegue dai sorgenti, su una
macchina con l'ambiente dell'installazione (`DATABASE_URL`, `ENCRYPTION_KEY` e, durante il cambio
della chiave master, `ENCRYPTION_KEY_PREVIOUS`):

```bash
npm run key:rotate                                 # dopo aver cambiato ENCRYPTION_KEY
npm run key:rotate -- --organization 7 --prune     # una nuova chiave per l'organizzazione 7
npm run key:rotate -- --dry-run                    # cosa cambierebbe; non scrive nulla
```

**La chiave master.** Generate un nuovo valore, impostatelo come `ENCRYPTION_KEY` e mettete quello
che sostituisce in `ENCRYPTION_KEY_PREVIOUS` (separati da virgola se sono più d'uno), sul processo
web, sui worker e sulla macchina che esegue il comando, poi riavviateli: un processo senza la
chiave precedente rifiuta di partire e indica le chiavi di organizzazione che non riesce ad aprire.
Eseguite `npm run key:rotate`. Riavvolge ogni chiave di organizzazione sotto la nuova chiave
master, sposta sulla chiave dell'organizzazione ogni valore ancora cifrato direttamente con una
chiave master (di prima della migrazione 0084) e stampa i conteggi; una seconda esecuzione riporta
zero modifiche. Poi togliete `ENCRYPTION_KEY_PREVIOUS` e riavviate ancora una volta. Un valore che
nessuna chiave configurata apre viene elencato e lasciato com'è, con codice di uscita 1:
aggiungete la chiave con cui era stato scritto a `ENCRYPTION_KEY_PREVIOUS` ed eseguite di nuovo,
oppure sostituite il valore.

**La chiave di un'organizzazione.** `--organization <id>` dà a quell'organizzazione una nuova
versione della chiave, ricifra con essa i suoi segreti e ritira la versione precedente, che resta
finché qualcosa la nomina; `--prune` cancella le versioni ritirate che nessun valore nomina più. I
processi in esecuzione usano la nuova versione entro un minuto. Le altre organizzazioni non
vengono toccate.

Tenete `ENCRYPTION_KEY` fuori dal backup del database, come dice la tabella dei [backup](#backup):
un database ripristinato sotto una chiave master diversa, senza quella vecchia in
`ENCRYPTION_KEY_PREVIOUS`, non può aprire le sue chiavi di organizzazione, e il processo web lo
dice all'avvio invece di far fallire il primo run che ha bisogno di un segreto.

## Monitoraggio

| Cosa                 | Segnale                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Processo web attivo  | `GET /healthz` risponde `200` senza toccare alcuna dipendenza: usatelo come liveness probe, così un'interruzione del database non fa riavviare il processo.                                                                                                                                                                                                                               |
| Processo web pronto  | `GET /readyz` risponde `200` quando PostgreSQL, il Redis di code e rate limit e lo store delle sessioni rispondono entro 2 secondi; altrimenti `503` con il controllo fallito, ad esempio `{"status":"not ready","checks":{"database":"failed","redis":"ok","sessions":"ok"}}`. L'`HEALTHCHECK` dell'immagine e un load balancer usano questo. Nessuno dei due richiede sessione o token. |
| Worker               | **Impostazioni → Runner**: online, in svuotamento o offline, con i job in corso e la versione. Un runner non sentito da `RUNNER_OFFLINE_AFTER_MS` è offline.                                                                                                                                                                                                                              |
| Pressione sulla coda | **Impostazioni → Utilizzo dei run**: run in corso e in attesa dell'organizzazione rispetto ai suoi limiti, e quanti runner sono online.                                                                                                                                                                                                                                                   |
| Run persi            | Run che terminano in _errore_ con motivo `worker_lost`: un worker è morto o è stato riavviato durante il run.                                                                                                                                                                                                                                                                             |
| Timeout              | Run che terminano _scaduti_: oltre `RUN_MAX_DURATION_MS`.                                                                                                                                                                                                                                                                                                                                 |
| Integrazioni         | Gli errori di invio sono mostrati su ogni collegamento GitHub/GitLab e issue tracker in Impostazioni.                                                                                                                                                                                                                                                                                     |

## Capacità e limiti {#capacita-e-limiti}

Tre numeri decidono quanto gira contemporaneamente; ciascuno è descritto nel
[riferimento della configurazione](./configuration#esecuzione-dei-piani).

- **Per worker:** `WORKER_CONCURRENCY` piani alla volta, e `BROWSER_TASK_CONCURRENCY` anteprime e
  caricamenti di pagina alla volta, su una coda separata. Una [sessione di debug](../guide/web-tests#debug)
  occupa uno di questi posti finché resta aperta, pausa compresa: al massimo 15 minuti senza
  comandi, una sessione per persona. Stato e comandi passano da Redis.
- **Per run:** il parallelismo del piano, limitato da `RUN_MAX_PARALLEL` sessioni browser.
- **Per organizzazione:** `ORG_MAX_CONCURRENT_RUNS` in corso e `ORG_MAX_QUEUED_RUNS` in attesa.
  Oltre il secondo, un nuovo run viene rifiutato con `429`. Tra i run in attesa passa prima
  l'organizzazione che ne ha meno in corso.

Gli amministratori dell'installazione configurano modalità e override in
[Impostazioni → Amministrazione quote](./administration#quotas). `TENANT_QUOTA_MODE=off` consente
uso locale gratuito senza controllo delle quote; `monitor` misura soltanto. Limiti dei test,
spazio e minuti mensili UTC restano indipendenti dai pagamenti. Il ruolo database applicativo
non modifica le quote; il servizio amministrativo le salva con revisione e audit. È disponibile
anche la configurazione SQL per gli operatori:

```sql
-- come proprietario del database; NULL torna al default dell'installazione
UPDATE organizations SET max_concurrent_runs = 5, max_queued_runs = 300 WHERE id = 42;
```

### Misurarla {#prova-di-carico}

`scripts/wfm-load.ts` carica un'installazione come fanno le pipeline, tramite `/api/v1`, e dice se
ha retto:

```bash
npx tsx scripts/wfm-load.ts --url https://wfm.example.com \
  --target <chiave A>:<id piano A> --target <chiave B>:<id piano B> \
  --readers 10 --read-seconds 30 --runs 10 --max-concurrent 2 --json carico.json
```

Ogni target è una chiave API (scope `plans:read`, `runs:read`, `runs:write`) e un piano di
un'organizzazione; datene uno per organizzazione per vedere come si dividono i runner. Usate un
piano leggero — un test API verso qualcosa di vicino — a meno che non vogliate caricare proprio i
browser; i suoi run restano nella cronologia del piano. Prima `--readers` client elencano piani e
run per `--read-seconds` (latenza p50/p95/p99, richieste al secondo, errori; i `429` di
`API_RATE_LIMIT` sono contati a parte, quindi mettetelo a `0` durante la misura). Poi partono
insieme `--runs` run di ogni piano, seguiti fino alla fine: quanto hanno aspettato e girato, come
sono finiti, quanti la coda ha rifiutato, e il massimo in corso insieme per organizzazione,
ricavato dagli orari di inizio e fine. Esce con `1` quando una soglia è superata — p95 delle letture
oltre `--max-p95-ms` (1000), errori oltre `--max-error-rate` (0), più run in corso di
`--max-concurrent`, un run finito diversamente da `completed`, o non finito entro `--run-timeout` —
e con `0` altrimenti.

Un run trattenuto dal limite della sua organizzazione parte appena finisce uno dei run
dell'organizzazione: la fine promuove i run in attesa più vecchi, tanti quanti sono i posti liberi
(`server/execution/run-promotion.ts`). `RUN_DEFERRAL_MS` (10 s) resta solo come riserva, per una promozione
persa mentre un processo ripartiva. In una misura con due run insieme e run di 2 s, otto run per
organizzazione sono finiti dopo 9 s, dove aspettare il controllo successivo ne richiedeva 33.

## Risoluzione dei problemi

| Sintomo                                                                                         | Causa probabile                                                                                             | Cosa fare                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Il server esce all'avvio citando `app_user`, `BYPASSRLS` o `SET ROLE`                           | I ruoli del database non sono come li richiede la tenancy                                                   | Eseguite il comando indicato nel messaggio (vedi [Preparare PostgreSQL](./installation#preparare-postgresql)).                                                    |
| `db:migrate` si ferma con `permission denied to create role`                                    | Il ruolo che esegue le migrazioni non può creare `app_user`                                                 | `ALTER ROLE <ruolo> CREATEROLE;` come superuser, rieseguite le migrazioni, poi `NOCREATEROLE` (vedi [Preparare PostgreSQL](./installation#preparare-postgresql)). |
| Il server esce dicendo che il database è stato creato con `db:push`                             | Tabelle presenti senza il journal delle migrazioni                                                          | `npm run db:doctor`; ricreate il database con `db:migrate`.                                                                                                       |
| `SESSION_SECRET must be set` o `ENCRYPTION_KEY is missing`                                      | Un segreto non è impostato in quel processo                                                                 | Impostatelo (vedi [Segreti](./installation#segreti)); anche i worker hanno bisogno di `ENCRYPTION_KEY`.                                                           |
| I segreti salvati non si decifrano dopo uno spostamento o un ripristino                         | Una `ENCRYPTION_KEY` diversa                                                                                | Usate la chiave con cui sono stati salvati; non c'è altro modo di leggerli.                                                                                       |
| `Session Redis is not connected. Refusing to start in production`                               | Redis non raggiungibile all'avvio                                                                           | Controllate `REDIS_URL` e che Redis accetti connessioni da questa macchina.                                                                                       |
| La registrazione risponde "Accounts on this installation are created by invitation"             | `REGISTRATION=invitation` (il default) e un account esiste già                                              | Invitate la persona da **Impostazioni → Membri**, oppure impostate `REGISTRATION=open` se la registrazione deve essere pubblica.                                  |
| L'accesso risponde OK ma la pagina successiva risulta disconnessa                               | Cookie Secure su HTTP semplice                                                                              | Servite su HTTPS; solo per uno stack locale, `SESSION_COOKIE_SECURE=false`.                                                                                       |
| `403` su ogni salvataggio dietro un proxy                                                       | L'origine pubblica è diversa dall'`Host` che vede il server                                                 | Aggiungetela a `CSRF_TRUSTED_ORIGINS`.                                                                                                                            |
| Pagina bianca, o parti mancanti, con errori `Content Security Policy` nella console del browser | Qualcosa inietta o carica script da altrove (un proxy, un'estensione del browser, una build personalizzata) | Rimuovete ciò che li inietta; per confermare la causa, `CONTENT_SECURITY_POLICY=report-only` e leggete la console.                                                |
| Le pipeline ricevono `429 rate_limited`                                                         | Una chiave ha fatto più di `API_RATE_LIMIT` chiamate in un minuto                                           | Interrogate meno spesso, date a ogni pipeline la sua chiave, o alzate `API_RATE_LIMIT`.                                                                           |
| Impostazioni → Sistema è in sola lettura, e i runner non hanno il pulsante Svuota               | Le impostazioni dell'installazione spettano ai suoi amministratori                                          | Aggiungete il nome utente a `INSTALLATION_ADMINS` (vedi [Amministratori dell'installazione](./administration#amministratori-dell-installazione)).                 |
| I run restano _in coda_                                                                         | Nessun runner online, l'organizzazione al limite, o runner svuotati                                         | Impostazioni → Runner e Impostazioni → Utilizzo dei run.                                                                                                          |
| I run terminano _errore: worker lost_                                                           | Worker riavviati o terminati (spesso per memoria esaurita)                                                  | Log e memoria dei worker; abbassate `WORKER_CONCURRENCY` o il parallelismo del piano.                                                                             |
| Anteprime e caricamenti di pagina falliscono con "No worker is running to open a browser"       | `BROWSER_TASKS=worker` e nessun worker attivo                                                               | Avviate un worker, o `BROWSER_TASKS=inline` su una sola macchina.                                                                                                 |
| Anteprime e caricamenti di pagina rispondono `504`                                              | Il task ha superato `BROWSER_TASK_TIMEOUT_MS`, di solito perché i worker sono occupati                      | Più worker o un `BROWSER_TASK_CONCURRENCY` più alto.                                                                                                              |
| Screenshot mancanti nei report                                                                  | Worker e processo web su dischi diversi con l'archivio locale                                               | `ARTIFACT_STORE=s3`.                                                                                                                                              |
| Ogni schedulazione parte due volte                                                              | Più processi web con `SCHEDULER_BACKEND=cron`                                                               | `SCHEDULER_BACKEND=bullmq` su tutti.                                                                                                                              |
| I run su un agente locale falliscono con "relay could not be reached"                           | I worker non sanno dove sia il relay                                                                        | `AGENT_RELAY_URL` sui worker; lo stesso `AGENT_RELAY_SECRET` ovunque.                                                                                             |
| Le funzioni AI non compaiono                                                                    | Nessuna chiave AI                                                                                           | Impostate `GEMINI_API_KEY`; tutto il resto funziona anche senza.                                                                                                  |

## Prometheus e OpenTelemetry

Vedere [Metriche e tracing distribuito](./telemetry.md) per attese in coda, utilizzo worker/agenti, scrape autenticati e configurazione OTLP.

Per distribuire immagini versionate con SBOM, scansioni e digest immutabili, seguire [Release riproducibili](./releases).
