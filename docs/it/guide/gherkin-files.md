# File Gherkin / Cucumber

La CLI usa lo stesso flusso di importazione ed esportazione con una chiave API ad accesso completo:

```sh
wfm tests export --project 12 --format gherkin --out specs/shop.feature
wfm tests import specs/shop.feature --project 12 --dry-run
wfm tests import specs/shop.feature --project 12
```

L'importazione riconosce il Gherkin dal contenuto e non richiede `--format`. L'esportazione usa il nome di file proposto dal server, a meno che non si indichi `--out`; in mancanza di entrambi usa `tests.feature`.

In **Test come file**, scegliere **Gherkin** per esportare i test web in un file `.feature`. I test API sono esclusi; i bundle YAML/JSON continuano a comprendere entrambi i tipi. Importare un file `.feature` oppure scegliere Gherkin prima di incollare il testo, verificare l'anteprima delle modifiche e importare. I test con un nome già esistente vengono aggiornati con una nuova versione; i nuovi test vengono assegnati al progetto scelto. L'accesso segue i ruoli dell'organizzazione e la visibilità dei progetti.

Il parser Gherkin ufficiale supporta tutti i dialetti ufficiali tramite `# language:`, `Rule`, i Background di Feature e Rule, le descrizioni, gli Examples con tag, le doc string e le DataTable con escape. Ogni riga di Examples diventa un test distinto, con il selettore della posizione nel sorgente originale. Gli argomenti strutturati e i tag ereditati restano associati ai passi.

Scegliere l'esecuzione **manuale** per conservare testo e argomenti a beneficio del verdetto di un tester, oppure **Cucumber** con un profilo autorizzato per eseguire vere definizioni JavaScript/TypeScript sull'agente dedicato dell'organizzazione. L'importazione non genera definizioni né azioni del browser. Nel World, `this.parameters` contiene le variabili dell'esecuzione. I piani eseguono una volta ogni scenario salvato o riga del dataset, indipendentemente dalla matrice di browser e lingue. Passi e hook indefiniti, ambigui, pending, saltati o falliti non contano mai come superati.

L'operatore installa Cucumber.js **12.9.0**, i file di supporto e le dipendenze, poi avvia l'agente **1.3.0** con `WFM_BDD_PROFILES` che punta al relativo manifest. Vengono annunciati solo ID pubblici dei profili, etichette, revisioni e limiti. Il proprietario dell'organizzazione associa un profilo annunciato e un pool all'organizzazione o a un singolo progetto. Percorsi degli eseguibili, comandi e loader restano configurazione dell'operatore. Il deployment e la struttura del progetto sono descritti in `deployment/bdd-agent/README.md`. I limiti di processo e il container dedicato fornito sono un isolamento operativo; Node non è una sandbox per codice di supporto ostile.

Le importazioni eseguibili portabili richiedono un binding di destinazione esplicito e autorizzato. Per l'importazione da CLI aggiungere `--bdd-mode cucumber --bdd-profile UUID_DESTINAZIONE --bdd-revision REVISIONE_SUPPORTO`; usare un binding restituito da `/api/bdd/profiles`, verificare l'anteprima con `--dry-run`, poi ripetere senza. Anche i bundle YAML/JSON conservano le definizioni BDD. Profili mancanti o revocati e revisioni non corrispondenti falliscono prima che i moduli di supporto vengano caricati. Le versioni pubblicate dei test conservano il sorgente della feature e la revisione del supporto fissata.

Gli export di WebFlowMaster includono i metadati `# wfm-test:`, che conservano le azioni originali, la configurazione BDD e gli altri campi, compresi dataset, setup e cleanup. Passi leggibili, argomenti strutturati, tag e contesto della Rule devono corrispondere ai metadati. Per importare esplicitamente un testo modificato, rimuovere prima i metadati di quello scenario. Gli export BDD selettivi contengono solo gli scenari e le righe di Examples scelti; un Outline con una sola riga preserva spazi e argomenti multilinea che altrimenti non sarebbero rappresentabili. Esportare un dialetto per file. Gli scenari fuori da una Rule precedono le Rule, perché Gherkin non ha un marcatore di fine Rule.

I file hanno un limite di **20 MiB**, **2.000** test espansi, **100.000** passi e **64 MiB** complessivi di sorgente e argomenti espansi persistiti. I limiti di esecuzione sono **300 secondi**, **8 MiB** di output e **1 MiB** complessivo di allegati. Si conservano solo gli allegati di testo semplice; quelli HTML o binari vengono omessi. I report applicano l'escape al testo e oscurano credenziali e variabili. Un test senza passi non può essere esportato in Gherkin. Controllare i valori letterali prima di fare commit dei file; i riferimenti a elementi del repository, gruppi e azioni personalizzate restano specifici dell'installazione.
