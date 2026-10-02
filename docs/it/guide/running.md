# Eseguire i test

I test girano nei **piani di test**. Un piano dice quali test, in quali browser, quanti insieme,
cosa conservare di ogni run e chi avvisare.

## Creare un piano

**Piani di test → + Piano di test** apre una procedura in tre passi:

1. **Nome** e descrizione.
2. **Browser e test**. Ogni configurazione di macchina aggiunge un browser — Chrome, Edge,
   Firefox o WebKit (il motore di Safari), visibile o headless; Chrome ed Edge devono essere
   installati sul runner. **Aggiungi Suite di Test** sceglie i test del piano (ricerca per nome o
   tag). Sistema operativo e versione del browser vengono registrati ma non applicati: i test
   girano sul sistema del runner, con i browser installati lì, e il report lo dice.
   Si possono scegliere anche i [test di app mobili](./mobile-apps#in-un-piano-di-test): girano una
   volta per esecuzione, sul dispositivo e sulla griglia che indicano, qualunque siano i browser.
3. **Impostazioni**: screenshot (sugli step falliti di default, sempre o mai), timeout, cosa fare
   quando falliscono uno step o un prerequisito, quante volte rieseguire un test fallito, e
   notifiche.

## Impostazioni del piano {#impostazioni-del-piano}

**Impostazioni** sulla riga di un piano cambia il comportamento del suo prossimo run:

| Impostazione | Cosa fa |
|---|---|
| **Browser** | Ogni test gira una volta per ogni browser elencato, ciascuno sul desktop o come telefono o tablet ([dispositivi](#dispositivi-mobili)). Nessuno elencato: il browser delle vostre impostazioni. |
| **Lingue** | Codici di lingua come `it-IT, en-US` (al massimo 10). Ogni test gira una volta per lingua su ogni browser; vedi [Testare in più lingue](#lingue). Vuoto: la lingua predefinita del browser. |
| **Esegui al massimo (test contemporanei)** | Da 1 a 16 sessioni di browser contemporanee. Con 1 il piano esegue un test alla volta, browser per browser. |
| **Worker che si dividono un'esecuzione** | Da 1 a 8 runner per un'esecuzione, ciascuno con il numero indicato sopra di test contemporanei; vedi [Un'esecuzione su più runner](#shard). Con 1 l'esecuzione resta su un solo runner. |
| **Conserva una registrazione del run** | Un **video** e una **trace** di Playwright di ogni test — mai, quando il test fallisce o sempre — e il traffico di **rete** come file HAR. Rispondono a ciò che uno screenshot non dice, e occupano disco a ogni run. |
| **Test visivi** | Confronta lo screenshot di ogni step con la sua baseline; vedi [Test visivi](./results#test-visivi). |
| **Esegui su** | I runner di questo server, un pool di [agenti locali](../LOCAL_AGENT) dentro la vostra rete, o una [griglia di browser](#griglie-di-browser). |
| **Registra i fallimenti in** | Un issue tracker (Jira, Azure DevOps) collegato da un owner. Con **Apri una issue quando un test fallisce**, ogni test e browser che fallisce ottiene una issue; lo stesso fallimento in seguito viene aggiunto come commento. |
| **Pubblica i risultati su** | TestRail, Xray o Zephyr Scale, collegati in **Impostazioni → Test management**: ogni run concluso vi viene pubblicato caso per caso; vedi [Pubblicare su TestRail, Xray o Zephyr](./results#test-management). |
| **Invia una notifica quando** e l'URL del webhook | Un messaggio a un incoming webhook di Slack o Microsoft Teams, o a qualsiasi URL che accetti un POST, quando un run passa, fallisce, non viene eseguito o viene fermato. Anche gli indirizzi e-mail elencati lì ricevono una mail, quando l'installazione invia e-mail. |

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
- Un runner che si ferma mentre ha un pezzo (un crash, una macchina persa) smette di rispondere; dopo
  due minuti un altro runner riprende quel pezzo e lo esegue.
- Una regola di arresto (per esempio *ferma l'esecuzione* a un fallimento) ferma tutti i runner: i test
  non ancora iniziati vengono registrati come saltati, con il motivo.
- Gli aiutanti sono normali job in coda: usano i runner liberi, e aiutano solo se ce ne sono. Senza
  runner liberi il primo esegue tutti i test da solo, e il log lo dice.

### Griglie di browser {#griglie-di-browser}

I runner hanno Chromium, Firefox e WebKit sul sistema su cui sono installati. Per Windows e macOS,
Chrome ed Edge ufficiali o una versione precedente, un piano può prendere i browser da una
**griglia di browser**, aggiunta in **Impostazioni → Griglie di browser**:

| Fornitore | Serve | OS e versioni |
|---|---|---|
| **BrowserStack** | Nome utente e chiave di accesso | Rispettati |
| **LambdaTest** | Nome utente e chiave di accesso | Rispettati |
| **Local Appium (agent)** | Un pool di agenti locali e l'indirizzo di Appium | Esegue solo [test di app mobili](./mobile-apps#appium-locale), non i browser di un piano |
| **Server Playwright** — il vostro `npx playwright run-server`, Browserless, Moon… | Il suo indirizzo `ws://` o `wss://`, e un token se lo chiede (dove l'indirizzo contiene `{token}` va lì, altrimenti come bearer token) | Non rispettati: usa i browser che ha |

La chiave è salvata cifrata e non viene più mostrata. **Prova la connessione** apre una breve
sessione Chromium sulla griglia e dice se ha funzionato. Un server Playwright deve usare la stessa
versione di Playwright dei runner.

Con **Esegui su** impostato su una griglia, ogni riga di browser del piano chiede anche il
**sistema operativo** (Windows o macOS), la sua **versione** (`11`, `Sonoma`) e la **versione del
browser** (`latest` se vuota). Ogni riga è un passaggio del run, e il report la etichetta con la
sua macchina — *chrome · Windows 11*, *chrome · macOS Sonoma*. Senza OS, WebKit gira su macOS e
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
emulare un dispositivo: per lui la scelta non viene offerta. I dispositivi si impostano nelle
impostazioni del piano (non nella procedura guidata di creazione) e funzionano sui runner del
server, sugli [agenti locali](../LOCAL_AGENT) e su una [griglia di browser](#griglie-di-browser), il cui
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

| Step | Valore |
|---|---|
| Se (senza elemento) | <code v-pre>{{locale}} == it-IT</code> |
| Verifica Testo Contenuto | `Accedi` |
| Altrimenti | |
| Verifica Testo Contenuto | `Sign in` |
| Fine se | |

Il report etichetta ogni risultato con browser e lingua (`chromium · it-IT`) e, con i test
visivi, ogni lingua è confrontata con le proprie baseline.

## Eseguire subito

**Esegui** sulla riga del piano avvia un run e ne apre la pagina: l'avanzamento, lo stato di ogni
test e il log man mano che il run lo scrive. **Apri il report dettagliato** apre il report.

Un run resta in coda quando l'organizzazione sta già eseguendo tanti piani quanti ne consente il
suo limite, o quando nessun runner è online: **Impostazioni → Utilizzo dei run** dice quale dei
due.

Per fermare un run, **Annulla run** nel suo report. I test non ancora partiti vengono riportati
come saltati; un test in corso si ferma allo step successivo.

### Rieseguire i fallimenti

Con **Riesegui in Caso di Fallimento** impostato, un test fallito viene eseguito di nuovo, fino a
tre volte. Un test che passa solo a un tentativo successivo viene segnato come **instabile** nel
report, e conta comunque come passato.

## Pianificazione

**Schedulazione → Crea pianificazione** esegue un piano da solo:

- **Frequency**: una volta, ogni 5, 15 o 30 minuti, ogni 1, 6 o 12 ore, ogni giorno, ogni
  settimana, ogni mese, o un'espressione **Custom CRON** (minuto, ora, giorno del mese, mese,
  giorno della settimana).
- **Timezone**: la pianificazione gira a quell'ora locale tutto l'anno, ora legale compresa.
- **Environment** i cui segreti usa il run, e i **Browsers** in cui girare (headless: nessuno sta
  guardando).
- **Retry on Failure**: riesegue l'intero piano se fallisce, una o due volte.
- **Schedule Active**: la si spegne senza cancellarla.

Il modulo della pianificazione non è ancora tradotto: le sue voci compaiono in inglese.

La dashboard elenca i prossimi run pianificati.

## Da una pipeline

Un piano può essere avviato dal vostro sistema di CI e il suo esito può far fallire la build: con
una chiave API e la riga di comando `wfm`, oppure con il webhook del piano. Vedi
[Integrazione CI](../CI_INTEGRATION).
