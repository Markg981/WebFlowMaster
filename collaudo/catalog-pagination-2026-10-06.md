# Cataloghi paginati e dettaglio su richiesta

Protocollo 30: 539 casi in 24 aree. LIB-35…LIB-41 sono **Da eseguire** in un nuovo ciclo;
i 532 casi precedenti e tutte le aree sono conservati. Non modificare cicli storici o esiti.

Aggiornare API e client dell'ambiente sacrificabile senza eliminare volumi. Predisporre almeno
51 test UI e 26 test API, mobile e set dati, con nomi distinguibili; includere nomi con `%` e `_`,
tag A/B/A+B, due progetti, stati UI diversi, due tenant e un progetto riservato. Conservare
conteggi attesi e ID delle risorse, senza dati personali o credenziali. Non serve una nuova
migrazione per questi cataloghi.

Aprire Network nel browser autenticato e visitare Libreria, Test API, App mobili e Dati di test.
Gli elenchi usano rispettivamente `/api/catalog/tests`, `/api/catalog/api-tests`,
`/api/catalog/mobile-tests`, `/api/catalog/test-data`: 25 riepiloghi per pagina, totale dopo
i filtri, navigazione avanti/indietro. La ricerca per nome è letterale e ignora maiuscole;
i tag selezionati richiedono tutti i tag. Progetto è un filtro dei cataloghi test, stato del solo catalogo UI;
i set dati hanno soltanto la ricerca per nome. Cambiare filtro riporta alla prima pagina.

Controllare che i riepiloghi non contengano passi completi, corpi delle richieste o valori
dei dataset. Aprire la modifica di manuale/BDD/set dati, oppure caricare o avviare un test
API/mobile: il dettaglio della sola risorsa scelta deve essere richiesto e conservare tutti
i campi dopo il salvataggio. Le route di elenco precedenti restano per selettori e integrazioni;
la presenza di questi percorsi compatibili non significa che ogni selettore sia paginato.

Ripetere filtri e conteggi con l'utente senza accesso al progetto riservato e con il secondo
tenant. Provare richieste senza sessione e parametri non validi (`page=0`, `pageSize=101`,
lista tag oltre il limite di 50 elementi): rifiuti senza esposizione di metadati. Eliminare l'unica risorsa della seconda
pagina e verificare il ritorno a una pagina valida. Registrare screenshot, richieste e risultati
nel nuovo ciclo; una destinazione o un dispositivo non disponibile è un prerequisito mancante.

I test locali delle route e dei componenti non dimostrano accettazione autenticata del browser,
RLS PostgreSQL reale, esecuzione Appium o deployment. I nuovi casi restano Da eseguire finché
il collaudo manuale non è svolto e registrato.
