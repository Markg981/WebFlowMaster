# Web client

The web client is a React single-page application in `client/`, with its own `package.json`,
Vite build and Vitest configuration. In development Vite serves it through the web process
(`server/vite.ts`); in production the web process serves the built files from `dist/public`
(`server/static.ts`).

## Structure

```
client/src/
  main.tsx            bootstraps React and i18n
  App.tsx             providers, routes, language from the user's settings
  pages/              one component per route
  components/         feature components, grouped by area (settings, reports, suites, tests,
                      scheduling, api-tester, visual-builder, dashboard, layout, security, tags)
  components/ui/      the design system: shadcn/Radix primitives styled with Tailwind
  hooks/              use-auth, use-theme, use-toast, recording and test-runner hooks
  lib/                queryClient (fetch wrapper), protected-route, API helpers, schemas
  locales/            translation bundles (en, it, fr, de) and their tests
  observability/      client logger, correlation ids, error boundary (development)
```

## Routes

Routes are declared in `client/src/App.tsx` with **wouter**; pages are loaded lazily. Every route but
`/auth` is wrapped in `ProtectedRoute`, which sends an anonymous visitor to the sign-in page.

| Path | Page | What it is |
|---|---|---|
| `/` , `/dashboard` | `DashboardOverviewPage` | Overview of recent activity and results. |
| `/dashboard/create-test` | `dashboard-page-new` | The test builder: page loading, detected elements, drag-and-drop steps, recording, describing in sentences, preview. |
| `/dashboard/api-tester` | `ApiTesterPage` | Building and sending API requests, assertions, extractions, saved API tests. |
| `/tests` | `TestLibraryPage` | Every saved test, tags, history and versions. |
| `/reviews` | `ReviewsPage` | Test reviews, when the organization requires them. |
| `/test-suites` | `TestSuitesPage` | Test plans: create, configure, run. |
| `/suites` | `SuitesPage` | Suites, static and dynamic. |
| `/scheduling` | `SchedulingPage` | Schedules. |
| `/test-manager` | `TestManager` | Excel import mapped to saved sequences. |
| `/reports` | `GeneralReportsPage` | The list of runs with filters, flaky tests and the quarantine. |
| `/test-plan/:planId/run` | `TestPlanExecutionPage` | A run as it happens, with the live console. |
| `/test-plans/:planId/executions/:executionId/report` | `TestReportPage` | The report of one run. |
| `/settings` | `settings-page` | Settings, as sections (account, environments, projects, members, API keys, security, runners, agents, GitHub/GitLab, issue trackers, audit log…). |
| `/auth` | `auth-page` | Sign in and registration by invitation. |

## Data fetching

Server state lives in **TanStack Query**. `lib/queryClient.ts` provides the default query function
and `apiRequest`, which:

- send cookies (the session) with every request;
- add correlation headers (`X-Correlation-Id`, `X-Wfm-Session-Id`) so a UI action and the server
  work it triggers share one id in the logs;
- turn a non-2xx answer into an `ApiError` carrying the status and the parsed body, so a caller can
  react to a `409` or a `403` without parsing strings.

Components call `fetch` directly in a few places (settings cards); both styles use the same session
cookie. Query keys are named after the resource (`['agents']`, `['sourceHosts']`, `['/api/tests']`)
and invalidated after mutations.

## Authentication in the client

`hooks/use-auth.tsx` exposes the current user (`/api/user`), sign-in, sign-out and registration.
When the server answers that a second factor is owed, the sign-in page asks for the code. Components
hide what the user's role cannot do (for example `isOwner` props on settings cards); the server
enforces it regardless.

## Live updates

The run page and the report's console open a WebSocket to `/ws` and subscribe to one execution; the
server pushes log entries as the worker produces them, and the same entries are fetched from
`execution_logs` when the page is opened after the fact.

## UI and design system

Components are built from the shadcn/ui primitives in `components/ui/` (Radix underneath: dialogs,
dropdowns, selects, tooltips), styled with Tailwind CSS and CSS variables for light and dark themes
(`hooks/use-theme.ts`). The visual builder uses React Flow; icons come from lucide-react.

## Internationalization

`i18n.ts` loads the four bundles in `locales/{en,it,fr,de}/translation.json`; the language comes from
the user's settings, English is the fallback. Every string is written as
`t('area.key', 'English text')`. Three tests in `locales/locales.test.ts` keep this honest:

- every key English has exists in the other three languages, with the same `{{placeholders}}`;
- no value is blank or a `[TRANSLATE]` marker, and keys are nested, never dotted;
- every literal key used in the code exists in English (or in its `_one`/`_other` plural forms).

Values that vary go into the translation as `{{name}}` placeholders, never concatenated in
JavaScript: a sentence built in code cannot be translated. Keys used with a `count` have `_one` and
`_other` forms.

## Tests

`npm run test:client -- --run` runs Vitest with Testing Library in jsdom. Conventions that recur:

- Mock `react-i18next` so `t` returns the fallback text (interpolated), and assert on the English.
- Mock `fetch` with `vi.stubGlobal` and assert on the requests the component made.
- Components using `useAuth` need `vi.mock('@/hooks/use-auth')`.
- Radix dropdowns and selects open in jsdom with
  `fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })`.
