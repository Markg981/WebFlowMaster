# Percorso di contribuzione

Usare questa pagina con il [manuale della suite](./suite-handbook) e la
[guida sviluppatore](./developer-guide). Mostra come attraversare i livelli esistenti con un
miglioramento piccolo e come estendere il metodo a nuove definizioni o capacità di esecuzione.
L'esempio è un esercizio di progetto, non una funzionalità già implementata.

## Partire da un comportamento osservabile

Richiesta di esempio: **un editor aggiunge una descrizione a un tag, e i colleghi la leggono nel
selettore dei tag**. Una rinomina la conserva; un viewer non può modificarla; un'altra organizzazione
non può leggerla. La descrizione non cambia la selezione dei test né cosa esegue un run già accodato.

Concordare lunghezza massima, conversione del testo vuoto in `null`, luogo di modifica e conservazione
della descrizione quando la creazione per nome trova un tag esistente. `POST /api/tags` è già
idempotente sul nome normalizzato: risponde `201` alla creazione e `200` per un tag esistente.
Conservare questo contratto salvo una modifica intenzionale della richiesta. Un autocomplete non
deve sovrascrivere implicitamente la descrizione di un collega.

## Seguire l'implementazione prima di modificare

| Livello            | File esistente                                                      | Cosa capire                                                         |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Contratto salvato  | `shared/schema.ts` (`tags`, `testTags`)                             | Organizzazione, nomi e tipi dei collegamenti                        |
| Logica di dominio  | `server/test-tags.ts`                                               | Normalizzazione nomi e assegnazioni                                 |
| API di sessione    | `server/routes/tags.routes.ts`                                      | Lettura viewer, scrittura editor, zod, gestione duplicati e race    |
| Assemblaggio route | `server/routes.ts`                                                  | Router già montato: estenderlo non richiede un nuovo mount          |
| UI riusabile       | `client/src/components/tags/TagPicker.tsx`                          | Props controllate; il componente non possiede tutte le chiamate API |
| Consumatori        | Cercare `TagPicker` in `client/src`                                 | Pagine/dialoghi che passano dati e mutazioni                        |
| Test esistenti     | `server/routes/tags.routes.test.ts`, `server/test-tags.test.ts`     | Fixture HTTP/tenant e aspettative sulla normalizzazione             |
| Sicurezza          | `server/middleware/tenancy.ts`, `server/middleware/require-role.ts` | Visibilità dati distinta dal permesso di agire                      |

Usare `rg -n "TagPicker|/api/tags" client/src server` per trovare i consumatori. Seguire una lettura
e una scrittura complete: aggiungere un campo allo schema non lo rende disponibile al componente,
e una nuova prop non lo rende persistente.

## Implementare l'esempio da un capo all'altro

1. Aggiungere una colonna testo nullable alla definizione Drizzle `tags` e una migrazione SQL
   additiva scritta a mano. Scegliere l'indice successivo dal journal, aggiungere la voce in
   `migrations/meta/_journal.json` e separare con `--> statement-breakpoint`. Le righe esistenti
   devono restare valide. Una descrizione su una tabella già protetta da RLS non richiede una
   nuova policy; una nuova tabella di organizzazione sì.
2. Estendere select e risposte esplicite per GET, POST e PUT. Validare lunghezza e normalizzazione
   nella request. Conservare autenticazione, `requireRole`, transazione tenant, duplicati ed errori
   utili. Conservare i campi precedenti. Decidere esplicitamente l'audit; una nuova azione va
   registrata nella stessa transazione e tradotta in tutte le lingue. Non affermare che tutte le
   route tag esistenti registrano già un audit.
3. Estendere i tipi API dei consumatori reali e le props di `TagPicker`. Mostrare descrizioni
   leggibili senza cambiare la selezione. Collocare l'editing nel form/dialogo dell'editor,
   gestire attesa ed errori e invalidare le query TanStack appropriate dopo il salvataggio.
   Non introdurre una cache di storage separata nel picker.
4. Aggiungere etichette/errori a `client/src/locales/en`, `it`, `fr` e `de` con la struttura
   esistente. Nascondere i controlli al viewer aiuta l'usabilità; il server deve comunque
   respingere una richiesta di scrittura costruita manualmente.
5. Aggiungere test route significativi: persistenza su seconda richiesta, conservazione del tag
   esistente, input troppo lungo, viewer negato e invisibilità tra organizzazioni. Testare lettura
   e modifica nel componente consumatore che le possiede. Verificare un database migrato; includere
   PostgreSQL reale quando cambia il confine di ownership/query.
6. Aggiornare [organizzazione dei test](../guide/organizing) in entrambe le lingue con posizione e
   comportamento precisi. Aggiungere un caso Collaudo crea → assegna → ricarica → rinomina → leggi
   come viewer e un caso con seconda organizzazione. Registrare risultati effettivi dopo l'esecuzione.

In questo esempio lo snapshot del piano e le unità non richiedono il nuovo campo: la descrizione
non influenza il verdetto. È una decisione di progetto esplicita, non un'esenzione dal controllo
dello snapshot per campi letti dal runner.

## Quando cambia l'esecuzione

Seguire il contratto completo: validazione condivisa → salvataggio/versione → selezione/snapshot
del piano → unità → esecuzione → risultato/evidenze → report/export. Una nuova azione mobile
appartiene a contratto/editor/runner mobile e relativi test, non all'executor browser. Una capacità
BDD richiede lavoro sul profilo operatore e contratto agente/runtime. Un'opzione di protocollo
appartiene alla configurazione nativa e ai test del trasporto, incluso il percorso remoto supportato.

Controllare pubblicazione, dataset, suite, matrici browser/lingue/dispositivi, retry, cancellazione,
quote e redazione. `execution-snapshot.test.ts` richiede una decisione per ogni nuova colonna del
piano. `execution-state.ts` resta proprietario delle transizioni legali. Le catene di estrazioni API
devono conservare l'ordine di dipendenza dopo una modifica della concorrenza.

Se serve alla pipeline, estendere insieme `server/routes/api-v1.routes.ts` e
`server/api-v1/openapi.ts`, con scope delle key ed errori documentati. Una nuova route autenticata
`/api/...` non basta come contratto pubblico. Aggiornare CLI/template solo se i consumatori
richiedono la capacità nuova.

## Comandi e valore delle verifiche

Questi comandi sono dichiarati nei manifest root/client. Partire dai test mirati; i controlli
completi richiesti restano il gate di integrazione finale. Le istruzioni non indicano che i comandi
siano già passati sulla propria modifica.

```sh
npm install
npm run db:migrate
npm run dev
# Secondo terminale, con lo stesso ambiente:
npm run dev:worker
```

Preparare `.env`, segreti, Redis e Playwright secondo la [guida sviluppatore](./developer-guide).
Usare `db:migrate`, mai `db:push`, per questo flusso. Non azzerare database condivisi o volumi di
accettazione dei colleghi per ottenere un test positivo.

| Comando                                                                     | Evidenza ottenuta                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `npx vitest run server/routes/tags.routes.test.ts server/test-tags.test.ts` | Comportamento mirato dell'esempio sul database dei test configurato   |
| `npm run test:client -- --run`                                              | Test client, inclusa coerenza delle traduzioni                        |
| `npm run check`                                                             | Progetti TypeScript, tipi Collaudo/E2E e runtime BDD                  |
| `npm run lint`                                                              | Regole lint del repository                                            |
| `npm test`                                                                  | Suite Vitest root e suite separata runtime BDD                        |
| `npm run test:rls`                                                          | Gate di isolamento PostgreSQL reale; richiede `DATABASE_URL` adeguato |
| `npm run test:collaudo`                                                     | Test dell'app Collaudo, non intero catalogo di accettazione           |
| `npm run build`                                                             | Bundle client/server/worker/migrator/CLI/agente e child BDD           |
| `npm run docs:build`                                                        | Generazione VitePress e validazione link                              |
| `npm run test:e2e`                                                          | Smoke dell'interfaccia sull'installazione reale dedicata              |

Per E2E usare database/porte Redis dedicati e prerequisiti di build della guida sviluppatore.
Per accettazione seguire il [laboratorio](../admin/test-lab), preparando provider/agenti/dispositivi.
La build prova il packaging; un fake HTTP prova il contratto esercitato dal test; solo il percorso
sul provider reale prova quella specifica integrazione installata.

## Rendere la modifica revisionabile

Descrivere trigger ed esito, tipi e permessi coinvolti, compatibilità della migrazione, test realmente
eseguiti e accettazione live ancora da fare. Includere evidenza concreta degli errori. Conservare il
lavoro locale estraneo. Documentare la procedura operativa se servono aggiornamento agente, segreto,
backfill o configurazione nuova.

Mantenere nomi e link delle pagine EN/IT accoppiati. Tradurre il comportamento, non solo i titoli.
Controllare esempi, export e diagrammi quando cambia il significato dei campi. Aggiornare un decision
record quando si introduce un confine o tradeoff; usare le guide esistenti per istruzioni ordinarie.
