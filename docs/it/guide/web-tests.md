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

Ogni azione attende già che il suo elemento sia pronto prima di agire, quindi un **Attendi**
fisso serve di rado; quando uno step fallisce perché qualcosa era lento, attendete proprio
quella cosa.

Cambiate l'azione o l'elemento di uno step dallo step stesso, rimuovetelo con il cestino, e
**Svuota** per ricominciare.

## Provarlo

**Esegui test** esegue la sequenza in un browser sul server e ne riproduce il risultato step per
step nell'anteprima, con uno screenshot di ogni step. Uno step fallito dice perché. Eseguire non
salva nulla.

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
- da valori catturati da un test API eseguito prima nello stesso run.

Un segnaposto che nessuno definisce non viene svuotato: lo step fallisce e indica la variabile
mancante.

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
