# Registro delle decisioni

Le scelte che hanno dato forma a WebFlowMaster, ognuna con il problema che risolveva, cosa si è deciso e
cosa costa. Sono le ragioni dietro il codice; leggile prima di cambiare una di queste aree.

## 1. L'isolamento dei tenant è imposto dalla row-level security di PostgreSQL

**Contesto.** Le organizzazioni condividono le tabelle. Filtrare per `organization_id` in ogni query è
una regola che basta un handler dimenticato a rompere.

**Decisione.** Ogni tabella per organizzazione ha la RLS attivata e forzata, con una policy su
`app.current_org`. Ogni query di un tenant gira in una transazione che passa al ruolo senza bypass
`app_user` e imposta l'organizzazione (`withTenantTransaction`). Il server non parte se queste condizioni
non valgono.

**Conseguenze.** Un filtro mancante non può far uscire dati; restituisce nulla. Ogni nuova tabella
richiede policy e permessi nella sua migrazione, verificati da un test di isolamento. Le query devono
girare in un contesto di tenant, anche il lavoro in background.

## 2. L'handle privilegiato è contingentato, non vietato

**Contesto.** Alcuni lavori non possono girare dentro un'organizzazione: registrazione, login, verifica
dei token, tabelle dell'installazione, cancellazione.

**Decisione.** Usano `privilegedDb`, e un test di architettura elenca ogni file autorizzato e quante
istruzioni, ciascuno con un motivo scritto.

**Conseguenze.** Aggirare la RLS è sempre una decisione visibile e rivista.

## 3. Lo stato di un run si muove solo con update condizionali

**Contesto.** Le consegne duplicate dei job eseguivano i piani due volte; le scritture tardive
riaprivano run conclusi.

**Decisione.** `server/execution-state.ts` possiede ogni transizione, ciascuna un
`UPDATE … WHERE status IN (predecessori ammessi)`; gli stati finali non hanno successori.

**Conseguenze.** Le race hanno esattamente un vincitore, deciso dal database. Il codice deve trattare
una transizione `null` come "qualcun altro l'ha già spostato".

## 4. Un run è deciso quando viene richiesto

**Contesto.** Un piano modificato mentre il suo run aspettava girava con impostazioni che nessuno aveva
scelto per quel run.

**Decisione.** L'orchestrator scrive uno snapshot versionato di ogni impostazione che il runner legge,
con le suite espanse in test. Un test impone che ogni colonna del piano sia catturata o dichiarata
irrilevante.

**Conseguenze.** I report descrivono esattamente ciò che è girato. Aggiungere un'impostazione di piano
letta dal runner significa aggiungerla allo snapshot.

## 5. Un job per run, idempotente a entrambe le estremità

**Decisione.** Chi chiama può inviare una chiave di idempotenza (univoca per organizzazione);
l'orchestrator invia esattamente un job BullMQ con id uguale a quello del run; il worker prende un run
solo da `queued`.

**Conseguenze.** Chiamate HTTP ripetute, scheduler gemelli e consegne duplicate producono tutti un solo
run.

## 6. I worker morti si riconoscono dall'heartbeat, e i loro run non vengono rieseguiti di nascosto

**Decisione.** I worker battono ogni 15 s mentre eseguono; uno sweep chiude i run silenziosi come
`error` (`worker_lost`), e quelli oltre la durata massima come `timed_out`.

**Conseguenze.** Niente resta appeso per sempre. Un run perso viene segnalato, non ripetuto, perché metà
run potrebbe aver già creato dati nell'applicazione sotto test; un run schedulato con tentativi rimasti
riprova.

## 7. Il processo web non esegue browser

**Contesto.** Anteprime e rilevazioni di pagina nel processo web rallentavano ogni pagina per tutti.

**Decisione.** Run dei piani e task browser vanno ai worker, su code separate, così un'anteprima non
aspetta mai dietro un run notturno. Fa eccezione la registrazione, perché la sua finestra deve aprirsi su
una macchina con un display.

**Conseguenze.** I worker scalano in modo indipendente; un'installazione su una sola macchina può
scegliere `BROWSER_TASKS=inline`.

## 8. Migrazioni SQL scritte a mano

**Decisione.** Le migrazioni sono file SQL scritti a mano, con un journal, applicati da `db:migrate` (e
dal servizio `migrate` prima che parta l'applicazione). `db:push` non si usa.

**Conseguenze.** Policy RLS, ruoli, permessi, vincoli e correzioni dei dati stanno accanto alle tabelle
che riguardano, e ogni database arriva allo stesso stato.

## 9. I token ad alta entropia si salvano come hash; i segreti che dobbiamo usare si cifrano

**Decisione.** Chiavi API, token di webhook e token degli agenti sono valori casuali di 32 byte salvati
come SHA-256 e mostrati una volta. Le credenziali che il prodotto deve presentare ad altri sistemi
(segreti degli ambienti, token di tracker e source host, stati di login) sono cifrate con AES-256-GCM e
mai restituite dall'API.

**Conseguenze.** Una chiave persa si sostituisce, non si recupera. `ENCRYPTION_KEY` va custodita e
tenuta stabile; perderla significa perdere quei segreti.

## 10. Gli effetti collaterali non decidono mai un verdetto

**Decisione.** Notifiche, apertura di issue, stati dei commit e upload di artefatti restituiscono esiti e
registrano gli errori; girano dopo che il verdetto è registrato.

**Conseguenze.** Un disservizio di Jira costa una issue, non un run. L'esito è visibile dove serve (per
esempio l'ultimo errore di invio su un collegamento GitHub).

## 11. Un'API pubblica piccola e stabile

**Decisione.** `/api/v1` è l'unica API promessa alle pipeline: forme esplicite, errori uniformi, chiavi
con scope, e un documento OpenAPI scritto a mano tenuto allineato al router da un test. Il resto di
`/api` serve il client web e può cambiare con esso.

**Conseguenze.** Le pipeline non si rompono quando cambia una pagina; aggiungere a `/api/v1` è un atto
voluto.

## 12. Il server distribuisce la propria CLI e il proprio agente

**Decisione.** `/cli/wfm.mjs` e `/cli/wfm-agent.mjs` sono bundle costruiti dai sorgenti del server
stesso, invece di pacchetti npm.

**Conseguenze.** Una pipeline o un agente usa sempre la versione che corrisponde al server con cui parla.

## 13. Gli agenti locali prestano browser; non eseguono test

**Contesto.** Le applicazioni dietro il firewall di un cliente non sono raggiungibili dai runner.

**Decisione.** Un agente avvia browser con `launchServer` di Playwright e li presta tramite connessioni
in uscita attraverso un relay; il runner vi si connette come ai propri. Le richieste API di quei run
passano dall'API request del browser in prestito.

**Conseguenze.** Un solo runner, le stesse funzionalità ovunque; l'agente è piccolo e non richiede porte
in ingresso. Agente e server devono avere la stessa major.minor di Playwright.

## 14. Più server web condividono una directory del relay invece del routing sticky

**Decisione.** Le istanze del relay pubblicano i propri agenti su Redis; una richiesta che arriva
all'istanza sbagliata viene inoltrata, e gli id di sessione indicano l'istanza che li tiene.

**Conseguenze.** Funziona con qualsiasi load balancer; le istanze devono raggiungersi fra loro su
`AGENT_RELAY_ADVERTISE_URL`.

## 15. Evidenze dietro un archivio di artefatti, risultati conservati per sempre

**Decisione.** Screenshot, video, trace, file HAR e baseline passano da un'unica interfaccia con
un'implementazione locale e una S3. La conservazione rimuove i file dopo `ARTIFACT_RETENTION_DAYS` ma
mantiene risultati, step e verdetti; le baseline non vengono mai rimosse.

**Conseguenze.** Funzionano più worker su più macchine; storico e analisi sopravvivono alla
conservazione.

## 16. La quarantena cambia il significato di un fallimento, non se il test gira

**Decisione.** Un test in quarantena gira comunque e il suo risultato viene registrato, ma il suo
fallimento non fa fallire il run, non lo ferma, non apre issue e non fa diventare rossa una pipeline.

**Conseguenze.** I test instabili smettono di insegnare a ignorare le build rosse, mentre le prove che
sono stati sistemati continuano ad accumularsi.

## 17. L'AI sceglie, non inventa

**Decisione.** Descrivere un test a frasi può produrre solo azioni dall'elenco chiuso implementato dal
runner ed elementi che esistono (repository o pagina); ogni riga viene mostrata prima dell'inserimento.
La correzione automatica propone un selettore che deve funzionare al nuovo tentativo prima di essere
salvato. Entrambe sono opzionali e disattivate senza una chiave AI.

**Conseguenze.** Una frase interpretata male è visibile prima di diventare un test; il prodotto funziona
pienamente anche senza un modello.

## 18. L'espansione avviene al momento giusto

**Decisione.** Le suite si espandono in test quando si crea un run (così il run è fissato); gruppi di
step ed elementi del repository si risolvono quando un test gira (così una correzione raggiunge ogni
test).

**Conseguenze.** Modificare una suite non cambia i run già in coda; modificare un gruppo o un elemento
cambia il prossimo run di ogni test che lo usa.

## 19. La storia non si può riscrivere

**Decisione.** `test_versions`, `test_publications` e `audit_log` non hanno permessi `DELETE` (né
`UPDATE`) per `app_user`. Ripristinare un test scrive una nuova versione.

**Conseguenze.** "Cosa è cambiato, e chi l'ha cambiato?" ha sempre una risposta.

## 20. Gli stati dei commit seguono la macchina a stati

**Decisione.** La macchina a stati annuncia ogni passaggio registrato ai listener registrati dai
processi web e worker; il modulo dello stato dei commit imposta pending, poi il verdetto, uno stato dopo
l'altro per ogni run.

**Conseguenze.** Ogni percorso che sposta un run (annullamento, timeout, recupero) viene riportato senza
collegarlo uno per uno; i test spostano i run senza inviare nulla, a meno che non si registrino.
