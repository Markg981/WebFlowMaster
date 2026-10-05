# Allineamento del collaudo al prodotto — 5 ottobre 2026

Base applicativa: `cc9970b`, main dopo PR #297 (Prometheus/OpenTelemetry).
Protocollo 25: **517 casi, 24 aree**. Nuovi casi tutti da eseguire in un nuovo ciclo.

| Funzionalità | Copertura nel catalogo | Riferimento |
| --- | --- | --- |
| Versioni e approvazioni API/mobile | API-29…API-36, MOB-25…MOB-32, LIB-27…LIB-34, SEC-37…SEC-44 | Guide API/mobile e pubblicazione EN/IT |
| gRPC/WebSocket sugli agenti | AGT-06…AGT-10 | `protocolli/esito-piani-2026-10-03.md` |
| Discussioni e dashboard condivise | COL-01…COL-08 | `collaborazione-2026-10-04.md` |
| Provider email e template | ADM-21…ADM-28 | `email-provider-templates-2026-10-04.md` |
| Streaming gRPC, mTLS e conversazioni | API-37…API-48 | `protocolli/esito-streaming-mtls-2026-10-04.md` |
| Gherkin/Cucumber su agenti dedicati | BDD-01…BDD-11 | `bdd-cucumber-2026-10-05.md` |
| Flussi, gruppi, matrici e catalogo mobile | MOB-33…MOB-40 | `../docs/mobile-flow-matrix-acceptance.md` |
| Quote configurabili e consumi | QUO-01…QUO-14 | `../docs/administration-acceptance.md` |
| Prometheus e OpenTelemetry | TEL-01…TEL-12 | `../docs/it/admin/telemetry.md`, equivalente EN |

La preparazione nella pagina include migrazioni fino a 0082, pool e profilo BDD,
grid/dispositivi Appium, simulatori e certificati mTLS, provider email di prova,
amministratore dell'installazione, storage sacrificabile e collector OTLP/HTTP JSON.
Non occorre azzerare i volumi esistenti per aggiornare il catalogo.

## Pagina e storico

Il selettore **Catalogo attuale** consente di vedere tutti i casi e i prerequisiti
senza creare un ciclo o scrivere esiti. Un avviso segnala quando il ciclo aperto
conserva un catalogo diverso. **Nuovo ciclo** congela il catalogo corrente e parte
da **Da eseguire**. Le note pendenti si salvano sul ciclo originario prima del cambio.
CSV, preparazione, definizioni ed esiti storici rimangono legati alla copia congelata.

## Verifica e limiti

- `npm run test:collaudo`: persistenza, backup, import atomico, conflitti e storico congelato.
- `npm run test:collaudo:browser`: browser Chromium con storage temporaneo; catalogo corrente,
  note pendenti, import, nuovo ciclo, CSV storico e filtro Telemetria a 390 px.
- `npm run docs:build`: build della documentazione EN/IT.

Verifiche locali completate: 13 test server e percorso Chromium passati, build EN/IT
riuscita, lint dei file JavaScript modificati senza errori. Confronto strutturale:
tutti i 491 casi e le 22 aree preesistenti restano identici e gli ID sono univoci.
Avvio della pagina locale su porta 4322: impronte di cicli, esiti/note e snapshot
confrontate prima/dopo, tutte invariate. Revisione indipendente senza rilievi importanti.

Queste verifiche controllano la pagina e le procedure, non attestano l'esecuzione
manuale dei 517 casi né il deployment del prodotto. Per mobile servono dispositivi
reali; per telemetria un collector raggiungibile; per storage un bucket di prova.
Quote e consumi non introducono fatturazione. Annotare nel ciclo il commit e
l'ambiente effettivamente collaudati e registrare i prerequisiti mancanti come Bloccato.
