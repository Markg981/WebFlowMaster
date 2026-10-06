# Riproducibilità degli input e replay storico

Protocollo 31, 546 casi in 24 aree. REP-26…REP-32 sono **Da eseguire** in un nuovo ciclo;
i cicli storici restano congelati. Nessuna migrazione aggiuntiva. Aggiornare API, worker e client.

Preparare due tenant, owner/editor/viewer, un piano con UI/API/mobile e dataset di prova,
definizioni pubblicate v1 e servizi/dispositivi controllabili. Fermare il worker per simulare
l’attesa, accodare e poi modificare/pubblicare v2. Avviare il worker e verificare richieste,
passi e versioni realmente eseguiti, senza assegnare esiti dai soli test automatizzati.

Il report deve indicare acquisizione all’accodamento, versioni e copia pubblicata/di lavoro,
impronte SHA-256 per definizione, dataset e input complessivi. Annotare ID e impronte. Modificare
piano/dataset e confermare **Riesegui configurazione storica** dal report: nuovo run manuale,
input originali, impronte identiche e collegamento al sorgente. Nessun aggiornamento dello stato
CI originale. Il piano deve esistere; i test cancellati possono usare le definizioni conservate.

Provare la route `POST /api/test-plan-executions/:id/replay` con `{ "mode": "historical" }`:
senza sessione 401, viewer 403, altro tenant 404, snapshot incompleto/storico 409; richiesta senza
mode o con snapshot fornito dal client 400. Quote enforce raggiunte: 429 senza run aggiuntivo.
Ripetere con la stessa `Idempotency-Key`: un solo run. Review obbligatoria attuale: copia congelata
non pubblicata saltata, senza sostituzione con la pubblicazione corrente.

Ispezionare lista, dettaglio, avvio e annullamento run: nessuna `configurationSnapshot` né
valori conservati. Export HTML/PDF, allegato Allure `execution-provenance.json` e proprietà JUnit
includono provenienza sicura. Il contenuto delle richieste/log segue la propria redazione;
la provenienza non deve introdurre valori o credenziali nei report.

Variabili/segreti di ambiente, sessioni salvate, dispositivi, browser, profili BDD, policy e
integrazioni restano correnti. Il replay verifica input conservati, non ripristina servizi esterni
né garantisce lo stesso esito. Dispositivo o servizio assenti sono prerequisiti mancanti.
Accettazione autenticata, esecuzione Appium, deployment e CI richiedono evidenza separata.
