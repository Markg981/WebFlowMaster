# Email per organizzazione: protocollo del 4 ottobre 2026

Branch `codex/email-provider-templates`, migrazione additiva `0077_organization_mail`. Catalogo versione 21: otto nuovi casi ADM-21–ADM-28, 460 casi complessivi. Le 452 definizioni precedenti e gli esiti dei cicli esistenti sono conservati. I nuovi casi manuali rimangono **Da eseguire**; le suite automatiche non assegnano risultati nel Collaudo.

## Prerequisiti

- Due organizzazioni con owner distinti ed editor/viewer; API e worker aggiornati con la stessa ENCRYPTION_KEY persistente.
- Relay SMTP TLS di prova, mittenti/destinatari controllati. Nel deployment hardened autorizzare host e porta SMTP al proxy CONNECT; nessun bypass diretto.
- Callback su origine HTTPS pubblica e stabile. SendGrid richiede la chiave pubblica di verifica Event Webhook; Mailgun la chiave di firma webhook; SES/SNS l’ARN esatto del topic e gli header originali abilitati nelle notifiche.
- SES/SNS, SendGrid e Mailgun hanno adattatori nativi. Per altri provider usare l’adattatore di eventi generici normalizzati HMAC. L’endpoint globale preesistente resta compatibile.

## Evidenze locali

Verifiche locali: typecheck pass; lint senza errori (10 warning preesistenti); client 468/468 pass; isolamento su PostgreSQL reale 107/107 pass; sei percorsi browser su installazione di produzione 6/6 pass, inclusi modifica/preview/reload dei modelli e isolamento tra due organizzazioni; build applicativa, build documentazione e Collaudo 13/13 pass. La suite server completa ha rilevato tre problemi corretti (etichette audit, accesso tenant e conservazione del link reset con SMTP disabilitato); le verifiche interessate sono state rieseguite con 47/47 e 48/48 pass. La CI completa sul commit della PR rimane il controllo finale.

I test degli adattatori usano firme e payload sintetici; il test SMTP verifica anche il proxy CONNECT con un server TCP locale. Una consegna effettiva richiede account e credenziali del provider dell’organizzazione e va annotata separatamente. Nessun invio esterno è stato eseguito per preparare questi casi. Nessun caso manuale nuovo è marcato come superato.

Per ogni esecuzione manuale registrare commit/ambiente, ID del caso, atteso/ottenuto e correlation ID senza segreti, token account o corpi email. Un prerequisito assente è un blocco di ambiente/configurazione, non un pass né una conferma di consegna.
