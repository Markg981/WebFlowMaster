# Ripristino applicativo completo — protocollo 35

Nuovi casi OPS-29…OPS-31, inizialmente **Da eseguire**. Aprire Catalogo attuale o un nuovo ciclo;
i cicli precedenti restano congelati. Il risultato automatico non assegna esiti manuali.

## OPS-29 — recupero locale completo

Prerequisiti: Docker Linux attivo con risorse per due installazioni, Node e dipendenze del repository,
Chromium (`npx playwright install chromium`), accesso ai registry per le immagini produttive.
Eseguire dalla radice `npm run test:restore-drill` e `npm run backup:drill`.

Il comando genera solo progetti `wfm-drill-source-<id>` e `wfm-drill-target-<id>`, database/Redis/volumi
privati e porte API casuali su loopback. Non passare credenziali o riferimenti produttivi. Le immagini
sono costruite dal checkout corrente. La sorgente viene distrutta dopo il backup; la destinazione
ripristina DB, archivio results e visual-baselines, con chiave cifratura originale.

Atteso: exit 0; in `restore-drill-artifacts/<id>/recovery.json` tutte le fasi riuscite. Login browser,
report storico con evidenze identiche per dimensione/SHA-256, altro tenant escluso da test/report/artefatti,
nuovo run browser riuscito sul worker con valore cifrato recuperato e nuove evidenze.
Allegare JSON, screenshot e log al ciclo. La fixture usa un ruolo applicativo non superuser, con
membership `app_user`; il controllo incrociato fra due tenant esercita le policy ripristinate.

## OPS-30 — tempi osservati

Registrare commit, OS/CPU/RAM, dimensione dump/archivi, numero di oggetti, data checkpoint e ora
inizio/fine. `recoveryDurationMs` parte dal provisioning della destinazione dopo distruzione sorgente
e termina dopo il nuovo report. Include verify, restore, avvio, login, report storico, controllo tenant
e nuovo run. Build/preparazione/backup sono misurati separatamente. Il risultato di un'esecuzione
fallita non è un RTO accettato. L'età del backup è una misura del checkpoint, non una garanzia RPO.
Per lo SLA ripetere su volumi e rete rappresentativi della produzione e confrontare con gli obiettivi
concordati, senza ricavare una promessa dai tempi della fixture sintetica.

## OPS-31 — recupero S3 esterno

Prerequisiti: backup DB e chiave originale, inventario key/version ID/checksum di results e baseline
al checkpoint, replica/versioning recuperabile, bucket destinazione sacrificabile e installazione
isolata con Redis proprio. Il comando automatico locale non verifica questa procedura.

1. Recuperare con gli strumenti del provider le versioni corrispondenti al checkpoint in un **nuovo
   bucket**, comprese baseline e metadati necessari. Non collegare una prova che scrive al bucket produttivo.
2. Avviare una seconda installazione con la stessa versione dell'app, `ARTIFACT_STORE=s3`, endpoint,
   bucket/prefix della destinazione e chiave originale. Ripristinare il DB con `backup:restore` sul
   progetto sacrificabile. Se il manifest è S3, il tool non contiene né ripristina gli oggetti.
3. Effettuare login da UI con l'utente ripristinato; aprire un report storico e scaricare le evidenze.
   Confrontare conteggio, dimensioni e hash con l'inventario originale; aprire anche una baseline visiva.
4. Accedere con il secondo tenant e verificare 404 per report/evidenze altrui. Avviare da UI un piano
   con un segreto salvato e attendere run riuscito e nuove evidenze nel bucket destinazione.
5. Registrare ID ripristino/versioni, checkpoint DB e replica, oggetti mancanti, tempi di recupero
   bucket, DB, avvio, login, report e nuovo run, e tempo totale. Conservare inventario e log del provider.

Senza replica/versioni/inventario: **Bloccato — prerequisito mancante**. Evidenza non disponibile
dopo recupero: **Fallito**, distinguendo configurazione ambiente, dato scaduto per retention e difetto
prodotto. Nessuna validazione dei test unitari sostituisce il recupero reale del provider.

## Pulizia ed evidenze

Il comando rimuove container/volumi dei suoi due progetti anche dopo errore. Una terminazione forzata
può richiedere pulizia manuale dei soli progetti con l'ID della prova. Le immagini locali generate
`wfm-restore-drill-api:<id>` e `wfm-restore-drill-worker:<id>` possono essere rimosse dopo l'archiviazione.
Backup e Compose temporaneo con credenziali non sono allegati CI. I backup locali restano esclusi
da Git e dal build Docker. Archiviare le evidenze pertinenti prima di eliminare la cartella della prova.
