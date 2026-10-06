# Documentazione di WebFlowMaster

WebFlowMaster è una piattaforma di automazione dei test per applicazioni web, API HTTP e app mobili native: si registrano
o si descrivono i test, si organizzano in piani e suite, si eseguono su più browser, a orario o dalla
CI — anche dentro reti che il server non raggiunge — e ogni esecuzione produce un report dettagliato.

**Prima volta qui?** Leggi [WebFlowMaster in breve](./overview): cos'è, com'è fatto e dove si trova ogni cosa.

**Da condividere con i colleghi:** il [manuale dell'intera suite](./internals/suite-handbook)
collega funzionalità, flussi e architettura. Il [percorso di contribuzione](./internals/contributing-guide)
mostra come implementare un miglioramento; l'[audit](./internals/product-audit) spiega le priorità proposte.

## Guida utente

Per chi scrive ed esegue i test:

- [Primi passi](./guide/) — accesso, orientarsi, un primo test dall'inizio alla fine.
- [Test web](./guide/web-tests) · [Test API](./guide/api-tests) · [App mobili](./guide/mobile-apps) ·
  [BDD / Cucumber](./guide/bdd-tests) ·
  [Organizzare i test](./guide/organizing) · [Eseguire i test](./guide/running) ·
  [Risultati](./guide/results)

## Installazione e amministrazione

Per chi gestisce un'installazione e per gli owner di un'organizzazione:

- [Installazione](./admin/installation) — configurazioni, Docker Compose, PostgreSQL, segreti, reverse proxy.
- [Operatività](./admin/operations) — aggiornamenti, backup, log, monitoraggio, risoluzione dei problemi.
- [Metriche e tracing](./admin/telemetry) — Prometheus e OpenTelemetry, configurazione e verifica.
- [Riferimento della configurazione](./admin/configuration) — tutte le variabili d'ambiente.
- [Amministrazione](./admin/administration) — ruoli, membri, chiavi, sicurezza, audit, dati.
- [Ambiente di collaudo](./admin/test-lab) — l'ambiente di accettazione: HTTPS, identity provider, strumenti simulati, Jenkins, emulatore Android.

## Sicurezza e compliance

- [Panoramica sulla sicurezza](./security/) — isolamento, identità, cifratura, audit e i limiti attuali.
- [Protezione dei dati](./security/data-protection) — quali dati personali si conservano, dove, per
  quanto, e come si esportano o cancellano.
- [Checklist di hardening](./security/hardening) — cosa fa un operatore prima e dopo la messa in
  esercizio.

## Integrazioni

- [Integrazione CI](./CI_INTEGRATION) — GitHub Actions, GitLab CI, Jenkins, Azure Pipelines, la CLI e
  lo stato dei commit.
- [Agenti locali](./LOCAL_AGENT) — testare applicazioni dentro una rete privata.

## Riferimento

- [API REST](./reference/api) — `/api/v1`: chiavi e scope, run, ogni endpoint e codice di
  errore, webhook dei piani.
- [Riga di comando wfm](./reference/cli) — comandi, opzioni, codici di uscita, cosa legge dalla CI.

## Interni

Per chi sviluppa e mantiene il prodotto:

- [Panoramica dell'architettura](./internals/) — processi, archivi, tecnologie, flussi principali.
- [Architettura di sistema](./internals/system-architecture) — contesto, container, componenti, deployment.
- [Diagrammi delle classi](./internals/class-diagrams) · [Schema del database](./internals/database-schema) ·
  [Diagrammi di sequenza](./internals/sequences) · [Sottosistema mobile](./internals/mobile)
- [Tenancy e accessi](./internals/tenancy) · [Ciclo di vita di un run](./internals/execution) ·
  [Modello dati](./internals/data-model) · [Agenti locali (interni)](./internals/agents) ·
  [Client web](./internals/frontend)
- [Guida sviluppatore](./internals/developer-guide) ·
  [Registro delle decisioni](./internals/decisions) · [Glossario](./internals/glossary)

## PDF

`npm run docs:pdf` scrive ogni sezione di questa documentazione come PDF, in inglese e in
italiano, in `docs/pdf/` — per un fascicolo di audit o per leggerla offline.
