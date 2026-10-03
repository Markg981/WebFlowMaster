# Verifica dei piani — 3 ottobre 2026

Ambiente: Docker `wfm-collaudo`, pool `interno`, agente 1.1.0 con un solo slot.
Le verifiche sono state eseguite tramite API autenticate come editor, pubblicazione dei
test, coda dei piani e worker del prodotto. Non sono risultati di un mock.

| Verifica | Evidenza | Esito |
| --- | --- | --- |
| gRPC, metadati, WebSocket, estrazione e riuso in OAuth, deadline di 30 secondi, recupero dello slot | Run `87a7483d-c00b-4fef-9b92-7adf2ce1e0e8`, piano `7dda6b4b-068e-4139-8d47-6533e247a439` | `completed`, cinque risultati `passed`, estrazione `echo=hello agent` |
| Stessi endpoint privati dai runner del server | Run `30b1a6f7-4def-4666-873f-d3832d94dc13`, piano `f441ac1a-1d46-4c6c-bfa2-030946d411ab` | `failed` atteso: gRPC codice 14; WebSocket `getaddrinfo ENOTFOUND protocolli` |
| HTTP e rifiuto nativo con bundle originale 1.0.0 | Agente temporaneo `legacy-acceptance-1.0.0` nel pool `legacy-acceptance` | Da completare: aggiornamento Docker interrotto e finestra `Update Failed` |
| Esportazioni JUnit/HTML e verifica visiva del report | Controlli aggiunti al comando | Da completare: Docker non disponibile; il browser in-app richiede il certificato locale |

I report dei primi due run restano nel prodotto. I casi del catalogo manuale non sono stati
segnati automaticamente come superati. Non sono stati cancellati volumi o risultati storici.

Ripresa: premere `Continue` nella finestra Docker Desktop `Update Failed`, riavviare lo
stack e l'agente temporaneo, quindi eseguire `collaudo:protocolli:piani` con
`WFM_PROTOCOL_SCOPE=legacy` e `WFM_LEGACY_POOL=legacy-acceptance`; eseguire anche la
prova con scope `server` per verificare le esportazioni. Revocare l'agente temporaneo e
rimuovere il relativo container dopo la verifica. Gestire manualmente il certificato
locale nel browser prima dell'ispezione visiva.
