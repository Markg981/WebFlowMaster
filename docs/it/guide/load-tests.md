# Test di carico

Il [controllo delle prestazioni](./api-tests#performance) di un test API ripete una richiesta
dentro un run funzionale: al massimo 200 richieste, 10 alla volta, sempre con gli stessi valori.
Risponde a "questo endpoint è diventato più lento?". Un **test di carico** risponde a un'altra
domanda: come si comporta il sistema quando molti utenti percorrono un flusso insieme, per minuti,
con il carico che cresce?

Aprite **Test di carico** nella navigazione. Un test di carico ripete test API già salvati
nell'[API Tester](./api-tests); non viene mai eseguito dentro un piano.

## Lo scenario

Un test di carico è una sequenza di test API salvati — accesso, aggiunta al carrello, pagamento —
che ogni **utente virtuale** esegue in ordine, più volte. Un passaggio completo nella sequenza è
un'**iterazione**.

- Ciò che un test [cattura](./api-tests#catture) viene inviato dai test successivi della stessa
  iterazione, come in un piano: il token dell'accesso finisce nella richiesta del carrello.
- Un test fallisce quando la sua richiesta non si riesce a fare o una sua asserzione non è
  rispettata. Un test fallito chiude l'iterazione — i test successivi invierebbero ciò che non ha
  catturato — e l'utente comincia la successiva.
- **Pausa dopo (ms)** attende dopo un test, come farebbe una persona che legge la pagina. Fino a
  60 s.

Fino a 20 test API per scenario. Ogni test viene inviato con il proprio metodo, URL, header, body,
autenticazione, asserzioni e catture, esattamente come in un piano.

## Il profilo di carico

Il numero di utenti virtuali segue gli **stage**. Ogni stage lo porta in modo lineare da dove era
finito lo stage precedente (0 all'inizio) al suo obiettivo di **utenti virtuali**, nella sua
**durata**:

| Stage | Durata | Utenti virtuali | Cosa succede                    |
| ----- | ------ | --------------- | ------------------------------- |
| 1     | 60 s   | 50              | salita da 0 a 50                |
| 2     | 600 s  | 50              | 50 utenti mantenuti per 10 minuti |
| 3     | 60 s   | 0               | discesa a 0                     |

Fino a 10 stage, 200 utenti virtuali e 3.600 s in tutto. Un utente oltre l'obiettivo del momento
si ferma alla fine della sua iterazione, così una discesa non interrompe mai uno scenario a metà.
L'editor disegna il profilo mentre lo modificate.

**Warm-up (s)** è l'inizio del run che viene eseguito ma non valutato: lì si riempiono cache,
compilatori JIT e pool di connessioni. Le sue richieste sono contate a parte e ombreggiate nella
timeline. Il warm-up deve finire prima dell'ultimo stage.

## Dati per utente virtuale

Senza data set ogni utente virtuale invia gli stessi valori. Scegliete uno dei
[dati di test](./organizing#test-data) dell'organizzazione, e `{{data.<set>.<colonna>}}` negli
API test diventa la riga propria di ciascun utente:

- **Una riga propria per ogni utente virtuale** — l'utente 1 legge la riga 1, l'utente 2 la riga
  2, e così via. Il set deve avere almeno tante righe quanti sono gli utenti virtuali al picco,
  perché due utenti non condividano un account; salvare o avviare un test con meno righe viene
  rifiutato indicando quante ne mancano.
- **La riga successiva a ogni iterazione** — ogni iterazione, di qualsiasi utente, prende la riga
  successiva, ricominciando dall'inizio alla fine. Va bene qualunque numero di righe.

`{{load.vu}}` (1, 2, …) e `{{load.iteration}}` (1, 2, … per ciascun utente) sono sempre
disponibili, per esempio per rendere unico il riferimento di un ordine:
`ordine-{{load.vu}}-{{load.iteration}}`.

## Soglie ed esito

Ogni soglia è facoltativa e viene valutata sulle richieste inviate dopo il warm-up:

- **Mediana (p50)**, **95° percentile (p95)**, **99° percentile (p99)** e **Più lenta**, in ms;
- **Richieste fallite**, in percentuale;
- **Throughput minimo**, in richieste al secondo sul tempo valutato.

Un run è **superato** quando arriva alla fine entro tutte le soglie ed è **fallito** indicando ogni
soglia superata ("p95 412 ms > 300 ms", "throughput 38 req/s < 50 req/s"). Fallisce anche un run
che non ha valutato nessuna richiesta. **Annullato** significa che qualcuno lo ha fermato; **Non
eseguito** significa che non è mai partito — un test API o il data set sono stati eliminati, il
data set ha troppe poche righe — oppure che il server che lo eseguiva si è fermato.

## Avviare e seguire un run

Aprite le **esecuzioni** di un test di carico, scegliete un ambiente (le sue variabili e i suoi
segreti risolvono i `{{segnaposto}}` come in un piano) e **Avvia un'esecuzione**. La pagina la
segue mentre gira, ogni 2 secondi:

- avanzamento, utenti virtuali ora e al picco;
- la timeline: utenti virtuali, richieste al secondo e p95 nel tempo, con il warm-up ombreggiato;
- per ogni test API e per tutte le richieste: richieste, errori, p50, p90, p95, p99 e la più lenta;
- iterazioni completate e fallite, e i primi errori distinti.

**Ferma l'esecuzione** la conclude entro 2 secondi; le richieste già in volo terminano. Ogni test
di carico mostra le sue ultime 10 esecuzioni, con riepilogo ed esito.

### Dove gira un run

Un run di carico viene inviato **dal server WebFlowMaster**, separato da piani, runner e agenti:
non occupa uno slot dei runner, e un piano non lo rallenta. Poiché il carico parte dalla rete del
server, provate da dove il server raggiunge il sistema sotto test.

- Un run di carico alla volta per organizzazione: due si misurerebbero a vicenda.
- Al massimo due run di carico per processo server, tutte le organizzazioni insieme; un terzo
  riceve la risposta "riprovate quando uno finisce".
- Un run conta nei [minuti di esecuzione](../admin/administration#quotas) dell'organizzazione come un test API.
- Se il server si ferma durante un run, il run viene chiuso come **Non eseguito** circa un minuto
  dopo.

I percentili derivano da un campione uniforme di al massimo 10.000 durate per test, quindi oltre
quella soglia sono stime; conteggi, errori, minimo, media e massimo sono esatti. La timeline ha al
massimo 240 punti.

## Permessi

I viewer vedono i test di carico e le loro esecuzioni. Gli editor li creano, modificano, avviano,
fermano ed eliminano. Un test di carico in un progetto riservato appartiene al progetto, come i suoi
test API.
