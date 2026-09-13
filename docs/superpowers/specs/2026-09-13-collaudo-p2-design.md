# Correzione dei difetti P2 del collaudo — esito

Data: 2026-09-13 · Branch: `fix/collaudo-p2` · Baseline: `main @ d257efd` (PR #126)

## Contesto

Chiusi i P0/P1 nella PR #126, restavano i quattro difetti che il collaudo del 12/09 aveva
classificato P2: **F-09**, **F-10**, **F-11**, **F-12**. Sono tutti chiusi. Durante il
lavoro su F-10 ne è emerso un quinto, più grave di tutti e quattro.

`npm run check` pulito, `npm run lint` senza warning, **467 test server su 55 file** più
**95 client**. Tredici migrazioni applicate da database vuoto.

| Difetto | Esito |
| :--- | :--- |
| F-09 — `db:push` lascia un DB non migrabile | Fatto. `server/schema-state.ts`, `npm run db:doctor` |
| F-10 — nessun chaining nell'API Tester | Fatto. Estrazioni + scheda Captures |
| F-11 — `Dockerfile` mancante, porta 5000, texture da CDN | Fatto |
| F-12 — schedulazioni solo UTC | Fatto. Fuso orario per schedulazione |
| **Nuovo** — i test API nei piani non venivano eseguiti | Fatto |

---

## Il difetto trovato durante il lavoro

`runTest`, ramo API, era letteralmente:

```js
const success = Math.random() > 0.2; // Simulate 80% pass rate
```

sotto un TODO. **Nessuna richiesta veniva mai inviata.** Ogni test API dentro un test plan
riportava un esito inventato, fallendo un run su cinque con il messaggio "Simulated API test
failure". È peggio del non avere copertura: il report era indistinguibile da uno vero, e
nessuno va a cercare una copertura che crede di avere già.

Non è fra i dodici del collaudo perché quell'analisi aveva esaminato la pagina API Tester,
che funziona davvero — il segnaposto stava sul percorso schedulato.

La causa è la stessa di F-01/F-05: la logica di costruzione richiesta e valutazione
assertion viveva **dentro** il gestore della rotta `/api/proxy-api-request`, irraggiungibile
da chiunque altro. Quando il runner dei piani ha avuto bisogno di eseguire un test API non
aveva niente da chiamare, e ha spedito un segnaposto. Ora sta in `server/api-test-runner.ts`,
una volta sola, e la chiamano sia la rotta sia il runner.

---

## Scelte prese

- **`db:push` non viene rimosso ma reso sicuro.** Serve a iterare sullo schema contro un
  database usa-e-getta, ed è legittimo. Ciò che mancava era che il sistema riconoscesse lo
  stato che produce: ora il server rifiuta l'avvio e `db:migrate` rifiuta di partire,
  entrambi spiegando come uscirne.
- **La regola che conta in `inspectSchemaState`**: tabelle presenti con zero migrazioni
  registrate significa `unmanaged`, esista o no la tabella journal. `db:push` seguito da
  `db:migrate` lascia un journal **vuoto**, perché il migrator lo crea prima di fallire;
  leggerlo come "una migrazione indietro" manderebbe il lettore a eseguire l'unico comando
  che non può funzionare. Trovato riproducendo la trappola, non ragionandoci sopra.
- **`node-cron` resta il backend predefinito.** Rendere BullMQ il default riporterebbe Redis
  fra i requisiti obbligatori, che è l'opposto di quanto stabilito col lavoro sull'avvio. È
  una decisione di deployment, non un difetto.
- **Le variabili catturate sono scoped al singolo run**, mai all'ambiente: un token catturato
  alle 02:00 non dice nulla sullo stato del sistema alle 03:00.
- **Il fuso orario è un nome IANA, non un offset.** Un offset non sa esprimere "le 02:00
  locali tutto l'anno", che è esattamente ciò che si vuole da un job notturno.

## Fuori scopo, deliberatamente

- I test API dentro i piani ora eseguono e concatenano, ma **l'autenticazione salvata sul
  test API** (`authType`/`authParams`: Basic, Bearer, JWT) non è ancora applicata dal runner
  condiviso — la rotta la gestiva nel client. Un test che si autentica va scritto oggi con
  un header esplicito, eventualmente con `{{token}}` catturato da una chiamata precedente,
  che è il percorso che questo lavoro apre. Da chiudere nel prossimo giro.
- Il `Dockerfile` è scritto ma **non costruito**: su questa macchina non c'è Docker. La
  verifica disponibile è il test che asserisce che ogni Dockerfile nominato dal compose
  esista; il build va provato dove Docker c'è.
- Nessuna interfaccia per catturare lo stato di login dal registratore: la rotta
  `/api/recording-login-state` esiste e funziona, il pulsante no.

## Da sapere per la prossima modifica programmatica

I file del working tree sono **CRLF** mentre l'indice git è LF. Le sostituzioni multilinea
via script falliscono in silenzio se il testo della patch è LF. Nel lavoro P0/P1 tre
modifiche erano andate perse così, e due messaggi di commit le avevano già dichiarate fatte.
Qui è stato usato un helper che normalizza i line ending e **verifica che l'ancora sia stata
trovata**, fallendo rumorosamente altrimenti. Vale la pena tenerlo.
