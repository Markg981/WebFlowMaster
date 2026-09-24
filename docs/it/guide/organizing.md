# Organizzare i test

## La libreria dei test

**Libreria dei test** elenca ogni test web salvato: i suoi tag, da dove parte e quando è stato
salvato l'ultima volta. Cercate per nome, o filtrate cliccando un tag. Da ogni riga si apre la
**Cronologia**, si cambiano i tag o si **Elimina** il test (con la sua cronologia).

I **tag** sono le etichette della vostra organizzazione — `smoke`, `checkout`, `nightly` — e si
aggiungono dalla riga del test. Sono ciò con cui le [suite dinamiche](#suite) selezionano i test.

## Cronologia e versioni {#cronologia-e-versioni}

Ogni salvataggio di un test è una **versione**, numerata da 1. La **Cronologia** le mostra dalla
più recente, con chi ha salvato ciascuna, quanti step aveva e come sono andati i run che l'hanno
usata.

**Ripristina** rimette una versione precedente salvandola di nuovo come versione più recente:
nulla in mezzo viene rimosso, così anche il lavoro di oggi resta recuperabile.

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

- **Statica**: questi test, nell'ordine in cui li scegliete.
- **Dinamica**: ogni test che ha **tutti** i tag scelti, calcolato ogni volta che si crea un run.
  Un test etichettato dopo entra nel run successivo senza modificare nulla.

Una suite mostra quali piani la includono. Eliminarne una usata dai piani fa smettere loro di
eseguirne i test; i run già fatti conservano ciò che hanno eseguito.

## Test Manager

**Test Manager** è per i team i cui casi di test stanno in Excel. **Carica l'Excel** (.xlsx o
.xls) importa un caso per riga, con id, priorità e obiettivo. Associate ogni caso a un test
salvato (**Scegli una sequenza**), selezionate i casi ed **Esegui i selezionati**; accanto a ogni
caso compaiono lo stato e l'ultimo report.
