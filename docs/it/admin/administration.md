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
volta sola: mandatelo alla persona con un canale di cui vi fidate, perché l'applicazione non
invia e-mail. Il link apre il modulo di registrazione con invito e username già compilati; la
persona sceglie una password (almeno 8 caratteri) ed è dentro. Un invito vale sette giorni e si
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
dimenticato la password. La pagina mostra il link una volta sola: consegnatelo voi, perché non
viene inviata alcuna e-mail. Apre un modulo per scegliere una nuova password, funziona una volta e
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

I membri possono accedere con l'identity provider dell'organizzazione tramite **OpenID
Connect**: Microsoft Entra ID, Okta, Google Workspace, Keycloak, Auth0 e qualsiasi altro
provider che pubblichi un documento di discovery. SAML non è supportato.

**Configurazione.** In **Impostazioni → Sicurezza → Single sign-on**:

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

**Accesso.** La pagina di accesso mostra **Accedi con SSO** appena un'organizzazione lo ha
configurato. La persona scrive il proprio indirizzo; il dominio sceglie l'organizzazione, e il
browser va al provider. Al ritorno l'applicazione verifica la risposta firmata del provider
(issuer, audience, firma, scadenza, e un nonce e uno state monouso), poi:

- un'identità già vista accede allo stesso account, anche se l'indirizzo è cambiato;
- la prima volta, un account esistente dell'organizzazione il cui nome utente è quell'indirizzo
  viene collegato; così passano al SSO i membri che avevano già una password;
- altrimenti viene **creato** un account, con l'indirizzo come nome utente e il ruolo scelto.
  Nessun owner viene creato così: si nomina un owner in **Impostazioni → Membri**.

L'indirizzo viene dal claim `email` oppure, se manca, da un `preferred_username` in forma di
indirizzo, che è ciò che invia Entra ID. Un indirizzo che il provider segna come non verificato
viene rifiutato, come uno fuori dai vostri domini.

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
il provider; rimuoverlo anche qui mette in ordine l'elenco dei membri.
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
| Stati dei commit su GitHub e GitLab | **Impostazioni → GitHub e GitLab**; mostra l'ultimo errore di invio | Owner |
| Agenti locali | **Impostazioni → Agenti locali**; vedi [Agenti locali](../LOCAL_AGENT) | Owner |

I token dei tracker e di GitHub/GitLab vengono cifrati al salvataggio e non vengono più
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

Entrambe si fanno per ora tramite l'API, con la chiave ad accesso completo di un owner:

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

La cancellazione rimuove le righe dell'organizzazione dal database. Non rimuove i suoi file
dall'archivio degli artefatti (screenshot, video e trace sotto `results/<planId>/`, con gli id
dei piani nell'esportazione; baseline sotto `visual-baselines/org_<id>/`), e la conservazione
non li trova più una volta spariti i run: li rimuove chi gestisce l'installazione, che si occupa
anche dei backup del database, dove l'organizzazione resta finché non scadono.

## Limiti noti

- Esportazione e cancellazione non hanno ancora una schermata; si fanno tramite l'API come
  mostrato sopra.
- Cancellare un'organizzazione lascia i suoi file nell'archivio degli artefatti, da rimuovere a
  cura di chi gestisce l'installazione.
- Il single sign-on è solo OpenID Connect (niente SAML), e i ruoli non vengono presi dai gruppi
  del provider: i nuovi account hanno il ruolo predefinito, e gli owner lo cambiano in
  **Impostazioni → Membri**.
- Non c'è invio di e-mail; gli inviti si consegnano a mano.
- Le sezioni **Notifiche** e **Account** di Impostazioni non vengono ancora salvate.
