# BDD/Cucumber — evidenze di accettazione

Branch `codex/bdd-cucumber-execution`. Il catalogo versione 23 aggiunge BDD-01–BDD-11 senza cambiare casi o risultati storici.

## Evidenze verificate

- Parser ufficiale multilingua e round-trip: 56 test passati; Rule, Background, Examples selezionati, doc string e tabelle con escape.
- Profili/import: 59 test mirati PGlite e 33 su PostgreSQL reale, inclusi isolamento tra organizzazioni e progetti riservati. Aggiunto il vincolo composito profilo/progetto nella migrazione 0080.
- Runtime dedicato: 21 test con processi Cucumber reali, CJS/ESM/TypeScript, World, hook, verdetti negativi, deadline/disconnessione, limiti e pulizia dei discendenti.
- Integrazione: 14 test mirati, inclusi rilascio dello slot HTTP prima di Cucumber, preservazione dei verdetti durante la redazione e limite dell’intero risultato persistito a 8 MiB.
- Client: 88 file / 496 test passati; correzioni successive dell’editor e dell’anteprima verificate con 20 test mirati.
- Interfaccia su installazione reale: `e2e/bdd.spec.ts` passato con PostgreSQL, API e worker compilati e agente autenticato a un solo slot. Import, profilo, selettore invalido, pubblicazione, modifica draft, due righe dataset e due shard; eseguito il sorgente pubblicato e mostrati allegati text/plain con escape e redazione.
- Immagini agente e supporto ricostruite. Container Linux non root, filesystem di sola lettura, capabilities rimosse e tmpfs 128 MiB: scenari JS/TS passati, discendente con stdio ereditato terminato. Lo scenario Cucumber sulla rete `none` conferma il blocco di metadata, gateway database e destinazione pubblica.

## Limiti dell’evidenza

Le prove automatiche non segnano come eseguiti tutti i casi manuali del catalogo. Il test Linux usa una rete senza egress: non certifica una configurazione Kubernetes o un firewall del cliente. Prima dell’uso, l’operatore deve applicare e verificare la propria rete protetta secondo `deployment/bdd-agent/README.md`.

La regressione completa, il percorso E2E con precondizioni/cleanup HTTP e i controlli CI della PR sono registrati nella sezione di consegna quando completati.
