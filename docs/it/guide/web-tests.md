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
| **Premi tasto** | Preme un tasto o una combinazione — `Enter`, `Tab`, `Escape`, `Control+A` — sull'elemento, o su quello che ha il focus se lo step non ne ha. |
| **Doppio click** / **Click destro** | Fa doppio click, o apre il menu contestuale dell'elemento. |
| **Trascina e rilascia** | Trascina l'elemento su quello il cui selettore è il valore. |
| **Carica file** | Passa a un campo file — o al pulsante che apre la scelta del file — un file creato dal valore: `fattura.csv`, oppure `fattura.csv\|contenuto`. |
| **Rispondi al dialog** | Dice come rispondere al prossimo `alert`, `confirm` o `prompt`: `accept`, `dismiss` o `accept:testo`. Va messo **prima** dello step che apre il dialog. Un dialog senza risposta viene chiuso. |
| **Cambia scheda** | Continua in un'altra scheda: vuoto per la più recente, un numero (da 1), o un testo nel suo indirizzo o titolo. |
| **Chiudi scheda** | Chiude la scheda corrente e torna a quella che l'ha aperta. |
| **Salva testo in variabile** | Legge il testo dell'elemento, o il valore di un campo, nella variabile indicata dal valore, per gli step successivi. |
| **Imposta variabile** | `nome=valore`, per gli step successivi. Vedi [valori generati](#valori-generati). |
| **Imposta cookie** / **Cancella cookie** | `nome=valore` per l'indirizzo corrente; oppure li elimina tutti. |
| **Imposta localStorage** | `chiave=valore` nello storage della pagina corrente. |
| **Esegui JavaScript** | Esegue il valore nella pagina. Fallisce se lancia un errore o restituisce `false`, così può verificare ciò che nessun altro step sa esprimere. |
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
<code v-pre>{{secret_…}}</code>, che definite come segreti di un ambiente.

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
(righe segnate **AI**).

## Variabili e ambienti {#variabili-e-ambienti}

Qualsiasi valore di uno step può contenere segnaposto <code v-pre>{{nome}}</code>, riempiti
quando il test gira:

- dall'**ambiente** scelto nel costruttore, nel run del piano o nella pianificazione: i suoi
  segreti (**Impostazioni → Ambienti**), per esempio <code v-pre>{{ADMIN_PASSWORD}}</code>. Un
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

Ogni segnaposto è un valore nuovo. Per usarne uno due volte — registrarsi con un indirizzo e poi
accedere con lo stesso — dategli prima un nome: **Imposta variabile**
<code v-pre>email={{$randomEmail}}</code>, poi <code v-pre>{{email}}</code>. Un generatore scritto
male fa fallire lo step come una variabile mancante.

I valori dei segreti sono cifrati, non vengono più mostrati dopo il salvataggio, e sono mascherati
nei log.

### Partire con l'accesso già fatto

Per saltare il login in ogni test: scegliete l'ambiente nel costruttore, avviate una
registrazione, accedete nella finestra di registrazione e premete **Save login for this
environment**. I run su quell'ambiente partono allora con quella sessione; l'ambiente compare
come *con accesso salvato* nel selettore. Salvatelo di nuovo quando la sessione scade.

## Precondizioni

Le **precondizioni** sono chiamate API eseguite prima degli step, per portare l'applicazione nello
stato che il test richiede — creare un cliente, svuotare un carrello. Si scelgono fra i vostri
[test API](./api-tests) salvati e girano nell'ordine dell'elenco. Un test la cui precondizione
fallisce viene riportato come bloccato, non come fallito.

## Dataset

Per eseguire lo stesso test su più input, dategli un **dataset**: una tabella i cui nomi di
colonna diventano variabili. Il test gira una volta per riga. Costruitelo aggiungendo colonne e
righe, oppure incollatelo da un foglio di calcolo (**Paste from a spreadsheet**): copiate il
blocco da Excel o Google Sheets, riga di intestazione compresa.

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
  <code v-pre>{{variabili}}</code> e valori generati.
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
