# Panoramica sulla sicurezza

Come WebFlowMaster protegge i dati delle organizzazioni che lo usano: cosa fa il prodotto da
solo, cosa lascia a chi gestisce l'installazione, e quali sono oggi i suoi limiti. Scritta per
chi valuta la sicurezza del prodotto e per gli operatori che rispondono alle sue domande.

Il dettaglio tecnico di ogni sezione è in [Tenancy e accessi](../internals/tenancy); le
impostazioni citate sono nel [riferimento della configurazione](../admin/configuration).

## Responsabilità condivisa

| Ambito | Il prodotto | Chi gestisce l'installazione | Gli owner dell'organizzazione |
|---|---|---|---|
| Isolamento tra organizzazioni | Imposto dal database su ogni query | Esegue PostgreSQL con i ruoli richiesti | — |
| Account e accessi | Ruoli, secondo fattore, scope delle chiavi API, registrazione su invito, registro di audit | Esposizione in rete, l'impostazione `REGISTRATION` | Membri, ruoli, obbligo del secondo fattore, igiene delle chiavi |
| Segreti salvati per i test | Cifrati con AES-256-GCM, mai restituiti | Custodisce `ENCRYPTION_KEY` e ne fa il backup | Decidono quali segreti salvare |
| Dati in transito | Cookie sicuri, controlli sull'origine | TLS davanti al processo web e tra i servizi | — |
| Dati a riposo | Cifratura applicativa dei segreti | Cifratura di dischi, database, backup e bucket | — |
| Dove possono collegarsi i test | Nulla è bloccato: raggiungere l'applicazione è il compito | Regole di rete per i worker | Cosa chiamano i loro test |
| Aggiornamenti | Release con migrazioni | Applicarle, aggiornare gli host | — |

## Isolamento tra organizzazioni

Le organizzazioni condividono un database. L'isolamento non dipende dal fatto che ogni query
ricordi un filtro: la **row-level security** di PostgreSQL è attivata e forzata su ogni tabella
che appartiene a un'organizzazione, e ogni richiesta esegue le sue query con un ruolo del
database che non può aggirarla, legato all'organizzazione di chi chiede. Una query senza filtro
non restituisce nulla di un'altra organizzazione; non restituisce tutto.

- Il processo web si rifiuta di partire se i ruoli del database renderebbero tutto questo
  inefficace.
- Le poche operazioni che devono attraversare le organizzazioni (accesso, verifica dei token,
  tabelle dell'installazione, cancellazione) usano una connessione separata e privilegiata. Un
  test automatico elenca ogni file autorizzato a usarla, con il motivo, così ogni nuovo uso è
  una decisione rivista.
- I test di isolamento girano nella suite a ogni modifica.
- Dentro un'organizzazione, i **progetti riservati** restringono chi vede i test di un
  progetto, anche questo imposto dal database.
- I log in tempo reale via WebSocket verificano allo stesso modo la sessione e che il run
  appartenga all'organizzazione di chi guarda.

## Identità e accessi

Le **persone** accedono con username e password. Gli account si creano su **invito** per
default: un owner invita da **Impostazioni → Membri**, e la registrazione senza invito viene
rifiutata, tranne per il primo account dell'installazione. `REGISTRATION=open` consente la
registrazione pubblica, in cui ogni nuovo account ottiene una propria organizzazione.

- Le password sono salvate come hash scrypt con un sale casuale per utente; l'hash non esce
  mai dal database in una risposta dell'API. Le password devono avere da 8 a 128 caratteri.
- Gli endpoint di accesso, registrazione e secondo fattore sono limitati a 20 tentativi per
  indirizzo client ogni 15 minuti. Gli accessi falliti per account esistenti finiscono nel
  registro di audit.
- **Autenticazione a due fattori**: codici TOTP da un'app di autenticazione (RFC 6238), ognuno
  accettato una volta sola, più codici di recupero monouso salvati come hash. Dopo la password
  la sessione non è autenticata finché non si inserisce il codice: cinque codici errati o
  cinque minuti chiudono il tentativo. Gli owner possono rendere obbligatorio il secondo fattore
  per tutta l'organizzazione, e l'obbligo vale anche per le sessioni già aperte.
- Le **sessioni** sono lato server (Redis) e durano 7 giorni. Il cookie è `HttpOnly`,
  `SameSite=Lax` e `Secure` in produzione. L'accesso genera un nuovo id di sessione.
- **Cambiare la password** richiede quella attuale e una sessione, non una chiave API. Una
  password dimenticata si recupera con un link monouso emesso da un owner (o, per l'unico owner di
  un'organizzazione, dall'operatore), valido un giorno e salvato solo come hash. Una sessione
  porta un'impronta della password con cui è stata aperta, quindi una nuova password chiude tutte
  le altre sessioni di quella persona.
- **Single sign-on** con OpenID Connect, per organizzazione
  ([Amministrazione](../admin/administration#single-sign-on)): flusso authorization code con
  PKCE, state e nonce monouso, e firma, issuer, audience e scadenza dell'ID token verificati con
  le chiavi pubblicate dal provider. Gli account si riconoscono dal subject stabile del provider,
  non dall'indirizzo e-mail; quelli nuovi hanno viewer o editor, mai owner. Il client secret è
  cifrato come gli altri segreti salvati. Un owner può **renderlo obbligatorio**: le password dei
  membri smettono di funzionare, anche nelle sessioni aperte, mentre gli owner mantengono la
  propria per poter rientrare.
- **Ruoli**: viewer, editor, owner, verificati su ogni endpoint. Vedi
  [Amministrazione](../admin/administration#ruoli).

Le **macchine** non usano mai la password di una persona:

| Credenziale | Salvata come | Ambito | Durata |
|---|---|---|---|
| Chiave API | Hash SHA-256, mostrata una volta | Il ruolo del suo account; facoltativamente ristretta a scope su `/api/v1` | Fino a revoca o scadenza |
| Account di servizio | Un account che non può accedere | Viewer o editor | Fino alla disattivazione, che revoca le sue chiavi |
| Token di webhook | Hash SHA-256, mostrato una volta | Avvia un piano | Fino alla cancellazione |
| Token di un agente locale | Hash SHA-256, mostrato una volta | Un agente di un'organizzazione | Fino a revoca |
| Ticket del relay | Non salvato; firmato con HMAC | Un'organizzazione, un pool e un browser | 60 secondi |

I token sono 32 byte casuali; per valori che non si possono indovinare basta un singolo hash, e
la ricerca resta esatta.

## Protezione dei segreti salvati

Ciò che il prodotto deve presentare ad altri sistemi per conto di un cliente viene **cifrato**
con AES-256-GCM, ogni valore con il proprio IV e tag di autenticazione, usando la
`ENCRYPTION_KEY` dell'installazione:

- i segreti degli ambienti usati dai test (password, token, indirizzi dei sistemi sotto test);
- i token di issue tracker, GitHub e GitLab;
- gli stati di login salvati (i cookie dell'applicazione sotto test);
- i segreti del secondo fattore.

Nessuno di questi viene mai restituito dall'API: i moduli che li modificano trattano un campo
vuoto come "lascia invariato". I test salvano segnaposto <code v-pre>{{secret_…}}</code>, anche
per le password digitate durante la registrazione, e il valore viene risolto solo quando uno
step ne ha bisogno.

## Protezione dell'applicazione

- **CSRF**: le richieste che modificano dati devono venire dall'origine dell'applicazione (o da
  una elencata in `CSRF_TRUSTED_ORIGINS`); le richieste delle macchine, senza un'origine del
  browser, si autenticano con una chiave o un token invece che con un cookie.
- **Intestazioni HTTP**: quelle predefinite di Helmet (HSTS, `X-Content-Type-Options`,
  protezione dai frame e altre) e, in produzione, una **Content Security Policy**: script,
  connessioni e worker solo dall'origine dell'applicazione (nessuno script inline o valutato),
  nessun plugin, nessun inserimento in frame da altri siti. Gli stili possono essere inline, come
  richiedono i componenti dell'interfaccia, e i font arrivano da Google Fonts. L'editor di codice
  e ogni altro script sono serviti dall'installazione stessa; nulla viene caricato da una CDN.
  `CONTENT_SECURITY_POLICY` può metterla in sola segnalazione o disattivarla.
- **Frequenza delle richieste**: l'accesso è limitato per indirizzo; ogni chiave API, e ogni
  indirizzo che chiama l'API pubblica senza chiave, è limitato a `API_RATE_LIMIT` richieste al
  minuto (600 di default); i webhook a `WEBHOOK_RATE_LIMIT` per indirizzo (120). Oltre, la
  risposta è `429` con `Retry-After`.
- **Impostazioni dell'installazione** (livello e conservazione dei log, pausa dei runner): le
  cambiano solo le persone elencate in `INSTALLATION_ADMINS`, oppure un owner finché
  l'installazione ha una sola organizzazione. Gli owner delle altre organizzazioni le vedono in
  sola lettura.
- **Validazione degli input**: i corpi delle richieste vengono validati con schemi prima di
  arrivare al database; le query sono parametrizzate tramite l'ORM.
- **Dimensione delle richieste**: i corpi JSON sono limitati a 100 KB.
- **Errori**: un errore imprevisto risponde con il suo messaggio e senza stack trace; lo stack
  va nel log. Ogni risposta ha un'intestazione `X-Correlation-Id` che ritrova le righe di log
  corrispondenti.

## Log e audit

**Registro di audit.** Le modifiche a membri, chiavi, test, piani, schedulazioni, progetti,
ambienti e segreti, revisioni, agenti, integrazioni, runner, impostazioni di sicurezza, e gli
accessi, vengono registrati con chi ha agito, l'azione, l'oggetto, l'indirizzo IP del client e,
per le chiamate API, quale chiave. Le voci vengono scritte nella stessa transazione della
modifica. Il ruolo del database usato dall'applicazione può solo leggere e aggiungere voci, mai
modificarle o cancellarle. Gli owner possono filtrarlo ed esportarlo.

**Log dell'applicazione**: JSON strutturato con un correlation id per richiesta. Password,
token, chiavi e campi simili vengono mascherati prima che la riga sia scritta. I log si
conservano 7 giorni di default e si possono inviare a Grafana Loki.

## Evidenze dei run

I run conservano screenshot, video, trace di Playwright e catture di rete (HAR) secondo le
impostazioni di ogni piano. Mostrano ciò che il browser mostrava, che può includere dati
personali dell'applicazione sotto test e valori digitati nei moduli.

- Le catture di rete vengono ripulite prima di essere salvate: intestazioni di autenticazione e
  cookie rimossi, credenziali negli URL cancellate, e i corpi di richieste e risposte non
  vengono mai registrati.
- Le evidenze sono servite solo ai membri dell'organizzazione a cui appartiene il run.
- Vengono rimosse dopo `ARTIFACT_RETENTION_DAYS` (90 di default); risultati e verdetti restano.

## Connessioni in uscita

I test esistono per raggiungere altri sistemi, quindi **il prodotto non limita dove si collega
un test**: uno step del browser o un test API può indirizzare qualsiasi host raggiungibile dal
worker. In produzione la verifica dei certificati è sempre attiva; le eccezioni di sviluppo
sono per host e ignorate in produzione.

Questo rende la posizione in rete dei worker una decisione di sicurezza. Vedi
[Hardening](./hardening#rete) per le regole che un operatore dovrebbe applicare, in particolare
su un'installazione dove persone di aziende diverse possono scrivere test.

## Agenti locali

Un agente locale permette a un cliente di testare applicazioni dentro la propria rete senza
aprirla all'installazione:

- l'agente fa solo connessioni **in uscita** verso l'installazione; nulla si connette alla rete
  del cliente;
- presta browser, non la rete: i run pilotano il browser avviato dall'agente, e solo
  l'organizzazione che ha creato l'agente può usarlo;
- un runner ha bisogno di un ticket firmato con un segreto condiviso dai processi
  dell'installazione, valido un minuto e per una sola organizzazione;
- revocare il token dell'agente lo disconnette subito.

## Funzioni AI

Le funzioni AI sono **disattivate finché l'operatore non imposta una chiave API di Google
Gemini**. Quando sono attive, lascia l'installazione verso l'API di Google:

| Funzione | Cosa viene inviato |
|---|---|
| Descrivere un test a frasi | Le frasi, l'elenco delle azioni ammesse, e nomi ed etichette degli elementi disponibili (mai selettori o segreti). |
| Correzione del selettore, quando uno step non trova il suo elemento | Il selettore che fallisce, l'errore, e fino a 30.000 caratteri dell'HTML della pagina. |
| Analisi del fallimento, quando uno step fallisce | Il messaggio di errore e lo stack trace. |

L'HTML di una pagina può contenere dati personali dell'applicazione sotto test. Impostate la
chiave solo dove inviarlo a Google è accettabile; tutto il resto funziona anche senza.

## Gestione delle vulnerabilità

- Le dipendenze vengono controllate con `npm audit`, e le segnalazioni con la relativa decisione
  sono registrate in `docs/SECURITY-AUDIT.md` nel repository.
- La suite di test (oltre 1.600 test) gira a ogni modifica, compresi i test di isolamento tra
  organizzazioni, i test di architettura che limitano l'accesso privilegiato al database e i
  test dei percorsi di autenticazione e audit.
- Playwright e i browser sono fissati alla stessa versione nell'immagine web, nell'immagine
  worker e nell'agente.

## Limiti noti

Dichiarati perché una valutazione possa pesarli, invece di scoprirli dopo:

- **Il single sign-on è solo OpenID Connect**, senza SAML, senza associare i gruppi del provider
  ai ruoli e senza SCIM: una persona rimossa qui ma non presso il provider ottiene un nuovo
  account al suo accesso successivo, quindi l'accesso si revoca presso il provider. I domini
  e-mail non vengono verificati via DNS; su un'installazione condivisa il primo che rivendica un
  dominio lo ottiene.
- Nessuna regola sulla complessità delle password oltre alla lunghezza, e nessun invio di
  e-mail: i link di invito e di reset della password li consegna l'owner.
- **I limiti di frequenza si contano per processo web**: con più processi web dietro un
  bilanciatore il limite effettivo è moltiplicato per il loro numero.
- **Gli stili possono essere inline** sotto la Content Security Policy, come richiedono i
  componenti dell'interfaccia.
