# Risultati

## Input storici e replay

Il report mostra versioni conservate, provenienza pubblicata/copia di lavoro, SHA-256 per
definizione e impronte di dataset e configurazione. Anche gli export HTML/PDF, Allure e JUnit
riportano la provenienza senza valori o credenziali dello snapshot.

Editor e owner possono scegliere **Riesegui configurazione storica** e confermare un run manuale.
Usa test, dataset, browser e impostazioni conservati anche dopo modifiche al catalogo o al piano.
Il nuovo report collega il sorgente e conserva le stesse impronte. I test cancellati producono
risultati dalla definizione salvata; il piano sorgente deve ancora esistere. I report senza input
accodati verificati non offrono il replay storico.

Si applicano accessi, review e quote attuali. Segreti, sessioni salvate, dispositivi, browser,
profili BDD, integrazioni e applicazione sotto test usano lo stato corrente. Cambiamenti esterni
possono cambiare l’esito. Il replay non aggiorna lo stato della build CI originale.

## Dashboard

La **Dashboard** mostra com'è andato l'ultimo periodo, i passati e i falliti degli ultimi 30
giorni, i report più recenti e i prossimi run pianificati.

## Report

**Report** elenca ogni run concluso: il piano, lo stato, quando è partito, quanto è durato, il
conteggio dei test passati, falliti e saltati, e chi o cosa l'ha avviato (una persona, una
pianificazione, una pipeline). Filtrate per piano e stato, e aprite un run con **Apri report**.

![Report: tutti i run conclusi](/screenshots/reports.webp)

## Il report di un run

![Il report di un run: totali, durata e risultati per modulo](/screenshots/run-report.webp)

Il report elenca ogni test in ogni browser con il suo esito, e i suoi step con i tempi. Intorno:

- **Build**: per un run avviato dalla CI, repository, branch, commit e build testati.
- **Eseguito su**: il runner o gli agenti locali che l'hanno eseguito.
- **Tentativi**: un test rieseguito dopo un fallimento mostra i suoi tentativi; uno passato solo a
  un tentativo successivo è segnato come **instabile**.
- **Quarantena**: i fallimenti dei test in quarantena sono mostrati ma non hanno fatto fallire il
  run.
- Come è finito un run che non si è concluso: **Annullato**, **Tempo scaduto** o **Non
  completato** (il runner si è fermato).

![I test falliti nel report, con browser, motivo ed evidenze](/screenshots/run-report-failure.webp)

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

| Strumento                                   | Che cosa diventa un run                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **TestRail**                                | Una test run nel progetto (e nella suite), con i soli casi del run e un risultato per ciascuno. |
| **Xray Cloud**, **Xray Server/Data Center** | Una issue Test Execution, aggiunta al Test Plan di Xray se la connessione ne indica uno.        |
| **Zephyr Scale** (Cloud)                    | Un test cycle, con una test execution per ogni caso.                                            |

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

#### Chi può scaricare una trace {#chi-puo-scaricare-una-trace}

Una trace è un'**evidenza grezza**: conserva il contenuto della pagina e ogni richiesta con il suo
corpo, quindi una password digitata durante il test vi si trova in chiaro. Solo **editor** e
**owner** possono scaricare trace e file HAR; un viewer vede il resto del report e una nota che
dice che la trace esiste. Il server lo decide a ogni download, quindi conoscere l'indirizzo non
cambia nulla. Una chiave API ha bisogno anche dello scope `runs:evidence`.

| File                                                        | Viewer | Editor, owner |
| ----------------------------------------------------------- | ------ | ------------- |
| Screenshot, differenze visive, video                        | ✓      | ✓             |
| Report Lighthouse, file scaricati da un test                | ✓      | ✓             |
| Trace Playwright, HAR                                       | —      | ✓             |
| Qualsiasi altro file del run (nomi vecchi o non conosciuti) | —      | ✓             |

I file di un test in un **progetto riservato** sono disponibili solo a chi è nel progetto (e agli
owner). Per tutti gli altri non esistono: ricevono la stessa risposta di un file mai scritto.

Un test che gestisce in modo visibile una credenziale — un valore `{{secret_…}}`, oppure un campo,
un selettore o un valore che si chiama _password_ — **non registra la trace**, anche se il piano
la chiede; il log del run lo segnala. Video e screenshot sono conservati come richiesto.

::: warning Screenshot, video e trace non vengono ripuliti
Niente toglie un segreto da un'immagine o da una registrazione. Un browser disegna un campo password
come puntini, ma un'applicazione può mostrare un token, una scheda personale o un codice monouso in
qualsiasi punto della pagina, ed è quello che conterranno screenshot e video. Per i flussi che
usano credenziali reali o dati personali: usate account di test dedicati, impostate nel piano
**Trace** su _Mai_ e **Video** su _Mai_ o _Quando il test fallisce_, e tenete basso
`ARTIFACT_RETENTION_DAYS`.
:::

#### Step healed {#step-healed}

Uno step segnato **superato dopo riparazione** è passato con un locator riparato, non con il suo
(vedi [Uso in esecuzione, approvazione e pubblicazione](./web-tests#approvazione-riparazioni)). È
comunque un successo, e gli step successivi sono stati eseguiti normalmente. Gli step passati con il
proprio locator non hanno badge. I dettagli dello step mostrano:

- il **locator scritto** e quello **usato in questo run**;
- chi l'ha trovato: un fallback noto o l'AI;
- la **proposta** e il suo stato attuale: _proposta_, _approvata_ (con la versione della copia di
  lavoro che ne è nata), _rifiutata_ o _superata_ (lo step è cambiato dopo il run e non si può più
  approvare).

Editor e owner del progetto vedono **Approva** e **Rifiuta**. Approvare scrive la riparazione dove
lo step è scritto, sotto il fingerprint registrato dal run. Non pubblica nulla: la nuova versione va
in linea solo con il consueto passo di pubblicazione o revisione. Il log del run ha un avviso per
ogni step riparato. Le proposte si leggono anche da `GET /api/healing-proposals?testId=…`.

I risultati registrati prima delle approvazioni mostrano cosa fece allora il run (scrisse la
riparazione da sé).

Il bordo rosso che evidenzia l'elemento su cui si agisce viene rimosso dopo ogni azione.
Screenshot, confronti visivi e pagina inviata all'AI mostrano l'applicazione così com'è.

#### Tentativi e righe del dataset {#tentativi-e-righe}

Ogni riga del report è un test su un browser, in una lingua (e su un dispositivo per un test mobile):
un'**unità** del run. Le evidenze di un'unità si conservano per **tentativo** e, per un test con un
[dataset](./web-tests#dataset), per **riga** di ogni tentativo. Una riesecuzione non sovrascrive le
evidenze del primo tentativo, e una riga non sovrascrive quelle di un'altra.

Quando un risultato ha più di un tentativo, o righe di dataset, i suoi dettagli si aprono con due
selettori:

- **Tentativi**: _Tentativo 1 · failed_, _Tentativo 2 · passed · esito_… I dettagli si aprono sul
  tentativo su cui si basa l'esito. Scegliete un tentativo precedente per aprire le evidenze del
  fallimento che la riesecuzione ha sostituito: screenshot, video, trace e HAR, e il motivo del
  fallimento.
- **Righe del dataset**: _Tutte le righe_, oppure una riga con il suo esito e il suo errore.
  Scegliendo una riga si vedono i suoi step e i suoi video, trace e HAR, niente delle altre righe.

Il report conserva gli step del tentativo su cui si basa l'esito. Un tentativo precedente mostra le
sue evidenze e il suo motivo, e indica che i suoi step sono nella sua trace. Le regole qui sopra su
chi può scaricare una trace valgono per ogni tentativo e ogni riga.

Un link può aprire il report su una sola porzione: aggiungete `?unit=<id unità>&attempt=<n>&row=<m>`
all'indirizzo del report (riga da 0). L'API dà la stessa vista: `GET /api/v1/runs/{runId}/units`
elenca le unità di un run, e `GET /api/v1/runs/{runId}/units/{unitId}` restituisce ogni tentativo e
riga con i link ai suoi file (vedi l'[API](../reference/api)). Da una pipeline,
`wfm units <runId> [<unitId>]` li stampa.

Le evidenze di un tentativo si scrivono una volta sola. Un caricamento tardivo dello stesso tentativo
(per esempio da un worker che ha perso il suo lavoro) non sostituisce un file a cui il report già
punta. I run precedenti a questa versione mantengono i loro link. I loro tentativi e le loro righe
non erano conservati separatamente.

### Test visivi {#test-visivi}

Con **Test visivi** attivo in un piano, lo screenshot di ogni step viene confrontato con la sua
**baseline**. Il primo run dopo l'attivazione registra le baseline. Da lì in poi, uno step il cui
screenshot differisce mostra **Baseline**, **This run** e **Difference**.

Il confronto può anche non avvenire: la baseline salvata non è un'immagine leggibile, lo storage
degli artifact non risponde, oppure lo screenshot dello step non si può acquisire. Quello step è
**non verificato** e il test termina in **Error**: mai Passed, e mai contato come differenza
visiva. Lo step mostra la causa (`baseline-corrupt`, `storage-unavailable`,
`screenshot-unavailable`, `comparison-failed`); il motivo riporta "Visual comparison could not run
(…)". Gli export concordano: il report JSON conserva la causa sullo step, Allure mostra test e step
come _broken_ sotto **Visual comparison errors**, JUnit scrive un `<error>`. Una baseline corrotta
non viene mai sostituita da sola: avviate un run con `updateBaselines: true` (vedi l'[API](../reference/api))
per accettare gli screenshot di quel run come nuove baseline.

### Rete

Quando il piano conserva la rete, il report riassume il traffico di ogni test: quante richieste,
quante fallite, quanto è stato ricevuto, e le richieste fallite e le più lente. **Scaricate
l'HAR** per aprire l'intera cattura negli strumenti per sviluppatori di qualsiasi browser (editor e
owner). Non contiene mai corpi di richieste e risposte; cookie, header di autorizzazione e parametri
di query con nomi da credenziale sono sostituiti da `[redacted]`. Una credenziale in un'altra forma
— in un percorso, in un header personalizzato — non viene riconosciuta: per questo l'HAR è
un'evidenza grezza come la trace.

### Accessibilità

Uno step **Verifica accessibilità** mostra quali regole sono state violate, su quali elementi e
con quale gravità; quali sono state rispettate; e quali richiedono il controllo di una persona.

## Esportare un run

**Esporta** scarica il run come:

| Formato                 | Per                                                    |
| ----------------------- | ------------------------------------------------------ |
| Report HTML             | Un unico file che si apre ovunque, screenshot inclusi. |
| PDF                     | Allegarlo a un ticket o archiviarlo per un audit.      |
| Risultati Allure (.zip) | `allure generate` o un server Allure.                  |
| JUnit XML               | Il report dei test di un sistema di CI.                |

Un export contiene i risultati e gli screenshot dei test falliti, e nient'altro delle evidenze
del run: nessuna trace, HAR o video, e nessun link a questi file, chiunque lo esporti. Lo screenshot
di un test in un progetto riservato di cui chi esporta non fa parte viene omesso.

Tentativi e righe del dataset non contano mai come test a sé: un export ha un test per unità, come
il report. Il report HTML li elenca sotto **Attempts and dataset rows**. Allure li allega al loro
test come _Attempts and dataset rows_. JUnit tiene un `<testcase>` per unità e li mette nella
proprietà `wfm.attempts`.

**Requisiti coperti** mostra i [requisiti](./organizing#requisiti) con esattamente i risultati di
questo run, e li esporta come matrice di tracciabilità.

## Aprire una issue

Quando un owner ha collegato Jira o Azure DevOps, un test fallito nel report ha **Apri issue**,
che crea una issue con i dettagli del fallimento, e poi **Apri nel tracker**. Un piano può anche
aprirle da solo (vedi [Impostazioni del piano](./running#impostazioni-del-piano)).

## Test instabili e quarantena

**Report** mostra anche i **Test che si contraddicono**: negli ultimi giorni, i test il cui esito è
cambiato da un run all'altro senza nulla che lo spieghi. Un test che si è rotto ed è stato
sistemato non compare, e nemmeno uno il cui esito è cambiato perché è stato modificato. Ogni test
conta per conto suo, non per nome: due test diversi con lo stesso nome restano separati, e un test
rinominato conserva la sua storia sotto il nome nuovo. I test mobili contano per dispositivo
([app mobili](./mobile-apps#instabili)).

Compare anche un test **passato al nuovo tentativo**, pure quando ogni run è finito verde e nessun
esito è mai cambiato: tre run passati ciascuno al secondo tentativo mostrano **3× passato al nuovo
tentativo**, e un ultimo run verde non toglie il test dall'elenco. Nuovi tentativi, cambi di esito,
run mai eseguiti per un errore d'infrastruttura e modifiche si contano a parte e non si sommano mai
fra loro. Condividono una storia solo i run confrontabili: lo stesso test, che esegue la stessa
definizione (rinominarlo non la divide, cambiarne passi, dati o dipendenze sì), sullo stesso
browser, ambiente, lingua e dispositivo. **Evidenze** elenca cosa è successo, dal più recente, ogni
voce collegata al report del run aperto sul tentativo che lo mostra — per un nuovo tentativo, il
primo tentativo fallito e perché. Un run registrato prima che si conservassero i tentativi dice che
il motivo non è stato registrato, invece di indovinarne uno.

Un test instabile si può mettere in **quarantena**, con il motivo. Continua a girare e i suoi
risultati vengono conservati, ma i suoi fallimenti smettono di far fallire i run, fermare i
piani, aprire issue e rompere le pipeline. **Test in quarantena** mostra come è andato ognuno da
allora; quando torna a passare, usate **Rilascia** con una nota su cosa l'ha sistemato. Possono andare in quarantena i test web,
API e [mobili](./mobile-apps#quarantena).

## Per quanto si conservano le evidenze

Screenshot, video, trace e catture di rete vengono rimossi dopo il periodo per cui l'installazione
li conserva (90 giorni di default). Il report allora lo dice; risultati ed esiti restano.
