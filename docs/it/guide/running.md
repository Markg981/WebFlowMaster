# Eseguire i test

I test girano nei **piani di test**. Un piano dice quali test, in quali browser, quanti insieme,
cosa conservare di ogni run e chi avvisare.

## Creare un piano

**Piani di test → + Piano di test** apre una procedura in tre passi:

1. **Nome** e descrizione.
2. **Browser e test**. Ogni configurazione di macchina aggiunge un browser — Chrome, Edge,
   Firefox o WebKit (il motore di Safari), visibile o headless; Chrome ed Edge devono essere
   installati sul runner. **Aggiungi Suite di Test** sceglie i test del piano (ricerca per nome o
   tag). Sistema operativo e versione del browser vengono registrati ma non applicati: i test
   girano sul sistema del runner, con i browser installati lì, e il report lo dice.
3. **Impostazioni**: screenshot (sugli step falliti di default, sempre o mai), timeout, cosa fare
   quando falliscono uno step o un prerequisito, quante volte rieseguire un test fallito, e
   notifiche.

## Impostazioni del piano {#impostazioni-del-piano}

**Impostazioni** sulla riga di un piano cambia il comportamento del suo prossimo run:

| Impostazione | Cosa fa |
|---|---|
| **Browser** | Ogni test gira una volta per ogni browser elencato. Nessuno elencato: il browser delle vostre impostazioni. |
| **Esegui al massimo (test contemporanei)** | Da 1 a 16 sessioni di browser contemporanee. Con 1 il piano esegue un test alla volta, browser per browser. |
| **Conserva una registrazione del run** | Un **video** e una **trace** di Playwright di ogni test — mai, quando il test fallisce o sempre — e il traffico di **rete** come file HAR. Rispondono a ciò che uno screenshot non dice, e occupano disco a ogni run. |
| **Test visivi** | Confronta lo screenshot di ogni step con la sua baseline; vedi [Test visivi](./results#test-visivi). |
| **Esegui su** | I runner di questo server, o un pool di [agenti locali](../LOCAL_AGENT) dentro la vostra rete. |
| **Registra i fallimenti in** | Un issue tracker (Jira, Azure DevOps) collegato da un owner. Con **Apri una issue quando un test fallisce**, ogni test e browser che fallisce ottiene una issue; lo stesso fallimento in seguito viene aggiunto come commento. |
| **Invia una notifica quando** e l'URL del webhook | Un messaggio a un incoming webhook di Slack o Microsoft Teams, o a qualsiasi URL che accetti un POST, quando un run passa, fallisce, non viene eseguito o viene fermato. |

**Suite** sulla riga aggiunge [suite](./organizing#suite): girano dopo i test del piano,
nell'ordine in cui sono spuntate, e un test presente in più suite gira una volta sola.

## Eseguire subito

**Esegui** sulla riga del piano avvia un run e ne apre la pagina: l'avanzamento, lo stato di ogni
test e il log man mano che il run lo scrive. **Apri il report dettagliato** apre il report.

Un run resta in coda quando l'organizzazione sta già eseguendo tanti piani quanti ne consente il
suo limite, o quando nessun runner è online: **Impostazioni → Utilizzo dei run** dice quale dei
due.

Per fermare un run, **Annulla run** nel suo report. I test non ancora partiti vengono riportati
come saltati; un test in corso si ferma allo step successivo.

### Rieseguire i fallimenti

Con **Riesegui in Caso di Fallimento** impostato, un test fallito viene eseguito di nuovo, fino a
tre volte. Un test che passa solo a un tentativo successivo viene segnato come **instabile** nel
report, e conta comunque come passato.

## Pianificazione

**Schedulazione → Crea pianificazione** esegue un piano da solo:

- **Frequency**: una volta, ogni 5, 15 o 30 minuti, ogni 1, 6 o 12 ore, ogni giorno, ogni
  settimana, ogni mese, o un'espressione **Custom CRON** (minuto, ora, giorno del mese, mese,
  giorno della settimana).
- **Timezone**: la pianificazione gira a quell'ora locale tutto l'anno, ora legale compresa.
- **Environment** i cui segreti usa il run, e i **Browsers** in cui girare (headless: nessuno sta
  guardando).
- **Retry on Failure**: riesegue l'intero piano se fallisce, una o due volte.
- **Schedule Active**: la si spegne senza cancellarla.

Il modulo della pianificazione non è ancora tradotto: le sue voci compaiono in inglese.

La dashboard elenca i prossimi run pianificati.

## Da una pipeline

Un piano può essere avviato dal vostro sistema di CI e il suo esito può far fallire la build: con
una chiave API e la riga di comando `wfm`, oppure con il webhook del piano. Vedi
[Integrazione CI](../CI_INTEGRATION).
