# Automazione dei percorsi UI critici

La suite `npm run test:e2e` aggiunge nove scenari ai nove d'installazione e a quello BDD:
19 percorsi Chromium sui bundle produttivi, con PostgreSQL, Redis e worker dedicati.
Le istruzioni di esecuzione sono nelle guide sviluppatore EN/IT.

La pagina Collaudo include l'area **Percorsi UI critici**, casi **AUT-01…AUT-09**
nello stesso ordine della tabella seguente. Il protocollo **32** contiene **555 casi in
25 aree**. Riavviare `npm run dev:collaudo` e scegliere **Catalogo attuale** per consultarli;
creare un nuovo ciclo per registrarne gli esiti, inizialmente **Da eseguire**.

| Spec/scenario                               | Casi manuali correlati | Parte verificata automaticamente                                                                                                  |
| ------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `security.spec.ts`: MFA                     | MFA-01, MFA-03, MFA-05 | Attivazione da UI, rifiuto di un codice errato (non del limite di cinque tentativi), accesso con recovery e rifiuto del suo riuso |
| `security.spec.ts`: OIDC                    | SSO-01, SSO-02         | Configurazione persistente, redirect HTTPS, callback con token firmato, sessione e permessi viewer                                |
| `security.spec.ts`: dominio sconosciuto     | SSO-05                 | Errore visibile e pagine protette ancora dietro login                                                                             |
| `critical-workflows.spec.ts`: review        | LIB-04                 | Editor richiede, autore e viewer non approvano, altro membro approva e pubblica                                                   |
| `critical-workflows.spec.ts`: pubblicazione | LIB-03                 | Pubblicazione da storico persistente dopo ricaricamento                                                                           |
| `critical-workflows.spec.ts`: editor mobile | MOB-01, MOB-05, MOB-33 | Passi e matrice dispositivo/OS persistenti; viewer legge storico senza modifica, restore o pubblicazione                          |
| `critical-workflows.spec.ts`: eliminazione  | MOB-05                 | Annullare la conferma conserva il test; confermarla lo elimina anche dopo reload                                                  |
| `critical-workflows.spec.ts`: quote         | QUO-02, QUO-11, QUO-12 | Amministratore salva enforce, soglia raggiunta, creazione rifiutata; owner ordinario/editor non amministrano le quote             |
| `critical-workflows.spec.ts`: annullamento  | PLN-10                 | Conferma dal report, stato cancelled persistente, test successivo skipped                                                         |

Questa è una mappa di copertura parziale, non un esito dei casi manuali: non aggiorna cicli
storici né marca automaticamente alcun caso come superato. I casi restano da eseguire nel ciclo
manuale pertinente. Dispositivi Android/iOS, Appium, SAML, DNS, gruppi del provider e tutte le
dimensioni delle quote richiedono le rispettive prove di accettazione.

Le richieste al prodotto non sono intercettate. Inviti e preparazione del piano da annullare
usano le API reali; le azioni sotto verifica sono UI. Il provider OIDC esterno locale verifica
client, redirect e PKCE e firma i token con nonce. Certificato e chiave della fixture sono
materiale pubblico di test; non usarli in un'installazione ordinaria.
