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

Gli altri tipi dell'elenco compaiono come *not available*. Il grant authorization code richiede
una persona davanti a un browser, quindi non può essere usato da un run pianificato. Ogni campo
di ogni tipo accetta segnaposto dell'ambiente — tenete lì password e client secret, non nel test.

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

## Salvare

**Salva test** chiede un nome e, facoltativamente, un progetto; **Salva modifiche** aggiorna il
test aperto dai **Test salvati**. Un test API salvato si può aggiungere ai piani di test, e usare
come [precondizione](./web-tests#precondizioni) di un test web.
