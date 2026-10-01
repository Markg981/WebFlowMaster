# Risultati

## Dashboard

La **Dashboard** mostra com'è andato l'ultimo periodo, i passati e i falliti degli ultimi 30
giorni, i report più recenti e i prossimi run pianificati.

## Report

**Report** elenca ogni run concluso: il piano, lo stato, quando è partito, quanto è durato, il
conteggio dei test passati, falliti e saltati, e chi o cosa l'ha avviato (una persona, una
pianificazione, una pipeline). Filtrate per piano e stato, e aprite un run con **Apri report**.

## Il report di un run

Il report elenca ogni test in ogni browser con il suo esito, e i suoi step con i tempi. Intorno:

- **Build**: per un run avviato dalla CI, repository, branch, commit e build testati.
- **Eseguito su**: il runner o gli agenti locali che l'hanno eseguito.
- **Tentativi**: un test rieseguito dopo un fallimento mostra i suoi tentativi; uno passato solo a
  un tentativo successivo è segnato come **instabile**.
- **Quarantena**: i fallimenti dei test in quarantena sono mostrati ma non hanno fatto fallire il
  run.
- Come è finito un run che non si è concluso: **Annullato**, **Tempo scaduto** o **Non
  completato** (il runner si è fermato).

I **grafici** mostrano come si è diviso il run — superati, falliti e saltati, con la percentuale di
successo — e la stessa divisione per ogni priorità e ogni gravità; passando sopra una barra se ne
vede il conteggio. I **filtri** restringono i test falliti e i risultati per modulo a un
componente, una gravità o un esito; i conteggi diventano quelli dei test mostrati, e **Azzera i
filtri** riporta l'intero run.

### Esiti manuali {#esiti-manuali}

I [test manuali](./organizing#test-manuali) di un run compaiono nella scheda **Test manuali**, una
riga per test, **In attesa** finché nessuno ne registra l'esito; un run con test in attesa finisce
comunque come completato. A run concluso, un editor apre la riga, segna ogni step come **OK**,
**KO** o **Non eseguito** con una nota, e registra l'esito:

- **Superato** conta tra i superati.
- **Fallito** conta tra i falliti e fa fallire il run; il motivo mostrato è la nota, o in mancanza
  la nota del primo step KO.
- **Bloccato** (non è stato possibile eseguirlo) conta tra i saltati.

Ogni esito ricalcola i totali e lo stato del run, così il report mescola risultati manuali e
automatici. Un run annullato o scaduto conserva il suo esito. Un esito si può correggere
registrandolo di nuovo; la riga dice chi l'ha registrato e quando, e ogni registrazione finisce nel
registro di audit.

### Pubblicare su TestRail, Xray o Zephyr {#test-management}

Un piano che nelle impostazioni indica una connessione in **Pubblica i risultati su** invia ogni run
concluso a quello strumento, con il risultato di ogni test sotto il suo caso:

| Strumento | Che cosa diventa un run |
|---|---|
| **TestRail** | Una test run nel progetto (e nella suite), con i soli casi del run e un risultato per ciascuno. |
| **Xray Cloud**, **Xray Server/Data Center** | Una issue Test Execution, aggiunta al Test Plan di Xray se la connessione ne indica uno. |
| **Zephyr Scale** (Cloud) | Un test cycle, con una test execution per ogni caso. |

**Quale caso è un test.** In **Impostazioni → Test management**, **Casi di test** su una
connessione elenca tutti i test — web, API e di app mobili — con una casella per la chiave: `C123` in TestRail (o solo `123`),
`SHOP-45` in Xray, `SHOP-T12` in Zephyr. Un test il cui nome inizia con una chiave tra parentesi
quadre — `[C123] Login` — non ha bisogno di nulla: la chiave appare in grigio nella casella ed è
usata così com'è. Una chiave scritta nella casella prevale sul nome. I test senza né l'una né
l'altra vengono esclusi, e la pubblicazione dice quanti sono: un caso che lo strumento non conosce
farebbe fallire l'intero import.

**Che cosa viene inviato per un caso.** Passato, fallito o saltato, e **non eseguito** per un test
ancora in attesa di un esito manuale (TODO in Xray, Not Executed in Zephyr; TestRail non riceve
alcun risultato). Un test eseguito su più browser, o due test sullo stesso caso, danno un solo
risultato, fallito se uno qualsiasi è fallito, con l'esito di ogni browser, il motivo del
fallimento (fino a 1000 caratteri) e l'indirizzo del report nel commento. Il titolo della run è il
nome del piano e il momento in cui è terminato, in UTC.

La scheda **Test management** del report elenca dove è andato il run, con il link alla run di
TestRail o alla issue di Xray, quanti casi sono stati pubblicati e quanti test non avevano un caso,
e perché una pubblicazione è fallita (un token errato, un caso rifiutato dallo strumento).
**Pubblica di nuovo** invia ancora il run — dopo gli esiti manuali, o quando lo strumento era giù —
alla connessione del piano o a un'altra; ogni volta è una nuova run nello strumento. Una
pubblicazione fallita non cambia mai il risultato del run.

### Analisi AI dei fallimenti {#analisi-ai-dei-fallimenti}

Quando l'installazione ha una chiave AI (`GEMINI_API_KEY`), ogni test fallito nella scheda
**Test falliti** ha il pulsante **Analizza con l'AI**. Un editor lo preme e l'AI legge ciò che il
report contiene già: il motivo dato dal runner, gli step intorno al fallimento con i loro errori, le
richieste fallite e lente, e lo screenshot. Risponde, nella lingua dell'interfaccia, con:

- una **categoria**: **Locator** (l'elemento c'è ma il test lo cerca nel modo sbagliato),
  **Bug dell'applicazione**, **Tempi**, **Dati di test**, **Ambiente** o **Non chiara**;
- quanto è sicura, e lo step a cui attribuisce il problema;
- perché lo pensa, e cosa fare;
- per un locator, un **selettore proposto**, da copiare o da mettere nello step con **Applica al test**.

**Applica al test** cambia il selettore di quello step e salva il test come nuova versione,
annullabile dalla cronologia; i piani la usano una volta pubblicata. È offerto quando lo step è del
test stesso — uno step dentro un gruppo si modifica nel gruppo — e per i run fatti da questa versione
di WebFlowMaster in poi, i cui step registrano a quale step del test corrispondono.

L'analisi resta sul risultato: riaprirla, per chiunque, non costa nulla, e **Analizza di nuovo**
ne chiede una nuova. È una causa probabile, non un verdetto: verificatela sugli step. I valori che
sembrano password, codici o chiavi non vengono mai inviati (vedi
[Funzioni AI](../security/#funzioni-ai)), e ogni analisi finisce nel registro di audit.

### I dettagli di uno step

Aprendo uno step si vedono lo **screenshot**, l'errore con cui è fallito e — se il piano li
conserva — il **video** e la **trace di Playwright** del test. Scaricate la trace e apritela con
`npx playwright show-trace` o su trace.playwright.dev: riproduce ogni azione con la pagina
com'era, la console e la rete.

Uno step segnato **healed** ha trovato il suo elemento solo dopo che il selettore è stato
sostituito (vedi [Repository degli elementi](./web-tests#repository-degli-elementi)).

### Test visivi {#test-visivi}

Con **Test visivi** attivo in un piano, lo screenshot di ogni step viene confrontato con la sua
**baseline**. Il primo run dopo l'attivazione registra le baseline. Da lì in poi, uno step il cui
screenshot differisce mostra **Baseline**, **This run** e **Difference**.

### Rete

Quando il piano conserva la rete, il report riassume il traffico di ogni test: quante richieste,
quante fallite, quanto è stato ricevuto, e le richieste fallite e le più lente. **Scaricate
l'HAR** per aprire l'intera cattura negli strumenti per sviluppatori di qualsiasi browser. Non
contiene mai corpi di richieste e risposte, cookie, token o password.

### Accessibilità

Uno step **Verifica accessibilità** mostra quali regole sono state violate, su quali elementi e
con quale gravità; quali sono state rispettate; e quali richiedono il controllo di una persona.

## Esportare un run

**Esporta** scarica il run come:

| Formato | Per |
|---|---|
| Report HTML | Un unico file che si apre ovunque, screenshot inclusi. |
| PDF | Allegarlo a un ticket o archiviarlo per un audit. |
| Risultati Allure (.zip) | `allure generate` o un server Allure. |
| JUnit XML | Il report dei test di un sistema di CI. |

**Requisiti coperti** mostra i [requisiti](./organizing#requisiti) con esattamente i risultati di
questo run, e li esporta come matrice di tracciabilità.

## Aprire una issue

Quando un owner ha collegato Jira o Azure DevOps, un test fallito nel report ha **Apri issue**,
che crea una issue con i dettagli del fallimento, e poi **Apri nel tracker**. Un piano può anche
aprirle da solo (vedi [Impostazioni del piano](./running#impostazioni-del-piano)).

## Test instabili e quarantena

**Report** mostra anche i **Test che si contraddicono**: negli ultimi giorni, i test il cui esito è
cambiato da un run all'altro senza nulla che lo spieghi. Un test che si è rotto ed è stato
sistemato non compare, e nemmeno uno il cui esito è cambiato perché è stato modificato. I test
mobili contano per dispositivo ([app mobili](./mobile-apps#instabili)).

Un test instabile si può mettere in **quarantena**, con il motivo. Continua a girare e i suoi
risultati vengono conservati, ma i suoi fallimenti smettono di far fallire i run, fermare i
piani, aprire issue e rompere le pipeline. **Test in quarantena** mostra come è andato ognuno da
allora; quando torna a passare, usate **Rilascia** con una nota su cosa l'ha sistemato. Possono andare in quarantena i test web,
API e [mobili](./mobile-apps#quarantena).

## Per quanto si conservano le evidenze

Screenshot, video, trace e catture di rete vengono rimossi dopo il periodo per cui l'installazione
li conserva (90 giorni di default). Il report allora lo dice; risultati ed esiti restano.
