# Esportazione in Playwright

Un test web si può scaricare come file Playwright Test (`*.spec.ts`) che gira senza WebFlowMaster:
`npx playwright test` sulla propria macchina o nella propria pipeline. Questa pagina elenca cosa il
file fa allo stesso modo di un run di WebFlowMaster, cosa fa diversamente e cosa non può fare.

## Due modalità {#modalita}

**Bozza (D-AUTHOR)** — la predefinita, ed è ciò che scarica l'icona del file su un test web. È pensata
per l'utente tecnico che vuole proseguire il test a mano. Ogni step senza un equivalente è scritto al
suo posto come una chiamata che **fa fallire il test**, con il motivo:

```ts
// Not exported — Query a database: queries the environment's database through WebFlowMaster
notExported("step 4, Query a database: queries the environment's database through WebFlowMaster");
```

Le prime righe del file iniziano con `// DRAFT —` ed elencano ogni step mancante (`missing:`) o che si
comporta diversamente (`differs:`). Una bozza non è mai marcata come saltata: uno step che non può
girare rende il test rosso, quindi una bozza non può passare per caso.

**Strict (D-CI)** — per una pipeline che deve ricevere solo file completi. Se uno step o
un'impostazione non è esportabile non viene scritto nulla: la richiesta fallisce con **422** e
l'elenco dei rilievi. Quando la modalità strict restituisce un file, le sue prime righe dicono
`// Conformance: complete`.

## Quale versione viene esportata {#versione}

Il file è fatto da una sola versione salvata del test, con i gruppi di step, le azioni
personalizzate e gli elementi condivisi che usa **quella versione** — mai da una copia di lavoro
etichettata con il numero di un'altra versione.

| `version=`          | Cosa viene esportato                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `run` (predefinito) | Ciò che esegue un piano: la versione pubblicata, o l'ultimo salvataggio se non è mai stato pubblicato |
| `published`         | La versione pubblicata; **409** se il test non è mai stato pubblicato                                 |
| `working`           | La copia di lavoro, con i gruppi di step e le azioni personalizzate attuali                           |
| un numero, es. `3`  | Quella versione salvata; **404** se non esiste                                                        |

Una versione la cui istantanea delle dipendenze non si può leggere, o i cui gruppi non si espandono
più, viene rifiutata con **409** invece di essere esportata con i gruppi di oggi.

## Route {#route}

`GET /api/tests/:id/playwright` (ruolo viewer o superiore).

| Parametro | Valori                             | Predefinito           |
| --------- | ---------------------------------- | --------------------- |
| `version` | `run`, `published`, `working`, `N` | `run`                 |
| `mode`    | `draft`, `strict`                  | `draft`               |
| `format`  | `json` per il risultato completo   | il file come allegato |

Header della risposta: `X-WFM-Export-Source` (`published`, `version` o `working`) e
`X-WFM-Export-Version` (il numero di versione, quando c'è).

| Stato | Significato                                                                                                                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 200   | Il file (o, con `format=json`: `fileName`, `code`, `mode`, `complete`, `findings`, `notExported`, `variables`, `source`)                       |
| 400   | Id, `version` o `mode` non validi                                                                                                              |
| 404   | Test o versione inesistente                                                                                                                    |
| 409   | La versione richiesta non si può esportare così com'è stata salvata (mai pubblicata, istantanea illeggibile, un gruppo che non si espande più) |
| 422   | Modalità strict e qualcosa non è esportabile: `{ error, findings: [{ step, area, support, label, reason }] }`                                  |

**Compatibilità.** Una chiamata senza parametri si comporta come prima — una bozza di ciò che esegue
un piano — con due differenze: la versione è quella che un piano esegue davvero (prima si poteva
esportare la copia di lavoro con il numero della versione pubblicata), e gli step non esportabili ora
fanno fallire il test invece di essere commenti.

Da una pipeline:

```sh
curl -fsS -H "Authorization: Bearer $WFM_TOKEN" \
  "https://wfm.example.com/api/tests/42/playwright?version=published&mode=strict" \
  -o tests/checkout.spec.ts
```

`-f` fa fallire lo step su 422, quindi la pipeline non esegue mai un file incompleto.

## Variabili e segreti {#segreti}

Ogni <code v-pre>{{variabile}}</code> è letta al momento del run da una variabile d'ambiente chiamata
`WFM_<NOME>` (`WFM_BASEURL` per <code v-pre>{{baseUrl}}</code>); il file le elenca nelle prime righe.
Uno step che ha bisogno di una variabile non impostata fallisce con il nome della variabile d'ambiente
da impostare. I valori segreti non sono mai scritti nel file: un header come `Authorization`,
`Cookie` o `X-Api-Key`, o un campo del body come `password` o `token`, viene esportato solo quando il
valore viene da una variabile (<code v-pre>Bearer {{token}}</code>). Una credenziale scritta
letteralmente è un rilievo — in modalità strict l'esportazione è rifiutata, in bozza lo step fallisce
— e una colonna del dataset che ne contiene una viene esclusa dal file.

## Conformità {#conformita}

**supported** — il file fa ciò che fa un run. **partial** — gira, con la differenza descritta.
**unsupported** — lo step ha bisogno di WebFlowMaster: rifiutato in modalità strict, un
`notExported(...)` che fallisce in bozza.

### Azioni {#azioni}

<div v-pre>

| Azione               | Supporto    | Nel file                                                                                                          |
| -------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `click`              | supported   | locator.first().click()                                                                                           |
| `doubleClick`        | supported   | locator.first().dblclick()                                                                                        |
| `rightClick`         | supported   | locator.first().click({ button: 'right' })                                                                        |
| `hover`              | supported   | locator.first().hover()                                                                                           |
| `input`              | supported   | locator.first().fill(value); una {{variabile}} non impostata fallisce                                             |
| `select`             | supported   | locator.first().selectOption(value)                                                                               |
| `selectByText`       | supported   | click, poi l'opzione per ruolo o per le classi dell'overlay, visibile entro 15 s                                  |
| `wait`               | supported   | page.waitForTimeout(ms); il valore è un numero letterale                                                          |
| `scroll`             | supported   | locator.scrollIntoViewIfNeeded(), o window.scrollBy(0, 200)                                                       |
| `navigate`           | supported   | page.goto(url, { waitUntil: 'domcontentloaded' })                                                                 |
| `assert`             | supported   | visibile entro 5 s (con polling, come un run)                                                                     |
| `assertTextContains` | supported   | textContent contiene il testo (maiuscole distinte) entro 5 s                                                      |
| `assertElementCount` | supported   | conteggio confrontato con l'operatore entro 5 s                                                                   |
| `assertState`        | supported   | checked/enabled/editable… con polling entro 5 s                                                                   |
| `ensureState`        | supported   | legge isChecked, clicca solo se diverso, poi attende 5 s lo stato                                                 |
| `waitForElement`     | supported   | waitFor({ state: 'visible' \| 'hidden', timeout: 15 s })                                                          |
| `waitForText`        | supported   | filter({ hasText }).waitFor({ state: 'attached', timeout: 15 s })                                                 |
| `waitForNetworkIdle` | supported   | waitForLoadState('networkidle', 15 s)                                                                             |
| `pressKey`           | supported   | sull'elemento quando c'è, altrimenti page.keyboard                                                                |
| `dragAndDrop`        | supported   | dragTo verso la destinazione nello stesso frame                                                                   |
| `uploadFile`         | supported   | setInputFiles su un input file, altrimenti il file chooser aperto dal click; il nome è letterale                  |
| `handleDialog`       | supported   | una coda di risposte per scheda; i dialoghi senza risposta sono chiusi                                            |
| `switchTab`          | supported   | più recente, numero o testo in indirizzo/titolo, atteso per 15 s                                                  |
| `closeTab`           | supported   | torna alla scheda che l'ha aperta, altrimenti alla prima rimasta                                                  |
| `storeText`          | supported   | valore del campo o innerText, senza spazi ai bordi, nelle variabili                                               |
| `setCookie`          | supported   | addCookies per l'indirizzo della scheda                                                                           |
| `clearCookies`       | supported   | context.clearCookies()                                                                                            |
| `setLocalStorage`    | supported   | localStorage.setItem nella pagina                                                                                 |
| `executeScript`      | supported   | page.evaluate della stessa espressione (argomenti dell'azione personalizzata ed elemento inclusi); false fallisce |
| `setVariable`        | supported   | nelle variabili; i generatori ({{$…}}) sono rifiutati                                                             |
| `assertCondition`    | supported   | le stesse regole di confronto; non numeri con > < falliscono                                                      |
| `mockRequest`        | supported   | context.route + fulfill, filtro sul metodo, ritardo, header CORS                                                  |
| `blockRequests`      | supported   | route.abort('blockedbyclient')                                                                                    |
| `clearMocks`         | supported   | unrouteAll (il file non installa altre route)                                                                     |
| `setGeolocation`     | supported   | grantPermissions + setGeolocation; il punto è letterale                                                           |
| `if`                 | supported   | if/else; le condizioni sugli elementi sono lette subito, senza attesa                                             |
| `else`               | supported   | } else {                                                                                                          |
| `endIf`              | supported   | }                                                                                                                 |
| `repeat`             | supported   | ciclo for da 0…200, {{loopIndex}} da 1                                                                            |
| `repeatWhile`        | supported   | ciclo for che fallisce dopo 200 giri, {{loopIndex}} da 1                                                          |
| `endLoop`            | supported   | } e {{loopIndex}} torna al ciclo esterno                                                                          |
| `waitForEmail`       | unsupported | legge la casella di test dell'ambiente (Mailpit)                                                                  |
| `waitForSms`         | unsupported | legge la casella SMS dell'organizzazione                                                                          |
| `queryDatabase`      | unsupported | interroga il database dell'ambiente tramite WebFlowMaster                                                         |
| `assertAccessible`   | unsupported | la scansione axe-core e le sue soglie girano in WebFlowMaster                                                     |
| `measurePerformance` | unsupported | la raccolta dei Web Vitals gira in WebFlowMaster                                                                  |
| `auditLighthouse`    | unsupported | Lighthouse gira in WebFlowMaster                                                                                  |
| `expectDownload`     | unsupported | i controlli sul download e {{download.*}} girano in WebFlowMaster                                                 |

</div>

### Frame, schede, dati, gruppi, setup e pulizia {#funzionalita}

<div v-pre>

| Funzionalità             | Supporto    | Area      | Nel file                                                                                   |
| ------------------------ | ----------- | --------- | ------------------------------------------------------------------------------------------ |
| frames                   | supported   | frame     | catena di frameLocator, dal più esterno                                                    |
| tabs                     | supported   | tab       | switchTab/closeTab, handleDialog per scheda                                                |
| dataset                  | supported   | data      | un test Playwright per riga, valori come stringhe                                          |
| datasetWithPreconditions | partial     | data      | un run fa le precondizioni una volta per tutte le righe; il file una volta per riga        |
| groups                   | supported   | group     | espansi prima dell'esportazione, dalle dipendenze della versione esportata                 |
| preconditions            | supported   | setup     | fixture request: prima il controllo, satisfiedStatuses, header e body inviati come scritti |
| cleanups                 | supported   | cleanup   | in finally, ogni chiamata tentata, 404/410 contano come fatte, non fa mai fallire il test  |
| variables                | supported   | variables | variabili d'ambiente `WFM_<NOME>`; una non impostata fa fallire lo step che la usa         |
| generators               | unsupported | variables | i valori {{$random…}} sono generati da WebFlowMaster                                       |
| literalCredentials       | unsupported | secrets   | una credenziale scritta in un header o nel body non viene mai copiata nel file             |

</div>

### Cosa resta ai run di WebFlowMaster {#livello-run}

Sono impostazioni del run, non del test, quindi non rendono mai parziale un'esportazione:

- la riparazione AI di un selettore che non trova più l'elemento;
- il confronto visivo con una baseline;
- il nuovo tentativo di uno step fallito (impostazione del piano);
- screenshot, video ed evidenze conservati da WebFlowMaster;
- la policy di egress sugli indirizzi che un test può raggiungere;
- cosa fa un piano quando una precondizione fallisce (continua/salta);
- il timeout di caricamento pagina; il timeout degli elementi è `WFM_ELEMENT_TIMEOUT_MS` (30 s di
  default);
- browser, dispositivo e viewport: li decide la configurazione di Playwright.

## Come si verifica la conformità {#verifica}

Le tabelle qui sopra sono la matrice del codice: un test unitario fallisce se si aggiunge un'azione
senza una riga qui, o se il supporto di una riga cambia senza questa pagina. Un test end-to-end esegue
gli stessi casi su una pagina controllata sia come piano di WebFlowMaster sia come file esportato, e
controlla che concordino — gli stessi effetti, le stesse asserzioni superate e lo stesso fallimento
quando un'asserzione è sbagliata — e che la modalità strict rifiuti un test con uno step non
supportato invece di scrivere un file.
