# Primi passi

WebFlowMaster testa applicazioni web, protocolli API HTTP/nativi, app mobile e scenari BDD. Un test si costruisce registrandolo,
trascinando gli step o descrivendolo a frasi; i test si raggruppano in **piani**; i piani girano
su richiesta, con una pianificazione o da una pipeline di CI, in uno o più browser; e ogni run
lascia un **report** con screenshot, tempi e, quando servono, un video, una trace di Playwright e
il traffico di rete.

Di fretta? [Il primo test in 10 minuti](../start/qa) è il percorso breve; questa pagina è quello completo.

Questa guida è per chi scrive ed esegue i test. L'installazione e la gestione di
un'organizzazione sono in [Amministrazione](../admin/administration). Per i dispositivi leggere
[App mobile](./mobile-apps); per scenari manuali o Cucumber leggere [Test BDD](./bdd-tests).
Mobile e Cucumber hanno target propri, distinti dalla matrice browser.

## Accesso

Accedete con il nome utente e la password che vi ha dato un owner della vostra organizzazione,
di solito tramite un link di invito. A seconda di come è configurata l'organizzazione:

- **Autenticazione a due fattori**: dopo la password viene chiesto un codice a sei cifre
  dall'app di autenticazione. Se l'organizzazione la richiede e non l'avete ancora configurata,
  l'applicazione vi chiede di farlo prima di tutto (**Impostazioni → Sicurezza**).
- **Single sign-on**: scegliete **Accedi con SSO**, scrivete il vostro indirizzo e-mail di
  lavoro e accedete presso l'identity provider dell'azienda. Se la pagina di accesso dice che la
  vostra organizzazione accede con il single sign-on, la password lì non funziona più: usate
  quel pulsante.

Password dimenticata? Chiedete un link di reset a un owner della vostra organizzazione.

**Più di un'organizzazione?** Un owner di un'altra organizzazione può invitare lo username che già
avete; aprite il link di invito mentre siete connessi e accettate, e quell'organizzazione viene
aggiunta al vostro account. Nell'intestazione compare allora un menu delle organizzazioni, accanto
alla ricerca: sceglietene una e l'intera applicazione mostra quell'organizzazione — i suoi test,
piani, run e impostazioni, con il ruolo che vi avete — e nulla delle altre. Dove il single sign-on è
configurato su un dominio verificato, anche accedere tramite il provider di quell'organizzazione vi
fa entrare.

## Orientarsi

![La dashboard: run, andamento e pianificazioni, con la barra laterale a sinistra](/screenshots/dashboard.webp)

La barra laterale contiene tutto:

| Sezione               | A cosa serve                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Dashboard**         | Viste private e condivise di run, andamento e pianificazioni. Vedi [Conversazioni e dashboard](./collaboration). |
| **Tester API**        | Costruire e salvare test API. Vedi [Test API](./api-tests).                                                      |
| **Crea Test**         | Il costruttore dei test web. Vedi [Test web](./web-tests).                                                       |
| **Libreria dei test** | Ogni test salvato, con tag e cronologia. Vedi [Organizzare i test](./organizing).                                |
| **Test Manager**      | Importare casi di test da Excel e associarli ai test salvati.                                                    |
| **Suite**             | Elenchi di test condivisi da più piani.                                                                          |
| **Piani di test**     | Cosa eseguire, dove e come; il pulsante **Esegui**. Vedi [Eseguire i test](./running).                           |
| **Revisioni**         | Le modifiche in attesa di approvazione, se l'organizzazione revisiona i test prima che girino.                   |
| **Schedulazione**     | I piani che girano da soli.                                                                                      |
| **Report**            | Ogni run concluso, i test instabili e la quarantena. Vedi [Risultati](./results).                                |
| **Impostazioni**      | Preferenze e password e, a seconda del ruolo, ambienti, progetti, membri, chiavi e il resto.                     |

**Ctrl+K** (**⌘K** su Mac), oppure **Cerca** nella barra in alto, apre da qualsiasi pagina la palette dei
comandi: digitando parte di un nome si va a una pagina, si esegue un piano di test, si passa dal tema
chiaro a quello scuro o si esce. I piani compaiono solo a editor e owner, che possono avviare un run.

**Novità**, nel menu dell'account (il cerchio con le iniziali, in alto a destra) e nella palette dei
comandi, elenca cosa è cambiato in questa installazione, dal più recente, con il link alla pull
request di ogni modifica: è il `CHANGELOG.md` che l'installazione contiene, quindi descrive la
versione in uso. Un punto sul cerchio segnala modifiche non ancora lette; aprire la pagina lo
toglie, in questo browser.

Il **?** nella barra in alto apre questo manuale, in una nuova scheda, alla sezione sulla pagina in
cui siete (**Aiuto su questa pagina** nella palette dei comandi fa lo stesso). Il manuale è nella
vostra lingua dove è stato tradotto, in inglese altrimenti; lo serve l'installazione stessa, quindi
descrive la versione in uso e funziona anche senza accesso a internet.

Sul telefono la sidebar è nascosta: il pulsante **menu** (☰) a sinistra nella barra in alto la apre
come cassetto, che si chiude quando scegliete una pagina o premete **Esc**. Le pagine di
consultazione — la dashboard, **Report** e il report di un run — stanno nella larghezza di un
telefono o di un tablet; le tabelle larghe scorrono di lato dentro il proprio riquadro. La
costruzione di test e piani resta pensata per il computer.

Cosa potete fare dipende dal **ruolo**: i viewer leggono test e risultati; gli editor li creano
anche, li modificano e li eseguono; gli owner gestiscono anche l'organizzazione. I pulsanti che
non potete usare sono nascosti o disattivati.

## Progetti e ambienti

Due cose conviene prepararle prima del primo test, in **Impostazioni**:

- Un **progetto** raggruppa i test di un'applicazione. Tiene in ordine la libreria dei test ed è
  dove il [repository degli elementi](./web-tests#repository-degli-elementi) conserva gli
  elementi condivisi. Un owner può riservare un progetto ad alcuni membri.
- Un **ambiente** (Staging, Produzione…) contiene i valori che un test usa su quel sistema —
  l'indirizzo, i nomi utente, le password — come **segreti** cifrati. I test li richiamano come
  <code v-pre>{{nome}}</code>, così lo stesso test gira su Staging o su Produzione scegliendo
  l'ambiente. Vedi [Variabili e ambienti](./web-tests#variabili-e-ambienti).

## Partire da un progetto di esempio

La dashboard di una nuova organizzazione propone **Parti da un progetto di esempio** a editor e
owner finché l'organizzazione non ha test suoi. **Crea progetto di esempio** aggiunge il progetto
_Northwind Shop (sample)_: cinque test web e tre test API su un piccolo negozio di caffè che questa
installazione serve da sé su `/demo-shop`, e quattro piani che li eseguono. Il primo piano,
_Sample · Checkout smoke_, parte subito e si apre il report di quel run: in un minuto vedi un run
vero. Gli altri sono in **Test plans**: _Storefront regression_ esegue tutti i percorsi su
Chromium, Firefox e WebKit, _Orders API contract_ crea un ordine e lo rilegge con il numero
restituito dalla prima chiamata, e _Catalog checks (fails on purpose)_ fallisce sul controllo del
banner, per mostrare com'è un fallimento: lo step, lo screenshot, il video e la trace.

È tutto normale: modifica i test, esegui i piani, elimina progetto e test quando non servono più.
**Non ora** nasconde la proposta, in questo browser. Se la tua organizzazione revisiona i test prima
di eseguirli, il primo run non parte: pubblica i test di esempio, poi esegui i piani. Se i run non
raggiungono il negozio, un amministratore imposta `DEMO_SHOP_URL`
([Configurazione](../admin/configuration)).

## Il primo test, dall'inizio alla fine

1. **Crea Test**: inserite l'indirizzo dell'applicazione e **Carica Sito**, poi **Rileva
   Elementi**.
2. Trascinate le azioni nella **Sequenza del test** e date a ognuna il suo elemento, oppure
   registratele. Premete **Esegui test** per vederlo girare.
3. **Salva test**, in un progetto.
4. **Piani di test → + Piano di test**: date un nome al piano e aggiungetegli il test.
5. **Esegui** il piano, e aprite il report quando finisce.
6. Quando passa in modo affidabile, **Schedulazione → Crea pianificazione** per eseguirlo ogni
   notte, oppure eseguitelo dalla vostra pipeline ([Integrazione CI](../integrations/ci)).

## Impostazioni personali

**Impostazioni → Preferenze** contiene la lingua dell'interfaccia (English, Italiano, Français,
Deutsch) e il tema; **Impostazioni → Valori predefiniti** il browser e i timeout usati dal
costruttore. **Impostazioni → Sicurezza** contiene il vostro secondo fattore, e **Impostazioni →
Account** la password.
