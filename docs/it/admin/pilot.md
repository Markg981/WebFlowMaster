# Pilot e decisione di adozione

Una release qualificata ([Release riproducibili](./releases.md)) dimostra che la build si installa, si
aggiorna e dà un solo verdetto per run. Non dimostra che un team possa adottare WebFlowMaster. Il pilot
risponde a questa domanda con le misure di un team reale. La decisione di adozione viene registrata a
parte, distinta dall'approvazione tecnica della build.

## Prima del pilot

Con il responsabile di prodotto si scelgono:

- **un team o cliente**, con il numero di utenti che ha davvero. Non vanno presunti team o utenti non
  confermati;
- **i flussi rappresentativi** (da uno a tre): quelli che il team esegue a ogni rilascio, ciascuno con il
  motivo per cui è rappresentativo (form, dataset, shadow DOM, file, CI);
- **un operatore che non ha scritto il prodotto**, che esegue tutti i compiti. Chi ha scritto WFM osserva
  soltanto e compila il registro;
- **la finestra di osservazione**: due settimane, salvo accordi diversi;
- **la baseline**: gli stessi flussi misurati con lo strumento attuale del team. Valgono solo le cifre del
  team, misurate su quei flussi e datate. Percentuali dei vendor o cifre di altri progetti non sono
  accettate.

Tutto questo va scritto nel file del pilot.
[scripts/fixtures/pilot/pilot.json](https://github.com/Markg981/WebFlowMaster/blob/main/scripts/fixtures/pilot/pilot.json)
è il modello da cui partire.

Durante il pilot non si aggiunge nuovo perimetro funzionale. Fanno eccezione solo le correzioni degli
incidenti emersi dal pilot.

## Cosa fa l'operatore

| Compito       | Inizio e fine nel registro             | Cosa misura                             |
| ------------- | -------------------------------------- | --------------------------------------- |
| `install`     | `install_start`, `install_end`         | installazione dalla guida pubblicata    |
| `first_test`  | `first_test_start`, `first_test_end`   | registrazione del primo test            |
| `parametrize` | `parametrize_start`, `parametrize_end` | variabili, dataset, ambiente            |
| `ci_run`      | `ci_run_start`, `ci_run_end`           | il piano avviato dalla CI del team      |
| `diagnosis`   | `diagnosis_start`, `diagnosis_end`     | trovare la causa di un fallimento reale |

L'osservatore registra anche `first_green` (la prima run passata del flusso), `recorder_correction` (ogni
step corretto a mano dopo la registrazione, con `count`), `locator_fix` (ogni locator riparato o proposta di
healing approvata) e `note`.
[observations.json](https://github.com/Markg981/WebFlowMaster/blob/main/scripts/fixtures/pilot/observations.json)
è il modello da cui partire.

## Misure e confronto

Dal registro il report ricava il tempo al primo verde, le correzioni del recorder, il tempo di diagnosi e
la manutenzione dei locator. Dalle run dei piani del pilot nella finestra ricava i retry (tentativi in più
di ogni unità e della run) e i minuti di esecuzione. Ogni misura viene confrontata con la baseline dello
stesso flusso (migliore, peggiore, uguale). Una misura che nessuno ha osservato risulta mancante e vale
come sconosciuta, mai come zero. Correzioni e manutenzione dei locator sono conteggi di eventi: se non ne viene registrato nessuno, valgono zero.

## Gli incidenti riaprono un ID

Ciascuno dei casi seguenti, anche se capita una volta sola, va nel registro come `incident`, con l'ID
dell'audit che riapre e una descrizione di cosa è successo:

| `incident`      | Quando                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------- |
| `false_green`   | una run risulta passata con uno step, un risultato o un controllo fallito o assente      |
| `lost_evidence` | un risultato, uno screenshot, un video, una trace o un log promesso non è raggiungibile  |
| `authorization` | qualcuno ha letto o modificato ciò che il suo ruolo o lo scope della chiave non consente |
| `blocker`       | l'operatore non è riuscito a proseguire senza l'aiuto di chi ha scritto WFM              |

Per esempio, una falsa verde riapre C02, un'evidenza persa riapre C07 o C02 e un incidente di
autorizzazione riapre C03. Un incidente non è rumore statistico. Resta `reopened`, e tiene chiuso il gate,
finché `closedBy` non indica la modifica che lo corregge, insieme al caso negativo del lotto.

## Report e gate

```bash
# Run lette dall'installazione del pilot via /api/v1 (chiave con runs:read, solo nell'ambiente)
WFM_PILOT_URL=https://wfm.example WFM_PILOT_API_KEY=... \
  npm run pilot -- report --pilot pilot.json --log observations.json
# Oppure da un export degli stessi record
npm run pilot -- report --pilot pilot.json --log observations.json --runs runs.json
```

Il report viene scritto in `.local/pilot/<id>/report.md` e `report.json`. Il codice di uscita `0` indica
`ready_for_decision`. Il codice `1` indica `incomplete` (manca un compito, il primo verde, una run o un
confronto) oppure `blocked` (un incidente è ancora aperto). Il codice `2` indica che il file del pilot o il
registro non sono utilizzabili. Nessuno dei due file viene accettato se l'operatore ha scritto il prodotto
o se una baseline non è `measured`.

## Decisione di adozione

Il responsabile decide su un report `ready_for_decision`. La decisione indica:

- `decision`: `adopt`, `adopt_limited` (con `limits`), `extend_pilot` oppure `reject`;
- `target`: il target commerciale sostenuto dai dati, e `matrix.supported`, cioè browser, superfici e
  installazioni da supportare;
- `evidence`: le misure e le voci del registro su cui si basa;
- `support`: chi supporta il team, per quante ore a settimana e attraverso quale canale;
- `buildApproval`: la release qualificata in P18. Viene citata, ma non costituisce la decisione;
- `featureFreezeUntilGate: true`.

```bash
npm run pilot -- decide --report .local/pilot/<id>/report.json --decision decision.json
```

Una decisione presa su un report non pronto, oppure priva di capacità di supporto o di evidenze, viene
rifiutata (codice di uscita `1`).
[decision.json](https://github.com/Markg981/WebFlowMaster/blob/main/scripts/fixtures/pilot/decision.json)
è il modello da cui partire. I valori che contiene sono esempi, non risultati di un pilot.
