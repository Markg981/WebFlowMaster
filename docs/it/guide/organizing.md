# Organizzare i test

## La libreria dei test

**Libreria dei test** elenca ogni test web salvato: i suoi tag, da dove parte e quando è stato
salvato l'ultima volta. Cercate per nome, o filtrate cliccando un tag. Da ogni riga si apre la
**Cronologia**, si cambiano i tag o si **Elimina** il test (con la sua cronologia).

I **tag** sono le etichette della vostra organizzazione — `smoke`, `checkout`, `nightly` — e si
aggiungono dalla riga del test. Sono ciò con cui le [suite dinamiche](#suite) selezionano i test.

## Test manuali {#test-manuali}

Non tutto vale la pena di automatizzarlo: una verifica fatta una volta a rilascio, un flusso che
richiede il giudizio di una persona, un dispositivo che nessun browser può sostituire. **Nuovo test
manuale** nella libreria ne scrive uno: un nome e i suoi step, ciascuno con l'**azione** da
eseguire e il **risultato atteso**. Compare nella libreria con l'etichetta **Manuale**, e la sua
matita ne modifica gli step. Ogni step deve avere la sua azione: quelli vuoti vengono tolti al
salvataggio, e un test manuale senza step viene rifiutato, anche se arriva dall'API.

Un test manuale è un test come gli altri: ha versioni e revisioni, porta tag, entra in suite e
piani. In un run non apre alcun browser: attende nel report del run l'esito di una persona (vedi
[Esiti manuali](./results#esiti-manuali)), una volta per run qualunque siano i browser e le lingue
del piano.

## Cronologia e versioni {#cronologia-e-versioni}

Ogni salvataggio di un test è una **versione**, numerata da 1. La **Cronologia** le mostra dalla
più recente, con chi ha salvato ciascuna, quanti step aveva e come sono andati i run che l'hanno
usata.

**Ripristina** rimette una versione precedente salvandola di nuovo come versione più recente:
nulla in mezzo viene rimosso, così anche il lavoro di oggi resta recuperabile.

## Test come file {#test-come-file}

**Libreria dei test → File** esporta i test web e API di un progetto — o tutti — in un unico file
YAML o JSON, da tenere in un repository accanto all'applicazione, rivedere nelle pull request e
importare in un'altra installazione. Il file contiene ciò che i test sono (step, precondizioni,
pulizia, dataset, richieste, asserzioni, campi di reportistica) e niente che appartenga a questa
installazione: né id, né autori, né date, così un diff mostra solo cosa è cambiato nei test. Un
segreto scritto nell'autorizzazione di un test API diventa una variabile
(<code v-pre>{{bearer_token}}</code>…): impostatela in un ambiente dove i test vengono importati.

**Importa** rilegge quel file. **Mostra cosa cambia** elenca ogni test come nuovo, aggiornato,
invariato o non importato (con il motivo); **Importa** poi salva: un test con lo stesso nome viene
aggiornato e riceve una nuova [versione](#cronologia-e-versioni), gli altri vengono creati nel progetto
scelto. Gli step che chiamano un gruppo di step o un'azione personalizzata, o nominano un elemento
condiviso, vi si riferiscono per id, quindi quei test si importano nella loro organizzazione;
l'esportazione dice quanti sono. La CLI fa lo stesso da una pipeline: `wfm tests export` e
`wfm tests import` ([CLI](../reference/cli)).

**Come test Playwright.** L'icona del file su un test web lo scarica come file Playwright Test
(`*.spec.ts`), con gli step che un run esegue — gruppi di step e azioni personalizzate espansi,
elementi condivisi risolti. Le variabili vengono da variabili d'ambiente chiamate `WFM_<NOME>`
(`WFM_BASEURL` per <code v-pre>{{baseUrl}}</code>); le precondizioni girano prima tramite il fixture
request di Playwright e la pulizia dopo, qualunque cosa sia successa; un dataset diventa un test per
riga. Gli step senza un equivalente fuori da WebFlowMaster — attesa di un'email, una query al
database, la scansione di accessibilità — sono scritti come commenti, e le prime righe del file
dicono quanti sono.

## Pubblicazione e revisioni {#pubblicazione-e-revisioni}

Un test salvato è una **copia di lavoro**. I piani eseguono la versione **pubblicata** quando ce
n'è una; se un test non è mai stato pubblicato, i piani eseguono l'ultimo salvataggio — a meno che
l'organizzazione non richieda le revisioni.

Il pannello di pubblicazione di un test dice quale versione eseguono i piani e se ci sono
modifiche più recenti:

- **Pubblica la versione N** fa eseguire ai piani quella versione dal run successivo.
- **Torna a questa**, nella cronologia, fa eseguire di nuovo ai piani una versione pubblicata in
  precedenza.

Quando un owner attiva **Richiedi una revisione per pubblicare** (in **Revisioni**), pubblicare una
versione richiede l'approvazione di un altro membro:

1. L'autore usa **Chiedi la revisione della versione N**, con una nota per chi revisiona.
2. Un altro membro apre **Revisioni**, legge la modifica e sceglie **Approva e pubblica**, oppure
   **Rifiuta** con un commento che dice cosa cambiare. Nessuno approva le proprie modifiche.
3. Finché nulla è pubblicato, i piani saltano il test. Tornare a una versione già stata in
   produzione resta possibile senza revisione.

## Suite {#suite}

Una **suite** è un elenco di test tenuto una volta sola e incluso da tutti i piani che ne hanno
bisogno. **Suite → Nuova suite** ne crea di due tipi:

- **Statica**: questi test, nell'ordine in cui li scegliete — test web, API e di
  [app mobili](./mobile-apps) allo stesso modo.
- **Dinamica**: ogni test che ha **tutti** i tag scelti, calcolato ogni volta che si crea un run.
  Un test etichettato dopo entra nel run successivo senza modificare nulla — test web, API e di
  [app mobili](./mobile-apps#tag) allo stesso modo.

Una suite mostra quali piani la includono. Eliminarne una usata dai piani fa smettere loro di
eseguirne i test; i run già fatti conservano ciò che hanno eseguito.

## Requisiti e copertura {#requisiti}

**Requisiti** risponde alla domanda che si fa prima di un rilascio: quali story sono testate, quali
falliscono e quali non hanno nessun test.

Un requisito è un'**epic**, una **user story** o un **requisito** semplice, con una chiave
(`SHOP-142`, `4711`, `REQ_12`), un titolo e l'epic a cui appartiene. Si aggiunge con **Nuovo
requisito**, oppure con **Importa dal tracker** tramite un Jira o un Azure DevOps già collegato in
**Impostazioni → Issue tracker**:

- **Epic e story del progetto** (Jira: tipi Epic e Story; Azure DevOps: Epic, Feature, User Story,
  Product Backlog Item, Requirement);
- **Queste chiavi**: `SHOP-142, SHOP-143`, o gli id dei work item;
- **Una query JQL** (Jira) o **una query WIQL** (Azure DevOps), per esempio le story di un rilascio.

Una story importata porta con sé la sua epic, e ciascuna finisce sotto il suo padre. Importare di
nuovo, o **Sincronizza importati**, aggiorna titoli, tipi e stato nel tracker; un requisito scritto
a mano con la stessa chiave diventa quello importato e conserva i suoi test. Nel tracker non viene
mai scritto nulla. Si importano al massimo 500 elementi per volta.

**Test** su un requisito collega i test web, API e di [app mobili](./mobile-apps) che lo coprono. Un'epic conta i propri test e
quelli di tutte le sue story, ciascuno una volta. La copertura si calcola dall'**ultimo risultato di
ogni test**, tutti i browser di quel run insieme:

| Copertura | Significa |
|---|---|
| **Passa** | Ogni test che lo copre è passato l'ultima volta che è stato eseguito. |
| **Fallisce** | Almeno uno è fallito (su qualsiasi browser). |
| **Non eseguito** | Nessuno è fallito, ma alcuni non sono mai stati eseguiti, sono stati saltati, o sono test manuali in attesa di esito. |
| **Nessun test** | Nulla lo copre. |

**Risultati da** restringe quali run contano: l'ultimo run di ogni test ovunque, o l'ultimo run di
un piano — per esempio quello di rilascio. **Requisiti coperti** nel report di un run apre la pagina
con esattamente i risultati di quel run. I numeri sopra la tabella danno il totale, la quota con
almeno un test e quanti sono in ogni stato. I numeri di una riga aprono i suoi test, ciascuno con
l'ultimo esito e il link al report di quel run.

**Esporta matrice (CSV)** scarica la matrice di tracciabilità di ciò che è mostrato: una riga per
requisito e test che lo copre, con ultimo esito, run e piano, e una riga per ogni requisito che
nessun test copre.

Un test collegato in un progetto che non potete vedere viene contato (*+1 in progetti che non puoi
vedere*) ma non nominato, resta fuori dallo stato e rimane collegato quando cambiate gli altri. I
viewer leggono; gli editor aggiungono, importano, collegano ed eliminano. Eliminare un requisito
toglie i suoi collegamenti, mai i test; ciò che conteneva passa al primo livello.

### Test da una story {#test-da-una-story}

Il pulsante con le scintille sulla riga di un requisito propone casi di test, quando l'operatore ha
configurato il modello AI. Legge la story com'è **adesso** nel tracker — descrizione e criteri di
accettazione (Jira: i campi chiamati *Acceptance criteria* o *Criteri di accettazione*; Azure
DevOps: *Acceptance Criteria*) — oppure, per un requisito scritto qui, la sua descrizione.
**Proponi test** chiede fino al numero scelto (6 di base, al massimo 12), scritti nella lingua
dell'interfaccia: il percorso principale, gli errori che un utente può fare e i limiti, ciascuno con
il criterio che copre, le precondizioni e i passi (un'azione e il risultato atteso).

Nulla viene creato finché non lo decidete. Ogni caso si può rinominare e correggere — passi
aggiunti, tolti, riscritti — e togliere la spunta; **Crea** trasforma quelli spuntati in **test
manuali**, collegati al requisito, con le precondizioni come primo passo. Girano nei piani come ogni
test manuale, e i loro passi sono frasi che [descrivere un test a frasi](./web-tests#descrivere-un-test-a-frasi) trasforma poi
in un test automatico. Un nome già usato fa rifiutare tutto ed è mostrato in rosso: nulla viene
creato a metà. **Proponi di nuovo** chiede casi nuovi. Solo per gli editor; il testo della story
viene inviato al modello (vedi [Funzioni AI](../security/#funzioni-ai)) e nel tracker non viene
scritto nulla.

## Test Manager

**Test Manager** è per i team i cui casi di test stanno in Excel. **Carica l'Excel** (.xlsx o
.xls) importa un caso per riga, con id, priorità e obiettivo. Associate ogni caso a un test
salvato (**Scegli una sequenza**), selezionate i casi ed **Esegui i selezionati**; accanto a ogni
caso compaiono lo stato e l'ultimo report.

## Dati di test condivisi {#test-data}

Gli stessi clienti, prodotti o carte venivano copiati da un test all'altro, e finivano per
divergere. **Dati di test** li tiene una volta per tutta l'organizzazione: un set ha un nome
(`customers`), una descrizione e una tabella. I viewer leggono i set; gli editor li creano e li
modificano.

Un set si usa in due modi:

- **Valori, in qualsiasi test.** <code v-pre>{{data.customers.email}}</code> è la colonna `email`
  della prima riga di `customers`, in uno step UI, una richiesta API o uno step mobile, nei piani
  come nel builder. I valori di un ambiente con lo stesso nome prevalgono, così un ambiente può
  sostituirne uno.
- **Righe, per un test UI.** Nel dataset del test, **Use a shared data set** fa girare il test una
  volta per riga del set, con le sue colonne come <code v-pre>{{colonna}}</code> — vedere
  [Dataset](./web-tests#dataset).

I nomi sono lettere minuscole, cifre e trattini bassi; le colonne lettere, cifre e trattini bassi,
così un segnaposto può nominarle. Un set contiene fino a 1.000 righe e 50 colonne. Un set su cui
gira un test non si può eliminare finché quel test non smette di usarlo; il rifiuto nomina i test.
Creazione, modifica ed eliminazione di un set sono registrate nel log di audit.
