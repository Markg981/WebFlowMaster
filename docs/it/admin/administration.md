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

**Azzerare il secondo fattore di un membro** con l'icona della chiave, quando ha perso sia il
dispositivo sia i codici di recupero. Accede con la password e, se l'organizzazione lo richiede,
lo configura di nuovo.

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
quindi su un'installazione condivisa è una decisione di chi la gestisce.

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

::: warning Valgono per tutta l'installazione
Si applicano a tutte le organizzazioni dell'installazione, e l'owner di qualsiasi organizzazione
può cambiarle. La modifica viene registrata nel registro di audit dell'organizzazione il cui
owner l'ha fatta. Su un'installazione condivisa da più clienti, lasciatele a chi la gestisce.
:::

## Esportazione e cancellazione *(owner)*

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
- Non c'è single sign-on (SAML, OpenID Connect) né invio di e-mail; gli inviti si consegnano a
  mano.
- Le sezioni **Notifiche** e **Account** di Impostazioni non vengono ancora salvate.
