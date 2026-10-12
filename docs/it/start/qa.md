# Il primo test in 10 minuti

Per chi scrive i test. Serve un account con ruolo **editor** (chiedete l'invito a un owner della
vostra organizzazione) e l'indirizzo di un'applicazione web da provare. Per un primo tentativo va
bene qualunque pagina pubblica.

## 1. Accedere (1 minuto)

Aprite il link d'invito, scegliete una password ed entrate. Se l'organizzazione usa il single
sign-on scegliete **Accedi con SSO** e scrivete l'indirizzo di lavoro; se richiede
l'autenticazione a due fattori, configuratela quando viene chiesto. Dettagli: [Accesso](../guide/#accesso).

## 2. Un progetto in cui tenere il test (1 minuto)

**Impostazioni → Progetti**: scrivete il nome dell'applicazione in **Nome del nuovo progetto** e
premete **Crea progetto**. Saltate il passo se il progetto esiste già, oppure createlo più tardi
dalla finestra di salvataggio (**Crea nuovo progetto**). I progetti tengono in ordine la libreria e
raccolgono gli elementi condivisi ([Progetti e ambienti](../guide/#progetti-e-ambienti)).

## 3. Costruire il test (4 minuti)

1. Aprite **Crea Test**, scrivete l'indirizzo in **URL del sito da testare** e premete **Carica
   Sito**. Compare uno screenshot della pagina.
2. Premete **Rileva Elementi**: pulsanti, campi e link della pagina vengono elencati con i loro
   selettori.
3. Trascinate **Inserimento Testo** da **Azioni Disponibili** nella **Sequenza del test**, poi
   rilasciateci sopra un campo preso da **Elementi rilevati** e scrivete il valore.
4. Aggiungete **Click Elemento** per il pulsante, poi **Verifica Testo Contenuto** con un elemento e
   il testo che vi aspettate di vedere dopo. Un test senza verifica dimostra solo che la pagina non
   si è bloccata.
5. Premete **Esegui test** e guardate ogni passo diventare verde.

Preferite registrare? **Registra azioni utente (auto-record)**, nella stessa pagina, apre una
finestra del browser e trasforma clic e digitazione in passi; serve uno schermo, quindi funziona
quando WebFlowMaster gira sulla vostra macchina. Preferite le parole? Descrivete il test a frasi
([Descrivere un test a frasi](../guide/web-tests#descrivere-un-test-a-frasi)).

## 4. Salvarlo (30 secondi)

**Salva test**, con un nome che un collega capisca ("Accesso con un account valido"), e scegliete il
progetto.

## 5. Metterlo in un piano ed eseguirlo (2 minuti)

1. **Piani di test → + Piano di test**: date un nome al piano ("Smoke"), aggiungete il test, tenete
   il browser predefinito.
2. Premete **Esegui**. Il run va in coda, un worker lo prende e lo esegue.

## 6. Leggere il report (1 minuto)

Aprite il run quando finisce, dal piano o da **Report**. Ogni test mostra i passi, uno screenshot
per ciascuno, i tempi e, per un fallimento, il passo che è fallito e perché
([Risultati](../guide/results)).

## Poi

- Eseguirlo ogni notte: **Schedulazione → Crea schedulazione** ([Pianificazione](../guide/running#pianificazione)).
- Lo stesso test su Staging e Produzione: mettete l'indirizzo in un
  [ambiente](../guide/web-tests#variabili-e-ambienti) e scrivete <code v-pre>{{baseUrl}}</code>.
- Molte righe di dati: [Dataset](../guide/web-tests#dataset).
- La vostra API, la vostra app mobile: [Test API](../guide/api-tests), [App mobili](../guide/mobile-apps).
- Affidarlo alla pipeline: [Il primo run da una pipeline](./devops).
