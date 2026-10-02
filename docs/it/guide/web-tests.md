# Test web

Un test web è una **sequenza di step** che un browser esegue sulla vostra applicazione: andare
a una pagina, scrivere in un campo, cliccare, verificare cosa compare. Si costruisce in **Crea
Test**.

## Caricare l'applicazione

1. Inserite l'indirizzo in **URL del sito da testare** e premete **Carica Sito**. La pagina viene
   aperta da un vero browser sul server, e uno screenshot compare in **Anteprima Sito**.
2. Premete **Rileva Elementi**. L'elenco degli elementi rilevati mostra cosa si può cliccare,
   compilare o verificare nella pagina — pulsanti, campi, link, menu — ognuno con il selettore
   che il test userà per trovarlo.

Viene rilevato solo ciò che è visibile quando la pagina è caricata. Per un elemento che compare
dopo (un menu che si apre, una seconda pagina), aggiungete gli step che ci arrivano, eseguiteli e
rilevate di nuovo.

## Costruire la sequenza

Trascinate un'azione da **Azioni Disponibili** nella **Sequenza del test**, poi rilasciateci
sopra un elemento rilevato (oppure usate **Imposta elemento**). Compilate il valore che l'azione
richiede: il testo da scrivere, l'opzione da scegliere, il testo atteso.

| Azione | Cosa fa |
|---|---|
| **Naviga** | Va a un indirizzo. |
| **Click Elemento** | Clicca. |
| **Inserimento Testo** | Scrive in un campo. |
| **Seleziona Opzione** | Sceglie un'opzione di un menu nativo. |
| **Scegli Da Menu** | Apre un menu personalizzato e sceglie un'opzione dal testo. |
| **Passa sopra** | Porta il mouse sopra un elemento (per i menu che si aprono al passaggio). |
| **Scorri** | Scorre la pagina o un elemento. |
| **Porta allo stato** | Attiva o disattiva una casella o un interruttore, solo se non lo è già. |
| **Attendi** | Attende un numero fisso di millisecondi. Meglio le attese qui sotto. |
| **Attendi Elemento** | Attende che un elemento sia visibile, o nascosto. |
| **Attendi Testo** | Attende che un elemento contenga un testo. |
| **Attendi Rete** | Attende che le richieste della pagina si siano concluse. |
| **Verifica Visibilità** | Fallisce se l'elemento non è visibile. |
| **Verifica Testo Contenuto** | Fallisce se l'elemento non contiene il testo. |
| **Verifica Conteggio Elementi** | Fallisce se il numero di elementi corrispondenti non è quello giusto, per esempio `==1`, `>=5`, `<3`. |
| **Verifica stato** | Fallisce se un controllo non è selezionato, abilitato, modificabile — o il contrario. |
| **Verifica accessibilità** | Controlla la pagina in quel punto con axe-core, e fallisce sulle violazioni di gravità pari o superiore a quella scelta (serious di default). |
| **Misura la velocità della pagina** | Controlla le Core Web Vitals e i tempi misurati dal browser per la pagina rispetto a dei limiti — vedi [Velocità delle pagine](#velocita-delle-pagine). |
| **Audit Lighthouse** | Esegue Lighthouse sulla pagina corrente e ne controlla i punteggi — vedi [Velocità delle pagine](#velocita-delle-pagine). |
| **Premi tasto** | Preme un tasto o una combinazione — `Enter`, `Tab`, `Escape`, `Control+A` — sull'elemento, o su quello che ha il focus se lo step non ne ha. |
| **Doppio click** / **Click destro** | Fa doppio click, o apre il menu contestuale dell'elemento. |
| **Trascina e rilascia** | Trascina l'elemento su quello il cui selettore è il valore. |
| **Carica file** | Passa a un campo file — o al pulsante che apre la scelta del file — un file creato dal valore: `fattura.csv`, oppure `fattura.csv\|contenuto`. |
| **Rispondi al dialog** | Dice come rispondere al prossimo `alert`, `confirm` o `prompt`: `accept`, `dismiss` o `accept:testo`. Va messo **prima** dello step che apre il dialog. Un dialog senza risposta viene chiuso. |
| **Cambia scheda** | Continua in un'altra scheda: vuoto per la più recente, un numero (da 1), o un testo nel suo indirizzo o titolo. |
| **Chiudi scheda** | Chiude la scheda corrente e torna a quella che l'ha aperta. |
| **Salva testo in variabile** | Legge il testo dell'elemento, o il valore di un campo, nella variabile indicata dal valore, per gli step successivi. |
| **Imposta variabile** | `nome=valore`, per gli step successivi. Vedi [valori generati](#valori-generati). |
| **Attendi email** | Attende l'email inviata a un indirizzo e ne legge codice e link in variabili. Vedi [email](#email). |
| **Query al database** | Esegue un'istruzione SQL sul database dell'ambiente e legge la prima riga in variabili. Vedi [database](#database). |
| **Verifica valori** | Fallisce se un confronto non è vero: <code v-pre>{{db.value}} == 1</code>, <code v-pre>{{total}} > 0</code>, <code v-pre>{{email.subject}} contains Benvenuto</code>. Gli stessi confronti di una condizione senza elemento. |
| **Imposta cookie** / **Cancella cookie** | `nome=valore` per l'indirizzo corrente; oppure li elimina tutti. |
| **Imposta localStorage** | `chiave=valore` nello storage della pagina corrente. |
| **Esegui JavaScript** | Esegue il valore nella pagina. Fallisce se lancia un errore o restituisce `false`, così può verificare ciò che nessun altro step sa esprimere. |
| **Simula richiesta** | Da quel momento risponde alle richieste della pagina a un indirizzo al posto del server — vedi [Simulare la rete](#simulare-la-rete). |
| **Blocca richieste** | Da quel momento le richieste della pagina a un indirizzo falliscono come se la rete fosse giù. |
| **Rimuovi simulazioni** | Toglie tutte le simulazioni e i blocchi: la pagina torna a raggiungere i server veri. |
| **Se** / **Altrimenti** / **Fine se** | Esegue degli step solo quando una condizione è vera. Vedi [condizioni e cicli](#condizioni-e-cicli). |
| **Ripeti** / **Ripeti finché** / **Fine ciclo** | Esegue degli step un numero di volte, o finché una condizione è vera. |

Ogni azione attende già che il suo elemento sia pronto prima di agire, quindi un **Attendi**
fisso serve di rado; quando uno step fallisce perché qualcosa era lento, attendete proprio
quella cosa.

Cambiate l'azione o l'elemento di uno step dallo step stesso, rimuovetelo con il cestino, e
**Svuota** per ricominciare.

Un **Invio** registrato viene rieseguito come step **Premi tasto** dopo il valore del campo in cui
è stato premuto, così una ricerca inviata con Invio viene inviata anche nel replay.

## Condizioni e cicli {#condizioni-e-cicli}

**Se**, **Altrimenti** e **Fine se** sono step come gli altri, messi attorno agli step che
governano; lo stesso vale per **Ripeti** o **Ripeti finché** e **Fine ciclo**. Il costruttore
rientra ciò che sta dentro un blocco ed elenca i blocchi non chiusi; un test che ne ha uno fallisce
prima che si apra il browser, indicando lo step.

Una condizione ha una di due forme:

- **Con un elemento**: lo stato in cui è *adesso* — `visible`, `hidden`, `exists`, `missing`,
  `checked`, `unchecked`, `enabled`, `disabled`, oppure `contains:testo` / `not contains:testo`.
  La risposta è immediata: "se il banner dei cookie è visibile, chiudilo" prosegue subito quando
  il banner non c'è. Per qualcosa che sta ancora caricando, mettete uno step di attesa prima.
- **Senza elemento**: un confronto di valori — <code v-pre>{{stato}} == Pagato</code>,
  <code v-pre>{{n}} > 3</code>, <code v-pre>{{titolo}} contains Ordine</code>, con `==`, `!=`,
  `>`, `<`, `>=`, `<=`, `contains`, `not contains` — oppure una variabile che vale `true` o
  `false`.

**Ripeti** prende un numero di volte; dentro, <code v-pre>{{loopIndex}}</code> conta da 1.
**Ripeti finché** valuta la condizione prima di ogni passata. Un ciclo ferma il test dopo 200
passate, così una condizione che non diventa mai falsa non tiene occupato un worker per sempre.
Con il test visuale, ogni passata di un ciclo è confrontata con la propria baseline.

## Provarlo

**Esegui test** esegue la sequenza in un browser sul server e ne riproduce il risultato step per
step nell'anteprima, con uno screenshot di ogni step. Uno step fallito dice perché. Eseguire non
salva nulla.

## Debug {#debug}

**Debug** esegue la sequenza in modo che possa fermarsi, essere corretta e ripartire, con il
browser ancora aperto:

- **Breakpoint**: cliccate il pallino di uno step per farlo diventare rosso. Il run si ferma prima
  di quello step. Un breakpoint sulla chiamata a un gruppo di step si ferma al primo step del
  gruppo. I breakpoint si possono mettere e togliere mentre la sessione è in corso.
- **Dove uno step fallisce** il run non finisce: si ferma lì, con l'errore.

Quando si ferma, il pannello **Debugger** mostra perché, la pagina in quel momento e il suo
indirizzo, gli step eseguiti fin lì e le variabili (i valori che vengono dall'ambiente sono
segreti: se ne vede solo il nome). Lo step su cui è fermo ha un bordo colorato nel canvas. Da lì:

| Comando | Cosa fa |
|---|---|
| **Continua** | Prosegue fino al prossimo breakpoint, fallimento o alla fine. |
| **Passo** | Esegue questo step e si ferma prima del successivo. |
| **Riprova** | Dopo un fallimento: esegue di nuovo lo step, con la correzione se c'è. |
| **Salta** | Salta questo step. Non è offerto per if, else, cicli e le loro chiusure. |
| **Ferma** | Termina il run e chiude il browser. |
| **Pausa** | Durante l'esecuzione: si ferma prima dello step successivo. |

**Selettore** e **valore** dello step si possono correggere prima di continuare, andare avanti di
un passo o riprovare. La correzione di uno step del test viene copiata anche nel canvas;
**salvate** il test per mantenerla. La correzione di uno step dentro un gruppo vale solo per quel
run.

Un run che ha saltato uno step non risulta mai passato. Un test guidato dai dati si esegue in debug
con una riga del suo dataset, scelta accanto a **Debug** (la prima, se non ne scegliete un'altra). Una sessione lasciata in pausa per 15 minuti chiude il browser. Ogni persona ha
una sessione alla volta: avviarne un'altra ferma la prima.

## Registrare

Con **Modalità di Creazione Test → Registra azioni utente**, **Inizia registrazione** apre una
finestra del browser in cui usate l'applicazione come al solito; ogni clic e ogni testo scritto
diventa uno step. Usate **Add assert** nella barra del registratore per registrare un risultato
atteso. **Termina registrazione** mette gli step nella sequenza, sostituendo quelli presenti.

::: warning Il registratore si apre sulla macchina del server
La finestra di registrazione è un vero browser sulla macchina che esegue WebFlowMaster, non una
scheda del vostro browser. Funziona quando il server gira sul vostro computer; su un server
condiviso senza schermo la registrazione non è disponibile, e i test si costruiscono trascinando
gli step o descrivendoli.
:::

Le password scritte durante la registrazione non vengono salvate nel test: diventano segnaposto
<code v-pre>{{secret&#95;…}}</code>, che definite come segreti di un ambiente.

## Descrivere un test a frasi

**Descrivi** trasforma istruzioni in linguaggio naturale in step, una per riga, con le parole di
un ticket:

```text
Go to https://example.com/login
Type "admin" into the Username field
Click the Sign in button
Check that the dashboard is visible
```

**Leggi la descrizione** mostra ogni riga come lo step che è diventata prima di inserire
qualsiasi cosa, così una frase letta nel modo sbagliato si scopre prima che diventi un test che
passa per il motivo sbagliato. Gli elementi vengono cercati fra quelli rilevati, e nel
repository degli elementi di un progetto se ne scegliete uno. Le formulazioni comuni vengono
capite senza AI; se l'installazione ha una chiave AI, il resto viene letto anche dal modello
(righe segnate **AI**). Senza AI questo comprende i tasti (`Premi Invio nel campo Password`),
`Doppio clic su …` / `Clic destro su …`, `Carica il file fattura.pdf nel campo Allegato`,
`Accetta il dialog` / `Rispondi al prompt con «Mario»`, le schede, i cookie e
`Salva il testo di … come numeroOrdine`.

## Variabili e ambienti {#variabili-e-ambienti}

Qualsiasi valore di uno step può contenere segnaposto <code v-pre>{{nome}}</code>, riempiti
quando il test gira:

- dall'**ambiente** scelto nel costruttore, nel run del piano o nella pianificazione: i suoi
  segreti (**Impostazioni → Ambienti**), per esempio <code v-pre>{{ADMIN&#95;PASSWORD}}</code>. Un
  segreto chiamato `baseUrl` imposta <code v-pre>{{baseUrl}}</code>, così un test può partire da
  <code v-pre>{{baseUrl}}/login</code> su ogni ambiente;
- da una riga di un **dataset** (sotto);
- <code v-pre>{{locale}}</code>, la lingua in cui un piano esegue il test (vedi
  [Testare in più lingue](./running#lingue));
- da valori catturati da un test API eseguito prima nello stesso run;
- dagli step **Salva testo in variabile** e **Imposta variabile** precedenti nello stesso test.
  Quei valori appartengono solo a quel run.

Un segnaposto che nessuno definisce non viene svuotato: lo step fallisce e indica la variabile
mancante.

### Valori generati {#valori-generati}

Un segnaposto che comincia con `$` crea un valore ogni volta che viene usato, ovunque le
variabili siano accettate — uno step, un URL, un test API:

| Segnaposto | Valore |
|---|---|
| <code v-pre>{{$randomEmail}}</code> | `test.k3v9…@example.com` (un dominio che non consegna a nessuno) |
| <code v-pre>{{$uuid}}</code> | Un UUID casuale |
| <code v-pre>{{$randomInt(1,100)}}</code> | Un intero fra i due, estremi inclusi (0–1000 di default) |
| <code v-pre>{{$randomString(8)}}</code> | Lettere e cifre |
| <code v-pre>{{$randomDigits(6)}}</code> | Solo cifre |
| <code v-pre>{{$today}}</code>, <code v-pre>{{$today(+7)}}</code> | Una data, `aaaa-mm-gg`, oggi o fra quei giorni |
| <code v-pre>{{$now}}</code>, <code v-pre>{{$timestamp}}</code> | L'istante corrente, ISO o in millisecondi |
| <code v-pre>{{$totp(secret&#95;mfa)}}</code> | Il codice che un'app di autenticazione mostra adesso per il seme contenuto nella variabile indicata; vedi [accesso in due passaggi](#totp) |

Ogni segnaposto è un valore nuovo. Per usarne uno due volte — registrarsi con un indirizzo e poi
accedere con lo stesso — dategli prima un nome: **Imposta variabile**
<code v-pre>email={{$randomEmail}}</code>, poi <code v-pre>{{email}}</code>. Un generatore scritto
male fa fallire lo step come una variabile mancante.

I valori dei segreti sono cifrati, non vengono più mostrati dopo il salvataggio, e sono mascherati
nei log.

### Accesso in due passaggi con un'app di autenticazione {#totp}

Quando l'applicazione chiede il codice a sei cifre di un'app di autenticazione (Google
Authenticator, Microsoft Authenticator…), <code v-pre>{{$totp(nome)}}</code> digita il codice che
l'app mostrerebbe in quel momento. Registrate una volta l'account di test e conservate ciò che
l'applicazione ha mostrato come segreto dell'ambiente, per esempio `secret_mfa`: la chiave scritta
sotto il QR code (`JBSW Y3DP EHPK 3PXP`, spazi e maiuscole non contano), oppure l'indirizzo
contenuto nel QR code (`otpauth://totp/…?secret=…`), che porta con sé anche numero di cifre,
periodo e algoritmo quando non sono i soliti 6, 30 secondi e SHA-1. Poi lo step **Digita**
<code v-pre>{{$totp(secret&#95;mfa)}}</code> nel campo del codice.

L'argomento è il **nome** della variabile, mai la chiave, così la chiave resta cifrata e fuori dal
test. Un nome che l'ambiente non definisce, o un valore che non è una chiave, fa fallire lo step e
lo nomina. Il codice è calcolato dall'orologio del runner, che deve essere giusto a pochi secondi.

### Partire con l'accesso già fatto

Per saltare il login in ogni test: scegliete l'ambiente nel costruttore, avviate una
registrazione, accedete nella finestra di registrazione e premete **Save login for this
environment**. I run su quell'ambiente partono allora con quella sessione; l'ambiente compare
come *con accesso salvato* nel selettore. Salvatelo di nuovo quando la sessione scade.

### Email: codici e link {#email}

Registrazione, reimpostazione della password e accesso in due passaggi mandano un'email che il test
deve leggere. Lo step **Attendi email** la legge dalla **casella di test** dell'ambiente, un
[Mailpit](https://mailpit.axllent.org): un raccoglitore di posta che accetta tutto ciò che
l'applicazione invia alla sua porta SMTP, per qualsiasi indirizzo. Nell'ambiente di test puntate
l'SMTP dell'applicazione su di esso (porta 1025) e ogni indirizzo ha una casella, anche quelli
inventati.

Una registrazione, dall'inizio alla fine:

| Azione | Valore |
|---|---|
| Imposta variabile | <code v-pre>email={{$randomEmail}}</code> |
| Digita | <code v-pre>{{email}}</code> nel campo dell'indirizzo, poi inviare il modulo |
| Attendi email | <code v-pre>{{email}}\|Conferma il tuo account</code> |
| Digita | <code v-pre>{{email.otp}}</code> nel campo del codice — oppure **Naviga** su <code v-pre>{{email.link}}</code> |

Il valore è l'indirizzo, seguito facoltativamente da `|` e da un testo contenuto nell'oggetto, e
da un secondo `|` e un'espressione regolare per il codice:
<code v-pre>{{email}}|Il tuo codice|codice: (&#91;A-Z0-9-]+)</code> legge ciò che trova il primo gruppo.
Lo step attende fino a 60 secondi l'email più recente a quell'indirizzo esatto (in A, Cc o Ccn)
arrivata **dopo l'inizio del test**, così un indirizzo fisso, come quello di un utente di prova,
non legge l'email del run precedente. Poi imposta:

| Variabile | Contiene |
|---|---|
| <code v-pre>{{email.otp}}</code> | Il codice: il primo numero di 4–8 cifre dopo una parola come *codice*, *code*, *OTP*, *PIN* o *verifica*, oppure l'unico dell'email; con un pattern, ciò che il pattern ha trovato |
| <code v-pre>{{email.link}}</code> | Il primo link da seguire, saltando disiscrizioni, immagini e fogli di stile |
| <code v-pre>{{email.subject}}</code>, <code v-pre>{{email.from}}</code>, <code v-pre>{{email.text}}</code> | Oggetto, indirizzo del mittente e testo (un'email solo HTML viene convertita in testo) |

Una variabile che l'email non fornisce — nessun codice, nessun link — resta non definita, così uno
step successivo che la usa fallisce e la nomina, invece di digitare un valore di un'email
precedente. Un pattern che non trova nulla fa fallire lo step.

**Quale casella.** I segreti dell'ambiente `mailpit.url` (per esempio
`https://mail.staging.example`) e, se li chiede, `mailpit.username` e `mailpit.password`;
`mailpit.timeout` cambia l'attesa, in secondi. In loro assenza, quella del server (`MAILPIT_URL`,
che lo stack docker-compose imposta sul suo Mailpit, aperto su http://localhost:8025). La casella
viene letta da dove gira il browser, quindi un piano su un agente locale raggiunge un Mailpit della
rete dell'agente.

### Database: verificare e preparare i dati {#database}

Ciò che uno schermo non mostra — la riga scritta dal checkout, il flag impostato da una pagina di
amministrazione — o ciò che un test deve preparare senza passare per dieci schermate, uno step
**Query al database** lo legge o lo scrive direttamente. Il valore è un'istruzione SQL, con
variabili:

| Azione | Valore |
|---|---|
| Query al database | <code v-pre>SELECT status, total FROM orders WHERE email = '{{email}}'</code> |
| Verifica valori | <code v-pre>{{db.status}} == Paid</code> |

Imposta:

| Variabile | Contiene |
|---|---|
| <code v-pre>{{db.value}}</code> | La prima colonna della prima riga (vuota se non ci sono righe) |
| <code v-pre>{{db.colonna}}</code> | Ogni colonna della prima riga con il suo nome — <code v-pre>{{db.status}}</code>, <code v-pre>{{db.total}}</code>; i caratteri diversi da lettere, cifre, `_` e `.` diventano `_`, quindi date un nome alle colonne calcolate (`count(*) AS n`) |
| <code v-pre>{{db.rowCount}}</code> | Le righe restituite, o quelle modificate da un INSERT, UPDATE o DELETE |
| <code v-pre>{{db.json}}</code> | Le prime 100 righe, in JSON |

Le date sono in formato ISO, i valori nulli sono testo vuoto. Ogni query dimentica le colonne della
precedente, così una colonna che questa query non ha restituito è non definita invece di restare
dalla volta prima. Un'istruzione rifiutata dal database fa fallire lo step con il messaggio del
database.

**Quale database.** Il segreto dell'ambiente `db.url`, un indirizzo il cui schema sceglie il database:

| Database | Indirizzo |
|---|---|
| PostgreSQL | `postgres://utente:password@host:5432/shop` (`?sslmode=require` per TLS) |
| MySQL, MariaDB | `mysql://utente:password@host:3306/shop` |
| SQL Server | `sqlserver://utente:password@host:1433/Shop` — `sqlserver://…@host%5CSQLEXPRESS/Shop` per un'istanza con nome; `?encrypt=false` per un server senza TLS, `?trustServerCertificate=true` per un certificato autofirmato |

Caratteri come `@` o `/` nella password si scrivono `%40` e `%2F`. Per un secondo database
dategli un nome: `db.reporting.url` e il valore `@reporting SELECT …`.
`db.timeout` cambia il limite di 30 secondi, in secondi. Si tengono al massimo 1000 righe.

L'istruzione gira con i permessi dell'utente dell'indirizzo: usate un utente che possa leggere solo
ciò che i test verificano e scrivere solo ciò che preparano, e mai un database di produzione. La
query parte dal runner di WebFlowMaster, non dal browser — anche su un agente locale — quindi il
runner deve raggiungere il database. I valori entrano nell'SQL così come sono: mettete il testo tra
apici (`'{{email}}'`) e usate variabili i cui valori sono sotto il controllo del test.

## Velocità delle pagine {#velocita-delle-pagine}

**Misura la velocità della pagina** legge ciò che il browser stesso ha registrato sulla pagina in cui
si trova il test, in quel punto del flusso, e fallisce quando un limite non è rispettato. Il valore
elenca i limiti:

`LCP < 2.5s, CLS <= 0.1, INP < 200, TTFB < 800ms, weight < 2MB`

| Metrica | Cos'è |
|---|---|
| `LCP` | Largest Contentful Paint: quando è comparso il contenuto principale. |
| `CLS` | Cumulative Layout Shift: quanto si è spostata la pagina (la finestra di 5 secondi peggiore). |
| `INP` | Interaction to Next Paint: la risposta più lenta a un clic o a un tasto finora; misurata solo dopo che il test ha interagito. |
| `FCP`, `TTFB`, `DCL`, `LOAD` | Primo disegno, primo byte, DOM pronto, evento load. |
| `TBT` | Total Blocking Time: i task lunghi dopo il primo disegno. |
| `REQUESTS`, `WEIGHT` | Quante richieste, e quanti byte trasferiti (i file di altri domini senza `Timing-Allow-Origin` contano 0). |

I tempi accettano `ms` o `s`, le dimensioni `KB` o `MB`. Se vuoto, controlla le soglie *buone* delle
Core Web Vitals: `LCP <= 2500, CLS <= 0.1, INP <= 200`. Mettetelo dopo che la pagina si è caricata —
dopo un **Attendi elemento** sul contenuto principale, per esempio — e dopo un'interazione quando
conta l'INP. Solo Chromium misura LCP, CLS, INP e TBT; in Firefox e WebKit compaiono come — e un
limite su di esse risulta non misurato invece che fallito, così lo stesso test gira su ogni browser.

**Audit Lighthouse** esegue [Lighthouse](https://developer.chrome.com/docs/lighthouse) sull'indirizzo
della pagina corrente e ne controlla i punteggi per categoria (0–100): `performance >= 80,
accessibility >= 90, best-practices >= 90, seo >= 80`, più `desktop` per il profilo desktop (mobile
di default). Se vuoto registra i punteggi e non controlla nulla. Lighthouse ricarica la pagina in un
proprio Chromium sul runner, inviando i cookie del test per quell'indirizzo, così una pagina dietro
un accesso viene analizzata con l'accesso fatto; richiede 15–60 secondi. Il suo report HTML completo
resta con le evidenze dell'esecuzione. Gira solo sui runner del server: un piano su agenti locali o
su una griglia di browser non può essere analizzato da dove si trova la pagina.

La scheda **Velocità delle pagine** del report elenca ogni pagina misurata — le metriche per browser,
e i punteggi Lighthouse con il link al report — con i limiti non rispettati, e i dettagli di ogni
step mostrano gli stessi numeri.

## Simulare la rete {#simulare-la-rete}

Un test può rispondere da sé alle richieste della pagina, per vedere le schermate che il backend vero
mostra di rado — un errore, una lista vuota, una risposta lenta — o per girare quando il backend non
è pronto. **Simula richiesta** prende

`[METODO] indirizzo | stato [after 1500ms] | corpo`

- **indirizzo**: un URL, o un pattern dove `**` vale qualunque carattere e `*` qualunque tranne `/`:
  `**/api/orders*`, <code v-pre>{{baseUrl}}/api/orders/42</code>. Con un metodo davanti
  (`GET`, `POST`…) risponde solo a quel metodo; gli altri arrivano al server.
- **stato**: `200` se omesso; `after 1500ms` (o `after 2s`, fino a 30 s) ritarda la risposta, per
  verificare uno stato di caricamento.
- **corpo**: tutto ciò che segue il secondo `|`, variabili comprese. Il JSON è inviato come
  `application/json`, il resto come testo.

`GET **/api/orders | 200 | []` mostra la lista vuota;
`POST **/api/orders | 500 | {"error":"out of stock"}` l'ordine fallito. La simulazione
vale per il resto del test e in tutte le schede che apre; una simulazione successiva dello stesso
indirizzo la sostituisce, così un test può cambiare risposta a metà. **Blocca richieste** prende un
indirizzo e fa fallire quelle richieste — `**/analytics/**` tiene fuori una terza
parte — e **Rimuovi simulazioni** toglie tutto ciò che è stato impostato.

Riguarda solo ciò che chiede la pagina: precondizioni, pulizia e test API vanno ai server veri.

## Precondizioni

Le **precondizioni** sono chiamate API eseguite prima degli step, per portare l'applicazione nello
stato che il test richiede — creare un cliente, svuotare un carrello. Si scelgono fra i vostri
[test API](./api-tests) salvati e girano nell'ordine dell'elenco. Un test la cui precondizione
fallisce viene riportato come bloccato, non come fallito.

## Pulizia {#pulizia}

Le chiamate di **pulizia** sono chiamate API eseguite dopo il test, che sia passato, fallito o
bloccato da una precondizione, per rimuovere i dati che ha creato — l'ordine che ha inserito, il
cliente creato da una precondizione — così l'esecuzione successiva parte dallo stesso stato e
l'applicazione sotto test non si riempie di dati di prova. Si scelgono fra i vostri
[test API](./api-tests) salvati, di solito richieste `DELETE`, e girano nell'ordine dell'elenco.

- Possono usare i valori salvati dagli step: <code v-pre>DELETE {{baseUrl}}/orders/{{orderId}}</code>
  dopo uno step **Salva testo in variabile** che ha conservato il numero d'ordine come `orderId`. Una chiamata che nomina una
  variabile mai impostata nell'esecuzione — il test è fallito prima dello step che la salva — non
  viene fatta, e il report dice che è stata saltata.
- Ogni chiamata viene tentata, anche dopo che una fallisce. `404` e `410` valgono come **già
  rimosso**, quindi una pulizia si può ripetere senza danni.
- Con un [dataset](#dataset), la pulizia gira una volta per ogni riga, dopo tutte le righe, con i
  valori di quella riga; ciò che ha creato una precondizione lo cancella la prima riga, e per le
  altre risulta già rimosso.
- La pulizia non cambia mai l'esito del test. Il report la mostra come riga **Cleanup** dopo gli
  step, fallita quando una chiamata è fallita — possono essere rimasti dei dati — e il log
  dell'esecuzione nomina la chiamata.

Anche **Esegui test** nel builder esegue la pulizia. Il debugger no: una sessione in pausa a metà
cancellerebbe ciò che state guardando.

## Dataset

Per eseguire lo stesso test su più input, dategli un **dataset**: una tabella i cui nomi di
colonna diventano variabili. Il test gira una volta per riga. Costruitelo aggiungendo colonne e
righe, oppure incollatelo da un foglio di calcolo (**Paste from a spreadsheet**): copiate il
blocco da Excel o Google Sheets, riga di intestazione compresa.

Quando le righe servono anche ad altri test, tenetele in un [set di dati condiviso](./organizing#test-data)
e sceglietelo in **Use a shared data set**: il test conserva solo un collegamento, gira sulle righe
del set così come sono al momento del run, e segue il set anche se viene rinominato. **Use a copy as
this test's own rows** trasforma il collegamento in righe proprie del test.

## Gruppi di step

Una sequenza usata da molti test — l'accesso, la scelta di un cliente — si può salvare con
**Salva come gruppo**. Compare allora sotto **Gruppi di step** nella palette, e qualsiasi test può
includerla. Un test esegue il gruppo com'è al momento del run, quindi modificare il gruppo cambia
ogni test che lo usa.

## Azioni personalizzate {#azioni-personalizzate}

Quando nessuna azione predefinita fa ciò che serve a un test, un editor può scriverne una:
**Impostazioni → Azioni personalizzate → Nuova azione personalizzata**, con nome, parametri e uno
script. L'azione compare sotto **Azioni personalizzate** nella palette e un test la usa come
qualsiasi altro step.

- **I parametri** si elencano separati da virgole; un `?` finale ne rende uno facoltativo
  (`codice, qta?`). Nel test, il valore dello step dà gli argomenti: `codice=4711; qta=2`. Per un
  punto e virgola dentro un valore scrivete `\;`. Gli argomenti possono contenere
  <code v-pre>{{variabili}}</code> e valori generati. Un argomento mancante o sconosciuto, o un
  valore senza `=`, fa fallire il test prima che si apra il browser, sia con **Esegui test** nel
  costruttore sia in un piano, con un messaggio che nomina l'argomento.
- **Lo script** è il corpo di una funzione async eseguita nella pagina sotto test. Legge gli
  argomenti in `args` (`args.codice`) e, quando lo step ha un elemento, quell'elemento in
  `element` (trovato con `document.querySelector`, quindi un selettore CSS). Fa fallire lo step
  lanciando un errore o restituendo `false`; qualsiasi altro valore restituito compare nel report.

```js
const riga = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes(args.codice));
if (!riga) throw new Error(`Nessun ordine ${args.codice}`);
riga.querySelector('button.apri').click();
```

Un'azione personalizzata ha i poteri di uno step **Esegui JavaScript** e nessun altro: gira nella
pagina del browser, mai sul server o sul runner. I test fanno riferimento all'azione invece di
copiarla, quindi modificarla cambia ogni test che la usa al run successivo; un'azione ancora usata
da un test o da un gruppo di step non si può eliminare, e il messaggio dice chi la usa. Creazione,
modifica ed eliminazione finiscono nel registro di audit, senza lo script.

## Repository degli elementi {#repository-degli-elementi}

Quando lo stesso elemento è usato da molti test, **salvatelo**: il segnalibro su un elemento
rilevato lo salva in un progetto con un nome. I test che lo usano leggono il selettore dal
progetto, così quando l'applicazione cambia, correggere il selettore una volta in **Impostazioni
→ Repository degli elementi** sistema tutti i test.

Quando uno step non trova il suo elemento e l'installazione ha una chiave AI, il run può
**correggerlo**: chiede un nuovo selettore, riprova, e segna lo step come *healed* nel report. Un
elemento salvato che è stato corretto mostra nel repository il selettore vecchio e quello nuovo,
da confermare.

## Salvare

**Salva test** chiede un nome e, facoltativamente, un progetto (lo si può creare lì). Salvare di
nuovo con lo stesso nome propone di sovrascrivere. Ogni salvataggio è una nuova **versione**
nella cronologia del test (vedi
[Organizzare i test](./organizing#cronologia-e-versioni)).
