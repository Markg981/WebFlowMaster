# Collaborazione: evidenze locali del 4 ottobre 2026

Branch: `codex/collaboration-dashboards`, da main dopo il merge della PR 290. Migrazione additiva `0076_collaboration`; catalogo versione 20 con otto nuovi casi COL-01–COL-08 (452 casi complessivi). Le definizioni e gli esiti dei cicli Collaudo precedenti rimangono conservati.

## Installazione reale

Prova su database PostgreSQL 16 dedicato `wfm_ci_e2e`, ruolo applicativo non-superuser, `app_user` senza BYPASSRLS, Redis dedicato e bundle di produzione API/worker. Nessun mock degli endpoint o inserimento diretto di dati per i percorsi browser. Utenti creati tramite registrazione e invito reale.

`npm run test:e2e`: **5/5 pass**, 48,7 secondi.

- Registrazione, logout, login e persistenza della sessione.
- Test API creato dall’interfaccia, ricaricato ed eseguito contro il target HTTP reale.
- Conversazione API con menzione del membro, risposta, risoluzione, ricaricamento, riapertura e filtro menzioni.
- Dashboard aggiuntiva con due istanze Report, titolo, periodo e limite; condivisione, predefinita persistita, lettura da un viewer invitato e duplicazione privata modificabile.
- Piano avviato nell’interfaccia, eseguito dal worker e risultato persistito letto nel report.

## Isolamento e regressioni

- PostgreSQL reale: **41 test RLS preesistenti e 48 test di collaborazione/analytics pass**.
- Client: **459/459 test pass**, inclusa parità traduzioni EN/IT/FR/DE.
- Migrazione di layout preesistente: ordine, visibilità, preferenze e testo dei commenti conservati.
- Test mirati server, vincoli, architettura e rimozione membri: pass dopo le correzioni di integrazione emerse dalla prima suite completa. La riesecuzione completa finale è demandata alla CI della PR.
- Typecheck e build applicativa: pass. Documentazione EN/IT: build pass.
- Lint: zero errori nel codice di progetto, dieci warning preesistenti; escluse le directory locali non versionate `tmp`, `outputs`, `.claude`.
- Applicazione Collaudo: **13/13 pass**; policy/readiness di rete: **11/11 pass**.
- Revisione indipendente: nessun rilievo aperto dopo le correzioni di conferma eliminazione e attribuzione del progetto dei run congelati.

Queste sono evidenze dell’installazione di prova dedicata. I nuovi casi manuali non sono stati marcati automaticamente come eseguiti nell’istanza Collaudo esistente e non sono stati modificati i suoi volumi o dati.
