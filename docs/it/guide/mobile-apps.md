# App mobili

**App mobili** testa un'app nativa Android o iOS su un **dispositivo reale** di una griglia cloud —
BrowserStack App Automate o LambdaTest Real Devices — tramite Appium. È un tipo di test a sé,
accanto ai test web e API: una schermata nativa non è una pagina web, quindi i suoi passi indicano
gli elementi come li conosce l'app.

Per un **sito** responsive su un telefono non serve: emulate il dispositivo tra i browser del piano
([telefoni e tablet](./running#dispositivi-mobili)).

## Prima di iniziare

- Una griglia **BrowserStack** o **LambdaTest** in **Impostazioni → Griglie di browser**, con
  username e access key dell'account. La stessa griglia serve browser e dispositivi; un server
  Playwright vostro fa girare solo browser.
- L'app: un **.apk** o **.aab** per Android, un **.ipa** compilato per dispositivi reali per iOS.

## Scrivere un test

**App mobili** nel menu → **Nuovo test mobile**:

| Campo | Cos'è |
|---|---|
| **Nome** | Unico nell'organizzazione. |
| **Piattaforma** | Android o iOS. |
| **App** | Dove la trova la griglia: **Carica .apk / .ipa** invia il file alla griglia scelta accanto e ne compila l'indirizzo (`bs://…` o `lt://…`); oppure incollate uno caricato prima, o un indirizzo https:// da cui la griglia la scarica. WebFlowMaster non conserva il file. |
| **Dispositivo** | Come lo chiama la griglia: `Google Pixel 8`, `Samsung Galaxy S24`, `iPhone 15` — vedi l'elenco dei dispositivi della griglia. |
| **Versione del sistema** | Facoltativa: `14.0`, `17`. Vuota: quella scelta dalla griglia per quel dispositivo. |
| **Nei piani di test gira su** | La griglia su cui lo esegue un [piano di test](#in-un-piano-di-test). Un test nuovo parte con la prima griglia BrowserStack o LambdaTest; **Nessuna griglia** lo tiene fuori dalle esecuzioni dei piani (un piano che lo include lo segnala come errore). |

Ogni passo è un'azione e, per quasi tutte, un elemento:

| Azione | Cosa fa |
|---|---|
| **Tocca** | Tocca l'elemento. |
| **Digita** | Svuota il campo e digita il valore. |
| **Svuota** | Svuota il campo. |
| **Attendi elemento** / **Verifica visibile** | Attende che l'elemento sia sullo schermo (fino a 15 secondi). |
| **Verifica non visibile** | Fallisce se l'elemento è ancora sullo schermo dopo al massimo 5 secondi. |
| **Verifica che il testo contenga** | Il testo dell'elemento contiene il valore. |
| **Scorri** | `up`, `down`, `left` o `right`: la direzione in cui il dito si muove al centro dello schermo. |
| **Indietro** | Il tasto indietro del sistema (Android), o la navigazione indietro dell'app. |
| **Nascondi tastiera** | Chiude la tastiera a schermo quando copre ciò che viene dopo. |
| **Attendi (secondi)** | Fino a 60 secondi. Meglio attendere l'elemento. |

**Indicare un elemento:**

| Scrivete | Trova |
|---|---|
| `~login` | L'**accessibility id**: `content-desc` su Android, `accessibilityIdentifier` su iOS. È quello da chiedere agli sviluppatori: sopravvive a restyling e traduzioni. |
| `id=com.shop:id/login` | Il resource id (Android) o il name (iOS). |
| `text=Accedi` | Un elemento che mostra esattamente quel testo. |
| `//android.widget.Button[@text='OK']` | XPath nell'albero delle viste dell'app. |
| `android=new UiSelector().text("OK")` | UiAutomator di Android. |
| `ios=label == "OK"`, `chain=**/XCUIElementTypeButton` | Predicate string e class chain di iOS. |

Un passo che la piattaforma non sa leggere — un selettore CSS, `android=…` in un test iOS — è
segnato in rosso e il test non si salva finché non è corretto. I valori possono usare le
<code v-pre>{{variabili}}</code> dell'ambiente e i [valori generati](./web-tests#valori-generati),
compreso <code v-pre>{{$totp(secret_mfa)}}</code>.

## Eseguirlo

**Esegui** (▶) sulla riga di un test: scegliete la griglia e, per le sue variabili, l'ambiente. La
griglia trova il dispositivo e installa l'app — un minuto o due — poi ogni passo compare mentre
gira, con il motivo quando uno fallisce; i passi dopo un fallimento sono saltati. Alla fine
arrivano lo screenshot del dispositivo e, su BrowserStack, **Video e log sulla griglia**, la pagina
della sessione con il video. La dashboard della griglia mostra la sessione con il nome del test,
segnata come superata o fallita.

L'elenco mostra l'ultima esecuzione di ogni test. I viewer vedono test ed esecuzioni; gli editor li
scrivono, li eseguono e li eliminano.

## In un piano di test

Un piano può includere test mobili accanto ai test web e API: nella procedura guidata del piano,
**Aggiungi Suite di Test** li elenca con l'etichetta **mobile** (un filtro per tag li esclude: non
hanno tag). La pagina del piano li elenca con *(app mobile)*.

In un'esecuzione del piano un test mobile:

- gira **una volta**, sul dispositivo che indica e sulla griglia scelta in **Nei piani di test gira
  su** — non una volta per browser o lingua del piano, i cui browser e il cui "esegui su" non
  valgono per un dispositivo;
- legge le variabili dell'ambiente dell'esecuzione, come gli altri test del piano;
- segue il **Riesegui in Caso di Fallimento** del piano (i tentativi compaiono sul risultato) e la
  sua politica sui fallimenti: un test mobile fallito fa fallire l'esecuzione, e può fermarla;
- è una riga del [report](./results#il-report-di-un-run) come le altre: il dispositivo (`Google Pixel 8 · 14.0`) nella
  colonna *Browser*, i passi sotto il pulsante dei passi con il motivo di quello fallito, l'ultima
  schermata del dispositivo come screenshot e, su BrowserStack, **Open the session on the grid**
  per video e log.

Essendo parte del piano, gira anche nelle sue [pianificazioni](./running#pianificazione) e nei
[pipeline](./running#da-una-pipeline), e il suo risultato arriva a notifiche, JUnit e strumento di test
management insieme agli altri.

Un test mobile senza griglia è segnalato come errore nell'esecuzione, con il motivo, senza chiedere
un dispositivo ad alcuna griglia.

## Suite, requisiti e test management

Un test mobile va ovunque va un test web o API:

- in una **suite statica** ([Suite](./organizing#suite)), e quindi in ogni piano che la include —
  una suite dinamica cerca per tag, e i test mobili non ne hanno;
- come copertura di un **requisito** ([Requisiti](./organizing#requisiti)): il suo ultimo
  risultato in un'esecuzione di un piano conta come gli altri, e l'export della matrice dice
  `mobile`;
- collegato a un caso di **TestRail, Xray o Zephyr Scale**
  ([test management](./results#test-management)): il suo risultato in un'esecuzione è pubblicato su
  quel caso, con il dispositivo nel commento. Un `[C123]` all'inizio del nome funziona come per un
  test web.

In ogni elenco porta l'etichetta **Mobile**.

## Cosa arriva dopo

Un **inspector** per scegliere gli elementi da uno screenshot dal vivo del dispositivo, e poi
l'esecuzione su un Appium locale (un emulatore o un telefono collegato a un agente), sono i
prossimi passi.
