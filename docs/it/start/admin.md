# La prima organizzazione con single sign-on

Per chi configura un'organizzazione. Alla fine i colleghi entrano con l'account aziendale, ricevono
un ruolo dai loro gruppi e perdono l'accesso quando se ne vanno. Serve il ruolo di **owner** e un
amministratore del vostro identity provider (Microsoft Entra ID, Okta, Google Workspace, Keycloak,
ADFS…) a portata di mano. Se WebFlowMaster non è ancora installato, iniziate da
[Installazione](../admin/installation): il primo account registrato lì diventa owner della prima
organizzazione.

## 1. Mettere in sicurezza il proprio account (5 minuti)

1. **Impostazioni → Account**: cambiate la password iniziale se ve l'ha data qualcun altro.
2. **Impostazioni → Sicurezza**: configurate un secondo fattore con un'app di autenticazione e
   conservate i codici di recupero in un posto sicuro. Gli owner mantengono l'accesso con password
   anche quando il single sign-on è obbligatorio: questo è l'account che entra quando il provider
   non risponde.
3. Invitate un secondo owner (**Impostazioni → Membri**), così l'organizzazione non dipende da una
   sola persona.

## 2. Collegare l'identity provider (20 minuti)

OpenID Connect è la strada più breve dove il provider lo supporta; SAML 2.0 funziona allo stesso
modo dal lato di WebFlowMaster ([Single sign-on](../admin/administration#single-sign-on)).

1. **Impostazioni → Sicurezza**, single sign-on, **Protocollo** OpenID Connect. Copiate la
   **Redirect URI da registrare presso il provider**.
2. Presso il provider registrate un'applicazione web con quella redirect URI, gli scope
   `openid email profile` e un client secret.
3. Tornati in WebFlowMaster inserite **Issuer**, **Client ID**, **Client secret**, i **Domini
   e-mail** e il **Ruolo dei nuovi account** (viewer è la scelta prudente).
4. **Salva**, poi **Prova il provider**.
5. Uscite e rientrate con **Accedi con SSO** usando un account di prova dell'azienda.

## 3. Verificare i domini (5 minuti)

In **Verifica dei domini** ogni dominio mostra un record TXT, `_wfm-verification.<dominio>`.
Pubblicatelo, poi premete **Verifica**. Su un'installazione condivisa un dominio non verificato non
fa accedere nessuno, e verificarlo impedisce a un'altra organizzazione di rivendicarlo.

## 4. Ruoli dai gruppi (10 minuti)

In **Ruoli dai gruppi del provider** associate i gruppi del provider ai ruoli: per esempio
`wfm-viewers` a viewer, `wfm-testers` a editor, `wfm-admins` a owner. Chiedete all'amministratore
del provider di inviare i gruppi nel token (con Entra ID si associano gli object ID dei gruppi, non
i nomi). Attivate **Rifiuta chi non è in nessuno di questi gruppi** perché i gruppi diventino il
cancello: togliere qualcuno dai gruppi presso il provider gli toglie l'accesso qui al successivo
accesso.

## 5. Renderlo obbligatorio (2 minuti)

Quando un account di prova funziona dall'inizio alla fine, attivate **Rendilo obbligatorio**. I
membri che non sono owner non possono più accedere con la password e le loro sessioni con password
si chiudono. Le chiavi API continuano a funzionare, quindi le pipeline non ne risentono.

## 6. Controllare il registro di audit (3 minuti)

**Impostazioni → Registro di audit** mostra la modifica delle impostazioni, ogni account creato al
primo accesso e ogni accesso con `method: sso` ([Registro di audit](../admin/administration#registro-di-audit)).

## Poi

- Creare e rimuovere gli account dal provider appena cambiano: provisioning SCIM, nello stesso
  riquadro.
- Riservare alcuni progetti ad alcune persone: [Progetti riservati](../admin/administration#progetti-riservati).
- Pipeline: account di servizio e chiavi con scope ([Il primo run da una pipeline](./devops)).
- Utilizzo e limiti: [Quote e consumi](../admin/administration#quotas).
