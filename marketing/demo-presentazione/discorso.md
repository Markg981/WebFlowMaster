# Discorso Demo WebFlowMaster

Data: 12 ottobre 2026. Autore: Marco Oliva. Versione viva del documento:
<https://claude.ai/code/artifact/3b138e7c-b9a5-477c-977e-bfa9242c016d>.

## Come usare questo discorso

La presentazione dura 25 minuti: 8 di slide, 12 di demo live, 5 di domande. Ogni sezione qui sotto
corrisponde a una o più slide del deck «Demo WebFlowMaster» e riporta tra parentesi quadre il numero
della slide da mostrare. Il testo è scritto per essere detto, non letto: tienilo come traccia e usa le
frasi in grassetto come punti fissi se perdi il filo.

| Blocco                    | Slide | Minuti |
| ------------------------- | ----- | ------ |
| Apertura e agenda         | 1–2   | 2      |
| Il problema               | 3     | 2      |
| Cos'è WebFlowMaster       | 4–6   | 4      |
| Demo live                 | 7–9   | 12     |
| Sotto il cofano           | 10–12 | 3      |
| Numeri, roadmap, chiusura | 13–15 | 2      |

Prima di iniziare: stack di collaudo avviato, agente locale «portatile-marco» connesso nel pool
dmo-local, DMO locale raggiungibile su https://localhost:7000, piano «DMO NCC - Collaudo automatico»
aperto in una scheda e un run già completato aperto in un'altra scheda come riserva se la demo live
fallisse. Chiudi le notifiche del sistema operativo.

## Apertura [slide 1–2]

«Buongiorno a tutti, grazie per il tempo. Nei prossimi venticinque minuti vi mostro WebFlowMaster, una
piattaforma per automatizzare i test di applicazioni web, API e app mobili **senza scrivere codice**.
Non è una slide di concetto: è un prodotto installato, documentato e collaudato, e la parte centrale di
oggi è una demo dal vivo su un'applicazione che conosciamo bene.»

«L'agenda è in quattro punti. Primo, il problema che vogliamo risolvere: come testiamo oggi e cosa ci
costa. Secondo, cos'è il prodotto, in tre slide. Terzo, la demo: registro un test, lo eseguo, leggo il
risultato. Quarto, cosa c'è sotto, i numeri e cosa vi chiedo alla fine. Le domande sono benvenute in
ogni momento, ma tengo gli ultimi cinque minuti apposta.»

**Punto fisso:** «Una piattaforma, quattro tipi di test, zero codice da scrivere per chi li costruisce.»

## Il problema [slide 3]

«Partiamo da una domanda scomoda: a ogni rilascio, su ogni browser, chi rifà i clic a mano? La risposta
onesta, quasi ovunque, è: qualcuno del team, la sera prima, su un foglio Excel di casi di test.»

«Tre cose ci costano. **Primo, il tempo**: una regressione manuale si ripete identica a ogni consegna, e
cresce con il prodotto. **Secondo, le evidenze**: quando qualcosa fallisce, abbiamo uno screenshot in
una chat, un log su una macchina, una descrizione a voce. Ricostruire cosa è successo è un lavoro a
parte. **Terzo, la proprietà**: gli script di automazione che esistono vivono sul PC di chi li ha
scritti, con il suo framework, e quando quella persona cambia progetto si fermano.»

«L'obiettivo quindi non è solo «automatizzare». È avere un posto condiviso dove i test si costruiscono,
si eseguono e si leggono, **da chiunque nel team, con le stesse evidenze**.»

**Punto fisso:** «Non un altro framework: un processo condiviso con evidenze concrete.»

## Cos'è WebFlowMaster [slide 4–6]

«WebFlowMaster è una piattaforma self-hosted per il test automatico. In una frase: **si registra un
flusso nel browser, lo si organizza in piani, lo si esegue su Chromium, Firefox e WebKit, e torna un
report con screenshot, video e trace.** Chi costruisce il test non scrive codice.»

«Copre quattro tipi di test [slide 4]. **Web**: registrazione nel browser o builder visuale con
variabili, condizioni, cicli, confronti visivi e verifiche di accessibilità. **API**: richieste HTTP con
autenticazione, asserzioni e valori estratti da concatenare. **Mobile**: app Android e iOS via Appium,
su griglie cloud come BrowserStack o su dispositivi nostri, con un inspector per scegliere i locator.
**BDD**: scenari Gherkin versionati ed eseguiti con Cucumber. Tutti e quattro entrano nello stesso piano
e nello stesso report.»

«Il ciclo di lavoro è in cinque passi [slide 5]: definisci i test, organizzali in suite e piani,
eseguili a richiesta, a orario o dalla pipeline, analizza le evidenze, condividi con issue, notifiche e
report. Ogni passo ha un ruolo: chi scrive, chi revisiona e pubblica le versioni, chi legge l'esito di
un rilascio.»

«Questa è la schermata d'ingresso [slide 6]: tasso di successo, andamento degli ultimi trenta giorni,
prossime esecuzioni pianificate e ultimi report. È la pagina che apre chi deve decidere se rilasciare.
Ora vediamolo funzionare.»

**A chi serve.** Se qualcuno chiede «per chi è?»: QA e analisti costruiscono i test; sviluppatori e
DevOps lo chiamano dalla CI e leggono i log; i responsabili di prodotto guardano copertura e andamenti;
IT e amministratori gestiscono organizzazioni, ruoli, SSO, audit e agenti locali.

## Demo live [slide 7–9]

Scenario proposto: il piano «DMO NCC - Collaudo automatico» nel progetto «DMO NCC Demo», già usato
nella demo dell'8 ottobre 2026, eseguito sull'installazione locale di DMO attraverso l'agente Windows
del pool dmo-local. Se preferisci un'applicazione diversa, i passi restano gli stessi: cambiano solo
l'URL e il test registrato.

1. **Mostra il piano [slide 7].** Apri Test plans e il piano. Di': «Questo piano contiene i casi NCC
   che prima erano righe di un foglio Excel. Ogni caso è un test registrato nel browser: niente codice,
   solo le azioni e le verifiche.» Apri un test e scorri gli step: clic, attesa, verifica. Fermati sullo
   step di controllo del popup: «Qui il test tollera un messaggio di errore intermittente dell'ambiente
   locale senza fallire: è un ciclo limitato, non un'attesa cieca.»
2. **Registra uno step nuovo (2 minuti, facoltativo).** Apri Create Test, avvia la registrazione su
   https://localhost:7000, fai due clic e una verifica, salva. Di': «Questo è tutto quello che serve per
   aggiungere un controllo: chi conosce l'applicazione lo fa da solo.» Se il tempo stringe, salta e
   passa al punto 3.
3. **Esegui.** Premi Esegui sul piano. Mentre parte: «Il run non gira sul server, che è in Docker e non
   vede DMO. Gira sull'agente locale su questo portatile, che si collega in uscita verso la
   piattaforma. È lo stesso meccanismo per un ambiente di staging dietro VPN.» Mostra il log in diretta
   e l'avanzamento per test.
4. **Leggi il risultato [slide 8].** Apri il report del run. Per un test passato: step, durata,
   screenshot. Per il test [che fallisce di proposito, se ne hai preparato uno]: «Ecco cosa torna da un
   fallimento: lo screenshot del momento, il video, la trace Playwright da riaprire passo per passo e la
   cattura di rete. Non serve chiedere a nessuno come riprodurlo.» Mostra l'export: HTML, PDF, JUnit,
   Allure.
5. **Chiudi il cerchio.** Dal fallimento, mostra il pulsante per aprire un'issue in Azure DevOps o Jira
   [se configurato nel collaudo, altrimenti solo nominalo]. Poi apri API Tester [slide 9]: «Lo stesso
   piano può contenere test API: richiesta, asserzioni sulla risposta, valori estratti da riusare nello
   step dopo. Serve per i servizi dietro l'interfaccia.»

**Se la demo live fallisce:** passa alla scheda con il run già completato e di' «vi mostro il risultato
di stamattina». Non tentare un secondo run davanti al pubblico.

**Punto fisso:** «Dal clic al report: niente script, niente macchina di qualcuno, tutto tracciato.»

## Sotto il cofano [slide 10–12]

«Tre slide tecniche, veloci, per chi deve valutare se sta in piedi.»

«**Integrazioni** [slide 10]. Non è un'isola: si avvia dalla pipeline con la CLI o con le integrazioni
pronte per GitHub Actions, GitLab CI, Jenkins, Azure Pipelines, Bitbucket e CircleCI, e il codice di
uscita dice se il rilascio passa. Da un fallimento si apre un'issue in Jira o Azure DevOps. I risultati
si pubblicano su TestRail, Xray e Zephyr Scale. Le notifiche vanno su Slack, Teams, email o webhook.
L'accesso è con SSO OpenID Connect o SAML, MFA e provisioning SCIM.»

«**Architettura** [slide 11]. Due processi e tre archivi. Il processo web serve l'interfaccia e l'API;
i worker prendono i run da una coda e pilotano browser e dispositivi; PostgreSQL contiene tutto ciò
che è durevole, Redis le code e le sessioni, un archivio su disco o S3 le evidenze. Si scala
aggiungendo worker. L'agente locale è quello che avete visto nella demo: gira dentro la rete che ospita
l'applicazione da testare e **apre solo connessioni in uscita**. Nessuna porta da aprire verso
l'interno.»

«**Sicurezza** [slide 12]. L'isolamento fra organizzazioni è imposto dal database con la row-level
security, non dalle clausole dell'applicazione. I segreti sono cifrati con AES-256-GCM e mostrati una
volta sola. Il registro di audit è append-only. Le immagini Docker girano non-root, con SBOM e
scansione Trivy a ogni release. Tutto installato nella vostra infrastruttura: i dati non escono.»

**Punto fisso:** «Il database impone la tenancy, l'agente esce e non entra, i segreti non tornano
indietro.»

## Risultati e numeri [slide 13]

«Qualche numero per dire a che punto è il prodotto, non per impressionare.»

| Cosa                                    | Valore                                             | Fonte                      |
| --------------------------------------- | -------------------------------------------------- | -------------------------- |
| Tipi di test                            | 4 (web, API, mobile, BDD)                          | README                     |
| Browser                                 | 3 (Chromium, Firefox, WebKit)                      | README                     |
| Lingue dell'interfaccia                 | 4 (IT, EN, FR, DE)                                 | README                     |
| Casi del protocollo di collaudo manuale | 586 in 25 aree, protocollo 45                      | collaudo/README.md         |
| File di test automatici                 | 248 server, 94 client, più le spec E2E Playwright  | MIGLIORIE-2026-10-10.md    |
| Documentazione                          | 42 pagine, circa 91.000 parole, speculari IT ed EN | MIGLIORIE-2026-10-10.md    |
| Storia del repository                   | 985 commit da giugno 2025                          | git log al 12 ottobre 2026 |

«La riga a cui tengo di più è il collaudo: 586 casi manuali eseguiti su un ambiente completo con HTTPS,
Keycloak per il single sign-on, simulatori di TestRail, Jira e GitHub, Jenkins e un emulatore Android.
E la demo di oggi gira sullo stesso tipo di ambiente.»

**Punto fisso:** «Non è un prototipo: è un prodotto con un protocollo di collaudo e una documentazione
completa in due lingue.»

## Roadmap [slide 14]

«Dove siamo e dove andiamo, in tre colonne.»

«**Fatto.** La versione 1 è chiusa con il collaudo dell'8 ottobre. Il supporto mobile è completo:
emulazione dei dispositivi nei piani web, app native via Appium su griglie cloud e su agenti locali,
inspector. Del piano di migliorie del 10 ottobre sono già chiuse le priorità di sicurezza e dipendenze:
zero vulnerabilità aperte in npm audit, alert CodeQL critici e alti risolti, Dependabot attivo, Prettier
e CI separate per server, client ed E2E, notifiche native Slack e Teams, command palette.»

«**In corso.** Riorganizzazione del server per dominio, un dominio per PR. Layout mobile
dell'interfaccia e test E2E a viewport mobile. Test di volume sul database.»

«**Prossimo.** Changelog e note di rilascio per i clienti, riferimento API generato dall'OpenAPI,
documentazione in francese e tedesco a fronte dell'interfaccia già tradotta. Provider AI alternativi a
Gemini. Onboarding con un progetto demo precaricato. Aggiornamento di brochure e video con le nuove
schermate.»

«Nessuna di queste voci blocca l'uso di oggi: sono ciò che separa un prodotto che funziona da uno
facile da mantenere e da far adottare.»

**Da adattare prima della presentazione:** se nel frattempo chiudi altre PR del piano, sposta le voci
da «In corso» a «Fatto» anche nella slide 14.

## Chiusura e domande [slide 15]

«Riassumo in tre frasi. Una piattaforma, quattro tipi di test, zero codice per chi li costruisce. Un
processo condiviso con evidenze concrete, invece di script sulla macchina di qualcuno. Installata da
noi, con isolamento, SSO e audit.»

«Cosa vi chiedo. **Un flusso che conta per voi**: un accesso, un ordine, un'approvazione, un contratto
API. Lo colleghiamo a un ambiente di prova con dati sintetici e a una pipeline del team, costruiamo un
piano ripetibile con i browser che servono, e tra due settimane guardiamo insieme quattro cose:
copertura, leggibilità dei risultati, costo di manutenzione dei test e requisiti operativi. Se i numeri
non convincono, lo abbiamo capito con poco.»

«Grazie. Domande.»

**Punto fisso:** «Portatemi un flusso critico: in due settimane abbiamo una prova verificabile.»

## Domande probabili e risposte pronte

| Domanda                                                                | Risposta in una frase                                                                                                                                                       | Se insistono                                                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Quanto costa mantenere i test quando cambia l'interfaccia?             | I test sono versionati con revisione e pubblicazione, gli elementi stanno in una libreria riutilizzabile e l'assistenza AI può proporre la riparazione di un locator rotto. | I test instabili finiscono in quarantena e non bloccano il rilascio: si decide a mente fredda.                                           |
| Funziona con applicazioni dietro autenticazione Windows o in intranet? | Sì, è la demo di oggi: l'agente locale gira nella rete dell'applicazione e apre solo connessioni in uscita.                                                                 | Nessuna porta da aprire e nessun browser esposto; l'agente si registra con un segreto e appartiene a un pool.                            |
| I dati escono dall'azienda?                                            | No: è self-hosted, uno stack Docker Compose oppure processi web e worker separati dietro un bilanciatore.                                                                   | Le funzioni AI sono opzionali e spente senza chiave Gemini; provider alternativi sono in roadmap.                                        |
| Perché non Playwright o Selenium puri?                                 | Playwright c'è sotto; sopra ci sono registrazione senza codice, piani, evidenze condivise, ruoli e integrazioni, che altrimenti vanno scritti e mantenuti a mano.           | Chi sa scrivere codice continua a farlo: CLI, API REST e integrazioni CI sono pubbliche.                                                 |
| Perché non Testsigma, Katalon o Tosca?                                 | Stesse funzioni di base, ma installato da noi, senza costo per utente o per esecuzione e con il codice in mano.                                                             | Limite onesto: lo sviluppa una persona; documentazione, test automatici e protocollo di collaudo servono proprio a ridurre quel rischio. |
| Quanto serve per installarlo?                                          | Un clone, quattro segreti in un file .env e un docker compose up: PostgreSQL, Redis, migrazioni, web e worker partono insieme.                                              | Lo stack rifiuta di partire con i valori di esempio in produzione; TLS davanti con Caddy o il proxy aziendale.                           |
| Come si scala?                                                         | Si aggiungono worker; un run è un record nel database, non un processo, quindi web e worker si riavviano senza perdere nulla.                                               | Limiti per organizzazione: quote su esecuzioni, artifact e minuti.                                                                       |
| E le app mobili?                                                       | Android e iOS via Appium: sulle griglie cloud non serve installare nulla; con un agente locale si usano emulatori o dispositivi propri.                                     | L'inspector mostra screenshot e albero degli elementi in diretta per scegliere i locator.                                                |
| Quanto è sicuro?                                                       | Isolamento fra organizzazioni imposto dal database, SSO e MFA, segreti cifrati con AES-256-GCM, audit append-only, immagini non-root con SBOM e scansione Trivy.            | La checklist di hardening è nella documentazione, sezione Sicurezza.                                                                     |

Se una domanda esce da questa tabella, la risposta sicura è: «Buona domanda, ne prendo nota e vi
rispondo per iscritto entro domani.» Meglio di un'improvvisazione davanti al capo.
