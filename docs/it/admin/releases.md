# Release riproducibili

Il workflow di rilascio costruisce tre immagini: API, worker e agente locale. Registra commit,
dipendenze bloccate, digest delle basi, impronte SQL delle migrazioni, SBOM, rapporti di vulnerabilità
e digest del registry. L'installazione usa questi digest senza ricompilare il codice o seguire tag
mobili. Il primo target verificabile è **Linux amd64**.

## Input e contratto di riproducibilità

`Dockerfile`, `Dockerfile.worker` e `Dockerfile.agent` fissano la base Playwright con versione **e
digest SHA-256**, coerenti con il lockfile npm principale. Le dipendenze usano `npm ci`.
Lighthouse ha un lockfile separato in `deployment/lighthouse`: non viene più installato globalmente
risolvendo nuovamente le dipendenze. L'agente copia l'albero di produzione costruito dal lockfile
principale. Questo aumenta il numero di dipendenze presenti; SBOM e scansione le comprendono.
L'argomento `PLAYWRIGHT_VERSION` serve soltanto alla fixture di collaudo della versione incompatibile:
il workflow di rilascio non lo passa.

`deployment/releases/toolchain.json` fissa Buildx, BuildKit e Trivy. Le action sono fissate per commit.
`SOURCE_DATE_EPOCH` deriva dalla data del commit; l'esportatore normalizza i timestamp dei file.
Per ciascun ruolo vengono eseguite due build senza cache, con stessi input, piattaforma e argomenti.
Devono coincidere i digest della configurazione Docker, che comprendono gli identificatori del
contenuto dei layer non compressi. Questo è il contratto controllato: non promette tar esterni
identici byte per byte o database degli advisory identici in giorni diversi. I registry dei pacchetti
devono restare disponibili; un pacchetto mancante causa errore, senza sostituirlo con altre versioni.

Le build rimuovono log/cache npm e cache bytecode Node nello stesso layer che li genera: la pulizia in un layer successivo non renderebbe riproducibili quelli precedenti.

Il processo gira come `pwuser`. Lo smoke test nel container scrive nelle directory operative,
verifica la CLI Lighthouse su API/worker e avvia Chromium reale. I bind mount e i volumi nominati esistenti devono
essere scrivibili dall'UID numerico dell'utente: verificarlo con
`docker run --rm --entrypoint id IMAGE` e adeguare solo le directory degli artefatti interessate.
I nuovi volumi nominati ereditano i permessi dell'immagine. Il collaudo completo con autenticazione
resta un'attività distinta, descritta nella [guida ai test](./test-lab).

## Candidati, scansioni e pubblicazione

Le PR che modificano packaging o input applicativi e le esecuzioni manuali costruiscono candidati,
senza permesso di scrittura sul registry. Il push di `vX.Y.Z`, anche prerelease SemVer valida,
abilita la pubblicazione soltanto quando:

- Il tag coincide con la versione di `package.json` e `package-lock.json`.
- Il commit appartiene a `origin/main`.
- Gli ultimi controlli GitHub Actions `build-and-test`, `network-on-guarded-installation`,
  `ui-on-real-installation` e `rls-on-real-postgres` sono riusciti sullo stesso commit.
- Le scansioni dei lockfile e di tutte e tre le immagini non contengono vulnerabilità HIGH o
  CRITICAL, comprese quelle senza correzione. Rapporti mancanti o malformati bloccano il rilascio.
- Smoke test e due build indipendenti riescono per ogni ruolo.

Trivy produce una SBOM CycloneDX JSON e un rapporto JSON completo per ogni immagine. Sono
conservati anche versione dello scanner e metadati del database utilizzato. I rapporti mantengono
i rilievi di gravità inferiore per la valutazione. Non esistono eccezioni predefinite o flag
`ignore-unfixed`. Se una scansione blocca il rilascio, individuare pacchetto/base, aggiornare una
versione compatibile bloccata, revisionare e ripetere i controlli. Un'eventuale eccezione temporanea
richiederebbe una policy separata revisionata, con responsabile, scadenza e ID: qui non è implementata.
Errori dello scanner o nel download del database fermano la pubblicazione. Nuovi advisory possono
cambiare l'idoneità di un'immagine anche quando il suo contenuto non cambia.

Il workflow promuove **l'archivio scansionato**, verifica SHA-256 e configurazione caricata, e
pubblica `ghcr.io/OWNER/REPOSITORY-api`, `-worker`, `-agent` con tag versione e commit completo.
Rifiuta di sovrascrivere un tag con contenuto diverso e controlla che entrambi i tag abbiano lo
stesso digest. Non scrive `latest`. La promozione dei tre ruoli non è una transazione: un errore
può lasciare solo alcune immagini verificate. Ripetere sullo stesso tag per riutilizzare il contenuto
coincidente; installare soltanto quando esiste il manifest completo.

Una **release GitHub draft** raccoglie `release-manifest.json`, `release.env`, rapporti sorgente e
SBOM/rapporto/metadati scanner di ogni immagine. Revisionarla prima di pubblicarla. Le riesecuzioni
non modificano release GitHub già pubblicate. Le evidenze dei candidati durano 30 giorni; gli
archivi immagine 7 giorni. Scaricarli prima della scadenza. Gli allegati della release pubblicata
sono il registro duraturo della distribuzione: archiviarli con l'inventario dell'installazione.

## Procedura per l'operatore

1. Configurare i permessi Actions per creare pacchetti GHCR. Limitare tag `v*` e modifiche di main
   ai manutentori autorizzati e mantenere i controlli CI obbligatori. Scegliere esplicitamente la
   visibilità dei pacchetti; quelli privati richiedono credenziali di sola lettura sugli host.
2. Aggiornare insieme versione del pacchetto e lockfile in una PR revisionata. Per Playwright,
   aggiornare tutte le basi al tag ufficiale coerente e **verificarne il digest nel registry**.
   Aggiornare toolchain e lock Lighthouse con modifiche revisionate, evitando override mobili in CI.
3. Fare merge e attendere i quattro controlli sul commit risultante in main, poi creare e fare push
   del suo tag `vVERSION`. Se i controlli sono pendenti o falliti, il rilascio attende; rieseguire dopo
   il loro completamento.
4. Esaminare draft, rapporti, evidenze di ricostruzione e manifest. Controllare commit e journal
   delle migrazioni prima della pubblicazione e conservare il manifest della versione precedente.
5. Scaricare `release.env` dalla release verificata. Fornire segreti e connessioni in un file protetto
   `installation.env`, mai nel repository. `MIGRATION_DATABASE_URL` usa il proprietario delle
   migrazioni; `DATABASE_URL` usa il ruolo applicativo non-superuser per preservare RLS.

```sh
docker compose --env-file installation.env --env-file release.env \
  -f deployment/releases/compose.yml config --quiet
docker compose --env-file installation.env --env-file release.env \
  -f deployment/releases/compose.yml pull
# Dopo backup verificato di database/artefatti e finestra di manutenzione approvata:
docker compose --env-file installation.env --env-file release.env \
  -f deployment/releases/compose.yml up -d
```

Questo Compose contiene solo l'applicazione: PostgreSQL e Redis/Valkey esterni, artefatti condivisi,
migrator dalla stessa immagine API e API esposta soltanto su loopback. Configurare reverse proxy
HTTPS e opzioni necessarie seguendo [installazione](./installation) e [configurazione](./configuration).
TLS, database, backup e immagini infrastrutturali sono gestiti dall'operatore e non fanno parte
degli artefatti applicativi certificati. Bloccare anche le loro versioni/digest nell'inventario.
Non sovrapporre questo file al Compose di sviluppo, che ricompila sorgenti e usa credenziali demo.

Avviare l'agente nella rete del cliente con `WFM_AGENT_IMAGE` da `release.env`, `WFM_URL` e il suo
`WFM_AGENT_TOKEN`; vedere [agenti](../internals/agents). L'immagine di supporto BDD in `deployment/bdd-agent`
è un esempio operatore separato, non un quarto artefatto certificato. Se usata, adattarne la base
al digest dell'agente verificato, bloccare il profilo e conservarne le evidenze separate.

## Aggiornamento, rollback ed evidenze

Provare prima in staging. Eseguire e verificare backup di PostgreSQL e artefatti, annotare i digest
attuali, applicare le migrazioni e avviare API/worker nuovi. Verificare disponibilità, login, esecuzione
in coda e lettura degli artefatti; confrontare i digest installati con il manifest e registrare ciclo
di collaudo e commit. Una build candidata non equivale a una release installata.

Ripristinare i riferimenti delle immagini **non** annulla le migrazioni. Usare le immagini precedenti
solo se compatibili con lo schema nuovo; altrimenti ripristinare database e artefatti dal backup
verificato durante un'interruzione controllata. Seguire [operatività](./operations) e il runbook backup.
Non sono garantiti downgrade automatico o migrazioni senza interruzione.

`npm run test:release` verifica packaging e guardie senza database. Da checkout pulito e committato,
`GITHUB_REPOSITORY=owner/repository node scripts/release/prepare.mjs` prepara metadati candidati.
Il workflow esegue ricostruzioni e scansioni complete. Prima di un workflow riuscito sul tag,
i test locali non dimostrano pubblicazione sul registry o certificazione della release.

Il contratto sui timestamp segue la [guida Docker](https://docs.docker.com/build/ci/github-actions/reproducible-builds/)
e le [opzioni dell'esportatore](https://docs.docker.com/build/exporters/image-registry/).
Per le gravità vedere [Trivy](https://trivy.dev/docs/latest/configuration/filtering/).

## Baseline del 6 ottobre 2026

La scansione diagnostica dei lockfile ha rilevato 36 occorrenze HIGH/CRITICAL: 10 nel lock principale, 3 in Lighthouse, 22 nel lock client separato e 1 negli strumenti video. La baseline in `deployment/releases/baseline-2026-10-06.json` conserva ID, versioni, impronte degli input e metadati scanner. Il lock client separato non governa `npm ci` della workspace, ma è incluso nell’inventario dei lockfile presenti. La scansione include anche sviluppo e strumenti: il candidato resta bloccato finché tutti i rilievi nel perimetro sono risolti o una policy diversa viene revisionata esplicitamente. Nessuna eccezione è stata aggiunta. Questo rapporto non certifica le immagini né sostituisce nuove scansioni sul tag.

### Capacità del runner

Ogni ruolo usa un job separato. Il controllo iniziale richiede almeno 20 GiB liberi per build doppie, immagine caricata, archivi e database Trivy. Nella prova locale gli archivi Docker sono circa 1,2 GB per API/worker e 952 MB per agente; la cache Trivy occupa 2,8 GB. Le dimensioni cambiano con le dipendenze. Se il controllo fallisce, aumentare lo spazio del runner; non ridurre scansioni o confronti per far entrare il job. La capacità effettiva del runner GitHub va confermata dal primo workflow.

Il modello delle variabili necessarie è `deployment/releases/installation.env.example`. Gli ulteriori parametri applicativi vanno dichiarati nella sezione `environment` di un override Compose: `--env-file` fornisce valori per le sostituzioni del template e non inserisce automaticamente tutte le variabili nei container.
