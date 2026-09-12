# Correzione dei difetti P0/P1 del collaudo — design

Data: 2026-09-12 · Branch: `fix/collaudo-p0-p1` · Baseline: `main @ 166dab8`

## Contesto

Il collaudo del 12/09/2026 ha registrato dodici difetti riprodotti sulla macchina. Questo
documento copre i P0 (sbloccanti) e i P1 (necessari perché la piattaforma sia utilizzabile su
DMO). Restano fuori, per scelta esplicita: F-10 (chaining API Tester), F-11 (Dockerfile, porta
da env, asset esterno), F-12 (fuso orario e BullMQ di default).

Difetti in scopo: **F-01, F-02, F-03, F-04, F-05, F-06, F-07, F-08**, più due capacità P1
richieste da DMO (riuso dello stato di login, dropdown Angular Material) e il miglioramento dei
selettori.

## Principio guida

Ogni difetto in scopo è conseguenza di una duplicazione o di un'astrazione mancante, non di una
scelta architetturale sbagliata. Il lavoro è quindi in gran parte *unificazione*: un esecutore
invece di due, una sorgente di variabili invece di due, un caricamento di pagina invece di due.
Le capacità nuove (attese condizionali, dropdown, riuso login) diventano facili proprio perché
si aggiungono in un punto solo.

---

## 1. Un solo esecutore di passi

**Difetti risolti:** F-01, F-05

### Stato attuale

`server/playwright-service.ts` contiene due copie dello `switch` che esegue un passo:

| | `executeAdhocSequence` (righe ~766-860) | `executeTestSequence` (righe ~1136-1204) |
|---|---|---|
| Chiamato da | `POST /api/execute-test-direct` | `POST /api/tests/:id/run`, test plan, scheduler |
| `navigate` | presente | **assente** → `default` solleva |
| Sostituzione variabili | sì, su `input`/`navigate`/`select` | no |
| Auto-riparazione AI | no | sì, via `reporter.*` |

### Disegno

Estrarre una funzione unica:

```ts
interface StepContext {
  page: Page;
  reporter?: PlaywrightReporter;   // presente solo sul percorso persistito
  vars: Record<string, string>;
  screenshotBaseDir?: string;
}

async function executeStep(ctx: StepContext, step: TestStep): Promise<StepOutcome>;
```

Regole:

- Le azioni che il reporter sa intercettare (`click`, `input`) passano da `ctx.reporter` quando
  presente, altrimenti da `ctx.page`. Un piccolo adattatore interno evita un `if` per azione.
- La sostituzione variabili si applica **sempre**, a `value` e alle URL, indipendentemente dal
  chiamante.
- Il `default` resta un errore, ma ora esiste un solo elenco di `case` da tenere aggiornato.

`executeAdhocSequence` ed `executeTestSequence` mantengono le loro responsabilità attuali
(avvio browser, navigazione iniziale, raccolta risultati, screenshot, log WebSocket) e delegano
il singolo passo.

### Verifica

- Test che costruisce un `TestStep` con `action.id === 'navigate'` e lo esegue attraverso il
  percorso persistito: deve passare. Oggi fallisce con `Unsupported action ID: navigate`.
- Test che verifica che un `{{placeholder}}` in `value` venga risolto su **entrambi** i percorsi.
- Test che verifica che ogni id di azione dichiarato in `shared/recording.ts` sia gestito
  dall'esecutore — così una futura azione nuova non può essere dimenticata.

---

## 2. Avvio senza Redis

**Difetti risolti:** F-02, F-03

### Stato attuale

- `server/index.ts:94` — `await connectSessionRedis()` non si risolve mai con Redis spento: il
  client node-redis riprova indefinitamente, la promise resta pendente, `server.listen()` non
  viene raggiunto. Il `try/catch` circostante è codice morto.
- `server/auth.ts:44` — `createSessionStore()` legge `sessionRedis.isOpen`, ma in node-redis
  `#isOpen = true` è impostato all'ingresso di `connect()`, prima che esista un socket
  (`@redis/client/dist/lib/client/socket.js:170`). Solo `#isReady` segna l'handshake completato
  (riga 198). Conseguenze: con Redis spento viene scelto lo store Redis e ogni richiesta di
  sessione va in errore; e il `throw` che dovrebbe rifiutare l'avvio in produzione senza store
  condiviso non scatta mai.

### Disegno

In `server/redis.ts`:

- Costruire `sessionRedis` con un `reconnectStrategy` che **rifiuta** il tentativo iniziale dopo
  un numero limitato di prove, invece di riprovare senza fine. Le riconnessioni successive alla
  prima connessione riuscita restano illimitate: perdere Redis a regime non deve uccidere il
  processo.
- `connectSessionRedis(timeoutMs = 5000)` corre la `connect()` contro un timeout di guardia, così
  un driver che cambiasse comportamento non può comunque bloccare l'avvio.
- Instradare gli eventi `error` dei due client nel logger con soppressione dei duplicati
  ravvicinati, per non riavere centinaia di stack identici su stderr.

In `server/auth.ts`:

- `createSessionStore()` legge `sessionRedis.isReady`.
- Il commento alla riga 39, che oggi afferma il contrario, va corretto: `isOpen` non è
  autorevole, `isReady` lo è.

### Verifica

- Con `REDIS_URL` verso una porta chiusa e `NODE_ENV=development`: il server ascolta, il log dice
  di aver scelto lo store in memoria, `POST /api/register` risponde 201.
- Con `REDIS_URL` verso una porta chiusa e `NODE_ENV=production`: l'avvio fallisce con l'errore
  esplicito già scritto in `auth.ts`. Oggi non fallisce.
- Test che asserisce che `connectSessionRedis()` **rifiuti** entro il timeout invece di restare
  pendente.

---

## 3. Una sola sorgente di variabili

**Difetti risolti:** F-04

### Stato attuale

Due meccanismi indipendenti:

- `server/outbound-http.ts:14` — `requestVariables()` restituisce esattamente
  `{ baseUrl: process.env.DMO_BASE_URL || 'http://localhost:7000' }`. È ciò che vede il percorso
  single-test e ad-hoc.
- `server/test-execution-service.ts:27` — `interpolateSecrets()` risolve `{{CHIAVE}}` leggendo la
  tabella `secrets` cifrata, per ambiente. È ciò che vede il percorso dei test plan.

Il registratore salva le password come segnaposto `{{secret_…}}` (corretto: non finiscono in
chiaro nel database). Sul percorso single-test quel segnaposto non risolve e viene digitato
alla lettera nel campo password.

### Disegno

Nuovo modulo `server/variables.ts`:

```ts
export async function resolveVariables(opts: {
  userId: number;
  environmentId?: number | null;
}): Promise<Record<string, string>>;
```

Compone, in ordine di precedenza crescente:

1. `baseUrl` dal record `environments` selezionato;
2. fallback `process.env.DMO_BASE_URL` e infine il default attuale, **solo** se l'ambiente non
   definisce una base URL — serve a non rompere le installazioni esistenti;
3. i segreti decifrati dell'ambiente, per nome.

Tutti i consumatori passano da qui: i due esecutori, `precondition-runner`, `outbound-http`.
`requestVariables()` resta come sottile compatibilità e viene marcata deprecata.

**Ambiente attivo.** `environmentId` è opzionale nel corpo della richiesta di esecuzione; se
assente si usa l'ambiente predefinito dell'utente. Non introduciamo un selettore globale
nell'interfaccia in questo giro.

### Verifica

- Test che esegue lo **stesso** test con un `{{secret_password}}` su entrambi i percorsi e
  verifica che il valore risolto sia identico.
- Test che verifica che un nome sconosciuto resti letterale (comportamento attuale, voluto: un
  errore di battitura deve essere visibile, non silenziosamente vuoto).
- Test che verifica la precedenza: segreto dell'ambiente > variabile di processo.

---

## 4. Preview con evidenziazione degli elementi

**Difetti risolti:** F-06, F-08

### Stato attuale

- `loadWebsite()` e `detectElements()` sono **due sessioni browser separate**, ognuna con il
  proprio `browser.launch()`, `goto()` e attesa di `networkidle`. Su pagina dinamica lo
  screenshot della prima e i `boundingBox` della seconda descrivono due stati diversi.
- Entrambe usano viewport `1280×720`; `loadWebsite` scatta con `fullPage: false`.
- `detectElementsOnPage()` filtra `rect.top >= 0` — senza limite superiore — e tronca con
  `.slice(0, 50)` senza segnalarlo. Un elemento a `top: 1500` è quindi incluso ma cade fuori
  dall'immagine da 720px.
- `docs/USER_GUIDE.md` §2 descrive un "Inspector Mode" con highlight al passaggio del mouse che
  nel prodotto non esiste.

### Disegno

**Lato server.** `detectElements()` restituisce screenshot ed elementi **dallo stesso
caricamento**:

```ts
{
  elements: DetectedElement[];   // boundingBox relativo al DOCUMENTO
  screenshot: string;            // data URI, fullPage
  pageSize: { width: number; height: number };
  totalFound: number;
  truncated: boolean;
}
```

- Screenshot `fullPage: true`, così ogni elemento rilevato è effettivamente inquadrato.
- `boundingBox` diventa relativo al documento: `rect.top + window.scrollY`,
  `rect.left + window.scrollX`. È il cambio che rende le coordinate confrontabili con uno
  screenshot a pagina intera.
- Tetto configurabile (default 300 invece di 50) con `totalFound` e `truncated` nella risposta.
- `loadWebsite()` resta per la sola anteprima "carica e guarda", ma la pagina Create Test usa la
  risposta di `detectElements` come sorgente sia dell'immagine sia dei riquadri, eliminando la
  divergenza.

**Lato client.** Nuovo componente `ElementPreview`:

- Rende lo screenshot con `max-width: 100%` e misura il rapporto reso/naturale
  (`renderedWidth / pageSize.width`).
- Passaggio del mouse su una riga di "Detected Elements" → disegna un contorno assoluto sopra
  l'immagine alle coordinate scalate, con etichetta del selettore.
- Passaggio del mouse su un riquadro → evidenzia la riga corrispondente nella lista
  (evidenziazione bidirezionale, che è la richiesta esplicita: capire *quale* elemento è quale).
- Un comando per riga aggiunge l'elemento al pool di elementi del test.
- Quando `truncated` è vero, l'interfaccia lo dice: "mostrati 300 di N".

**Documentazione.** `docs/USER_GUIDE.md` §2 riscritto su ciò che il prodotto fa davvero dopo
questa modifica.

### Vincolo accettato

Su pagine DMO molto lunghe lo screenshot a pagina intera in base64 può pesare qualche megabyte.
Accettato in questo giro; se diventa un problema la mitigazione è servire l'immagine come file
invece che come data URI, non tornare al viewport fisso.

### Verifica

- Test che verifica che ogni `boundingBox` restituito cada dentro `pageSize`.
- Test che verifica `truncated: true` e `totalFound` corretto su una pagina con più elementi del
  tetto.
- Test client che verifica che l'hover su una riga produca un contorno con `top`/`left` scalati
  correttamente per un rapporto di rendering noto.

---

## 5. Attese condizionali

**Difetti risolti:** F-07

### Stato attuale

L'unica attesa è `wait`, che esegue `page.waitForTimeout(ms)`. Su DMO, dove SignalR aggiorna
l'interfaccia in modo asincrono, un timer fisso produce test instabili che l'auto-riparazione AI
tenta poi di rattoppare a valle.

### Disegno

Tre azioni nuove, aggiunte nell'esecutore unificato (punto 1) e quindi disponibili su entrambi i
percorsi:

| id | semantica | parametri |
|---|---|---|
| `waitForElement` | attende che il selettore sia visibile o nascosto | selettore, stato, timeout |
| `waitForText` | attende che il selettore contenga un testo | selettore, testo, timeout |
| `waitForNetworkIdle` | attende `networkidle`, con fallback al timeout | timeout |

Il timeout ha un default dalle impostazioni utente (`playwrightDefaultTimeout`), com'è già per il
resto.

Vanno aggiornati in modo coordinato: `shared/recording.ts` (id e `ACTION_I18N`), la palette in
`client/src/pages/dashboard-page-new.tsx`, e le quattro lingue in `client/src/locales/`.

### Verifica

- Test per azione contro una pagina locale che monta l'elemento dopo un ritardo: il passo deve
  passare senza `wait` fisso.
- Test che `waitForElement` fallisca con un messaggio che nomina selettore e stato atteso, non un
  timeout generico.
- Il test di copertura del punto 1 (ogni id dichiarato è gestito) copre l'allineamento.

---

## 6. Riuso dello stato di login

**Capacità P1 richiesta da DMO**

### Problema

Non esiste `storageState`, né cookie salvati, né `httpCredentials`: ogni test rifà
l'autenticazione passando dall'interfaccia. Su DMO questo significa decine di secondi per caso di
prova e fallimenti causati dal login, non da ciò che il test verifica.

### Disegno

- Colonna `storage_state` sulla tabella `environments`, **cifrata** con `server/crypto.ts`: il
  contenuto sono cookie e token di sessione, cioè materiale sensibile quanto un segreto.
- Cattura: al termine di una sessione di registrazione, `context.storageState()` viene offerto
  come "salva lo stato di login per questo ambiente".
- Applicazione: alla creazione del contesto browser, se l'ambiente selezionato ha uno stato
  salvato, `browser.newContext({ storageState })`.
- Nuova migrazione `0010_environment_storage_state.sql`.

Lo stato scade come ogni sessione: se il login non è più valido il test fallisce sul primo passo
autenticato. Rilevare e rinnovare automaticamente è fuori scopo qui.

### Verifica

- Test che verifica che lo stato salvato sia cifrato a riposo e decifrabile.
- Test che verifica che il contesto venga creato con `storageState` quando l'ambiente ne ha uno,
  e senza quando non ne ha.

---

## 7. Dropdown Angular Material

**Capacità P1 richiesta da DMO**

### Problema

L'azione `select` chiama `page.selectOption()`, che funziona solo sui `<select>` nativi. Un
`mat-select` è un `div` con un overlay CDK: l'azione fallisce.

### Disegno

Azione nuova `selectByText`, accanto a `select` che resta invariata per i menu nativi:

1. clicca il trigger (il selettore del passo);
2. attende la comparsa dell'opzione che contiene il testo richiesto, cercandola a livello di
   documento perché l'overlay CDK è montato fuori dal trigger;
3. clicca l'opzione;
4. attende la chiusura dell'overlay.

Implementata con i selettori Playwright per testo, quindi copre anche `ng-select` e i dropdown
custom senza codice specifico per libreria.

### Verifica

- Test contro una pagina locale che riproduce la struttura di un overlay CDK (trigger + lista
  montata in un nodo fratello del `body`).
- Test che `select` nativo continui a funzionare.

---

## 8. Selettori per ruolo e testo

**Capacità P1 richiesta da DMO**

### Problema

Angular Material genera id volatili (`mat-input-3`, `mat-select-value-5`) e
`buildUniqueSelector()` preferisce proprio `#id`. Il filtro che scarta le classi `ng-` e `cdk-`
è già presente e ben pensato; manca il livello successivo, cioè ripiegare su ruolo e testo prima
che sul percorso strutturale.

### Disegno

Separare generazione e scelta:

- **In pagina**, `buildSelectorCandidates(el)` restituisce una lista **ordinata** invece di una
  stringa: id stabile → `data-testid`/`data-test` → `name`/`aria-label` → ruolo + nome
  accessibile → testo esatto → classi non volatili → percorso strutturale.
  Un id è considerato stabile se non corrisponde ai pattern volatili noti (`mat-*`, `cdk-*`,
  suffissi puramente numerici generati).
- **Sul server**, si scorre la lista e si tiene il primo candidato con
  `page.locator(sel).count() === 1`. I selettori Playwright `role=` e `text=` si valutano solo
  qui, perché in pagina `document.querySelectorAll` non li conosce.

Il risultato è un selettore stabile quando esiste, e il percorso strutturale solo come ultima
risorsa — l'inverso di oggi per le pagine Angular.

### Verifica

- Test su markup in stile Angular Material: l'elemento con `id="mat-input-3"` e
  `aria-label="Username"` deve produrre un selettore basato sull'etichetta, non sull'id.
- Test che un id genuinamente stabile resti preferito.
- Test che il percorso strutturale sia ancora prodotto quando nulla di meglio è unico.

---

## Ordine di lavoro

L'ordine non è arbitrario: il punto 1 è prerequisito di 5, 7 e 8, e il punto 2 è prerequisito per
poter provare qualsiasi cosa dall'interfaccia senza Redis.

1. Avvio senza Redis (punto 2) — sblocca la verifica manuale
2. Un solo esecutore (punto 1) — prerequisito strutturale
3. Una sola sorgente di variabili (punto 3)
4. Attese condizionali (punto 5)
5. Dropdown Material (punto 7)
6. Selettori per ruolo e testo (punto 8)
7. Riuso dello stato di login (punto 6)
8. Preview con evidenziazione (punto 4)
9. Aggiornamento `USER_GUIDE.md`

Un commit per punto, con il test che riproduce il difetto scritto **prima** della correzione.

## Criteri di conclusione

- `npm run check` esce 0.
- `npm test` verde, con i test nuovi inclusi.
- Con Redis spento, in sviluppo: il server ascolta e la registrazione risponde 201.
- Con Redis spento, in produzione: l'avvio fallisce con messaggio esplicito.
- Un test salvato contenente `navigate` si riesegue verde via `POST /api/tests/:id/run`.
- Ogni id di azione dichiarato in `shared/recording.ts` è gestito dall'esecutore.
- Nella pagina Create Test, il passaggio del mouse su una riga evidenzia l'elemento nella preview
  e viceversa.

## Fuori scopo, con motivazione

- **F-10** estrazione e chaining nell'API Tester: è una funzionalità a sé, con il proprio modello
  dati; non blocca nulla di quanto sopra.
- **F-11** `Dockerfile` mancante, porta cablata a 5000, texture caricata da
  `grainy-gradients.vercel.app`: packaging e ambiente, indipendenti dal motore.
- **F-12** fuso orario nelle schedulazioni e BullMQ come backend predefinito: il secondo
  interagisce con la scelta di rendere Redis opzionale (punto 2) e merita una decisione a sé.

---

## Esito (aggiornato al 12/09/2026, branch `fix/collaudo-p0-p1`)

Tutto lo scope P0/P1 è stato implementato. Nove commit, 29 file, `npm run check` pulito,
`npm run lint` senza warning, **438 test verdi su 51 file** (erano 393 su 46) più 93 test
client.

| Punto | Difetti | Esito |
| :--- | :--- | :--- |
| 1. Un solo esecutore | F-01, F-05 | Fatto. `server/step-executor.ts`, mappa di handler tipizzata |
| 2. Avvio senza Redis | F-02, F-03 | Fatto |
| 3. Una sola sorgente di variabili | F-04 | Fatto. `server/variables.ts` |
| 4. Preview con evidenziazione | F-06, F-08 | Fatto |
| 5. Attese condizionali | F-07 | Fatto. Tre azioni nuove |
| 6. Riuso dello stato di login | — | Fatto. Migrazione 0010, cifrato |
| 7. Dropdown Angular Material | — | Fatto. Azione `selectByText` |
| 8. Selettori per ruolo e testo | — | Fatto |

### Scoperto durante il lavoro, non nel collaudo

- **La pipeline di logging era morta.** `redactSensitiveData` ricostruiva l'oggetto info di
  winston con `Object.entries`, che non enumera le chiavi Symbol, e winston instrada su
  `Symbol.for('level')`. Ogni transport scartava ogni voce: **nessuna** chiamata `logger.*`
  del processo raggiungeva console, file o Loki. È anche il motivo per cui nel collaudo il
  file di log a 0 byte sembrava una conseguenza del blocco all'avvio.
- **Il guard di copertura delle azioni era circolare.** La prima versione derivava
  `HANDLED_ACTION_IDS` da `ADHOC_ACTION_IDS`, cioè confrontava la lista con se stessa. Ora
  la garanzia è a compile-time: la mappa di handler è `Record<AdhocActionId, …>`, quindi
  dichiarare un'azione senza implementarla rompe `npm run check`.
- **La suite era instabile sotto carico.** `hookTimeout` era il default di 10 s, mentre ogni
  file applica dieci migrazioni alla propria istanza PGlite (Postgres in WASM). Con un fork
  per file e qualche test che guida un browser reale, il timeout scattava e vitest riportava
  il *file* come fallito con tutti i test skipped — leggibile come suite rotta invece che
  come macchina occupata.
- **I file del working tree sono CRLF** mentre l'indice git è LF. Tre modifiche multilinea
  applicate via script sono fallite in silenzio per questo motivo, ed erano state date per
  fatte in due messaggi di commit; sono state individuate rileggendo il codice e completate
  nei commit successivi. Per modifiche programmatiche su questo repo, normalizzare i line
  ending e **verificare che l'ancora sia stata trovata** invece di assumerlo.

### Scelte diverse dal disegno iniziale

- **`baseUrl` per ambiente senza nuova colonna.** Il disegno prevedeva un campo dedicato; si
  risolve invece come un normale segreto dell'ambiente, quindi la UI dei segreti esistente lo
  gestisce già e non serve migrazione.
- **Timeout delle attese condizionali fisso a 15 s** anziché preso dalle impostazioni utente.
  Il valore utente predefinito è 30 s, che raddoppia la durata dei test di timeout senza
  migliorare il comportamento in esercizio. Da riprendere se un caso reale lo richiede.
- **L'ispettore interattivo non è stato costruito.** Alla domanda sul punto F-08 la risposta
  è stata un'altra: evidenziare nella preview l'elemento corrispondente alla riga sotto il
  cursore. Quel macchinario esisteva già lato client e non funzionava perché immagine e
  coordinate venivano da due caricamenti distinti — è stato corretto, non riscritto.
- **I test API conservano l'iniezione anticipata dei segreti.** Il loro runner non ha un
  passo di risoluzione per campo a cui passare la mappa; farlo rientra in F-10.

### Resta fuori

F-09 (percorso di primo avvio: `db:push` lascia un database su cui `db:migrate` non gira
più), F-10 (estrazione e chaining nell'API Tester), F-11 (`Dockerfile` mancante, porta 5000
cablata, texture di login da CDN esterna), F-12 (fuso orario nelle schedulazioni, BullMQ come
backend predefinito).
