# Exporting to Playwright

A web test can be downloaded as a Playwright Test file (`*.spec.ts`) that runs without
WebFlowMaster: `npx playwright test` on your own machine or in your own pipeline. This page lists
what the file does the same way a WebFlowMaster run does, what it does differently, and what it
cannot do at all.

## Two modes {#modes}

**Draft (D-AUTHOR)** — the default, and what the file icon on a web test downloads. It is meant for
a technical user who wants to take the test further by hand. Every step that has no equivalent is
written in place as a call that **fails the test**, with the reason:

```ts
// Not exported — Query a database: queries the environment's database through WebFlowMaster
notExported("step 4, Query a database: queries the environment's database through WebFlowMaster");
```

The first lines of the file start with `// DRAFT —` and list every step that is missing
(`missing:`) or behaves differently (`differs:`). A draft is never marked as skipped: a step that
cannot run makes the test red, so a draft cannot pass by accident.

**Strict (D-CI)** — for a pipeline that must only ever get a complete file. If any step or setting
is not exportable, nothing is written: the request fails with **422** and the list of findings.
When strict mode returns a file, its first lines say `// Conformance: complete`.

## Which version is exported {#version}

The file is made from one saved version of the test, with the step groups, custom actions and shared
elements **that version** uses — never from a working copy labelled with another version's number.

| `version=`         | What is exported                                                                       |
| ------------------ | -------------------------------------------------------------------------------------- |
| `run` (default)    | What a plan runs: the published version, or the latest save if none was ever published |
| `published`        | The published version; **409** if the test was never published                         |
| `working`          | The working copy, with the current step groups and custom actions                      |
| a number, e.g. `3` | That saved version; **404** if it does not exist                                       |

A version whose dependency snapshot cannot be read, or whose groups no longer expand, is refused
with **409** rather than exported with today's groups.

## Route {#route}

`GET /api/tests/:id/playwright` (role viewer or above).

| Parameter | Values                             | Default                   |
| --------- | ---------------------------------- | ------------------------- |
| `version` | `run`, `published`, `working`, `N` | `run`                     |
| `mode`    | `draft`, `strict`                  | `draft`                   |
| `format`  | `json` for the full result         | the file as an attachment |

Response headers: `X-WFM-Export-Source` (`published`, `version` or `working`) and
`X-WFM-Export-Version` (the version number, when there is one).

| Status | Meaning                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 200    | The file (or, with `format=json`: `fileName`, `code`, `mode`, `complete`, `findings`, `notExported`, `variables`, `source`)     |
| 400    | Invalid id, `version` or `mode`                                                                                                 |
| 404    | No such test or version                                                                                                         |
| 409    | The requested version cannot be exported as it was saved (never published, unreadable snapshot, a group that no longer expands) |
| 422    | Strict mode and something is not exportable: `{ error, findings: [{ step, area, support, label, reason }] }`                    |

**Compatibility.** A call without parameters behaves as before — a draft of what a plan runs — with
two changes: the version is the one a plan really runs (before, the working copy could be exported
under the published version's number), and unexportable steps now fail the test instead of being
comments.

From a pipeline:

```sh
curl -fsS -H "Authorization: Bearer $WFM_TOKEN" \
  "https://wfm.example.com/api/tests/42/playwright?version=published&mode=strict" \
  -o tests/checkout.spec.ts
```

`-f` makes the step fail on 422, so the pipeline never runs an incomplete file.

## Variables and secrets {#secrets}

Each <code v-pre>{{variable}}</code> is read at run time from an environment variable named
`WFM_<NAME>` (`WFM_BASEURL` for <code v-pre>{{baseUrl}}</code>); the file lists them in its first
lines. A step that needs a variable which is not set fails with the name of the environment variable
to set. Secret values are never written in the file: a header such as `Authorization`, `Cookie` or
`X-Api-Key`, or a body field such as `password` or `token`, is exported only when its value comes
from a variable (<code v-pre>Bearer {{token}}</code>). A credential written literally is a finding —
in strict mode the export is refused, in a draft the step fails — and a dataset column that holds
one is left out of the file.

## Conformance {#conformance}

**supported** — the file does what a run does. **partial** — it runs, with the difference
described. **unsupported** — the step needs WebFlowMaster: refused in strict mode, a failing
`notExported(...)` in a draft.

### Actions {#actions}

<div v-pre>

| Action               | Support     | In the file                                                                                 |
| -------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `click`              | supported   | locator.first().click()                                                                     |
| `doubleClick`        | supported   | locator.first().dblclick()                                                                  |
| `rightClick`         | supported   | locator.first().click({ button: 'right' })                                                  |
| `hover`              | supported   | locator.first().hover()                                                                     |
| `input`              | supported   | locator.first().fill(value); an unset {{variable}} fails                                    |
| `select`             | supported   | locator.first().selectOption(value)                                                         |
| `selectByText`       | supported   | click, then the option by role or by the overlay classes, visible within 15 s               |
| `wait`               | supported   | page.waitForTimeout(ms); the value is a literal number                                      |
| `scroll`             | supported   | locator.scrollIntoViewIfNeeded(), or window.scrollBy(0, 200)                                |
| `navigate`           | supported   | page.goto(url, { waitUntil: 'domcontentloaded' })                                           |
| `assert`             | supported   | visible within 5 s (polled, as a run does)                                                  |
| `assertTextContains` | supported   | textContent includes the text (case-sensitive) within 5 s                                   |
| `assertElementCount` | supported   | count compared with the operator within 5 s                                                 |
| `assertState`        | supported   | checked/enabled/editable… polled within 5 s                                                 |
| `ensureState`        | supported   | reads isChecked, clicks only on a difference, then waits 5 s for the state                  |
| `waitForElement`     | supported   | waitFor({ state: 'visible' \| 'hidden', timeout: 15 s })                                    |
| `waitForText`        | supported   | filter({ hasText }).waitFor({ state: 'attached', timeout: 15 s })                           |
| `waitForNetworkIdle` | supported   | waitForLoadState('networkidle', 15 s)                                                       |
| `pressKey`           | supported   | on the element when it has one, else page.keyboard                                          |
| `dragAndDrop`        | supported   | dragTo the destination in the same frame                                                    |
| `uploadFile`         | supported   | setInputFiles on a file input, else the file chooser the click opens; the name is a literal |
| `handleDialog`       | supported   | a queue of answers per tab; unanswered dialogs are dismissed                                |
| `switchTab`          | supported   | newest, number or text in address/title, waited for 15 s                                    |
| `closeTab`           | supported   | back to the opener, else the first tab left                                                 |
| `storeText`          | supported   | field value or innerText, trimmed, into the variables                                       |
| `setCookie`          | supported   | addCookies for the address the tab is on                                                    |
| `clearCookies`       | supported   | context.clearCookies()                                                                      |
| `setLocalStorage`    | supported   | localStorage.setItem in the page                                                            |
| `executeScript`      | supported   | page.evaluate of the same expression (custom-action args and element included); false fails |
| `setVariable`        | supported   | into the variables; generators ({{$…}}) are refused                                         |
| `assertCondition`    | supported   | the same comparison rules; non-numbers with > < fail                                        |
| `mockRequest`        | supported   | context.route + fulfill, method filter, delay, CORS header                                  |
| `blockRequests`      | supported   | route.abort('blockedbyclient')                                                              |
| `clearMocks`         | supported   | unrouteAll (the file installs no other routes)                                              |
| `setGeolocation`     | supported   | grantPermissions + setGeolocation; the point is a literal                                   |
| `if`                 | supported   | if/else; element conditions read now, without waiting                                       |
| `else`               | supported   | } else {                                                                                    |
| `endIf`              | supported   | }                                                                                           |
| `repeat`             | supported   | for loop of 0…200, {{loopIndex}} from 1                                                     |
| `repeatWhile`        | supported   | for loop that fails after 200 rounds, {{loopIndex}} from 1                                  |
| `endLoop`            | supported   | } and {{loopIndex}} back to the outer loop                                                  |
| `waitForEmail`       | unsupported | reads the environment's test inbox (Mailpit)                                                |
| `waitForSms`         | unsupported | reads the organization's SMS inbox                                                          |
| `queryDatabase`      | unsupported | queries the environment's database through WebFlowMaster                                    |
| `assertAccessible`   | unsupported | the axe-core scan and its thresholds run in WebFlowMaster                                   |
| `measurePerformance` | unsupported | the Web Vitals collection runs in WebFlowMaster                                             |
| `auditLighthouse`    | unsupported | Lighthouse runs in WebFlowMaster                                                            |
| `expectDownload`     | unsupported | the download checks and {{download.*}} run in WebFlowMaster                                 |

</div>

### Frames, tabs, data, groups, setup and cleanup {#features}

<div v-pre>

| Feature                  | Support     | Area      | In the file                                                                       |
| ------------------------ | ----------- | --------- | --------------------------------------------------------------------------------- |
| frames                   | supported   | frame     | frameLocator chain, outermost first                                               |
| tabs                     | supported   | tab       | switchTab/closeTab, handleDialog per tab                                          |
| dataset                  | supported   | data      | one Playwright test per row, values as strings                                    |
| datasetWithPreconditions | partial     | data      | a run makes the preconditions once for all rows; the file makes them once per row |
| groups                   | supported   | group     | expanded before export, from the exported version's own dependencies              |
| preconditions            | supported   | setup     | request fixture: check first, satisfiedStatuses, headers and body sent as written |
| cleanups                 | supported   | cleanup   | in finally, each call attempted, 404/410 count as done, never fails the test      |
| variables                | supported   | variables | `WFM_<NAME>` environment variables; an unset one fails the step that needs it     |
| generators               | unsupported | variables | {{$random…}} values are made by WebFlowMaster                                     |
| literalCredentials       | unsupported | secrets   | a credential written in a header or body is never copied into the file            |

</div>

### What stays with WebFlowMaster runs {#run-level}

These are settings of the run, not of the test, so they never make an export partial:

- AI healing of a selector that stopped matching;
- visual comparison against a baseline;
- retry of a failed step (plan setting);
- screenshots, video and evidence kept by WebFlowMaster;
- the egress policy on the addresses a test may reach;
- what a plan does when a precondition fails (continue/skip);
- the page-load timeout; the element timeout is `WFM_ELEMENT_TIMEOUT_MS` (30 s by default);
- browser, device and viewport: the Playwright configuration decides them.

## How conformance is verified {#verification}

The tables above are the code's own matrix: a unit test fails if an action is added without a row
here, or if a row's support changes without this page. An end-to-end test runs the same cases on a
controlled page both as a WebFlowMaster plan and as the exported file, and checks that they agree —
the same effects, the same passing assertions, and the same failure when an assertion is wrong — and
that strict mode refuses a test with an unsupported step instead of writing a file.
