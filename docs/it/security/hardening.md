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
- `MFA_ISSUER` impostato con un nome che identifichi questa installazione.

## Rete {#rete}

- PostgreSQL e Redis non sono raggiungibili da internet; si collegano solo il processo web e i
  worker. Redis richiede una password (`redis://:password@host:6379`).
- Il processo web è l'unico punto di ingresso pubblico. I worker non hanno bisogno di
  connessioni in entrata.
- **Decidete cosa possono raggiungere i worker.** I test si collegano ovunque arrivino i worker.
  Su un'installazione condivisa da più aziende, o con `REGISTRATION=open`, mettete i worker in un
  segmento di rete che raggiunga le applicazioni sotto test e i servizi dell'installazione, e
  nient'altro. In particolare:
  - bloccate dai worker l'endpoint dei metadati cloud (`169.254.169.254`), oppure richiedete
    l'accesso ai metadati tramite token (per esempio IMDSv2 su AWS);
  - non lasciate che i worker raggiungano le interfacce di amministrazione della vostra
    infrastruttura;
  - raggiungete le applicazioni dentro la rete di un cliente con un
    [agente locale](../LOCAL_AGENT), non aprendo rotte dai worker.
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
  ad accesso completo solo per l'amministrazione, revocate subito dopo.
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

- Backup del database cifrati e verificati con un ripristino
  ([Backup](../admin/operations#backup)).
- Cifratura a riposo di dischi, database e bucket, come la offre la vostra piattaforma.
- `ARTIFACT_RETENTION_DAYS` impostato a ciò che serve alle vostre organizzazioni, non di più.
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
