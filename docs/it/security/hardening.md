# Checklist di hardening

Cosa dovrebbe fare chi gestisce un'installazione prima, e dopo, che sia raggiungibile da altre
persone. Ogni punto indica l'impostazione o la pagina che lo spiega. La
[panoramica sulla sicurezza](./) spiega perché ciascuno conta.

## Prima della messa in esercizio

- `NODE_ENV=production` su ogni processo.
- `SESSION_SECRET` e `ENCRYPTION_KEY` nuovi e casuali; nessuno dei valori di
  `docker-compose.yml` o di `.env.example` ([Segreti](../admin/installation#segreti)).
- `ENCRYPTION_KEY` conservata in un secret manager, con un backup separato dal database.
- Se si usano agenti locali, un `AGENT_RELAY_SECRET` dedicato, uguale su ogni processo.
- PostgreSQL 15+ con i ruoli che il server verifica: il ruolo di connessione ha `BYPASSRLS`,
  `app_user` no ([Preparare PostgreSQL](../admin/installation#preparare-postgresql)).
- Database inizializzato con `db:migrate`, mai con `db:push`; `npm run db:doctor` non segnala
  nulla da fare.
- TLS davanti al processo web; `SESSION_COOKIE_SECURE` non impostato a `false`.
- Esattamente un reverse proxy davanti, così gli indirizzi registrati dei client sono reali
  ([Dietro un reverse proxy](../admin/installation#dietro-un-reverse-proxy)).
- `CSRF_TRUSTED_ORIGINS` elenca solo le vostre origini pubbliche, se è impostata.
- `INSECURE_TLS_HOSTS` non impostata (in produzione viene comunque ignorata).
- `EGRESS_PRIVATE_TARGETS=deny` su un'installazione condivisa da più aziende, con i pochi
  indirizzi interni che deve raggiungere in `EGRESS_ALLOW_HOSTS` ([Rete](#rete)).
- `MFA_ISSUER` impostato con un nome che identifichi questa installazione.
- Un limite sulla dimensione delle richieste nel reverse proxy non inferiore a quello del
  server: 24 MB per l'import di un bundle di test, 20 MB per il proxy dell'API tester, 12 MB per
  l'import di un test API, 10 MB per un upload Excel (solo `.xlsx`, cancellato dopo la lettura),
  100 kB per ogni altra richiesta JSON.

## Rete {#rete}

Per un SaaS condiviso usare il [profilo di isolamento di rete](../admin/saas-network) fornito.
Impone un'allowlist di domini e porte esatti gestita dall'operatore, un proxy obbligatorio
e namespace protetti per API e worker. Con allowlist vuota nessun target è raggiungibile.
I controlli seguenti valgono anche per deployment con protezioni equivalenti predisposte
dall'operatore.

Dove un test può collegarsi è imposto su due livelli. Il proxy del profilo SaaS è quello della
rete: nulla esce dai worker se non attraverso di esso, qualunque cosa faccia l'applicazione. La
**policy di egress** è quella dell'applicazione, e vale per ogni installazione, con o senza
proxy: ogni indirizzo a cui un test, un webhook, un tracker, uno step del browser o
l'impostazione SMTP di un'organizzazione fa collegare il server è verificato, per nome e per
ciò che il nome risolve al momento della connessione, a ogni redirect. Le connessioni HTTP e
WebSocket si aprono sull'indirizzo verificato; un canale gRPC è fissato agli indirizzi verificati
quando sono di una sola famiglia, mentre un nome che risponde in entrambe (`localhost` su molti
host) è verificato e poi risolto di nuovo dal client gRPC, come per il percorso SMTP. Gli endpoint dei
metadati cloud (`169.254.0.0/16` incluso `169.254.169.254`, `fd00:ec2::254`,
`metadata.google.internal`, `100.100.100.200` di Alibaba, `192.0.0.192` di Oracle,
`168.63.129.16` di Azure) sono sempre rifiutati. Gli indirizzi privati, loopback, link-local e
unique-local sono raggiungibili per default (`EGRESS_PRIVATE_TARGETS=allow`): un'installazione
self-hosted testa la propria intranet dal server, e per lei non cambia nulla.
`EGRESS_PRIVATE_TARGETS=deny` rifiuta anche quelli, ed è l'impostazione per un'installazione
condivisa; `EGRESS_ALLOW_HOSTS` esenta host e CIDR da entrambi. Una richiesta rifiutata fallisce
subito, con un errore che nomina la policy e l'host come lo ha scritto il test. La policy non
copre le connessioni che il server non apre da sé: il browser e le richieste di un agente
locale, il browser di una griglia, e i protocolli TCP diretti (step su database, la casella che
un test legge tramite il browser di un agente).

**I browser del runner** (la run, l'anteprima del builder, il recorder e la detection degli
elementi, che aprono tutti lo stesso tipo di sessione) rispettano la stessa policy su ogni
canale. Ciascuno è verificato in un browser reale da `server/egress-policy-browser.test.ts`:

| Canale                                                                      | Dove si applica la policy                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| URL iniziale, step `navigate`, prima pagina di recorder/detection/anteprima | prima di interpellare il browser: solo `http(s)` e `about:blank`; poi la guardia delle richieste |
| Richieste di pagine, popup, frame, worker dedicati e service worker         | guardia delle richieste nel contesto del browser (403 che nomina la policy)                      |
| WebSocket da una pagina o da un popup                                       | guardia WebSocket nel contesto del browser (chiusa con codice 1008)                              |
| WebSocket o richiesta da un worker, ogni connessione aperta dal browser     | proxy di guardia del runner, sull'indirizzo risolto al momento della connessione                 |
| `file://`, `view-source:` e altre pagine non web                            | rifiutate al salvataggio del test e di nuovo quando la run naviga, in ogni profilo               |

Il proxy di guardia gira nel processo del runner e i browser del runner sono avviati dietro di
esso, loopback compreso. Apre ogni connessione da sé, con gli stessi controlli degli altri
trasporti del server, quindi un nome che risolve verso un indirizzo vietato è rifiutato quando
il browser si collega (DNS rebinding). Con `WFM_EGRESS_PROXY` impostato i browser passano invece
da quel proxy, come prima, e il suo firewall è l'autorità. `file://` è rifiutato qualunque sia
`EGRESS_PRIVATE_TARGETS`: il disco del runner contiene configurazione e chiavi, e una pagina web
non può aprire da sola un file locale (i browser rifiutano quella navigazione). Le destinazioni
private che servono a un'installazione on-premise restano raggiungibili con
`EGRESS_PRIVATE_TARGETS=allow` o `EGRESS_ALLOW_HOSTS`, e i certificati self-signed seguono
`allowsSelfSignedCertificate` come prima.

**Agenti e griglie di browser** eseguono il browser sulla macchina e sulla rete del
proprietario. Lì la policy non si applica, e il controller non promette di controllarlo tramite
il proprio resolver: cosa può raggiungere quel browser lo decide la rete in cui gira, che
configura il proprietario.

- PostgreSQL e Redis non sono raggiungibili da internet; si collegano solo il processo web e i
  worker. Redis richiede una password (`redis://:password@host:6379`).
- Il processo web è l'unico punto di ingresso pubblico. I worker non hanno bisogno di
  connessioni in entrata.
- **Decidete cosa possono raggiungere i worker.** I test si collegano ovunque arrivino i worker.
  Su un'installazione condivisa da più aziende, o con `REGISTRATION=open`, mettete i worker in un
  segmento di rete che raggiunga le applicazioni sotto test e i servizi dell'installazione, e
  nient'altro. In particolare:
  - bloccate dai worker anche l'endpoint dei metadati cloud (`169.254.169.254`), oppure
    richiedete l'accesso ai metadati tramite token (per esempio IMDSv2 su AWS), così la rete non
    dipende dalla sola policy dell'applicazione;
  - non lasciate che i worker raggiungano le interfacce di amministrazione della vostra
    infrastruttura;
  - raggiungete le applicazioni dentro la rete di un cliente con un
    [agente locale](../integrations/local-agents), non aprendo rotte dai worker.
- I worker su altre macchine usano `ARTIFACT_STORE=s3`, e il bucket è privato.

## Accessi

- Registrate voi il primo account dell'installazione, prima che sia raggiungibile da altri:
  finché non esiste, chi si registra per primo diventa owner della prima organizzazione.
- Lasciate `REGISTRATION` al default, `invitation`, a meno che l'installazione non offra la
  registrazione pubblica; invitate le persone da **Impostazioni → Membri**.
- Rendete obbligatoria l'autenticazione a due fattori in ogni organizzazione
  (**Impostazioni → Sicurezza**).
- Dove un'organizzazione ha un identity provider, configurate il
  [single sign-on](../admin/administration#single-sign-on), rendetelo obbligatorio, e chiedete
  il secondo fattore presso il provider. Impostate `WEBFLOW_PUBLIC_URL`, così il redirect URI
  non dipende dall'intestazione `Host` della richiesta.
- Le pipeline usano chiavi API **con scope** su **account di servizio**, con una scadenza; chiavi
  ad accesso completo solo per l'amministrazione, revocate subito dopo. Date `runs:evidence` (trace
  e file HAR) solo a una chiave che deve scaricarli.
- Controllate in **Impostazioni → Chiavi API** le chiavi non usate di recente, e revocatele.
- Tenete pochi owner. Su un'installazione condivisa da più organizzazioni, impostate
  `INSTALLATION_ADMINS` con gli operatori che possono cambiare le impostazioni dei log e
  svuotare i runner
  ([Amministratori dell'installazione](../admin/administration#amministratori-dell-installazione)).
- Lasciate `CONTENT_SECURITY_POLICY` al suo valore di produzione, `enforce`, e i limiti di
  frequenza (`API_RATE_LIMIT`, `WEBHOOK_RATE_LIMIT`) attivi.
- Lasciate `GEMINI_API_KEY` non impostata, a meno che inviare il contenuto delle pagine a Google
  sia accettabile per ogni organizzazione dell'installazione ([Funzioni AI](./#funzioni-ai)).

## Dati

- Backup del database notturni, copiati fuori dall'host, cifrati e verificati con un ripristino: `backup:verify` dopo ogni `backup:create`
  ([Backup](../admin/operations#backup)).
- Cifratura a riposo di dischi, database e bucket, come la offre la vostra piattaforma.
- `ARTIFACT_RETENTION_DAYS` impostato a ciò che serve alle vostre organizzazioni, non di più.
- Trace disattivate, e video al massimo quando il test fallisce, per i flussi che usano
  credenziali reali o dati personali; screenshot, video e trace non vengono ripuliti dai segreti
  ([Evidenze grezze](./data-protection#evidenze-grezze)).
- Dopo l'aggiornamento da una release in cui i viewer potevano scaricare le trace o le migrazioni
  stampavano `DATABASE_URL`: la
  [procedura per le credenziali esposte](./data-protection#credenziali-esposte), con
  cancellazione e rotazione approvate dal responsabile.
- Conservazione dei log in **Impostazioni → Sistema** scelta consapevolmente; log inviati a un
  archivio centrale (`LOKI_URL` o il collector della vostra piattaforma) se devono sopravvivere
  alla macchina.
- Una procedura per completare la cancellazione di un'organizzazione: file nell'archivio degli
  artefatti e backup ([Protezione dei dati](./data-protection#cosa-raggiunge-la-cancellazione)).

## Esercizio

- Aggiornamenti applicati presto, svuotando prima i runner
  ([Aggiornamento](../admin/operations#aggiornamento)).
- Sistemi operativi degli host e immagini base dei container aggiornati.
- `npm audit` rivisto a ogni aggiornamento, con le decisioni registrate in
  `docs/SECURITY-AUDIT.md`.
- Il registro di audit rivisto dagli owner di ogni organizzazione, in particolare accessi
  falliti, nuove chiavi API, nuovi owner e modifiche alle impostazioni di sicurezza.
- Allarmi sull'healthcheck del processo web e sui runner che vanno offline
  ([Monitoraggio](../admin/operations#monitoraggio)).
