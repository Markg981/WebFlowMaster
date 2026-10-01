# Test API

Un test API è una richiesta HTTP con le verifiche che la risposta deve superare. Più test in un
piano formano un flusso: accedere, creare un ordine, rileggerlo, cancellarlo — ognuno passando
valori al successivo. Si costruiscono in **Tester API**.

## La richiesta

- **Metodo** e **URL di base**; i **Parametri query** si aggiungono sotto e si vedono
  nell'**URL effettivo**.
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

## Salvare

**Salva test** chiede un nome e, facoltativamente, un progetto; **Salva modifiche** aggiorna il
test aperto dai **Test salvati**. Un test API salvato si può aggiungere ai piani di test, e usare
come [precondizione](./web-tests#precondizioni) di un test web.
