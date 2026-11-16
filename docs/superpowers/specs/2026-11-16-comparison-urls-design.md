# Comparing two versions by URL

Date: 2026-11-16. Extends [run comparison](2026-11-12-run-comparison-design.md).

## Problem

A comparison runs one plan on two **environments**. To compare an old and a new version of an
application (a port, an upgrade, two instances with their own databases) the user first has to
create two environments, give each a `baseUrl` secret, and the tests must open
`{{baseUrl}}/...`. A test recorded with a fixed address (`https://old.example.com/login`) opens
the old version on both sides, and the comparison proves nothing.

## Goal

In **Compare environments** each side takes a **URL**: the address of that version. The same plan
runs on both, and every address of the other version in the tests is replaced by this side's.
Nothing else changes: same frozen tests, same comparison, same verdicts, same parity report.

## Model

Each side has an optional environment and an optional URL; it needs at least one of the two.

| Side      | Environment                                  | URL                           |
| --------- | -------------------------------------------- | ----------------------------- |
| Baseline  | Secrets and saved login of the old version   | Where the old version answers |
| Candidate | Optional: without one it uses the baseline's | Where the new version answers |

The two sides must differ: different environments, or different URLs.

Optional, once per comparison: **Address used in the tests** (`recordedUrl`), for tests recorded
on a third address (a developer's machine, a test server).

## What a URL does in a run

On the side's run, with `url` = the side's URL and `from` = the other side's URL and
`recordedUrl` (those that are set and differ from `url`):

1. `{{baseUrl}}` is `url`, over the environment's `baseUrl` secret.
2. Before a web or API test runs, every occurrence of an address in `from` inside the test's own
   definition (start URL, steps, preconditions, request URL, headers, body, assertions) is
   replaced by `url`. Addresses are compared without a trailing `/`. The frozen definitions are
   not changed: both runs keep the same fingerprints, and the comparison pairs them as before.
3. Mobile tests are not rewritten (they open an app, not an address).

Pages the application itself links to are not rewritten: the application under test decides
where its links go.

URLs must be `http:` or `https:`, at most 2048 characters, without credentials; the egress policy
still decides at navigation time what a run may open.

## Storage

Migration `0113_comparison_urls.sql` adds `baseline_url`, `candidate_url` and `recorded_url`
(text, nullable) to `comparison_runs` and replaces `comparison_runs_environments_differ` with a
check that the sides differ by environment or by URL. A side without an environment records the
URL's host as its name, so lists and reports keep a name for it.

The run's snapshot carries the target in `comparison.target` (`{ url, rewriteFrom[] }`), so a
worker needs nothing but the snapshot, and a replay of a comparison run repeats it.

## Surfaces

- **Dialog**: per side an environment selector (with "none") and a URL field; the optional
  address used in the tests below. Validation: each side has one of the two, the sides differ.
- **Report and list**: under each side's name, its URL.
- **API**: `POST /api/test-plans/{planId}/comparisons` and `POST /api/v1/plans/{planId}/comparisons`
  accept `baselineUrl`, `candidateUrl`, `recordedUrl`; environments become optional. Responses
  return the three URLs.
- **CLI**: `wfm compare --baseline-url URL --candidate-url URL [--recorded-url URL]`, with or
  without `--baseline` and `--candidate`.
- **Parity report** (HTML/PDF) and the notification: the URLs next to the side names.

## Out of scope

- Rewriting addresses inside pages, redirects or links of the application.
- Mobile tests.
- More than two sides.

## Tests

- Unit: the rewrite (prefixes, trailing slash, nested values, no change without target), the
  `{{baseUrl}}` override, the create schema (one of the two per side, sides differ, bad URLs).
- Orchestrator: a URL-only baseline enqueues without an environment; the candidate replay carries
  its target; fingerprints of the two runs match.
- Routes: create with URLs, response shape, API v1.
- Client: the dialog's validation and request body.
- Collaudo: a new case file for the comparison by URL.
