# Test BDD con Gherkin e Cucumber

Gherkin descrive comportamenti in modo leggibile. WebFlowMaster conserva sorgente e selezione dello
scenario nel test, con due modalità: **manuale**, in cui una persona registra gli esiti, e
**Cucumber**, che esegue un progetto di supporto preparato dall'operatore su un agente locale.
Importare un file `.feature` non implementa automaticamente i suoi step.

## Scegliere la modalità prima di importare

Usare la modalità manuale quando lo scenario descrive una procedura umana o le step definition
non sono ancora implementate. Usare Cucumber quando il team possiede definizioni eseguibili e
l'operatore può installarne le dipendenze bloccate su un agente.

Le definizioni BDD usano internamente la libreria/versioni dei test UI. L'identità comprende
sorgente, dialetto, nome logico `.feature`, riga dello scenario e, per un Outline, riga Examples
selezionata. Background, Rule, tag, DocString e DataTable sono interpretati come Gherkin, senza
ridurli a selettori browser. Mantenere coerenti sorgente e selezione durante le modifiche.

## Preparare l'esecuzione Cucumber

1. L'operatore prepara un agente autorizzato con progetto di supporto e manifest
   `WFM_BDD_PROFILES`. Installare il bundle child BDD accanto all'agente. Esempi JS/TS mantenuti
   e container isolato sono in `deployment/bdd-agent/`.
2. L'agente annuncia pool, ID profilo operatore e revisione esatta. La revisione identifica
   l'implementazione installata; cambiare il nome del file feature non installa codice.
3. Un owner apre **Settings → Agents** e crea un **profilo di esecuzione Cucumber** da un target
   annunciato. Scegliere accesso per tutta l'organizzazione oppure per progetto e timeout,
   validato tra 1 e 300 secondi. Pool e identità del profilo operatore sono immutabili negli
   aggiornamenti; creare un nuovo binding per cambiare quel target.
4. L'editor sceglie profilo autorizzato e revisione quando importa o modifica il test BDD.
   Pubblicare con il normale flusso di review/versioni se il piano usa test pubblicati.

Vedere [configurazione agente](../LOCAL_AGENT). Preparare il codice degli step cliente è compito
dell'operatore: l'import feature trasferisce il sorgente, non un eseguibile di supporto arbitrario.

## Importare, modificare e condividere

In **Libreria dei test → File**, scegliere input Gherkin e leggere l'anteprima prima di importare.
Un Outline può produrre più definizioni scenario/esempio selezionate. Verificare progetto,
modalità e binding: quello di un'altra installazione non è automaticamente autorizzato qui.
L'importer richiede un binding di destinazione per eseguire Cucumber.

Sul test salvato, **Modifica Gherkin** apre l'editor del sorgente. Modificare insieme sorgente e
riga scenario/esempio: il salvataggio rianalizza e rigenera i passi. Scegliere modalità manuale o
Cucumber. I passi BDD derivano dal sorgente: l'editor ordinario non può modificarli separatamente.
La conversione in passi manuali ordinari è un'azione distinta e deliberata; salvare prima le
modifiche al sorgente se serve convertire.

La CLI importa Gherkin con destinazione Cucumber esplicita:

```sh
npm run cli -- tests import scenarios.feature --dry-run --bdd-mode cucumber --bdd-profile UUID_DESTINAZIONE --bdd-revision REVISIONE_SUPPORTO
```

Leggere il dry-run prima di rimuovere `--dry-run`. Vedere [CLI](../reference/cli) e
[test come file](./organizing). L'export Gherkin riguarda UI/BDD, non API/mobile; esportare un
dialetto per volta. Metadati WebFlowMaster che conservano il sorgente e binding di destinazione
sono contratti diversi: i metadati non autorizzano il target dell'installazione di origine.

## Eseguire e leggere il report

Aggiungere il test al piano o alla suite normalmente. Le unità Cucumber sono indipendenti dalla
matrice browser; le righe dataset possono produrre unità separate. Il worker risolve il binding
esatto autorizzato, esegue precondizioni via agente, invoca Cucumber e tenta il cleanup successivo.
Una precondizione fallita può bloccare o saltare l'esecuzione secondo policy. Anche il cleanup
viene riportato.

Il report contiene stati step/hook, durata, errori e allegati testuali limitati. Step undefined,
pending o falliti non stabiliscono uno scenario positivo. La modalità manuale richiede invece
l'inserimento umano degli esiti. Nessuna modalità promette video/trace browser per codice di supporto
arbitrario: scegliere le evidenze effettivamente fornite da progetto e contratto della piattaforma.

I segreti sono oscurati nelle evidenze normalizzate e l'output è limitato. L'import sorgente ha
un limite di 20 MiB, oltre a budget di test, step e dati persistiti. Evidenze eccessive possono
produrre un errore con dati scartati invece di un report illimitato.

## Risolvere i problemi

| Sintomo                                                | Cosa controllare                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Nessun profilo disponibile                             | Agente connesso, manifest valido, pool e credenziali organizzazione corretti              |
| Binding rifiutato                                      | Progetto/organizzazione di destinazione autorizzati e revisione esatta ancora coincidente |
| Scenario non trovato                                   | Righe scenario/Examples coerenti con sorgente modificato e dialetto                       |
| Step undefined                                         | Progetto di supporto e dipendenze corretti installati per quella revisione                |
| Errore prima di Cucumber                               | Precondizioni, slot agente, connettività e timeout                                        |
| Profilo aggiornato ma test pubblicato vecchio fallisce | Aggiornare il binding alla revisione nuova e ripubblicare                                 |

Per i confini di implementazione leggere il [manuale della suite](../internals/suite-handbook).
Registrare profilo/revisione, ambiente agente e report effettivo nell'accettazione dell'integrazione.
