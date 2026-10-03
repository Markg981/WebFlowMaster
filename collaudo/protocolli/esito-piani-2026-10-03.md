# Verifica dei piani — 3 ottobre 2026

Ambiente: Docker `wfm-collaudo` ricreato dopo il ripristino di Docker Desktop 29.8.1,
pool `interno`, agente 1.1.0 con un solo slot. Il vecchio database Docker non era
disponibile; la ricreazione è stata autorizzata. Il ciclo manuale e le note nei file
locali sono stati conservati, con una copia di sicurezza prima della preparazione.
Le verifiche sono state eseguite tramite API autenticate come editor, pubblicazione dei
test, coda dei piani e worker del prodotto. Non sono risultati di un mock.

| Verifica | Evidenza | Esito |
| --- | --- | --- |
| gRPC, metadati, WebSocket, estrazione e riuso in OAuth, deadline di 30 secondi, recupero dello slot | Run `be0470a5-9a29-4fa5-af8b-f837c564aafc`, piano `bf4dd8a3-f5db-4c2e-bd6a-700dca879943` | `completed`, cinque risultati `passed`, estrazione `echo=hello agent` |
| Stessi endpoint privati dai runner del server | Run `7fa3a161-0346-400c-ad19-bea03ffa2574`, piano `797be83b-9bc4-4597-9c06-9f7902b3b27c` | `failed` atteso: gRPC codice 14; WebSocket `getaddrinfo ENOTFOUND protocolli` |
| HTTP con bundle originale 1.0.0 | Run `fa534fa3-7666-4784-b74b-5b02dbcb5565`, piano `9e19c008-0964-486a-8436-a6e36fb8fff6` | `completed`, risultato `passed` |
| Rifiuto WebSocket con bundle originale 1.0.0 | Run `b7efff5e-d5d0-494b-98d1-5de1250d7251`, piano `ce3755f5-eabd-43ea-98e9-b91a7d12ab4f` | `failed` atteso, errore che richiede l'aggiornamento dell'agente |
| Esportazioni JUnit e HTML | Tutti e quattro i run sopra | HTTP riuscito e contenuto con i test del piano verificato dal comando |
| Verifica visiva del report | Report del primo run | Da completare: il browser in-app richiede la gestione manuale del nuovo certificato locale |

I report dei quattro run restano nel prodotto. I casi del catalogo manuale non sono stati
segnati automaticamente come superati. La preparazione ha conservato i risultati storici
nei file locali; i report del precedente database Docker non erano recuperabili.

La prova legacy ha usato il bundle originale di `scripts/wfm-agent.ts` dal commit
`4e751f5`, con versione 1.0.0. Dopo la verifica, il suo token è stato revocato e il
container temporaneo rimosso. Gli agenti 1.1.0 dei pool `interno` e `lab` restano attivi.
La griglia mobile Lab risponde tramite il pool `lab`, Appium 3.7.0. `collaudo:check`
riporta zero errori e un avviso sul limite di autenticazione standard (20/15 minuti).

Per l'ispezione visiva, gestire manualmente il nuovo certificato locale
`collaudo/collaudo-root.crt` nel browser. Jenkins è stato ricostruito; la creazione
della chiave persistente per l'integrazione richiede l'autorizzazione esplicita del
destinatario locale e dei permessi `runs:read`/`runs:write`.
