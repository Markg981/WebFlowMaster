# Integrazione al Collaudo WebFlowMaster — funzionalità 6–13

Versione di riferimento: commit `6d007cf`, branch `claude/vibrant-allen-8mh32x`.

Integrazione applicata al catalogo locale `collaudo/casi.json`, versione 16 con 404 casi, a partire dai 358 casi dell’artifact versione 15 consultato il 2026-10-02. I 46 nuovi ID proseguono la numerazione esistente. Il replay SAML è già coperto da SSO-15 e non viene duplicato. ID, ciclo visibile, esiti e note precedenti sono stati conservati nella migrazione locale. Tutti i nuovi casi sono **Da eseguire**: il superamento delle suite automatiche non costituisce l’esito del collaudo manuale.

Preparazione comune: installazione di collaudo aggiornata al commit, migrazioni fino alla 0074, organizzazioni A/B distinte, owner ed editor, progetto riservato e progetto accessibile, servizi API controllati, pagina web di prova per download e geolocalizzazione. Per SAML usare un IdP di prova; per email un relay di prova e un adattatore che produca callback firmati. Per SMS un numero di test o un simulatore del callback inbound. Non usare certificati o destinatari di produzione.

| ID | Scenario | Passi | Risultato atteso | Stato |
|---|---|---|---|---|
| API-22 | Importazione WSDL | Importare un WSDL 1.1 con un binding SOAP supportato; aprire il test generato per un'operazione. | Test POST con envelope SOAP, endpoint e intestazioni coerenti con il binding. | Da eseguire |
| API-23 | Esecuzione SOAP e XPath | Eseguire il test su un servizio noto; configurare un'asserzione XPath sul valore restituito. | La risposta XML viene verificata; il valore atteso produce un test riuscito. | Da eseguire |
| API-24 | Asserzione SOAP fallita | Configurare un valore XPath atteso differente dalla risposta ed eseguire. | Il test fallisce con evidenza della verifica non soddisfatta. | Da eseguire |
| API-25 | Chiamata gRPC unary | Configurare definizione proto, servizio, metodo unary, URL e richiesta JSON validi; eseguire. | Risposta decodificata in JSON, stato gRPC e asserzioni verificabili. | Da eseguire |
| API-26 | Errore gRPC | Chiamare un metodo di prova che restituisce NOT_FOUND e verificarne il codice. | Codice gRPC 5 conservato e verificabile, senza interpretarlo come stato HTTP. | Da eseguire |
| API-27 | Scambio WebSocket | Configurare WEBSOCKET verso un servizio di prova, messaggio raw e asserzione sulla risposta; eseguire. | Connessione, invio e ricezione completati; asserzione soddisfatta. | Da eseguire |
| API-28 | Risposta WebSocket assente | Usare un servizio che non invia messaggi entro la finestra di ascolto e richiedere con un'asserzione count maggiore di zero. | L'ascolto termina entro il limite e l'asserzione fallisce per assenza di messaggi. | Da eseguire |
| LIB-18 | Importazione Gherkin | In Test come file importare una Feature inglese con Scenario e passi Given/When/Then; controllare l'anteprima e confermare. | Test web con passi manuali e risultati attesi coerenti; nessuna azione browser inventata. | Da eseguire |
| LIB-19 | Background | Importare una Feature con un Background e due Scenario. | I passi del Background precedono quelli di entrambi gli scenari. | Da eseguire |
| LIB-20 | Scenario Outline | Importare un Outline con placeholder e due righe Examples. | Due test concreti con valori sostituiti e nomi distinti. | Da eseguire |
| LIB-21 | Export e reimportazione | Esportare in Gherkin un test web con azioni automatiche; reimportare il file senza modificarlo. | File .feature e metadati WFM presenti; azioni e campi supportati ripristinati. | Da eseguire |
| LIB-22 | Metadati non coerenti | Modificare il testo di uno scenario esportato lasciando il suo commento wfm-test; tentare l'importazione. | Errore esplicito; nessun aggiornamento silenzioso dal testo incoerente. | Da eseguire |
| LIB-23 | Dialetto non supportato | Importare un file con direttiva di lingua italiana e parole chiave italiane. | Formato rifiutato esplicitamente, senza creare test parziali. | Da eseguire |
| LIB-24 | Accesso al progetto | Come editor privo di accesso al progetto riservato tentare import/export dei suoi test. | Nessuna lettura o modifica dei test riservati. | Da eseguire |
| WEB-63 | Contenuto PDF | Scaricare un PDF testuale noto mediante Verifica un download e verificare una frase presente. | Asserzione riuscita, file conservato e metadati del PDF disponibili. | Da eseguire |
| WEB-64 | Contenuto PDF assente | Ripetere con una frase assente dal PDF. | Lo step fallisce; il solo download riuscito non basta. | Da eseguire |
| WEB-65 | Contenuto CSV | Scaricare un CSV noto con celle quotate e configurare le verifiche previste di contenuto e righe. | Contenuto e struttura rilevati coerenti con il file; asserzioni soddisfatte. | Da eseguire |
| WEB-66 | Geolocalizzazione | Impostare coordinate note prima di interrogare navigator.geolocation nella pagina di prova. | La pagina riceve le coordinate emulate. | Da eseguire |
| WEB-67 | Cambio posizione | Impostare una prima posizione, poi una seconda nello stesso test; interrogare la pagina dopo ciascuno step. | Ogni lettura restituisce la posizione impostata nello step precedente. | Da eseguire |
| WEB-68 | Estrazione OTP | Configurare la casella SMS dell'organizzazione; avviare Attendi SMS e inviare un messaggio nuovo al numero atteso. | Il codice viene estratto nella variabile configurata e utilizzabile nello step seguente. | Da eseguire |
| WEB-69 | Messaggio precedente | Inserire soltanto un SMS precedente all'inizio del test ed eseguire Attendi SMS. | Il messaggio vecchio non soddisfa l'attesa; lo step termina per timeout. | Da eseguire |
| WEB-70 | Revoca inbound | Revocare il token della casella e inviare un callback con il vecchio token. | Messaggio rifiutato e non acquisito nella casella. | Da eseguire |
| LIB-25 | Commento su test | Come utente autorizzato aggiungere un commento a un test accessibile; riaprire il test. | Commento persistente con autore e data. | Da eseguire |
| REP-23 | Commento su risultato | Aggiungere un commento a un risultato accessibile e riaprire il report. | Commento associato al risultato corretto e persistente. | Da eseguire |
| LIB-26 | Modifica del commento | Come autore modificare il proprio commento e riaprire il pannello. | Testo aggiornato, mantenendo l'associazione al test o risultato. | Da eseguire |
| SEC-36 | Isolamento tra organizzazioni | Come utente di B tentare lettura o scrittura dei commenti su un test di A. | Nessuna lettura o modifica consentita. | Da eseguire |
| REP-24 | Preferenze persistenti | Nascondere un widget e cambiare l'ordine; ricaricare la dashboard. | Visibilità e ordine conservati per l'utente. | Da eseguire |
| REP-25 | Preferenze personali | Dopo aver personalizzato la dashboard dell'utente A, accedere con un secondo utente senza preferenze. | Il secondo utente conserva il layout predefinito. | Da eseguire |
| SSO-26 | IdP login disabilitato | Con l'opzione disabilitata inviare dall'IdP una nuova asserzione firmata non correlata a una richiesta SP. | Accesso rifiutato. | Da eseguire |
| SSO-27 | IdP login abilitato | Abilitare l'opzione e inviare dall'IdP una nuova asserzione firmata valida per organizzazione, dominio e gruppi. | Accesso all'organizzazione e ruolo previsti. | Da eseguire |
| SSO-28 | Chiave SP protetta | Salvare certificato e chiave RSA corrispondenti, ricaricare impostazioni e scaricare metadata. | Metadata con certificato pubblico; la chiave privata non viene restituita o ripopolata. | Da eseguire |
| SSO-29 | Asserzione cifrata | Configurare chiave SP e inviare un'asserzione firmata e cifrata con il certificato SP corretto. | Accesso riuscito, rispettando le verifiche SAML. | Da eseguire |
| SSO-30 | Cifratura obbligatoria | Abilitare l'obbligo e inviare un'asserzione firmata in chiaro. | Accesso rifiutato. | Da eseguire |
| SSO-31 | Logout avviato dal prodotto | Con SLO configurato accedere via SAML e premere Logout. | Sessione locale terminata e browser indirizzato alla richiesta LogoutRequest firmata dell'IdP. | Da eseguire |
| SSO-32 | Logout avviato dall'IdP | Con sessione SAML attiva inviare LogoutRequest firmata riferita alla sua identità/sessione. | Sessione corrispondente revocata; un successivo accesso protetto richiede autenticazione. | Da eseguire |
| SSO-33 | SLO non firmato | Inviare una LogoutRequest senza firma valida. | Messaggio rifiutato e sessione legittima non revocata. | Da eseguire |
| SSO-34 | Revoca dei log live | Aprire un WebSocket dei log con sessione SAML, revocarla tramite SLO e produrre un nuovo log. | Nessun nuovo log ricevuto; socket chiuso quando viene verificato e nuovi upgrade rifiutati. | Da eseguire |
| ADM-12 | Invito HTML | Inviare un invito a un destinatario di prova con nome contenente markup HTML. | Alternative HTML e testo coerenti; nome mostrato come testo, senza interpretare il markup. | Da eseguire |
| ADM-13 | Reset HTML | Richiedere il reset di un utente noto e leggere il messaggio nel relay. | Alternative HTML e testo con link utilizzabile; storico senza corpo o token del link. | Da eseguire |
| ADM-14 | Notifica di fine run | Eseguire un piano con notifica email configurata e leggere il messaggio ricevuto. | Alternative HTML e testo con esito e link al run coerenti. | Da eseguire |
| ADM-15 | Accettazione SMTP | Fare accettare il destinatario dal relay e aprire lo storico come owner. | Stato di accettazione SMTP, senza dichiarare già consegnato il messaggio. | Da eseguire |
| ADM-16 | Callback di consegna | Inviare tramite l'adattatore un evento delivered firmato e recente con il messageId registrato. | Evento persistente e stato aggiornato a consegnato. | Da eseguire |
| ADM-17 | Callback duplicato | Reinviare lo stesso evento firmato con identico eventId e messageId. | Nessuna duplicazione dell'evento. | Da eseguire |
| ADM-18 | Callback contraffatto | Modificare la firma del callback e inviarlo. | Richiesta rifiutata; nessun cambiamento dello storico. | Da eseguire |
| ADM-19 | Hard bounce | Inviare un hard_bounce firmato per un messaggio dell'organizzazione A; tentare un nuovo invio allo stesso indirizzo in A. | Bounce registrato e nuovo invio soppresso. | Da eseguire |
| ADM-20 | Isolamento dello storico | Come owner di B tentare di consultare lo storico di A. | Visibili solo le consegne della propria organizzazione. | Da eseguire |

## Limiti e decisioni da riportare nel documento

- GraphQL era già presente; i nuovi protocolli hanno limiti documentati, incluso gRPC unary.
- Il Gherkin ordinario viene importato come passi manuali: non vengono generati step definition Cucumber o azioni automatiche dal testo.
- Per PDF il caso di contenuto usa un PDF testuale; non prova OCR su scansioni.
- L'OTP SMS legge messaggi inbound di numeri di prova: non introduce un servizio di invio SMS.
- Il tracciamento email richiede un adattatore ai callback HMAC documentati; SMTP da solo non conferma consegna o rimbalzi. Non è presente un editor di modelli HTML.
- Fatturazione SaaS e piani a consumo (punto 14) sospesi su richiesta dell'utente il 2026-10-02. Quote esistenti mantenute; nessun caso di pagamento da dichiarare implementato o superato.
- Le suite automatiche precedenti al commit hanno registrato 1.985 test server superati (uno saltato) e 442 client; gli esiti sopra restano da eseguire.
