# Client web

Il client web è un'applicazione React a pagina singola in `client/`, con `package.json`, build Vite e
configurazione Vitest propri. In sviluppo Vite lo serve attraverso il processo web (`server/vite.ts`);
in produzione il processo web serve i file compilati da `dist/public` (`server/static.ts`).

## Struttura

```
client/src/
  main.tsx            avvia React e i18n
  App.tsx             provider, rotte, lingua dalle impostazioni dell'utente
  pages/              un componente per rotta
  components/         componenti per funzionalità, raggruppati per area (settings, reports, suites,
                      tests, scheduling, api-tester, visual-builder, dashboard, layout, security, tags)
  components/ui/      il design system: primitive shadcn/Radix con stile Tailwind
  hooks/              use-auth, use-theme, use-toast, hook di registrazione ed esecuzione dei test
  lib/                queryClient (wrapper di fetch), protected-route, helper per l'API, schemi
  locales/            traduzioni (en, it, fr, de) e i loro test
  observability/      logger del client, correlation id, error boundary (sviluppo)
```

## Rotte

Le rotte sono dichiarate in `client/src/App.tsx` con **wouter**; le pagine si caricano in modo lazy.
Tutte le rotte tranne `/auth` sono avvolte in `ProtectedRoute`, che manda un visitatore anonimo alla
pagina di accesso.

| Percorso | Pagina | Cos'è |
|---|---|---|
| `/` , `/dashboard` | `DashboardOverviewPage` | Panoramica dell'attività e dei risultati recenti. |
| `/dashboard/create-test` | `dashboard-page-new` | Il builder dei test: caricamento della pagina, elementi rilevati, step con drag-and-drop, registrazione, descrizione a frasi, anteprima. |
| `/dashboard/api-tester` | `ApiTesterPage` | Costruire e inviare richieste API, asserzioni, estrazioni, test API salvati. |
| `/tests` | `TestLibraryPage` | Tutti i test salvati, tag, cronologia e versioni. |
| `/reviews` | `ReviewsPage` | Revisioni dei test, quando l'organizzazione le richiede. |
| `/test-suites` | `TestSuitesPage` | Piani di test: creare, configurare, eseguire. |
| `/suites` | `SuitesPage` | Suite, statiche e dinamiche. |
| `/scheduling` | `SchedulingPage` | Schedulazioni. |
| `/test-manager` | `TestManager` | Import da Excel collegato a sequenze salvate. |
| `/reports` | `GeneralReportsPage` | L'elenco dei run con filtri, test instabili e quarantena. |
| `/test-plan/:planId/run` | `TestPlanExecutionPage` | Un run mentre accade, con la console in diretta. |
| `/test-plans/:planId/executions/:executionId/report` | `TestReportPage` | Il report di un run. |
| `/settings` | `settings-page` | Le impostazioni, divise in sezioni (account, ambienti, progetti, membri, chiavi API, sicurezza, runner, agenti, GitHub/GitLab, issue tracker, audit log…). |
| `/auth` | `auth-page` | Accesso e registrazione su invito. |

## Recupero dei dati

Lo stato del server vive in **TanStack Query**. `lib/queryClient.ts` fornisce la funzione di query
predefinita e `apiRequest`, che:

- inviano i cookie (la sessione) a ogni richiesta;
- aggiungono gli header di correlazione (`X-Correlation-Id`, `X-Wfm-Session-Id`), così un'azione
  nell'interfaccia e il lavoro che provoca sul server condividono un id nei log;
- trasformano una risposta non 2xx in un `ApiError` che porta lo stato e il body interpretato, così chi
  chiama può reagire a un `409` o a un `403` senza analizzare stringhe.

In alcuni punti (le card delle impostazioni) i componenti chiamano `fetch` direttamente; entrambi gli
stili usano lo stesso cookie di sessione. Le chiavi di query prendono il nome dalla risorsa (`['agents']`,
`['sourceHosts']`, `['/api/tests']`) e vengono invalidate dopo le mutazioni.

## Autenticazione nel client

`hooks/use-auth.tsx` espone l'utente corrente (`/api/user`), accesso, uscita e registrazione. Quando il
server risponde che serve il secondo fattore, la pagina di accesso chiede il codice. I componenti
nascondono ciò che il ruolo dell'utente non consente (per esempio le prop `isOwner` delle card delle
impostazioni); il server lo impone comunque.

## Aggiornamenti in diretta

La pagina del run e la console del report aprono una WebSocket verso `/ws` e si iscrivono a un run; il
server invia le voci di log man mano che il worker le produce, e le stesse voci si leggono da
`execution_logs` quando la pagina viene aperta a run concluso.

## Interfaccia e design system

I componenti sono costruiti con le primitive shadcn/ui in `components/ui/` (sotto c'è Radix: dialog,
dropdown, select, tooltip), con stile Tailwind CSS e variabili CSS per i temi chiaro e scuro
(`hooks/use-theme.ts`). Il builder visuale usa React Flow; le icone vengono da lucide-react.

## Internazionalizzazione

`i18n.ts` carica le quattro traduzioni in `locales/{en,it,fr,de}/translation.json`; la lingua viene dalle
impostazioni dell'utente, l'inglese è il ripiego. Ogni stringa si scrive come
`t('area.chiave', 'Testo inglese')`. Tre test in `locales/locales.test.ts` tengono tutto in ordine:

- ogni chiave presente in inglese esiste nelle altre tre lingue, con gli stessi `{{segnaposto}}`;
- nessun valore è vuoto o un marcatore `[TRANSLATE]`, e le chiavi sono annidate, mai puntate;
- ogni chiave letterale usata nel codice esiste in inglese (o nelle sue forme plurali `_one`/`_other`).

I valori variabili entrano nella traduzione come segnaposto `{{nome}}`, mai concatenati in JavaScript:
una frase costruita nel codice non si può tradurre. Le chiavi usate con un `count` hanno le forme `_one`
e `_other`.

## Test

`npm run test:client -- --run` esegue Vitest con Testing Library in jsdom. Convenzioni ricorrenti:

- Simulare `react-i18next` perché `t` restituisca il testo di ripiego (interpolato), e verificare
  sull'inglese.
- Simulare `fetch` con `vi.stubGlobal` e verificare le richieste fatte dal componente.
- I componenti che usano `useAuth` richiedono `vi.mock('@/hooks/use-auth')`.
- In jsdom i dropdown e le select di Radix si aprono con
  `fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })`.
