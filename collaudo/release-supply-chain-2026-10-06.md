# Protocollo 27 — Release riproducibili

Il catalogo passa da 520 a 526 casi con OPS-20…OPS-25. I cicli storici restano congelati;
i nuovi casi partono **Da eseguire**. Il percorso E2E/dispositivi reali resta rinviato secondo
la decisione del 6 ottobre: questa modifica non lo riprende.

| Caso | Evidenza richiesta |
|---|---|
| OPS-20 | Due build pulite per ruolo, stesso digest di configurazione/layer, candidato senza pubblicazione |
| OPS-21 | Rapporto HIGH senza fix e rapporto malformato rifiutati dal gate |
| OPS-22 | Release staging, hash SBOM/rapporti e digest dei tre ruoli coerenti |
| OPS-23 | Versione/tag/check/archivio incompatibili rifiutati; tag differenti non sovrascritti |
| OPS-24 | Container pwuser, Chromium reale, Lighthouse e volumi operativi scrivibili |
| OPS-25 | Backup verificato, upgrade/installazione per digest, rollback con compatibilità schema |

Per eseguire utilizzare [la procedura IT](../docs/it/admin/releases.md) o
[EN](../docs/en/admin/releases.md). Registrare commit, piattaforma, digest, workflow e allegati.
I test automatici delle guardie non assegnano esiti ai casi manuali. Senza baseline precedente,
backup, registry o runner richiesto, classificare **Bloccato — prerequisito mancante**.

## Evidenze automatiche locali del 6 ottobre 2026

Sono passati 23 test delle guardie di release, 21 test di architettura, 13 test del
catalogo Collaudo e un test browser del catalogo: 58 test in totale. TypeScript,
build applicativa, build della documentazione e validazione della configurazione
Compose sono stati verificati separatamente.

Le tre immagini linux/amd64 sono state costruite due volte senza cache con
BuildKit v0.33.1 fissato per digest. Configurazione e layer non compressi coincidono:

| Ruolo | Digest della configurazione | Componenti SBOM | Occorrenze HIGH/CRITICAL |
|---|---|---:|---:|
| API | `sha256:3f1ef33b5e7505c22710bab632e4215a7c985920f109a51bcd00178ec48b2620` | 1799 | 31 |
| Worker | `sha256:a8a6b628710c95d2827ed7d982866450f5fcfe2a03076869a15519d74b524143` | 1799 | 31 |
| Agente | `sha256:2e5b5a985a92a0370daa0874c85e86dd053e63648fca371966394ee88ba9bd4f` | 1591 | 28 |

La prova usa snapshot locali del candidato, `SOURCE_DATE_EPOCH=1700000000` e
label di sviluppo, non un tag di release. Buildx locale è v0.37.1; il workflow
fissa v0.37.2. Il confronto riguarda configurazione e diffID dei layer, non
l'identità byte per byte degli archivi o la stabilità nel tempo del database CVE.
La rimozione della cache bytecode Node nello stesso RUN delle installazioni npm
ha eliminato le differenze osservate nelle prime build API/worker.

Il runtime dei tre ruoli è stato verificato con UID 1000, Chromium reale e
Playwright 1.61.1; API/worker includono Lighthouse 12.8.2. La prova con nuovi
volumi anonimi conferma la scrittura nelle directory operative. La guardia Linux
di spazio libero ha rilevato 893.2 GiB disponibili rispetto ai 20 GiB richiesti.
Queste prove non certificano un upgrade applicativo, un'accettazione autenticata
o il funzionamento RLS su PostgreSQL.

Trivy 0.75.0, fissato per digest, ha generato SBOM CycloneDX e rapporti sulle
immagini effettivamente confrontate. Il rapporto sui lockfile contiene 36
occorrenze HIGH/CRITICAL, registrate nella
[baseline sorgenti](../deployment/releases/baseline-2026-10-06.json).
I conteggi fra sorgenti e immagini **non sono sommabili**, perché i rilievi si
ripetono. Le guardie rifiutano i rapporti reali: **la pubblicazione è bloccata**.
Non sono state introdotte eccezioni né dichiarate risolte queste vulnerabilità.

Gli allegati completi rimangono nella cartella locale ignorata da Git
`outputs/release-validation-2026-10-06/`: rapporti sorgenti e immagini, tre SBOM,
metadati scanner/database e confronto delle build. Non sono artefatti pubblicati.
La pipeline hosted, la pubblicazione GHCR/GitHub e OPS-22/OPS-25 restano da
verificare con i relativi prerequisiti. Tutti i nuovi casi manuali restano
**Da eseguire**; nessun ciclo storico è stato modificato.
