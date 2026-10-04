# Test API

Un test API è una richiesta HTTP con le verifiche che la risposta deve superare. Più test in un
piano formano un flusso: accedere, creare un ordine, rileggerlo, cancellarlo — ognuno passando
valori al successivo. Si costruiscono in **Tester API**.

## La richiesta

- **Metodo** e **URL di base**; i **Parametri query** si aggiungono sotto e si vedono
  nell'**URL effettivo**. L'indirizzo può iniziare con una variabile —
  <code v-pre>{{baseUrl}}/orders</code> — così un test segue il server di ogni ambiente.
- **Ambiente**: quale ambiente riempie con i suoi segreti i
  <code v-pre>{{segnaposto}}</code> dell'indirizzo, degli header, del corpo e
  dell'autorizzazione, come per i [test web](./web-tests#variabili-e-ambienti).
- **Header**: coppie nome e valore.
- **Corpo**: nessuno, form data (campi di testo e file), form URL-encoded, raw (JSON, XML, testo,
  HTML, JavaScript, con il `Content-Type` corrispondente), un file binario, o una query GraphQL
  con le sue variabili.
- **Autorizzazione**:

| Tipo | Cosa viene inviato |
|---|---|
| No Auth | Nulla. |
| Basic Auth | Nome utente e password in un header Basic. |
| Bearer Token | `Authorization: Bearer` e il token. |
| API Key | Una chiave in un header o in un parametro query, con il nome che scegliete. |
| OAuth 2.0 | Un token richiesto prima al token URL, con il grant **client credentials** o **password**, poi inviato come Bearer. Le credenziali del client vanno in un header Basic o nel corpo. |
| JWT Bearer | Un JWT firmato a ogni richiesta: **HS256/384/512** con un segreto condiviso (anche in Base64), **RS\*** o **ES\*** con una chiave privata PEM. Claim e campi aggiuntivi dell'header sono JSON; `iat` viene aggiunto se manca. Inviato come `Authorization: <prefisso> <token>` (prefisso *Bearer* di default) o come parametro query. |
| Digest Auth | La richiesta parte, il server risponde 401 con le sue condizioni e la richiesta riparte con la risposta (RFC 7616: MD5, SHA-256, le varianti `-sess`, qop `auth` e `auth-int`). |
| OAuth 1.0 | Ogni richiesta firmata (RFC 5849) con **HMAC-SHA1/256/512** o **PLAINTEXT**, su metodo, URL, query e corpo form. Lasciate vuoto il token per OAuth a due vie. Nell'header Authorization o nella query. |
| Hawk Authentication | Un MAC su metodo, path, host e porta, con timestamp e nonce; facoltativamente l'hash del corpo, per i server che verificano i payload. |
| AWS Signature | Signature Version 4: `Authorization` e `x-amz-date`, più `x-amz-security-token` con credenziali temporanee e `x-amz-content-sha256` per S3. Lasciate vuoto il servizio per ricavarlo da un host `*.amazonaws.com`. |
| NTLM Authentication | L'handshake NTLMv2 (negotiate, challenge, authenticate) su un'unica connessione, come NTLM richiede — dal server o dall'agent quando il piano gira su un pool di agent. Funziona anche `DOMINIO\utente` nel nome utente. |
| Akamai EdgeGrid | `EG1-HMAC-SHA256` con client token, client secret e access token della sezione del vostro `.edgerc`; sono firmati gli header elencati e il corpo delle POST (fino al massimo indicato). |
| Atlassian ASAP | Un JWT di breve durata (**RS\*** o **ES\***) con issuer, audience, key ID e un `jti` nuovo, inviato come Bearer. |

Un header `Authorization` scritto nella scheda Header prevale sul tipo scelto qui. Se un campo
obbligatorio è vuoto — un nome utente, una chiave — la richiesta non parte e il risultato dice quale
campo manca, invece di lasciare che il server risponda 401. Il grant authorization code richiede una
persona davanti a un browser, quindi non può essere usato da un run pianificato. Ogni campo di ogni
tipo accetta segnaposto dell'ambiente — tenete lì password, segreti e chiavi private, non nel test.

**Invia** esegue la richiesta dal server e mostra la **Risposta**: stato, tempo, corpo e header,
e l'esito di ogni asserzione. Ogni richiesta inviata resta nella **Cronologia**, da cui si può
riaprire.

## Asserzioni

Ogni asserzione legge una parte della risposta e la confronta:

| Origine | Proprietà | Esempio |
|---|---|---|
| status code | — | equals `201` |
| header | il nome dell'header | `Content-Type` contains `json` |
| body json path | un percorso nel corpo JSON | `items[0].id` exists |
| body text | — | contains `"status":"ok"` |
| response time | — | less than `500` (millisecondi) |
| body xpath | un XPath in un corpo XML | `//status` equals `Shipped` — vedi [SOAP](#protocolli) |

Confronti: equals, not equals, contains, not contains, exists, not exists, is empty, is not
empty, greater than, less than (o uguale), matches regex, not matches regex. Un'asserzione si può
disattivare senza cancellarla. Il test passa quando passano tutte quelle attive.

## Catture: passare valori avanti {#catture}

Una **cattura** prende un valore dalla risposta — un token, l'id di ciò che è stato creato — e gli
dà un nome. I test API che vengono dopo nello stesso run di un piano possono usarlo come
<code v-pre>{{nome}}</code>, nell'indirizzo, negli header o nel corpo.

Una cattura legge gli stessi punti di un'asserzione: lo status code, un header, un JSON path o il
testo del corpo. I nomi sono lettere, cifre e underscore, e iniziano con una lettera. **Invia**
mostra il valore preso da ogni cattura, o perché non è riuscita a prenderlo.

I valori catturati viaggiano all'interno del passaggio di un browser nel piano, nell'ordine in cui
girano i test. Un piano che ne dipende deve tenere quei test nell'ordine giusto; con più test in
parallelo, il piano mantiene in ordine i test API di ogni browser.

## Tempi di risposta su più richieste {#performance}

L'asserzione **response time** giudica una richiesta, e il tempo di una richiesta è rumore: lo
decidono una cache fredda o una garbage collection. La scheda **Prestazioni** controlla un endpoint
in modo affidabile: attivate **Controlla i tempi di risposta su più richieste** e impostate

- **Richieste** — quante, da 2 a 200, compresa quella funzionale;
- **Alla volta** — quante in volo insieme, da 1 a 10;
- le soglie che fanno fallire il test, ciascuna facoltativa: **Mediana (p50)**, **95° percentile
  (p95)** e **La più lenta**, in millisecondi, e **Richieste fallite**, in percentuale.

In un piano la richiesta viene inviata una volta come sempre — le sue asserzioni decidono l'esito e
le sue catture passano ai test successivi — e poi di nuovo fino al numero indicato. Una ripetizione
conta come fallita quando non si è potuta fare o ha fallito un'asserzione del test. I percentili sono
nearest rank: il p95 di 20 richieste è la 19ª più veloce. Quando una soglia viene superata il test
fallisce indicando cosa è stato superato ("p95 412 ms > 300 ms"), e la scheda **Tempi di risposta**
del report del run elenca ogni test che ha controllato i tempi: richieste, p50, p95, la più lenta,
richieste fallite ed esito.

Le ripetizioni partono da dove gira il test — la rete di un agente locale quando il piano ne usa
uno — e si fermano quando il run viene annullato. Una richiesta che non si riesce proprio a fare
salta il controllo: non c'è nulla da misurare. I limiti sono voluti: risponde a "questo endpoint è
diventato più lento?" a ogni run, non è un test di carico.

## SOAP, WebSocket e gRPC {#protocolli}

**SOAP** usa POST HTTP con envelope XML raw: `text/xml` e `SOAPAction` per SOAP 1.1, `application/soap+xml` per SOAP 1.2. Asserzioni e catture XPath gestiscono i namespace (`//status` ignora i prefissi; `//ns:status` usa quello del documento). L’[import](#import) genera richieste modificabili dal WSDL.

**gRPC** supporta unary, streaming server, streaming client e streaming bidirezionale. Scegliete **GRPC**, indicate `grpc://host:porta/pacchetto.Servizio/Metodo` (`grpcs://` per TLS verificato) e incollate il **.proto**. Gli header sono metadata. La modalità predefinita segue la definizione del metodo; quella esplicita deve corrispondervi. Unary e streaming server ricevono un messaggio JSON. Streaming client e bidirezionale accettano:

```json
{"messages":[{"value":"primo"},{"value":"secondo"}]}
```

Gli stream bidirezionali accettano anche la conversazione ordinata sotto. La risposta unary/client-stream rimane un singolo messaggio JSON. Gli stream di risposta restituiscono `{messages,last,count,captures}`: asserite `count`, `last.value` o `messages[0].value`. Stato terminale e trailer sono disponibili alle asserzioni (0 significa OK). Gli errori remoti restano verificabili; timeout locale, annullamento, conversazione non valida e superamento dei limiti fanno fallire l’esecuzione, anche senza asserzioni.

**WebSocket** accetta `ws://` e `wss://`. Restano supportati messaggi raw separati da righe e `{"send":["ping"],"waitMs":2000,"until":1}`. Per alternare risposte, catture e invii dipendenti, selezionate il corpo raw e usate **Conversazione**, nell’editor ordinato o JSON:

```json
{"steps":[
  {"type":"receive"},
  {"type":"capture","name":"token","property":"token"},
  {"type":"send","message":"{{capture.token}}"},
  {"type":"receive","timeoutMs":2000,"property":"accepted","equals":true},
  {"type":"end"}
]}
```

La ricezione consuma risposte accodate, anche una challenge immediata. Una proprietà facoltativa come `items[0].id` e `equals` selezionano la risposta attesa. La cattura legge l’ultimo messaggio ricevuto; il nome inizia con una lettera e contiene lettere, cifre o underscore. Usate <code v-pre>{{capture.token}}</code> dopo averlo catturato: questi nomi sono riservati nella conversazione. Catture mancanti e chiusura anticipata falliscono indicando il passo. **Termina** chiude WebSocket o il flusso di richieste gRPC. Le conversazioni client-stream gRPC non possono ricevere prima dell’unica risposta finale.

La **Configurazione protocollo** imposta timeout complessivo, numero di messaggi e byte UTF-8 ricevuti. Valori predefiniti: **30 secondi / 100 messaggi / 1 MiB**; massimi: **60 secondi / 1.000 messaggi / 8 MiB**. Le catture hanno un limite aggregato separato con lo stesso massimo; gli invii della conversazione sono limitati complessivamente a 8 MiB dopo la sostituzione. Una conversazione ammette **100 passi**. Il transcript mostra messaggi e catture della conversazione. Test salvati, versioni eseguibili, pubblicazione approvata e bundle YAML/JSON conservano la configurazione. I report dei piani conservano il transcript oscurato e mantengono le estrazioni vive per le richieste successive.

### TLS verificato e certificati client

Nell’ambiente dell’organizzazione selezionata create segreti cifrati con CA radice, certificato client e chiave privata in PEM. Inserite i riferimenti esatti nella **Configurazione protocollo**, per esempio:

```json
{"tls":{"rootCa":"{{secret_grpc_ca}}","clientCertificate":"{{secret_grpc_cert}}","clientKey":"{{secret_grpc_key}}","keyPassphrase":"{{secret_grpc_passphrase}}"}}
```

Usate i nomi effettivi delle variabili segrete. La CA è facoltativa se basta la fiducia di sistema; certificato e chiave client vanno indicati insieme, la passphrase serve per una chiave cifrata. Ogni campo PEM risolto è limitato a 256 KiB. Certificati/chiavi in chiaro nella configurazione salvata vengono rifiutati. L’indirizzo risolto deve usare `grpcs://`, anche quando arriva da una variabile dell’ambiente. Si verificano corrispondenza chiave/certificato, fiducia e hostname della destinazione, senza fallback insicuro. Per ruotare le credenziali aggiornate i segreti dell’ambiente e rieseguite il test: le versioni conservano riferimenti, non PEM. Sul relay autenticato viaggiano solo i campi TLS necessari; i ticket contengono nomi di capability. Valori dell’ambiente e PEM sono oscurati negli errori del trasporto e nella cronologia.

I piani sugli agenti locali eseguono tutti questi protocolli dalla rete dell’agente. Aggiornate ad **agent 1.2.0** scaricando script/dipendenze nuovi o ricostruendo e riavviando l’agente Docker ([Agenti locali](../LOCAL_AGENT)). Gli agenti precedenti mantengono unary/WebSocket legacy, mentre i ticket avanzati richiedono `native-protocol-v2`: un pool non compatibile fallisce esplicitamente. **Invia** nell’editor esegue dal server. Restano applicati proxy obbligatorio e restrizioni sulle destinazioni.

## Importare da OpenAPI, Postman o WSDL {#import}

**Test salvati → Importa** crea test da ciò che un team ha già: una descrizione **OpenAPI 3** o
**Swagger 2**, in JSON o YAML, una **collection Postman** (v2.0 o v2.1), o il **WSDL** (1.1/2.0) di un
servizio SOAP. Aprite il file o
incollatelo, premete **Mostra cosa crea**, tenete i test che volete — quelli con metodo e indirizzo
già presenti restano non selezionati — scegliete un progetto e importate.

- Un test per operazione (OpenAPI) o richiesta (Postman), chiamato col suo summary, operation id o
  nome Postman, raggruppato per tag o cartella come modulo.
- L'indirizzo parte da <code v-pre>{{baseUrl}}</code>; i parametri di percorso diventano
  <code v-pre>{{nome}}</code> (anche i `:nome` di Postman). Le <code v-pre>{{variabili}}</code> di
  Postman hanno la stessa sintassi e restano come sono.
- I parametri di query e di header obbligatori ricevono l'esempio, il default o il primo valore
  ammesso, oppure una variabile. Il corpo è l'esempio dell'operazione, o uno costruito dal suo schema
  (JSON e form URL-encoded); i corpi raw, URL-encoded e GraphQL di Postman sono mantenuti.
- La sicurezza diventa l'autorizzazione del test — bearer, basic o API key — con il segreto come
  variabile (<code v-pre>{{token}}</code>, <code v-pre>{{password}}</code>…). Un segreto scritto in
  una collection Postman non viene importato.
- Lo stato atteso è un'asserzione: la prima risposta 2xx di OpenAPI, o il
  `pm.response.to.have.status(…)` di Postman.
- Da un WSDL: un `POST` per operazione del binding SOAP selezionato, con envelope e campi dello schema a `?` da compilare. SOAP 1.1 usa `SOAPAction`; SOAP 1.2 l’action nel content-type. Richiesta-risposta attende `200` e nessun `//Fault`; one-way attende stato 2xx.

L'anteprima elenca le variabili di cui i test hanno bisogno, con l'indirizzo del server come
suggerimento per <code v-pre>{{baseUrl}}</code>: impostatele in un
[ambiente](./web-tests#variabili-e-ambienti) prima di eseguire. Ciò che non si è potuto riportare è
indicato per ogni test: corpi multipart, script Postman oltre al controllo dello stato, script di
pre-request, flussi OAuth (il test invia allora <code v-pre>{{token}}</code>). Al massimo 500 test
per importazione, 12 MB per file; il registro di audit registra ogni importazione.

### Bundle WSDL/XSD offline

Aprite più file o una cartella, scegliete il WSDL principale e modificate i percorsi logici perché gli import si risolvano rispetto al documento che li contiene (per esempio `service.wsdl`, `types/request.xsd`, `types/base.xsd`). I percorsi della cartella vengono conservati. Scegliete l’endpoint SOAP nell’anteprima; cambiando file, percorsi o endpoint l’anteprima precedente viene invalidata.

Sono supportati import WSDL 1.1, import/include WSDL 2.0 e operazioni SOAP HTTP richiesta-risposta/one-way, con import/include XSD, nomi qualificati, riferimenti a elementi ed estensioni di tipi complessi. Limiti: 32 documenti, 10 MiB totali, profondità import 10. Le dipendenze sono risolte solo tra documenti caricati: nessuna lettura di rete o filesystem. DTD/entità, dipendenze mancanti o ambigue e percorsi insicuri vengono rifiutati. Binding RPC/encoded, gruppi/restrizioni complesse non supportati e scheletri ricorsivi falliscono esplicitamente. Policy, riferimenti alle policy, moduli SOAP, header, choice e attributi da configurare manualmente generano avvisi nell’anteprima. Verificate gli envelope generati prima dell’esecuzione.

## Salvare

**Salva test** chiede un nome e, facoltativamente, un progetto; **Salva modifiche** aggiorna il
test aperto dai **Test salvati**. Un test API salvato si può aggiungere ai piani di test, e usare
come [precondizione](./web-tests#precondizioni) di un test web.

## Versioni e pubblicazione

I test salvati hanno [cronologia, confronto e ripristino](./organizing#cronologia-e-versioni).
[Pubblicazione e revisioni](./organizing#pubblicazione-e-revisioni) scelgono la revisione eseguita
dai piani; salvare o ripristinare la copia di lavoro conserva la pubblicazione esistente. **Prova** esegue la copia di lavoro API salvata.
