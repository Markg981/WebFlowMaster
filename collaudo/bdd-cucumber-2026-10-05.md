# BDD/Cucumber — evidenze di accettazione

Branch `codex/bdd-cucumber-execution`. Il catalogo versione 23 aggiunge BDD-01–BDD-11 senza cambiare casi o risultati storici.

## Evidenze verificate

- Parser ufficiale multilingua e round-trip: 56 test passati; Rule, Background, Examples selezionati, doc string e tabelle con escape.
- Profili/import: 59 test mirati PGlite e 33 su PostgreSQL reale, inclusi isolamento tra organizzazioni e progetti riservati. Aggiunto il vincolo composito profilo/progetto nella migrazione 0080.
- Runtime dedicato: 21 test con processi Cucumber reali, CJS/ESM/TypeScript, World, hook, verdetti negativi, deadline/disconnessione, limiti e pulizia dei discendenti.
- Integrazione: 14 test mirati, inclusi rilascio dello slot HTTP prima di Cucumber, preservazione dei verdetti durante la redazione e limite dell’intero risultato persistito a 8 MiB.
- Client: regressione finale di 88 file / 505 test passati, inclusi i casi dell’editor e dell’anteprima.
- Interfaccia su installazione reale: `e2e/bdd.spec.ts` passato con PostgreSQL, API e worker compilati e agente autenticato a un solo slot. Import, profilo, selettore invalido, pubblicazione, modifica draft, due righe dataset e due shard; eseguito il sorgente pubblicato e mostrati allegati text/plain con escape e redazione.
- Immagini agente e supporto ricostruite. Container Linux non root, filesystem di sola lettura, capabilities rimosse e tmpfs 128 MiB: scenari JS/TS passati, discendente con stdio ereditato terminato. Lo scenario Cucumber sulla rete `none` conferma il blocco di metadata, gateway database e destinazione pubblica.

## Limiti dell’evidenza

Le prove automatiche non segnano come eseguiti tutti i casi manuali del catalogo. Il test Linux usa una rete senza egress: non certifica una configurazione Kubernetes o un firewall del cliente. Prima dell’uso, l’operatore deve applicare e verificare la propria rete protetta secondo `deployment/bdd-agent/README.md`.

## Verifiche di consegna

- Suite completa PostgreSQL: 17 file / 145 test passati su un database nuovo con ruolo applicativo non superuser e `SET LOCAL ROLE app_user`.
- Installazione reale: 10 percorsi E2E passati. BDD include precondizioni e cleanup HTTP nello stesso pool dedicato a un solo slot, due righe dataset e pubblicazione immutabile.
- Typecheck, build completa di applicazione/CLI/agente/migrator, build documentazione e 13 test dell’app Collaudo passati. Lint del codice del progetto: zero errori, 12 warning; esclusa la directory locale non versionata `tmp`.
- PR [#294](https://github.com/Markg981/WebFlowMaster/pull/294): l’esito definitivo della regressione server e dei quattro job CI è riportato nei controlli della PR e nella descrizione di consegna.
