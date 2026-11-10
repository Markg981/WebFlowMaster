# Copione della demo live

Demo di 15 minuti delle funzionalità di WebFlowMaster, pensata per un responsabile: ogni passo
mostra un risultato concreto e dice in una frase perché conta. Si gira sull'organizzazione
**Northwind Commerce** dello stack collaudo, con dati veri: ogni test, run, log, video e trace è
reale. Solo le date dei run sono distribuite sulle ultime due settimane, per avere un trend.

Durata totale: 15 minuti (blocchi A–H). I blocchi segnati _facoltativo_ si saltano se il tempo
stringe; i tempi tra parentesi sono indicativi.

## Il giorno prima

1. Docker Desktop avviato, poi dalla radice del repository:

   ```powershell
   pwsh marketing/presentazione-direzione/prepara-demo.ps1
   ```

   Avvia lo stack collaudo, il negozio demo, crea l'organizzazione e lancia circa 40 run reali
   (15–20 minuti). Finisce con «PRONTO per la demo» o con l'elenco di cosa sistemare.

2. Prova generale completa, cronometrata, seguendo questo copione.
3. Crea una **chiave API** per il blocco F: _Impostazioni → Chiavi API_, scope `runs:write` e
   `runs:read`, possibilmente su un account di servizio. Salvala in una variabile d'ambiente del
   terminale della demo, mai sullo schermo:

   ```powershell
   $env:WFM_URL = 'https://wfm.collaudo.test'
   $env:WFM_API_KEY = '<la chiave>'
   $env:NODE_EXTRA_CA_CERTS = "$PWD\collaudo\collaudo-root.crt"
   Invoke-WebRequest "$env:WFM_URL/cli/wfm.mjs" -OutFile wfm.mjs -SkipCertificateCheck
   ```

   Annota l'ID del piano «Checkout smoke» (è nell'URL quando apri il piano).

4. Registra con OBS (o `Win+Alt+R`) un passaggio completo della demo: è il **piano B** se il giorno
   stesso qualcosa non parte. In alternativa si usano il video promozionale
   (`marketing/promo-video/`) e le schermate della brochure (`marketing/brochure/assets/it/`).

## Un'ora prima

```powershell
pwsh marketing/presentazione-direzione/prepara-demo.ps1 -SoloVerifica
```

- Interfaccia in **italiano** (_Impostazioni → Lingua_), zoom del browser al 125%, notifiche di
  Windows silenziate, schede inutili chiuse.
- Schede aperte nell'ordine della demo:
  1. `https://wfm.collaudo.test` con login fatto come **maya** (`Demo.Video.2026!`), sulla Dashboard;
  2. `http://localhost:6080` (lo schermo virtuale, dove si apre il browser della registrazione);
  3. il terminale PowerShell con le variabili del punto 3 già impostate.
- Lancia una volta il piano «Checkout smoke», così il primo run della giornata non paga
  l'avvio a freddo dei browser.

## A. Il colpo d'occhio — Dashboard (1 min)

**Fai:** parti dalla **Dashboard**. Indica il trend degli ultimi 14 giorni, la percentuale di
successo, i run recenti e il prossimo run schedulato. Premi `Ctrl+K` e scrivi «checkout»: la
palette dei comandi apre qualsiasi test o piano.

**Di':** «Questa è la prima cosa che vede chi apre la piattaforma la mattina: come sono andati i
test della notte, cosa si è rotto e quando. Nessuno deve chiedere a nessuno a che punto è la
regressione.»

## B. Creare un test senza scrivere codice — Crea Test (3 min)

**Fai:** _Crea Test_ → URL `http://shop.northwind.test/login/` → **Registra**. Passa alla scheda
`localhost:6080`: inserisci utente e password, premi Accedi, poi aggiungi una verifica sul testo
di benvenuto. Torna al builder: gli step sono comparsi da soli. Salva con il nome «Demo – login».

**Di':** «Chi conosce l'applicazione registra il flusso usandola, come farebbe a mano. Ogni clic
diventa uno step leggibile; le verifiche si aggiungono con un clic. Non serve uno sviluppatore.»

Mostra poi, su un test esistente («Sign in with valid credentials»):

- le **variabili** `{{username}}` e `{{password}}`, risolte per ambiente: lo stesso test gira in
  sviluppo, collaudo e produzione;
- la **libreria degli elementi** e i **gruppi di step** riusabili: se cambia la pagina di login si
  corregge in un punto solo.

**Piano B:** se la registrazione non parte (noVNC spento), costruisci il test dalle azioni:
_Naviga_, _Clic_, _Scrivi_, _Verifica testo_. Il messaggio resta lo stesso.

## C. Eseguire — Piani di test (2 min)

**Fai:** _Piani di test_ → «Checkout smoke». Mostra test inclusi, browser (Chromium, Firefox,
WebKit) e parallelismo. Premi **Esegui**. Mostra il log in diretta e l'avanzamento test per test.
Mentre gira apri _Schedulazioni_: «Nightly regression» parte ogni notte da solo.

**Di':** «Un piano è la regressione che prima si faceva a mano prima di ogni rilascio. Lo lanci
quando vuoi, la notte con una schedulazione, o dalla pipeline a ogni commit. Gira su tre browser
in parallelo, e quando finisce avvisa per email, Slack o Teams.»

## D. Capire un fallimento in un minuto — Report (3 min)

**Fai:** apri il report del run. Su un test passato: step, durata, screenshot. Poi apri il test
che fallisce di proposito (il banner promozionale) e mostra in ordine:

1. lo **screenshot** del momento del fallimento e il messaggio d'errore;
2. il **video** del run;
3. la **trace Playwright**, da riaprire passo per passo con DOM e rete;
4. la **cattura di rete** (HAR).

Poi **Esporta**: HTML, PDF, JUnit, Allure. Accenna a **Apri issue** (Jira o Azure DevOps) dal
fallimento, con le evidenze già allegate.

**Di':** «Questo è il punto che fa risparmiare più tempo. Un fallimento arriva con tutto quello
che serve per capirlo: nessuno deve riprodurlo a mano, nessuno deve chiedere "su che macchina?". Il
PDF è l'evidenza da allegare al rilascio o all'audit.»

## E. Test che si mantengono da soli — Report → instabili e riparazioni (1 min)

**Fai:** in _Report_ apri **Test che si contraddicono**: i test il cui esito cambia senza motivo,
con le evidenze di ogni tentativo. Mostra la **quarantena**: il test continua a girare ma non
blocca più i rilasci. Se un run ha uno step con il badge **superato dopo riparazione**, aprilo:
locator scritto, locator usato, **Approva** / **Rifiuta**.

**Di':** «Il costo nascosto dell'automazione è la manutenzione: test che falliscono a caso e
locator che si rompono a ogni restyling. Qui i test instabili vengono isolati con le prove, e le
riparazioni dei locator vengono proposte dal run ma approvate da una persona: niente passa in
silenzio.»

## F. API e CI — Tester API e terminale (2 min)

**Fai:** _Tester API_ → «Orders API: create an order». Invia: mostra la risposta, le asserzioni
(status 201, titolo dell'ordine nel corpo) e il valore estratto `orderId`, usato dal test
successivo «read it back». Accenna all'**import** da OpenAPI, Swagger e Postman. Il test chiama un
servizio di echo pubblico (jsonplaceholder): serve la connessione a internet; senza, mostra un run
già finito dello storico.

Poi nel terminale:

```powershell
node wfm.mjs run <ID del piano Checkout smoke> --wait --junit junit.xml
echo $LASTEXITCODE
```

**Di':** «Le stesse verifiche valgono per le API, che si importano dalle specifiche invece di
riscriverle. E la pipeline lancia tutto con un comando: zero vuol dire verde, uno rosso. Ci sono
integrazioni pronte per Azure Pipelines, GitHub, GitLab, Jenkins, Bitbucket e CircleCI.»

## G. Il resto della piattaforma — una schermata per voce (2 min)

Una frase ciascuna, aprendo la pagina:

- **App mobili** — Android e iOS con Appium su BrowserStack, LambdaTest o dispositivi propri, con
  l'inspector live per scegliere i locator. _(Se non c'è l'emulatore acceso, mostra la schermata
  `marketing/brochure/assets/it/mobile.jpg`.)_
- **Test di carico** — utenti virtuali, rampa e soglie, nei report accanto ai funzionali.
- **Requisiti** e **Test Manager** — epiche e storie con copertura calcolata; risultati pubblicati su
  TestRail, Xray e Zephyr; l'**hub dei test case QA** importa i casi del team da un repository git.
- **Impostazioni** — organizzazioni isolate dal database, ruoli, SSO (OIDC/SAML), SCIM, audit log,
  consenso esplicito prima di attivare l'AI.
- **Novità** (`/whats-new`) — ogni modifica dell'installazione con la sua pull request.

## H. Facoltativo — Il nostro caso: DMO (3 min)

Il blocco che rende la demo concreta per AVEVA: i casi NCC che erano righe di un foglio Excel,
eseguiti come test automatici sull'installazione locale di DMO.

**Prerequisiti:** progetto «DMO NCC Demo» e piano «DMO NCC - Collaudo automatico» nello stack
collaudo, DMO locale su `https://localhost:7000`, agente Windows del pool `dmo-local` avviato su
questo portatile. Prova il piano il giorno prima: DMO locale mostra a volte il popup
_No keyed service for type 'NAF.IStaticDataService'_; i test lo tollerano con un ciclo limitato.

**Fai:** apri il piano, mostra un test e premi **Esegui**.

**Di':** «Il server è in Docker e non vede DMO. Il run gira sull'agente su questo portatile, che
si collega in uscita alla piattaforma: è lo stesso meccanismo per un ambiente di collaudo dietro
VPN o in una rete del cliente.»

## Se qualcosa va storto

| Problema                               | Cosa fare                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| La pagina non si apre                  | `prepara-demo.ps1 -SoloVerifica`; se lo stack è giù, passa al video del piano B   |
| La registrazione non parte             | Costruisci il test dalle azioni (piano B del blocco B)                            |
| Il run resta in coda                   | Mostra un run già finito dello storico: il report è identico                      |
| Il comando `wfm` restituisce 2         | Credenziali o rete: mostra l'output e passa oltre, il codice d'uscita è il punto  |
| L'agente DMO non si collega            | Salta il blocco H e mostra il video della demo dell'8 ottobre                     |

Regola generale: non fare debug davanti al capo. Si dice «lo vediamo dopo», si passa al blocco
successivo o alla registrazione.

## Ripartire da zero

Per rifare l'organizzazione: come maya `DELETE /api/organization` con
`{"confirmName":"Northwind Commerce"}`, poi di nuovo `prepara-demo.ps1`. Il test «Demo – login»
creato durante la demo si può eliminare da _Test_.
