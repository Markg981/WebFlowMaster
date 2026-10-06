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
- Le scansioni delle tre immagini non contengono HIGH o CRITICAL, compresi quelli senza fix.
  I rilievi dei lockfile devono essere risolti o soddisfare l’esatta eccezione sorgenti approvata sotto.
  Rapporti mancanti/malformati, copertura sorgenti incompleta o errori scanner bloccano il rilascio.
- Smoke test e due build indipendenti riescono per ogni ruolo.

Trivy produce una SBOM CycloneDX JSON e un rapporto JSON completo per ogni immagine. Sono
conservati anche versione dello scanner e metadati del database utilizzato. I rapporti mantengono
i rilievi di gravità inferiore per la valutazione. Non si usano ignore generici o flag
`ignore-unfixed`. L’unica eccezione approvata è quella temporanea per i sorgenti in
`deployment/releases/source-exceptions.json`, descritta sotto; non vale per le immagini.
Gli altri rilievi bloccanti richiedono aggiornamento compatibile fissato, revisione e nuove scansioni.
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

La scansione diagnostica dei lockfile ha rilevato 36 occorrenze HIGH/CRITICAL: 10 nel lock principale, 3 in Lighthouse, 22 nel lock client separato e 1 negli strumenti video. La baseline in `deployment/releases/baseline-2026-10-06.json` conserva ID, versioni, impronte degli input e metadati scanner. Il lock client separato non governa `npm ci` della workspace, ma è incluso nell’inventario dei lockfile presenti. La scansione include anche sviluppo e strumenti: il candidato resta bloccato finché tutti i rilievi nel perimetro sono risolti o una policy diversa viene revisionata esplicitamente. Alla baseline non erano presenti eccezioni; quella sorgenti approvata successivamente e descritta sotto è condizionata. Questo rapporto non certifica le immagini né sostituisce nuove scansioni sul tag.

### Capacità del runner

Ogni ruolo usa un job separato. Il controllo iniziale richiede almeno 20 GiB liberi per build doppie, immagine caricata, archivi e database Trivy. Nella prova locale gli archivi Docker sono circa 1,2 GB per API/worker e 952 MB per agente; la cache Trivy occupa 2,8 GB. Le dimensioni cambiano con le dipendenze. Se il controllo fallisce, aumentare lo spazio del runner; non ridurre scansioni o confronti per far entrare il job. La capacità effettiva del runner GitHub va confermata dal primo workflow.

Il modello delle variabili necessarie è `deployment/releases/installation.env.example`. Gli ulteriori parametri applicativi vanno dichiarati nella sezione `environment` di un override Compose: `--env-file` fornisce valori per le sostituzioni del template e non inserisce automaticamente tutte le variabili nei container.

## Correzioni delle dipendenze del 6 ottobre 2026

Il candidato successivo usa Playwright 1.63.0 su Ubuntu 26.04 (Resolute), con digest fissato,
Nodemailer 10.0.15 con i tipi inclusi nel pacchetto e Lighthouse 13.5.0. Sono
aggiornati anche proxy-addr, source-map-js, undici e Vite. Il lock client separato,
che descriveva un manifest precedente, è rigenerato dal manifest attuale; il lock
degli strumenti video usa source-map-js corretto. La baseline iniziale resta
conservata per il confronto, non rappresenta lo stato di questo candidato.

L'installazione di produzione usa `npm ci --omit=dev --workspaces=false`: il client
viene già compilato durante la build e i suoi strumenti non servono al runtime.
Le immagini finali rimuovono npm globale; l'avvio API, worker, agente e child BDD
usa direttamente Node. Installare le dipendenze di progetti BDD esterni nella
relativa immagine di supporto, secondo la procedura BDD, prima dell'esecuzione.
Il lock workspace può conservare dipendenze transitive orfane anche escludendo le
workspace. `scripts/release/runtime-tools.mjs` rimuove soltanto fast-glob,
micromatch e braces dopo aver verificato che nessuno sia raggiungibile dalle
dipendenze di produzione, inclusi peer e optional installati. Dipendenze richieste
mancanti, symlink o percorsi esterni interrompono la build. Lo smoke delle immagini
verifica Chromium, Firefox e WebKit: non rimuoviamo librerie multimediali necessarie
a WebKit per nascondere i rilievi del sistema operativo.

La scansione dei cinque lockfile dopo gli aggiornamenti contiene due occorrenze
HIGH di **CVE-2026-93687**, entrambe per braces 3.0.3 (lock principale e client).
Non esiste una versione correttiva pubblicata: vedere
[la segnalazione upstream](https://github.com/micromatch/braces/issues/73).
`scripts/security/apply-braces-patch.cjs` applica una mitigazione temporanea alla
profondità di parsing, con limite 100, mantenendo identità e versione originali.
Lo script verifica versione e hash del parser, è idempotente ed è eseguito dai
postinstall principale e client. Cambiamenti upstream inattesi interrompono
l'installazione per richiedere una revisione della patch.

Eseguire `npm run test:security` dopo `npm ci`: verifica glob normali, rifiuto
dell'annidamento e composizione email reale. `--ignore-scripts` non applica la
mitigazione. Il controllo di release include l'impronta della patch e dei manifest
client.

### Eccezione temporanea sorgenti approvata

L’utente ha approvato esplicitamente un’eccezione limitata ai sorgenti per **CVE-2026-93687**,
pacchetto **braces 3.0.3**, esclusivamente in `package-lock.json` e `client/package-lock.json`,
con scadenza **6 novembre 2026**. La configurazione revisionabile è
`deployment/releases/source-exceptions.json`. Il rilievo scanner resta riconosciuto: non si
dichiara un fix upstream e non si cambia l’identità del pacchetto.

L’accettazione richiede installazioni nuove principale e client separato e verifica riuscita
di integrità e limite di profondità di **ogni copia braces installata nei due alberi**.
Verificare i parser reali contro patch/hash attesi, comportamento dei glob ordinari e rifiuto
oltre profondità 100. Copie mancanti, contenuto parser inatteso, validazione fallita, policy
scaduta, versioni/percorsi non previsti o scansioni incomplete bloccano l’accettazione sorgenti.
`--ignore-scripts` da solo non soddisfa la condizione.

Il rapporto Trivy sorgenti originale e completo resta un artefatto, inclusi i due rilievi;
le evidenze dell’eccezione accettata sono separate e identificano policy, validazione e rilievi
corrispondenti. Nessun rilievo delle immagini è accettato, non si aggiungono ignore generici o
`ignore-unfixed` e ogni altro HIGH/CRITICAL resta bloccante. Rinnovo o estensione richiedono
revisione e approvazione esplicite; privilegiare un fix upstream verificato prima della scadenza.

L’approvazione non prova che CI/tag attuale soddisfi le condizioni. L’idoneità della release
richiede validazione riuscita, scansioni nuove complete e tutti gli altri gate.

Rimuovere la patch soltanto dopo un aggiornamento ufficiale con protezione
equivalente e nuove prove. Consultare il protocollo Collaudo 28 per le evidenze.

### Correzioni della base ed evidenze delle immagini

Ogni stage di build/runtime applica `deployment/releases/harden-base.sh`. Installa
le versioni Ubuntu esatte `3.5.5-1ubuntu3.7` di libssl3t64, openssl e
openssl-provider-legacy, elimina `/usr/bin/pebble`, gestore di servizi inutilizzato,
e mantiene UID/GID 1000 di `pwuser` per i volumi esistenti. npm globale è eliminato
soltanto dagli stage finali. Indici, cache e log variabili APT sono rimossi prima
dell'esportazione dei layer. Se una versione fissata scompare dai repository
Ubuntu firmati, la build fallisce: valutare una versione corretta successiva,
aggiornare il pin e ripetere scansioni, prove browser e doppie build. Non
installare automaticamente la versione latest.

Le scansioni locali di API, worker e agent riportano ciascuna **zero HIGH/CRITICAL**,
contro 31, 31 e 28 della baseline. Le due build senza cache di ogni ruolo producono
configurazioni e ID dei layer decompressi identici; i tre browser funzionano con
UID/GID 1000. API supera anche scritture su volumi anonimi temporanei e un audit
HTTP reale di Lighthouse 13.5.0 con rapporti JSON e HTML. Il fixture AGT-05 con
mismatch intenzionale continua a compilare con Playwright 1.60.0 ed è escluso
dalle immagini di release.

`deployment/releases/remediation-2026-10-06.json` registra hash, versione scanner
e database, ID delle configurazioni, numero di componenti SBOM e limiti delle
prove. I rapporti locali completi sono in
`outputs/security-remediation-2026-10-06/`, esclusa da Git. Le prove usano uno
snapshot congelato del candidato, epoch 1700000000 e Buildx locale 0.37.1,
mentre CI usa 0.37.2. Non certificano il tag finale né il workflow ospitato. I due rilievi
sorgenti residui richiedono l’eccezione separata approvata e le relative prove di validazione;
le sole scansioni immagini pulite non soddisfano queste condizioni.
