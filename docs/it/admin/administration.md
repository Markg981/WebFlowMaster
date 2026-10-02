# Amministrazione

Per gli owner di un'organizzazione: chi può fare cosa, come persone e macchine ottengono
l'accesso, e i controlli che un owner ha su sicurezza, capacità e dati dell'organizzazione.
L'installazione vera e propria è descritta in [Installazione](./installation) e
[Operatività](./operations).

Quasi tutto ciò che segue si trova in **Impostazioni**. Le sezioni segnate *owner* sono visibili
solo agli owner.

## Ruoli

Ogni persona appartiene a una sola organizzazione, con un solo ruolo.

| | Viewer | Editor | Owner |
|---|:---:|:---:|:---:|
| Vedere test, piani, run e report | ✓ | ✓ | ✓ |
| Creare e modificare test, suite, piani, schedulazioni, ambienti | | ✓ | ✓ |
| Avviare e annullare run | | ✓ | ✓ |
| Creare le proprie chiavi API | | ✓ | ✓ |
| Approvare revisioni, quando l'organizzazione le richiede | | ✓ | ✓ |
| Membri, inviti e ruoli | | | ✓ |
| Progetti riservati e chi vi accede | | | ✓ |
| Account di servizio; revocare la chiave API di chiunque | | | ✓ |
| Agenti locali, collegamenti GitHub/GitLab | | | ✓ |
| Criterio sul secondo fattore, criterio sulle revisioni | | | ✓ |
| Runner, registro di audit, impostazioni di sistema | | | ✓ |
| Esportare o cancellare l'organizzazione | | | ✓ |

Ogni organizzazione conserva almeno un owner: l'ultimo owner non può essere declassato né
rimosso.

Date a ciascuno il ruolo minimo che gli permette di lavorare. Chi segue solo i risultati è
viewer; le pipeline usano chiavi API, non l'account di una persona.

## Membri e inviti *(owner)* {#membri-e-inviti}

**Impostazioni → Membri** elenca le persone dell'organizzazione con i loro ruoli, e gli inviti
ancora in attesa.

**Invitare qualcuno.** Inserite lo username che avrà il nuovo account e il suo ruolo (viewer o
editor; il ruolo di owner si concede dopo), poi **Crea invito**. La pagina mostra un link, una
volta sola. Quando l'installazione invia e-mail ([E-mail](#e-mail)) e lo username è un indirizzo, il
link viene anche spedito lì, e la pagina dice se è partito; altrimenti mandatelo con un canale di
cui vi fidate. Il link apre il modulo di registrazione con invito e username già compilati; la
persona sceglie una password (come chiede la [politica delle password](#password-policy)) ed è dentro. Un invito vale sette giorni e si
può revocare finché è in attesa. Un account esistente non può essere spostato tra
organizzazioni: un invito crea sempre un account nuovo.

**Cambiare un ruolo** con il menu accanto a un membro. L'ultimo owner non può essere declassato.

**Rimuovere un membro** con l'icona del cestino. Il suo account viene cancellato, con le chiavi
API, il secondo fattore e le preferenze. Ciò che ha creato (progetti, test, test API, piani,
schedulazioni, gruppi di step, ambienti e i loro segreti) resta nell'organizzazione e passa a un
altro membro: a voi, a meno che nella finestra non ne scegliate un altro. Un owner che rimuove
se stesso lo passa a un altro owner. Il registro di audit ne conserva il nome e registra chi è
subentrato.

**Emettere un link di reset della password** con l'icona del link, per un membro che ha
dimenticato la password. La pagina mostra il link una volta sola, e lo spedisce come
si spedisce un invito. Apre un modulo per scegliere una nuova password, funziona una volta e
vale un giorno; emetterne un altro sostituisce il precedente. Il membro poi accede come sempre,
con il secondo fattore se lo ha. Per l'unico owner di un'organizzazione, il link lo emette
l'operatore dalla riga di comando (vedi [Recuperare l'accesso](./operations#recuperare-l-accesso)).

**Azzerare il secondo fattore di un membro** con l'icona della chiave, quando ha perso sia il
dispositivo sia i codici di recupero. Accede con la password e, se l'organizzazione lo richiede,
lo configura di nuovo.

Ognuno cambia la propria password in **Impostazioni → Account**, inserendo quella attuale.
Cambiare una password, o reimpostarla con un link, chiude tutte le altre sessioni di quella
persona.

Ognuna di queste operazioni viene registrata nel [registro di audit](#registro-di-audit).

::: details Le stesse operazioni tramite l'API
Con la chiave API ad accesso completo di un owner (`Authorization: Bearer wfm_…`):

| Operazione | Richiesta |
|---|---|
| Elencare i membri | `GET /api/organization` |
| Invitare | `POST /api/organization/invitations` con `{"username":"maria.rossi","role":"editor"}`; la risposta contiene il token, una volta |
| Inviti in attesa, revocarne uno | `GET /api/organization/invitations`, `DELETE /api/organization/invitations/<id>` |
| Registrarsi con un invito | `POST /api/register` con `{"username","password","invitationToken"}` |
| Cambiare un ruolo | `PATCH /api/organization/members/<userId>` con `{"role":"owner"}` |
| Rimuovere | `DELETE /api/organization/members/<userId>`, facoltativamente con `{"transferTo":<userId>}` |
| Link di reset della password | `POST /api/organization/members/<userId>/password-reset`; la risposta contiene il token, una volta. Il link è `/auth?reset=<token>` |
| Azzerare il secondo fattore | `DELETE /api/organization/members/<userId>/mfa` |
:::

## Progetti riservati

Un progetto è aperto a tutta l'organizzazione per default. Un owner può **riservarlo** in
**Impostazioni → Progetti**, con l'icona delle persone accanto al progetto: da quel momento è
visibile solo agli owner e alle persone elencate, ciascuna come viewer o editor. Un ruolo di
progetto può restringere il ruolo nell'organizzazione ma mai allargarlo: un viewer elencato come
editor continua a non poter modificare.

La riserva copre test, test API, gruppi di step, elementi e suite del progetto. Piani, run e
report restano visibili a tutta l'organizzazione, e un piano può eseguire i test di un progetto
riservato. Lo impone il database, non solo l'interfaccia.

## Autenticazione a due fattori

Ognuno può attivare un secondo fattore in **Impostazioni → Sicurezza**: un codice da un'app di
autenticazione, più codici di recupero monouso da conservare in un posto sicuro.

Un owner può **renderlo obbligatorio** per tutta l'organizzazione nella stessa sezione. Da quel
momento un membro senza secondo fattore non può fare altro che configurarlo, anche nelle
sessioni già aperte. Le chiavi API non sono coinvolte.

Un membro che ha perso sia il dispositivo sia i codici di recupero ha bisogno che un owner
azzeri il suo secondo fattore in **Impostazioni → Membri**.

## Single sign-on *(owner)* {#single-sign-on}

I membri possono accedere con l'identity provider dell'organizzazione tramite **OpenID Connect**
o **SAML 2.0**. OpenID Connect va bene per Microsoft Entra ID, Okta, Google Workspace, Keycloak,
Auth0 e qualsiasi provider che pubblichi un documento di discovery; SAML per i provider che
parlano solo SAML — ADFS, Shibboleth, PingFederate, configurazioni Okta ed Entra ID meno recenti.
Un'organizzazione usa un provider e un protocollo alla volta; si sceglie con **Protocollo** in cima
alla scheda.

**Configurare OpenID Connect.** In **Impostazioni → Sicurezza → Single sign-on**, Protocollo **OpenID Connect**:

1. Copiate il **redirect URI** mostrato (termina con `/api/sso/callback`; usa
   `WEBFLOW_PUBLIC_URL` se impostata).
2. Presso il provider, registrate un'applicazione web con quel redirect URI, gli scope
   `openid email profile` e un client secret. Il client si autentica con
   `client_secret_basic`, il default quasi ovunque.
3. Tornati qui, inserite l'**issuer** (l'indirizzo di cui il provider pubblica
   `/.well-known/openid-configuration`), il **client ID** e il **client secret**, i **domini
   e-mail** in cui terminano gli indirizzi dei membri, e il **ruolo dei nuovi account** (viewer o
   editor).
4. **Salva**, poi **Prova il provider**: scarica il documento di discovery con quanto salvato.

| Provider | Issuer |
|---|---|
| Microsoft Entra ID | `https://login.microsoftonline.com/{tenant-id}/v2.0` |
| Google Workspace | `https://accounts.google.com` |
| Okta | `https://{vostro-dominio}.okta.com` (o un authorization server al suo interno) |
| Keycloak | `https://{host}/realms/{realm}` |

Il client secret è salvato cifrato e non viene più mostrato; lasciate il campo vuoto per
mantenerlo quando cambiate altro. Ogni dominio appartiene a una sola organizzazione
dell'installazione.

**Configurare SAML 2.0.** Protocollo **SAML 2.0**. La scheda mostra cosa dare al provider; ogni
organizzazione è un service provider a sé:

| Valore di WebFlowMaster | Dove va presso il provider |
|---|---|
| **Entity ID** `…/api/sso/saml/{organizzazione}` | Identifier / Audience / *Relying party identifier* / *Client ID* di Keycloak |
| **URL ACS** `…/api/sso/saml/{organizzazione}/acs` | Reply URL / *Assertion Consumer Service*, binding **HTTP-POST** |
| **URL dei metadati** `…/api/sso/saml/{organizzazione}/metadata` | I provider che importano i metadati del service provider (ADFS, Shibboleth) leggono tutto da qui, dopo il salvataggio |

Presso il provider:

1. Create l'applicazione con quei valori. L'**asserzione deve essere firmata** (firmare anche
   l'intera risposta va bene). Le asserzioni cifrate non sono supportate: lasciate la cifratura
   spenta.
2. Inviate l'**indirizzo e-mail** della persona: come attributo `email`, `mail`,
   `urn:oid:0.9.2342.19200300.100.1.3` o `…/claims/emailaddress` di Microsoft, oppure come NameID
   in formato e-mail.
3. Preferite un NameID **persistent**: identifica la persona anche quando cambia indirizzo. Con un
   NameID transient come identità si usa l'indirizzo.

Tornati qui, incollate i **metadati XML** del provider e premete **Leggi i metadati**: compilano
l'**entity ID** del provider, il suo **URL di accesso** (binding HTTP-Redirect) e il suo
**certificato di firma**. Si possono anche scrivere a mano. Aggiungete domini e ruolo dei nuovi
account, poi **Salva** e **Prova il provider**, che controlla che il certificato sia valido e che
l'URL di accesso risponda. La scheda mostra soggetto e scadenza del certificato; quando il provider
lo rinnova incollate il nuovo — con un certificato scaduto ogni accesso viene rifiutato, e la
scheda lo dice.

| Provider | Dove trovare i metadati |
|---|---|
| Microsoft Entra ID | Enterprise application → Single sign-on → *Federation Metadata XML* |
| Okta | Applicazione → Sign On → *Identity Provider metadata* |
| ADFS | `https://{host}/FederationMetadata/2007-06/FederationMetadata.xml` |
| Keycloak | `https://{host}/realms/{realm}/protocol/saml/descriptor` |

**Accesso.** La pagina di accesso mostra **Accedi con SSO** appena un'organizzazione lo ha
configurato. La persona scrive il proprio indirizzo; il dominio sceglie l'organizzazione, e il
browser va al provider. Al ritorno l'applicazione verifica la risposta firmata del provider —
per OpenID Connect issuer, audience, firma, scadenza, nonce e state dell'ID token; per SAML la
firma dell'asserzione con il certificato salvato, issuer, audience, finestra di validità e che
risponda a una richiesta inviata da questa installazione, cosa che può fare una sola volta — poi:

- un'identità già vista accede allo stesso account, anche se l'indirizzo è cambiato;
- la prima volta, un account esistente dell'organizzazione il cui nome utente è quell'indirizzo
  viene collegato; così passano al SSO i membri che avevano già una password;
- altrimenti viene **creato** un account, con l'indirizzo come nome utente e il ruolo scelto, o
  il ruolo a cui portano i suoi gruppi (sotto). Senza un gruppo mappato su owner, nessun owner
  viene creato così: si nomina un owner in **Impostazioni → Membri**.

Con OpenID Connect l'indirizzo viene dal claim `email` oppure, se manca, da un
`preferred_username` in forma di indirizzo, che è ciò che invia Entra ID; un indirizzo che il
provider segna come non verificato viene rifiutato. Con SAML viene dagli attributi elencati sopra o
da un NameID in forma di indirizzo. In entrambi i casi un indirizzo fuori dai vostri domini viene
rifiutato.

**Ruoli dai gruppi del provider.** In **Ruoli dai gruppi del provider** associate i gruppi inviati
dal provider a un ruolo: viewer, editor o owner. A ogni accesso la persona riceve il ruolo più alto
fra quelli a cui portano i suoi gruppi: un nuovo account viene creato con quel ruolo, e uno
esistente lo segue, verso l'alto o verso il basso (il registro di audit registra il cambio come
`member.role_changed` con `bySsoGroups: true`). Chi non è in nessun gruppo mappato mantiene il
ruolo che ha, e un nuovo account riceve il ruolo predefinito; senza alcuna mappatura i ruoli si
gestiscono in **Impostazioni → Membri** come prima. L'ultimo owner dell'organizzazione non viene
mai retrocesso dai suoi gruppi, così l'organizzazione non resta chiusa fuori.

I gruppi si confrontano senza distinguere maiuscole e minuscole. **Claim o attributo con i
gruppi** indica dove il provider li mette: `groups` se vuoto; vanno bene sia una lista sia un
valore singolo.

| Provider | Cosa inviare |
|---|---|
| Microsoft Entra ID | Registrazione app → Configurazione token → *Aggiungi attestazione gruppi*. Il claim `groups` contiene gli **object ID** dei gruppi: mappate quelli, non i nomi. Oltre 200 gruppi Entra invia un link al posto della lista; assegnate i gruppi all'applicazione per restare sotto il limite. |
| Okta | Authorization server → Claims → un claim `groups` con un filtro (es. *Starts with* `wfm-`). Per SAML, un group attribute statement. |
| Keycloak | Client scope → Mapper *Group Membership*, nome del claim `groups`, *Full group path* disattivato. Per SAML, il mapper *Group list*. |
| ADFS | Una regola di claim che invia *Token-Groups – Unqualified Names* come attributo (es. `groups`). |

**Rifiuta chi non è in nessuno di questi gruppi** (dopo aver mappato almeno un gruppo) fa della
mappatura il cancello d'ingresso: chi non è in nessun gruppo mappato non può accedere, che il suo
account esista o no, e ne vede il motivo nella pagina di accesso. Togliere qualcuno dai gruppi
presso il provider gli revoca così l'accesso qui al suo accesso successivo.

**Verificare i domini.** Ogni dominio mostra un record DNS TXT da pubblicare:
`_wfm-verification.<dominio>` con valore `wfm-verification=<token>`. Una volta pubblicato,
premete **Verifica**: il server cerca il record e segna il dominio come **verificato**; se il record
non c'è ancora la scheda dice cosa ha trovato (le modifiche DNS possono impiegare un po' a
raggiungere tutti i server). La verifica resta quando si salvano di nuovo le impostazioni, e si
perde solo togliendo il dominio dall'elenco.

Se l'installazione imposta `SSO_REQUIRE_DOMAIN_VERIFICATION=true` — ogni installazione condivisa
o multi-tenant dovrebbe farlo — un dominio non indirizza alcun accesso finché non è verificato, e
una rivendicazione non verificata non lo trattiene: un'altra organizzazione che aggiunge il dominio
lo prende, e chi lo verifica per primo lo tiene. Senza la variabile i domini funzionano appena
salvati e verificarli è facoltativo, il che va bene per un'installazione con una sola
organizzazione.

**Provisioning con SCIM.** Il single sign-on viene a sapere delle persone quando accedono. Con
SCIM 2.0 il provider avvisa WebFlowMaster appena qualcosa cambia presso di lui: crea gli account, li
disattiva e li rimuove, e invia i suoi gruppi. In **Provisioning (SCIM)** premete **Emetti un
token** e date al provider l'**URL di base SCIM** (`<il vostro indirizzo>/api/scim/v2`) e il token,
che viene mostrato una sola volta; **Sostituisci il token** chiude subito quello vecchio,
**Revoca** chiude il provisioning. Prima va configurato il single sign-on: gli account creati così
non hanno password e accedono tramite il provider, che li collega per indirizzo al primo accesso.

| Provider | Dove |
|---|---|
| Microsoft Entra ID | Applicazione enterprise → Provisioning → *Automatico*: **Tenant URL** è l'URL di base, **Secret token** il token. Mappate `userPrincipalName` (o `mail`) su `userName`; *Provision Microsoft Entra ID Groups* invia i gruppi. |
| Okta | Scheda *Provisioning* dell'app → SCIM 2.0, **Base URL** e autenticazione *HTTP Header* con il token; identificativo univoco `userName` (l'indirizzo e-mail); attivate *Create*, *Update* e *Deactivate Users*, e *Push Groups*. |
| Altri (OneLogin, JumpCloud, Keycloak con un'estensione SCIM…) | SCIM 2.0 con un bearer token: l'URL di base e il token. |

Cosa fa qui:

- Gli **utenti** sono i membri dell'organizzazione; `userName` è il loro indirizzo e-mail, in uno
  dei domini del single sign-on. Un nuovo utente riceve il **Ruolo dei nuovi account**. Anche i
  membri già presenti sono elencati, così un provider che confronta per `userName` li prende in
  carico invece di crearli di nuovo.
- **`active: false` disattiva** subito l'account: le sue sessioni terminano alla richiesta
  successiva, non può accedere e le sue chiavi API smettono di funzionare. **Impostazioni →
  Membri** lo segna come *disattivato*. `active: true` lo restituisce con il suo ruolo e tutto ciò
  che ha creato.
- **Cancellare** un utente rimuove il membro come farebbe un owner: ciò che ha creato passa
  all'owner presente da più tempo.
- I **gruppi** applicano le mappature di **Ruoli dai gruppi del provider** appena qualcuno entra
  o esce da uno di essi: si confronta il nome del gruppo, o il suo ID esterno (l'object ID di Entra
  ID). Cambiare le mappature le applica subito ai gruppi inviati. Chi non è in nessun gruppo
  mappato mantiene il suo ruolo, come all'accesso — a meno che **Rifiuta chi non è in nessuno di
  questi gruppi** sia attivo: allora un account gestito dal provider viene **disattivato subito**
  quando esce dall'ultimo gruppo mappato (le sue sessioni terminano, `reason: no_group` nel registro
  di audit) e riattivato quando rientra in uno; un nuovo account attende disattivato finché un
  gruppo mappato non lo contiene. Uno disattivato dal provider stesso (`active: false`) resta tale
  finché il provider non dice altrimenti. Il controllo vale solo da quando il provider invia gruppi,
  così un provider che sincronizza solo le persone non le chiude fuori.
- L'**ultimo owner attivo** dell'organizzazione non viene mai disattivato, declassato o rimosso
  dal provider, che riceve invece un 409.

Il registro di audit indica come autore `SCIM` per ogni modifica del provider: account creati
(`member.provisioned`), disattivati, riattivati, rinominati o rimossi, ruoli cambiati dai gruppi
(`bySsoGroups` e `byScim`), e gruppi inviati, modificati o rimossi; l'emissione e la revoca del
token sono registrate a nome dell'owner che le ha fatte, mai il token.

**Renderlo obbligatorio.** Con **Rendilo obbligatorio** attivo, i membri che non sono owner non
possono più accedere con la password, e le sessioni aperte con la password terminano alla
richiesta successiva. Gli owner mantengono la password, perché qualcuno possa ancora entrare e
correggere le impostazioni se il provider è irraggiungibile o mal configurato. Le chiavi API non
sono interessate.

A una sessione aperta tramite il provider non viene chiesto il
[secondo fattore](#autenticazione-a-due-fattori) dell'organizzazione: quel controllo spetta al
provider, quindi richiedetelo lì.

::: warning È il provider a decidere chi entra
Rimuovere un membro qui cancella il suo account, ma se il provider lo lascia ancora accedere, il
suo accesso successivo crea un nuovo account con il ruolo predefinito. Revocate l'accesso presso
il provider (con il provisioning SCIM viene disattivato qui all'istante), oppure mappate i gruppi, attivate **Rifiuta chi non è in nessuno di questi gruppi** e
toglietelo dai gruppi; rimuoverlo anche qui mette in ordine l'elenco dei membri.
:::

Il registro di audit registra le modifiche o la rimozione delle impostazioni (mai il secret),
ogni account creato al primo accesso e ogni accesso, con `method: sso`. Quando un accesso viene
rifiutato, la persona ne vede il motivo nella pagina di accesso, e il log del server riporta
l'errore del provider.

## Chiavi API e account di servizio

Pipeline e script si autenticano con **chiavi API** (**Impostazioni → Chiavi API**), mai con la
password di una persona.

- Le **chiavi con scope** (il default) funzionano solo sull'API pubblica `/api/v1`, e solo per
  ciò che è stato concesso: `plans:read`, `runs:read`, `runs:write`. Una pipeline che avvia un
  piano e ne aspetta l'esito ha bisogno di `runs:write` e `runs:read`.
- Le **chiavi ad accesso completo** agiscono come il loro account ovunque. Usatele solo quando una
  chiave con scope non basta.
- Una chiave può avere una **scadenza**. Il suo ultimo utilizzo è visibile, così si trovano le
  chiavi inutilizzate.
- La chiave viene mostrata **una sola volta**. È salvata come hash e non si può recuperare; una
  chiave persa si revoca e si sostituisce.
- Il ruolo dell'account della chiave vale comunque: la chiave di un viewer non avvia run.

Una chiave appartiene al suo account. Quando la pipeline non deve dipendere da una persona, un
owner crea un **account di servizio**: un account che non può accedere, ha un proprio ruolo
(viewer o editor) e possiede chiavi. Disattivare l'account di servizio revoca tutte le sue
chiavi in una volta.

Gli owner vedono e possono revocare ogni chiave dell'organizzazione.

## Integrazioni

| Cosa | Dove | Chi |
|---|---|---|
| Avviare piani dalla CI | Chiavi API e la CLI `wfm`; vedi [Integrazione CI](../CI_INTEGRATION) | Editor |
| Webhook che avviano un piano | Le impostazioni del piano; ognuno ha il proprio token | Editor |
| Issue tracker (Jira, Azure DevOps) | **Impostazioni → Issue tracker** | Editor |
| Test management (TestRail, Xray, Zephyr Scale) | **Impostazioni → Test management**; vedi [Pubblicare su TestRail, Xray o Zephyr](../guide/results#test-management) | Editor |
| Stati dei commit su GitHub e GitLab | **Impostazioni → GitHub e GitLab**; mostra l'ultimo errore di invio | Owner |
| Agenti locali | **Impostazioni → Agenti locali**; vedi [Agenti locali](../LOCAL_AGENT) | Owner |

I token dei tracker, degli strumenti di test management e di GitHub/GitLab vengono cifrati al salvataggio e non vengono più
mostrati; per cambiarne uno, inserite il nuovo valore.

## Ambienti e segreti

**Impostazioni → Ambienti** contiene i valori usati dai test: indirizzi, username, password. Un
segreto chiamato `baseUrl` imposta <code v-pre>{{baseUrl}}</code>, così lo stesso test gira su
test, staging e produzione. I valori dei segreti sono cifrati, non vengono più mostrati dopo il
salvataggio e sono mascherati nei log. Il registro di audit registra che un segreto è stato
impostato o cancellato, mai il suo valore.

## Revisioni dei test

Quando un owner attiva **Richiedi una revisione per pubblicare** nella pagina **Revisioni**, una
modifica a un test arriva ai piani solo dopo che un altro membro l'ha approvata. Nel frattempo i
piani continuano a eseguire l'ultima versione pubblicata. Utile dove i test decidono un rilascio
e una modifica deve essere vista da due persone.

## Runner *(owner)*

**Impostazioni → Runner** elenca le macchine worker dell'installazione: online, in svuotamento o
offline, cosa stanno eseguendo e con quale versione.

**Svuota** un runner prima di una manutenzione: finisce ciò che ha e non prende altro.
**Riprendi** lo rimette in servizio. I runner servono tutte le organizzazioni dell'installazione,
quindi solo i suoi [amministratori](#amministratori-dell-installazione) possono svuotarne o
riprenderne uno; gli altri owner vedono l'elenco senza i pulsanti.

## Utilizzo dei run e limiti

**Impostazioni → Utilizzo dei run** mostra i run in corso e in attesa dell'organizzazione
rispetto ai suoi limiti, e quanti runner sono online. Un run che resta *in coda* di solito si
spiega qui: l'organizzazione è al limite, o nessun runner è online.

I limiti li imposta chi gestisce l'installazione, non gli owner (vedi
[Capacità e limiti](./operations#capacita-e-limiti)).

## Registro di audit *(owner)* {#registro-di-audit}

**Impostazioni → Registro di audit** registra chi ha fatto cosa e quando: accessi e accessi
falliti, membri e inviti, chiavi e account di servizio, test, piani, schedulazioni, suite,
progetti e relativi accessi, revisioni e pubblicazioni, quarantena, ambienti e segreti, agenti,
collegamenti GitHub/GitLab, runner, modifiche al secondo fattore, run annullati e impostazioni di
sistema.

Ogni voce riporta chi ha agito, l'azione, l'oggetto, l'indirizzo IP del client e, per le
richieste fatte con una chiave, quale chiave. Si può filtrare per categoria, azione, persona e
date, ed esportare in CSV (fino a 10.000 voci per esportazione; restringete le date per
averne di più).

Il registro non si può modificare né cancellare dall'applicazione: il database gli concede solo
lettura e aggiunta. Viene rimosso solo quando si cancella l'intera organizzazione.

## Impostazioni di sistema *(owner)*

**Impostazioni → Sistema** imposta il livello dei log e per quanto tempo si conservano i file
di log.

Si applicano a tutte le organizzazioni dell'installazione, quindi le cambiano solo i suoi
amministratori; gli altri le vedono in sola lettura. La modifica viene registrata nel registro
di audit dell'organizzazione dell'amministratore.

### Amministratori dell'installazione {#amministratori-dell-installazione}

Le impostazioni dei log e lo svuotamento dei runner riguardano l'intera installazione, non una
singola organizzazione. Chi può cambiarli:

- le persone i cui nomi utente sono elencati in `INSTALLATION_ADMINS`, se impostata
  ([Configurazione](./configuration)); nessun altro, qualunque sia il suo ruolo;
- altrimenti, gli owner dell'organizzazione finché l'installazione ne ha **esattamente una**.
  Appena esiste una seconda organizzazione, nessuno può finché l'operatore non imposta
  `INSTALLATION_ADMINS`.

Un'azienda che gestisce la propria installazione non deve fare nulla. Un'installazione condivisa
da più clienti dovrebbe nominare i propri operatori.

## Esportazione e cancellazione *(owner)* {#esportazione-e-cancellazione}

In **Impostazioni → Esportazione e cancellazione**: **Scarica l'esportazione**, e **Cancella
definitivamente** dopo aver scritto il nome esatto dell'organizzazione. Lo stesso si può fare
tramite l'API, con la chiave ad accesso completo di un owner:

```bash
export WFM_URL=https://webflowmaster.example.com
export KEY=wfm_...   # la chiave ad accesso completo di un owner
```

**Esportazione**: `GET /api/organization/export` restituisce l'intera organizzazione in un file
JSON: ogni tabella che le appartiene (membri, progetti, test, piani, run, il registro di audit e
il resto). Password e token degli inviti sono esclusi. I segreti salvati e i token delle
integrazioni sono inclusi in forma cifrata, illeggibili senza la `ENCRYPTION_KEY`
dell'installazione; chiavi API e altri token solo come hash, da cui non si risale alle chiavi.
Trattate comunque il file come riservato: contiene test, dati e registro di audit
dell'organizzazione.

```bash
curl -s -H "Authorization: Bearer $KEY" "$WFM_URL/api/organization/export" -o export.json
```

La **cancellazione** elimina l'organizzazione e **tutti gli account dei membri**, in modo
irreversibile. Richiede come conferma il nome esatto dell'organizzazione:

```bash
curl -s -X DELETE -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"confirmName":"Acme QA"}' "$WFM_URL/api/organization"
```

Esportate prima. La cancellazione viene scritta nel log dell'applicazione, perché il registro di
audit viene cancellato insieme all'organizzazione.

La cancellazione rimuove le righe dell'organizzazione dal database e poi i suoi file
dall'archivio degli artefatti: screenshot, video e trace di ogni run sotto
`results/<planId>/<runId>/`, e le baseline visive sotto `visual-baselines/org_<id>/`. La risposta
dice quanti file sono stati rimossi e nomina le cartelle che l'archivio ha rifiutato (per esempio
un bucket irraggiungibile), registrate anche nel log dell'applicazione; quelle le rimuove a mano
chi gestisce l'installazione. I backup del database conservano l'organizzazione finché non scadono.

## E-mail {#e-mail}

Con `SMTP_URL` e `SMTP_FROM` impostate (vedere [Configurazione](./configuration)), l'installazione invia:

- **Inviti e link di reset della password** emessi da un owner, agli username che sono indirizzi.
  Il link resta mostrato una volta, per quando la mail non arriva.
- **"Password dimenticata?"** nella pagina di accesso: un link di reset spedito all'indirizzo con
  cui la persona accede. La risposta è la stessa che l'account esista o no, così non serve a
  scoprire chi ne ha uno. La richiesta è registrata nel log di audit.
- **Notifiche dei run**: agli indirizzi nelle notifiche di un piano, quando i suoi interruttori lo
  prevedono per quell'esito, e alla persona che ha avviato il run, da **Impostazioni → Notifiche**:
  e-mail sì o no (no di default), poi ogni run concluso o solo i run falliti. Un messaggio rifiutato
  viene segnalato nella console del run; non cambia mai il run.

Senza SMTP tutto funziona come prima: gli owner consegnano i link, e i piani notificano solo tramite
il loro webhook.

## Politica delle password {#password-policy}

`PASSWORD_POLICY` decide come deve essere una nuova password, quando la si sceglie (registrazione,
cambio, link di reset); le password già esistenti non vengono controllate.

- `basic` (default): da 8 a 128 caratteri, diversa dallo username.
- `strong`: almeno 12 caratteri; almeno tre fra minuscole, maiuscole, cifre e simboli; non contiene
  lo username (o la parte di un indirizzo prima della @); non è fra le password da cui parte ogni
  lista di tentativi.

## Limiti noti

- Senza SCIM, il single sign-on legge i ruoli dai gruppi solo all'accesso: una modifica presso il
  provider arriva a WebFlowMaster al successivo accesso della persona, e le sessioni già aperte
  mantengono il loro ruolo fino ad allora. SCIM supporta filtri `eq` su un attributo, niente
  operazioni bulk né ordinamento, e di un utente conserva l'indirizzo, lo stato attivo e l'ID
  esterno (nomi e altri attributi sono accettati e ignorati). Le asserzioni SAML devono essere firmate e non
  cifrate, l'accesso parte da WebFlowMaster (niente accesso avviato dall'IdP), e il single logout
  non è supportato.
- Le e-mail sono testo semplice via SMTP; non c'è un editor di modelli e i rimbalzi non vengono tracciati.
