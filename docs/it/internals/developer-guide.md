# Guida sviluppatore

Come preparare un ambiente di sviluppo, eseguire e testare il prodotto, e modificarlo senza rompere le
garanzie descritte nel resto di questa documentazione.

## Prerequisiti

- **Node.js 20 o successivo** e npm.
- **Redis o Valkey** su `localhost:6379` per le code (basta `docker compose up -d redis`).
- **PostgreSQL 15+** solo se si vuole sviluppare su di esso; altrimenti si usa automaticamente PGlite
  (Postgres in WebAssembly, in una cartella locale).
- I browser di Playwright: `npx playwright install` (almeno Chromium; Firefox e WebKit per i test sulla
  matrice).

## Primo avvio

```bash
npm install                       # radice e workspace del client
cp .env.example .env              # poi imposta SESSION_SECRET ed ENCRYPTION_KEY
npm run db:migrate                # crea lo schema, il ruolo app_user e le policy RLS
npm run dev                       # processo web su http://localhost:5000, client tramite Vite
npm run dev:worker                # in un secondo terminale: esegue piani e task browser
```

`ENCRYPTION_KEY` deve essere di 64 caratteri esadecimali. Si generano entrambi i segreti con
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Con `DATABASE_URL=./data/local-pg` il database è una cartella PGlite. Con un URL `postgres://` è
PostgreSQL; il ruolo della connessione deve possedere le tabelle e poter fare `SET ROLE app_user` (le
migrazioni lo concedono). `npm run db:doctor` dice in che stato è lo schema e cosa eseguire.

::: warning Non usare `db:push`
`drizzle-kit push` crea le tabelle senza registrare le migrazioni e senza le policy di row-level
security; `db:migrate` poi fallisce sulla prima tabella già esistente. Usa solo `db:migrate`.
:::

Per lavorare sul builder senza un worker, imposta `BROWSER_TASKS=inline`: anteprime e rilevazione degli
elementi girano allora nel processo web. La registrazione apre sempre la sua finestra sulla macchina che
esegue il processo web.

## Comandi di tutti i giorni

| Comando | Cosa fa |
|---|---|
| `npm run dev` / `npm run dev:worker` | Processo web / worker, con `tsx` e `.env`. |
| `npx tsc -b` | Controllo dei tipi di server, client, codice condiviso e script. |
| `npm run lint` | ESLint su `.ts` e `.tsx`. |
| `npx vitest run --config vitest.config.ts` | Test del server e degli script. |
| `npm run test:client -- --run` | Test del client. |
| `npm run test:rls` | Solo i test di tenancy e isolamento. |
| `npm run build` | Bundle di client, server, worker, migrator, CLI e agente in `dist/`. |
| `npm run docs:dev` / `npm run docs:build` | Questo sito di documentazione: in diretta / build verificata. |
| `npm run cli -- run <planId> --wait` | La CLI per pipeline contro il server locale. |
| `npm run agent` | Un agente locale contro il server locale (`WFM_URL`, `WFM_AGENT_TOKEN`). |

Prima di un commit devono passare tutti e quattro i controlli: `tsc -b`, `lint`, i test del server e i
test del client (e `docs:build` quando cambia la documentazione).

## Come funzionano i test

### Server

- Vitest esegue ogni file di test in un processo proprio con il **proprio database PGlite in memoria**;
  `server/tests/setup.ts` vi applica prima tutte le migrazioni. I file girano quindi in parallelo senza
  condividere stato.
- I test delle rotte costruiscono una piccola app Express con il router da testare, un `req.user` finto
  e `runWithTenant` attorno alla richiesta, poi la chiamano con **supertest**.
- Le factory in `server/tests/factories.ts` creano organizzazioni e utenti; il resto si inserisce nel
  test con `privilegedDb`.
- Il codice che parla con il mondo esterno si testa contro **finti server HTTP reali** (un server locale
  che fa da GitHub, Jira o intranet), non contro mock di `fetch`, così si esercita la richiesta vera.
- Dove conta il browser, i test usano **Chromium reale**: l'esecutore degli step, il relay e gli agenti
  sono testati end-to-end.
- Nei file che importano moduli che usano il logger, simulalo:
  `vi.mock('./logger', () => ({ default: Promise.resolve({ info: vi.fn(), ... }) }))`.

### Test di architettura

Alcuni test proteggono proprietà che nessun test di funzionalità noterebbe. Quando uno fallisce ti sta
chiedendo di rendere esplicita una decisione, non di aggirarlo:

| Test | Protegge |
|---|---|
| `server/tests/architecture.test.ts` | Le rotte non importano l'handle privilegiato; ogni file che lo fa resta nel suo `PRIVILEGED_BOOTSTRAP_BUDGET`; l'immagine Playwright di ogni Dockerfile coincide con la versione bloccata di Playwright; il lockfile descrive ogni piattaforma; i servizi compose indicano Dockerfile esistenti. |
| `server/tests/isolation.test.ts` | Ogni tabella in `ORG_SCOPED_TABLES` ha la RLS e nasconde le righe delle altre organizzazioni. |
| `server/test-suites.test.ts` (deriva) | Ogni foreign key fra tabelle per organizzazione è protetta come stessa organizzazione o dichiarata come paternità. |
| `server/execution-snapshot.test.ts` | Ogni colonna di `test_plans` è catturata nello snapshot del run o dichiarata irrilevante per un run. |
| `server/api-v1/openapi.test.ts` | Il documento OpenAPI e il router `/api/v1` coincidono, rotta per rotta e scope per scope. |
| `server/audit-trail.test.ts` | Ogni azione e categoria di audit ha un'etichetta in tutte e quattro le lingue. |
| `client/src/locales/locales.test.ts` | Le traduzioni sono complete e coerenti, e ogni chiave usata dal codice esiste. |

### Test lenti o sensibili

I test con browser reale durano secondi ciascuno e possono rallentare durante un'esecuzione completa in
parallelo. Verifica ciò che il codice ha deciso (il messaggio, lo stato), mai durate misurate
sull'orologio che includono l'avvio di un browser.

## Convenzioni

### Codice

- **Spiega il perché, non il cosa.** I moduli e le funzioni non ovvie si aprono con un commento che dice
  cosa decide il codice e cosa non funzionava senza. Rispetta densità e stile dei commenti circostanti.
- **Separa le decisioni dagli effetti.** Metti le regole in un modulo puro (senza database e senza rete)
  e testalo direttamente; tieni sottile il modulo che tocca il mondo esterno.
- **Gli errori sono frasi** su cui un utente può agire, e gli effetti collaterali (notifiche, issue,
  stati, upload) non fanno mai fallire un run: restituiscono un esito e registrano nel log.
- **Non restituire mai un segreto** dall'API, e mostra un token generato solo nella risposta che lo ha
  creato.
- Usa i tipi condivisi in `shared/` per tutto ciò che leggono entrambe le parti (stati, schemi, id delle
  azioni).

### Migrazioni del database

Le migrazioni sono **SQL scritto a mano** in `migrations/NNNN_nome.sql`, ognuna con una voce in
`migrations/meta/_journal.json` (`idx` = il numero, `when` = un timestamp successivo alla voce
precedente, `tag` = il nome del file senza estensione). Le istruzioni sono separate da
`--> statement-breakpoint`. Si apre con un commento che spiega a cosa serve la modifica.

Una nuova **tabella per organizzazione** richiede, nella stessa migrazione:

1. `organization_id integer NOT NULL REFERENCES organizations(id)` e un indice su di essa;
2. `ENABLE` e `FORCE ROW LEVEL SECURITY`, la policy `org_isolation` e i permessi che servono ad
   `app_user` (senza `DELETE` quando le righe sono evidenze);
3. la tabella aggiunta a `ORG_SCOPED_TABLES` in `shared/schema.ts`;
4. ogni foreign key verso un'altra tabella per organizzazione protetta come stessa organizzazione o
   elencata come paternità nel test di deriva.

Riporta la tabella in `shared/schema.ts` (Drizzle) con un commento che la spiega. Applica con
`npm run db:migrate`; i test applicano tutte le migrazioni a ogni database di test.

### API

- Le rotte stanno in `server/routes/<area>.routes.ts` e si montano in `server/routes.ts`.
- Proteggi ogni rotta con `requireRole(...)`; esegui le query dentro `withTenantTransaction`.
- Valida i body con zod e rispondi `400` con `details` in caso di errore.
- Registra le modifiche rilevanti per la sicurezza con `recordAudit(tx, …)` nella stessa transazione, e
  aggiungi l'azione ad `AUDIT_ACTIONS` con le etichette nelle quattro lingue.
- L'**API pubblica** è solo `/api/v1` (`server/routes/api-v1.routes.ts`): risposte con forma esplicita,
  errori come `{ error: { code, message } }`, uno scope su ogni endpoint, e il documento OpenAPI in
  `server/api-v1/openapi.ts` aggiornato nella stessa modifica.

### Client

- Ogni stringa visibile passa da `t('area.chiave', 'Testo inglese')`, con la chiave aggiunta a tutte e
  quattro le traduzioni (vedi [Client web](./frontend#internazionalizzazione)).
- Lo stato del server passa da TanStack Query; invalida le chiavi di query toccate da una mutazione.
- Nascondi ciò che il ruolo dell'utente non consente, ma non contarci mai: decide il server.

### Dipendenze

`npm install` su Windows elimina le voci opzionali `@emnapi/*` da `package-lock.json`, e questo rompe le
installazioni su Linux; il test di architettura lo intercetta. Dopo aver aggiunto una dipendenza su
Windows, ripristina quelle voci dal lockfile committato prima del commit.

La versione di Playwright è fissata in tre punti: `package-lock.json`, la riga `FROM` di ogni Dockerfile
e la compatibilità dell'agente (major.minor). Si aggiornano insieme.

## Aggiungere una funzionalità: checklist

1. Schema e migrazione (con RLS se per organizzazione), e la decisione nel test dello snapshot se hai
   aggiunto una colonna di piano che il runner legge.
2. Modulo puro delle decisioni con i suoi test; modulo sottile con effetti, testato contro finti server.
3. Rotte con ruoli, validazione, tenancy, audit; `/api/v1` e OpenAPI se servono alle pipeline.
4. Client: componenti, traduzioni nelle quattro lingue, test.
5. Documentazione: la guida pertinente in `docs/en` e `docs/it`, e il sito si compila.
6. `tsc -b`, `lint`, test del server, test del client — tutti verdi — poi un commit con un messaggio che
   spiega la modifica in prosa.

## Documentazione

Questo sito sta in `docs/` ed è costruito con VitePress. Le pagine in inglese sono in `docs/en`, quelle
in italiano in `docs/it`, pagina per pagina con gli stessi nomi di file; la barra laterale è in
`docs/.vitepress/config.mts`. I diagrammi sono blocchi di codice Mermaid. `npm run docs:build` fallisce
su un link rotto.
