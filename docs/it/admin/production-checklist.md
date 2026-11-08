# Checklist per la produzione

I valori predefiniti favoriscono un avvio rapido su una macchina. Prima di esporre un'installazione agli utenti, percorri questa lista. All'avvio il server scrive anche un avviso, una sola volta, quando `NODE_ENV=production` e la policy di egress è rimasta al valore predefinito.

## Allowlist di egress

I test fanno collegare il server ai sistemi sotto test. Per impostazione predefinita (`EGRESS_PRIVATE_TARGETS` non impostata, equivale a `allow`) i test raggiungono loopback e indirizzi privati della rete del server; gli endpoint metadata del cloud sono sempre rifiutati. Va bene per una sola azienda che testa la propria intranet, non per un'installazione condivisa.

- Imposta `EGRESS_PRIVATE_TARGETS=deny` ed elenca in `EGRESS_ALLOW_HOSTS` gli host intranet raggiungibili dai test (`*.suffisso` per un sottoalbero, CIDR ammessi).
- Con `REGISTRATION=open` il server non parte se il valore non è `deny`.
- Per un deployment completamente isolato vedi [Isolamento di rete per un SaaS condiviso](./saas-network).

## TLS e reverse proxy

- Termina il TLS su un reverse proxy e imposta `WEBFLOW_PUBLIC_URL` sull'indirizzo pubblico `https://`.
- Imposta `TRUST_PROXY` sulla catena reale di proxy (numero di hop, `false` se assente, oppure IP/CIDR dei proxy), altrimenti IP client e rate limit per IP si possono falsificare.
- Non usare `INSECURE_TLS_HOSTS` in produzione.

## Segreti

- Genera i tuoi `SESSION_SECRET`, `ENCRYPTION_KEY` (`openssl rand -hex 32`) e `AGENT_RELAY_SECRET`; i segnaposto di `.env.example` bloccano l'avvio in produzione.
- Tienili fuori dal repository e pianifica la rotazione: [Rotazione della chiave di cifratura](./operations#rotating-the-encryption-key).

## Backup

Pianifica lo strumento di backup e prova un ripristino: [Backup](./operations) e la prova di ripristino completo.

## Conservazione

Imposta `ARTIFACT_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS`, `EVIDENCE_RETENTION_DAYS` e `LOG_RETENTION_DAYS` secondo la tua policy: [Riferimento della configurazione](./configuration).

## Single sign-on

Configura l'SSO per organizzazione e lascia attiva `SSO_REQUIRE_DOMAIN_VERIFICATION`: [Amministrazione](./administration). Definisci `INSTALLATION_ADMINS` e sappi come [recuperare l'accesso](./operations#recovering-access).

## Variabili obbligatorie

`DATABASE_URL` (PostgreSQL), `REDIS_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `NODE_ENV=production`, `WEBFLOW_PUBLIC_URL`. Elenco completo: [Riferimento della configurazione](./configuration). Vedi anche [Hardening di sicurezza](../security/hardening).
