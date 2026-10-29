# Eseguire i test

I test girano nei **piani di test**. Un piano dice quali test, in quali browser, quanti insieme,
cosa conservare di ogni run e chi avvisare.

## Dati fissati all'accodamento

Per i nuovi run di piano, lo snapshot conserva i dataset inline o le righe dei set condivisi
dei test web/BDD selezionati e i valori della prima riga `{{data.<set>.<colonna>}}` usati dai
test web, API e mobile. Modificare, rinominare o eliminare un set mentre il run attende non
cambia questi input. Anche dataset nulli e vuoti sono fissati: aggiungere righe dopo
l'accodamento non trasforma quel run in un'esecuzione su più righe.

Il dataset della versione web/BDD pubblicata prevale sulla copia in modifica. Se un set
referenziato non è disponibile all'accodamento, lo snapshot registra un errore per quel test;
correggere il riferimento richiede un nuovo run. Richieste con la stessa chiave di idempotenza
e retry automatici riutilizzano lo snapshot originale. Un nuovo run acquisisce i dati correnti.

Allo stesso modo si fissano i test web, con i gruppi di step, gli elementi salvati e le azioni
personalizzate che richiamano: una versione pubblicata esegue quelli registrati al suo
salvataggio, una copia di lavoro quelli correnti all'accodamento del run
([Che cosa esegue una versione](./web-tests#che-cosa-esegue-una-versione)). Un run accodato la cui
configurazione salvata è illeggibile, o scritta da un rilascio più recente in un formato che questo
non conosce, termina in errore dicendolo; non viene mai eseguito dal piano com'è ora.

I run storici senza snapshot dei dataset continuano a risolvere i dati all'avvio del worker.
Questa funzione congela gli input dei dataset, non tutte le definizioni o i sistemi esterni:
segreti d'ambiente, variabili catturate dalle risposte, valori generati, dispositivi e stato
dell'applicazione possono ancora cambiare. Le credenziali d'ambiente non vengono copiate.
I valori dei dataset sono salvati come normali dati del run in `configuration_snapshot.datasets`:
usare i segreti d'ambiente per le credenziali e applicare le politiche di accesso e conservazione
dei run ai dati sensibili. Tutti i worker devono essere aggiornati prima di fare affidamento
su questo comportamento durante un rilascio graduale.

## Creare un piano

![La pagina dei piani di test](/screenshots/test-plans.webp)

**Piani di test → + Piano di test** apre una procedura in tre passi:

1. **Nome** e descrizione.
2. **Browser e test**. Ogni configurazione di macchina aggiunge un browser — Chrome, Edge,
   Firefox o WebKit (il motore di Safari), visibile o headless, sul desktop o come telefono o
   tablet ([dispositivi](#dispositivi-mobili)); Chrome ed Edge devono essere installati sul runner. **Aggiungi Suite di Test** sceglie i test del piano (ricerca per nome o
   tag). Sistema operativo e versione del browser vengono registrati ma non applicati: i test
   girano sul sistema del runner, con i browser installati lì, e il report lo dice.
   Si possono scegliere anche i [test di app mobili](./mobile-apps#in-un-piano-di-test): girano una
   volta per esecuzione, sul dispositivo e sulla griglia che indicano, qualunque siano i browser.
3. **Impostazioni**: screenshot (sugli step falliti di default, sempre o mai), un **video** di ogni
   run (mai, quando il test fallisce o sempre), quanti test possono **girare insieme**, timeout,
   cosa fare quando falliscono uno step o un prerequisito, quante volte rieseguire un test fallito,
   e notifiche. Le stesse scelte si cambiano poi in [Impostazioni del piano](#impostazioni-del-piano).

## Impostazioni del piano {#impostazioni-del-piano}

**Impostazioni** sulla riga di un piano cambia il comportamento del suo prossimo run:

| Impostazione                                      | Cosa fa                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Browser**                                       | Ogni test gira una volta per ogni browser elencato, ciascuno sul desktop o come telefono o tablet ([dispositivi](#dispositivi-mobili)). Nessuno elencato: il browser delle vostre impostazioni.                                                                                                                                                                                                                                                        |
| **Lingue**                                        | Codici di lingua come `it-IT, en-US` (al massimo 10). Ogni test gira una volta per lingua su ogni browser; vedi [Testare in più lingue](#lingue). Vuoto: la lingua predefinita del browser.                                                                                                                                                                                                                                                            |
| **Esegui al massimo (test contemporanei)**        | Da 1 a 16 sessioni di browser contemporanee. Con 1 il piano esegue un test alla volta, browser per browser.                                                                                                                                                                                                                                                                                                                                            |
| **Worker che si dividono un'esecuzione**          | Da 1 a 8 runner per un'esecuzione, ciascuno con il numero indicato sopra di test contemporanei; vedi [Un'esecuzione su più runner](#shard). Con 1 l'esecuzione resta su un solo runner.                                                                                                                                                                                                                                                                |
| **Se un runner si perde durante un test**         | **Segna il risultato come sconosciuto** (default): il test termina _indeterminato_ e l'esecuzione _incompleta_. **Riesegui il test su un altro runner**: solo se ogni test del piano può essere eseguito due volte sull'applicazione senza danni; vedi [Un runner che smette di rispondere](#runner-perso).                                                                                                                                            |
| **Conserva una registrazione del run**            | Un **video** e una **trace** di Playwright di ogni test — mai, quando il test fallisce o sempre — e il traffico di **rete** come file HAR. Rispondono a ciò che uno screenshot non dice, e occupano disco a ogni run.                                                                                                                                                                                                                                  |
| **Test visivi**                                   | Confronta lo screenshot di ogni step con la sua baseline; vedi [Test visivi](./results#test-visivi).                                                                                                                                                                                                                                                                                                                                                   |
| **Esegui su**                                     | I runner di questo server, un pool di [agenti locali](../integrations/local-agents) dentro la vostra rete, o una [griglia di browser](#griglie-di-browser).                                                                                                                                                                                                                                                                                            |
| **Registra i fallimenti in**                      | Un issue tracker (Jira, Azure DevOps) collegato da un owner. Con **Apri una issue quando un test fallisce**, ogni test e browser che fallisce ottiene una issue; lo stesso fallimento in seguito viene aggiunto come commento.                                                                                                                                                                                                                         |
| **Pubblica i risultati su**                       | TestRail, Xray o Zephyr Scale, collegati in **Impostazioni → Test management**: ogni run concluso vi viene pubblicato caso per caso; vedi [Pubblicare su TestRail, Xray o Zephyr](./results#test-management).                                                                                                                                                                                                                                          |
| **Invia una notifica quando** e l'URL del webhook | Un messaggio a un incoming webhook di Slack o Microsoft Teams, o a qualsiasi URL che accetti un POST, quando un run passa, fallisce, non viene eseguito o viene fermato. Gli indirizzi Slack e Teams ricevono il loro formato a schede: esito colorato, numeri e pulsante **Open report** quando l'installazione conosce il proprio indirizzo pubblico. Anche gli indirizzi e-mail elencati lì ricevono una mail, quando l'installazione invia e-mail. |

**Suite** sulla riga aggiunge [suite](./organizing#suite): girano dopo i test del piano,
nell'ordine in cui sono spuntate, e un test presente in più suite gira una volta sola.

### Un'esecuzione su più runner {#shard}

Un piano lungo finisce prima se più runner se lo dividono. Con **Worker che si dividono un'esecuzione**
maggiore di 1, il runner che prende l'esecuzione ne scrive il lavoro — un pezzo per ogni test su ogni
browser e lingua — e chiede aiuto alla coda. Ogni runner che si unisce, il primo compreso, prende il
pezzo successivo non ancora assegnato, lo esegue e ne prende un altro: un test lento non blocca un
gruppo fisso.

- Il report resta un'unica esecuzione: un insieme di risultati, un esito, una notifica.
- Un piano i cui test API catturano valori per le richieste successive li tiene insieme: ogni browser
  e lingua è un unico pezzo, eseguito in ordine su un solo runner.
- Un runner che si ferma mentre ha un pezzo (un crash, una macchina persa) smette di rispondere; vedi
  [Un runner che smette di rispondere](#runner-perso).
- Una regola di arresto (per esempio _ferma l'esecuzione_ a un fallimento) ferma tutti i runner: i test
  non ancora iniziati vengono registrati come saltati, con il motivo.
- Gli aiutanti sono normali job in coda: usano i runner liberi, e aiutano solo se ce ne sono. Senza
  runner liberi il primo esegue tutti i test da solo, e il log lo dice.

### Un runner che smette di rispondere {#runner-perso}

Un runner tiene ogni pezzo di lavoro sotto una lease che rinnova mentre il test gira. Quando smette di
rinnovarla — un crash, una macchina persa, una rete interrotta — la lease scade (due minuti di
default), e da quel momento nulla di ciò che quel runner scrive viene accettato: né un risultato, né
uno screenshot, né un "passato" che arriva in ritardo. Che cosa succede al pezzo dipende da quanto
era avanzato:

- **Non era iniziato nulla** (il runner è morto prima di aprire il test): un altro runner lo prende,
  come se nulla fosse.
- **Il test era iniziato**: può aver già fatto clic, creato record o inviato richieste, quindi il suo
  risultato non è noto. Di default il test termina **indeterminato**, l'esecuzione termina con un
  errore che dice quanti risultati sono andati persi, e nulla viene eseguito due volte. Con
  **Riesegui il test su un altro runner**, un altro runner lo riesegue come nuovo tentativo;
  sceglietelo solo per piani i cui test si possono ripetere senza danni.
- **I test API che passano valori ai successivi** non vengono mai ripresi a metà, qualunque sia
  l'impostazione: i valori catturati sono andati persi con il runner. I risultati già registrati per i
  test precedenti della sequenza restano nel report.

Un runner che non riesce a confermare in tempo la sua lease ferma da solo il test, prima che la lease
possa scadere sotto di lui, e la console dell'esecuzione lo dice. Un'esecuzione su un solo runner che
perde il suo runner termina con `worker_lost`; viene rieseguita solo con la stessa impostazione.

Un'esecuzione è **completata** solo quando ogni test atteso ha il suo unico risultato. Il report
distingue i test persi (indeterminati), mai eseguiti o non avviabili dai test saltati di proposito e
dai test manuali in attesa di una persona.

### Griglie di browser {#griglie-di-browser}

I runner hanno Chromium, Firefox e WebKit sul sistema su cui sono installati. Per Windows e macOS,
Chrome ed Edge ufficiali o una versione precedente, un piano può prendere i browser da una
**griglia di browser**, aggiunta in **Impostazioni → Griglie di browser**:

| Fornitore                                                                         | Serve                                                                                                                                  | OS e versioni                                                                            |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **BrowserStack**                                                                  | Nome utente e chiave di accesso                                                                                                        | Rispettati                                                                               |
| **LambdaTest**                                                                    | Nome utente e chiave di accesso                                                                                                        | Rispettati                                                                               |
| **Local Appium (agent)**                                                          | Un pool di agenti locali e l'indirizzo di Appium                                                                                       | Esegue solo [test di app mobili](./mobile-apps#appium-locale), non i browser di un piano |
| **Server Playwright** — il vostro `npx playwright run-server`, Browserless, Moon… | Il suo indirizzo `ws://` o `wss://`, e un token se lo chiede (dove l'indirizzo contiene `{token}` va lì, altrimenti come bearer token) | Non rispettati: usa i browser che ha                                                     |

La chiave è salvata cifrata e non viene più mostrata. **Prova la connessione** apre una breve
sessione Chromium sulla griglia e dice se ha funzionato. Un server Playwright deve usare la stessa
versione di Playwright dei runner.

Con **Esegui su** impostato su una griglia, ogni riga di browser del piano chiede anche il
**sistema operativo** (Windows o macOS), la sua **versione** (`11`, `Sonoma`) e la **versione del
browser** (`latest` se vuota). Ogni riga è un passaggio del run, e il report la etichetta con la
sua macchina — _chrome · Windows 11_, _chrome · macOS Sonoma_. Senza OS, WebKit gira su macOS e
tutto il resto su Windows 11. Safari su una griglia resta il WebKit di Playwright.

Ogni test è una sessione nella dashboard del fornitore, con il nome del test, raggruppata sotto il
run e segnata come superata o fallita. Eliminare una griglia riporta i piani che la usavano sui
runner del server. Un piano gira su una griglia o su agenti locali, mai su entrambi.

### Telefoni e tablet {#dispositivi-mobili}

**Dispositivo** su una riga dei browser nelle impostazioni del piano trasforma quel browser in un
telefono o un tablet: iPhone 15, iPhone 15 Pro Max, iPhone 14, iPhone SE, iPhone 13 Mini, Pixel 7,
Pixel 5, Galaxy S24, Galaxy A55, iPad Pro 11, iPad Mini, Galaxy Tab S9 (i tablet anche in
orizzontale). La pagina vede allora quel dispositivo: dimensione e densità dello schermo, il tocco
invece del mouse (`pointer: coarse`), il layout mobile (`<meta name="viewport">` viene rispettato) e
il suo user agent, così un sito responsive mostra menu, dimensioni e pagine che mostra su quel
telefono. Ogni riga è un passaggio a sé: Chromium sul desktop e Chromium come Pixel 7 danno due
risultati per test, e il report dice quale è quale (`chromium · Pixel 7`).

Scegliete il motore su cui è costruito il browser del dispositivo — **WebKit** per un iPhone o un
iPad, **Chromium** o **Chrome** per Android — per il risultato più vicino. **Firefox** non può
emulare un dispositivo: per lui la scelta non viene offerta. I dispositivi si scelgono nella
procedura guidata di creazione o nelle impostazioni del piano e funzionano sui runner del
server, sugli [agenti locali](../integrations/local-agents) e su una [griglia di browser](#griglie-di-browser), il cui
browser desktop mostra allora il dispositivo.

È un'emulazione, non un telefono vero: ciò che dipende dal dispositivo stesso — il comportamento
proprio di Safari su iOS, la tastiera a schermo, la velocità del telefono, le app native — richiede
dispositivi reali, che arrivano con i test delle app mobili.

### Testare in più lingue {#lingue}

Con **Lingue** impostato, ogni lingua è un run del piano a sé su ogni browser: due browser e tre
lingue fanno sei passate. In ciascuna il browser parte in quella lingua — l'header
`Accept-Language` che riceve l'applicazione, `navigator.language` e i formati di numeri e date
della pagina — e <code v-pre>{{locale}}</code> contiene il codice, sia per i test UI sia per quelli
API.

Una verifica il cui testo cambia con la lingua va dentro un **Se** su
<code v-pre>{{locale}}</code> (vedi [condizioni e cicli](./web-tests#condizioni-e-cicli)):

| Step                     | Valore                                 |
| ------------------------ | -------------------------------------- |
| Se (senza elemento)      | <code v-pre>{{locale}} == it-IT</code> |
| Verifica Testo Contenuto | `Accedi`                               |
| Altrimenti               |                                        |
| Verifica Testo Contenuto | `Sign in`                              |
| Fine se                  |                                        |

Il report etichetta ogni risultato con browser e lingua (`chromium · it-IT`) e, con i test
visivi, ogni lingua è confrontata con le proprie baseline.

## Eseguire subito

**Esegui** sulla riga del piano avvia un run e ne apre la pagina: l'avanzamento, lo stato di ogni
test e il log man mano che il run lo scrive. **Apri il report dettagliato** apre il report.

![Un piano in esecuzione: ogni test e browser mentre avanza](/screenshots/run-in-progress.webp)

Un run resta in coda quando l'organizzazione sta già eseguendo tanti piani quanti ne consente il
suo limite, o quando nessun runner è online: **Impostazioni → Utilizzo dei run** dice quale dei
due.

Per fermare un run, **Annulla run** nel suo report. I test non ancora partiti vengono riportati
come saltati. Un test in corso viene fermato dove si trova, anche a metà di uno script che non
finisce mai: il suo browser viene chiuso entro pochi secondi e lo step risulta **Stopped**. Il
runner rileva un annullamento al controllo successivo, ogni 15 secondi per default. Uno step che
supera la sua scadenza (5 minuti per default) viene fermato allo stesso modo e fallisce per tempo
scaduto.

Un run che non riesce a registrare il risultato di un test termina in **errore** (`run_incomplete`),
mai come superato: il suo messaggio nomina il test il cui risultato è andato perso. Non è come un
test fallito: un test fallito compare nel report con il suo fallimento, e il run è **fallito**.

### Rieseguire i fallimenti

Con **Riesegui in Caso di Fallimento** impostato, un test fallito viene eseguito di nuovo, fino a
tre volte. Un test che passa solo a un tentativo successivo viene segnato come **instabile** nel
report, e conta comunque come passato.

## Pianificazione

![La pagina di schedulazione con un piano notturno](/screenshots/scheduling.webp)

**Schedulazione → Crea pianificazione** esegue un piano da solo:

- **Frequency**: una volta, ogni 5, 15 o 30 minuti, ogni 1, 6 o 12 ore, ogni giorno, ogni
  settimana, ogni mese, o un'espressione **Custom CRON** (minuto, ora, giorno del mese, mese,
  giorno della settimana).
- **Timezone**: la pianificazione gira a quell'ora locale tutto l'anno, ora legale compresa.
- **Environment** i cui segreti usa il run, e i **Browsers** in cui girare (headless: nessuno sta
  guardando). Un ambiente ancora indicato da una pianificazione attiva non si può eliminare
  (richiesta rifiutata con 409, con l'elenco delle pianificazioni); se il nome non corrisponde più
  ad alcun ambiente, il run non parte invece di girare senza variabili e segreti.
- **Retry on Failure**: riesegue l'intero piano se fallisce, una o due volte.
- **Schedule Active**: la si spegne senza cancellarla.

Il modulo della pianificazione non è ancora tradotto: le sue voci compaiono in inglese.

La dashboard elenca i prossimi run pianificati.

## Da una pipeline

Un piano può essere avviato dal vostro sistema di CI e il suo esito può far fallire la build: con
una chiave API e la riga di comando `wfm`, oppure con il webhook del piano. Vedi
[Integrazione CI](../integrations/ci).

### Eseguire solo ciò che una modifica tocca {#impatto}

Una pipeline che esegue tutto il piano a ogni commit aspetta test che quel commit non può aver
rotto. **Impostazioni → Mappa dell'impatto** dice quali file riguardano quali test: ogni regola
associa un pattern di file a uno dei vostri [tag](./organizing#la-libreria-dei-test) — `src/checkout/**` → `checkout`.
Una regola con **Nessun test** indica file che non riguardano nulla, come `docs/**` o `*.md`.

Avviate l'esecuzione con i file cambiati dal commit — `wfm run <piano> --changed-since origin/main`,
oppure l'input `changed-since` della GitHub Action — ed esegue:

- i test con un tag a cui porta un file cambiato;
- i test che la mappa non copre (nessuno dei loro tag compare in una regola), perché niente dice che
  la modifica non possa romperli;
- i test falliti o in errore nell'ultima esecuzione conclusa del piano, così l'esecuzione che deve
  mostrare una correzione la mostra.

Nel dubbio esegue di più: un file cambiato che **nessuna regola riconosce** fa eseguire tutto il
piano, e senza regole si eseguono tutti i test. Il log dell'esecuzione, il campo `selection` dell'API
e la CLI dicono cosa è stato deciso — per esempio _3 changed file(s) affect the tags checkout: 7 of
40 tests run_ — così un test non eseguito è una scelta, non un buco. **Provala su una modifica**, nella
stessa sezione, mostra quali test eseguirebbe un elenco di file, senza eseguirli.

I pattern sono come quelli di git: `**` qualsiasi percorso, `*` e `?` dentro una cartella, `{ts,tsx}`
l'uno o l'altro; un pattern senza `/` indica un file in qualunque cartella (`*.md`), uno che finisce
con `/` un'intera cartella.
