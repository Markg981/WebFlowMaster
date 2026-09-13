# Da strumento di un cliente a prodotto — esito

Data: 2026-09-13 · Branch: `feat/generic-product` · Baseline: `main @ dee515d` (PR #128)

## Contesto

Chiusi i dodici difetti del collaudo e il gruppo "costruito ma non raggiungibile", restavano
tre cose dal tuo brief iniziale che non erano difetti ma requisiti: che il prodotto non fosse
solo per DMO, che vedesse dentro gli iframe, e che una batteria di test potesse girare su più
dati.

`npm run check` pulito, `npm run lint` senza warning, **496 test server su 58 file** più 95
client. Quattordici migrazioni applicate da database vuoto.

## Cosa contiene

**Debranding.** `AppShell.tsx` scriveva "DMO" a mano in due punti. Ora è un'impostazione di
sistema `workspaceName` (default `WebFlowMaster`, override con `WORKSPACE_NAME`), così un
deployment può chiamarsi DMO e il successivo diversamente senza ricompilare. `DMO_BASE_URL`
diventa `APP_BASE_URL`, **continuando a leggere il vecchio nome**: rinominare una variabile
d'ambiente sotto un deployment in funzione è una rottura silenziosa — i test comincerebbero
semplicemente a colpire l'host di default.

**iframe e shadow DOM.** `frameLocator` non compariva da nessuna parte e `page.locator` non
attraversa il confine di un iframe, quindi un elemento dentro uno non era solo non
cliccabile: il rilevamento non lo vedeva affatto, il che si legge come "la pagina non ce
l'ha". Ora il rilevamento gira una volta per frame e ogni elemento registra la catena di
iframe a cui il suo selettore è relativo.

Lo shadow DOM era il problema inverso: il motore CSS di Playwright attraversa gli shadow root
aperti da solo, quindi quegli elementi erano perfettamente cliccabili ma assenti dalla lista —
e il controllo di unicità, che usava `querySelectorAll`, era in disaccordo con il motore che
poi avrebbe agito sul selettore.

**Dataset parametrici.** Un test può portare righe di input, ognuna delle quali diventa
`{{variabile}}` per quella esecuzione. Prima si poteva esprimere solo caricando un foglio
Excel nel Test Manager, che mappa ogni riga su un test *diverso*: venti test quasi identici, e
una modifica al flusso significava modificarli tutti e venti.

## Scelte prese

- **Ogni riga del dataset ha il suo browser**, non uno condiviso. Una riga è un caso
  indipendente, e una che lasciasse un modale aperto o una sessione a metà deciderebbe
  l'esito della successiva — il tipo peggiore di fallimento, perché si sposta se riordini le
  righe. Costa tempo, e vale la pena.
- **Una riga che fallisce non ferma le altre.** Fermarsi al primo problema significa che il
  run successivo ne trova un altro, una riga alla volta.
- **Un array vuoto conta come nessun dataset.** È un dataset che qualcuno ha iniziato e non
  ha compilato; eseguire zero volte riportando successo sarebbe un verde per un test mai
  eseguito.
- **Un frame non indirizzabile viene saltato del tutto.** Elencare elementi su cui il runner
  non potrà mai agire sarebbe una promessa che non può mantenere.
- **Un passo dentro un frame non passa dal reporter AI.** Il reporter guida la pagina
  direttamente e non sa nulla di frame; riparare un selettore contro il documento sbagliato
  sarebbe peggio che non ripararlo.

## Resta aperto

- **Nessuna interfaccia per i dataset.** Il campo esiste, è tipizzato e il runner lo esegue,
  ma nel builder non c'è ancora un editor: oggi si popola via API. È il prossimo passo
  naturale, come lo era la scheda Captures per le estrazioni.
- **Il `Dockerfile` non è mai stato costruito**: su questa macchina non c'è Docker. Il test
  garantisce che esista e sia quello nominato dal compose, non che il build passi.
- **Gli schemi di autenticazione oltre basic/bearer/apiKey** restano dichiarati nell'enum e
  non implementati, come lo erano nel client.
- **Frame cross-origin** non sono leggibili dal rilevamento: la loro assenza è gestita senza
  far fallire la scansione, ma resta un'assenza.
