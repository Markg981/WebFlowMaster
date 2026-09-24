# Documentazione di WebFlowMaster

WebFlowMaster è una piattaforma di automazione dei test per applicazioni web e API HTTP: si registrano
o si descrivono i test, si organizzano in piani e suite, si eseguono su più browser, a orario o dalla
CI — anche dentro reti che il server non raggiunge — e ogni esecuzione produce un report dettagliato.

## Installazione e amministrazione

Per chi gestisce un'installazione e per gli owner di un'organizzazione:

- [Installazione](./admin/installation) — configurazioni, Docker Compose, PostgreSQL, segreti, reverse proxy.
- [Operatività](./admin/operations) — aggiornamenti, backup, log, monitoraggio, risoluzione dei problemi.
- [Riferimento della configurazione](./admin/configuration) — tutte le variabili d'ambiente.
- [Amministrazione](./admin/administration) — ruoli, membri, chiavi, sicurezza, audit, dati.

## Integrazioni

- [Integrazione CI](./CI_INTEGRATION) — GitHub Actions, GitLab CI, Jenkins, Azure Pipelines, la CLI e
  lo stato dei commit.
- [Agenti locali](./LOCAL_AGENT) — testare applicazioni dentro una rete privata.

## Interni

Per chi sviluppa e mantiene il prodotto:

- [Panoramica dell'architettura](./internals/) — processi, archivi, tecnologie, flussi principali.
- [Tenancy e accessi](./internals/tenancy) · [Ciclo di vita di un run](./internals/execution) ·
  [Modello dati](./internals/data-model) · [Agenti locali (interni)](./internals/agents) ·
  [Client web](./internals/frontend)
- [Guida sviluppatore](./internals/developer-guide) ·
  [Registro delle decisioni](./internals/decisions) · [Glossario](./internals/glossary)

::: info Altre guide in arrivo
La panoramica su sicurezza e compliance, la guida utente e il riferimento delle API sono in fase di
riscrittura e compariranno qui.
:::
