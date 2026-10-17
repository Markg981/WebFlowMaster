import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EXIT_NOT_READY,
  EXIT_OK,
  EXIT_TOOL_ERROR,
  pilotReport,
  reportMarkdown,
  validateDecision,
  validateLog,
  validatePilot,
} from './pilot-core.mjs';
import { fetchRuns, main } from './wfm-pilot.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/pilot/${name}.json`, import.meta.url), 'utf8'));
const silent = () => {
  const lines = { log: [], error: [] };
  return { lines, io: { log: (l) => lines.log.push(l), error: (l) => lines.error.push(l) } };
};

test('the example pilot is valid and ready for a decision', () => {
  const pilot = fixture('pilot');
  const log = fixture('observations');
  assert.deepEqual(validatePilot(pilot), []);
  assert.deepEqual(validateLog(log, pilot), []);
  const report = pilotReport(pilot, log, fixture('runs'));
  assert.equal(report.verdict, 'ready_for_decision');
  const [flow] = report.flows;
  assert.equal(flow.timeToFirstGreenMin, 70);
  assert.equal(flow.recorderCorrections, 2);
  assert.equal(flow.diagnosisMin, 15);
  assert.equal(flow.locatorFixes, 1);
  assert.equal(flow.retries, 1, 'one unit retried once; the run outside the window does not count');
  assert.equal(flow.runMinutes, 10);
  assert.equal(flow.tasks.install, 35);
  assert.deepEqual(flow.runs.byStatus, { completed: 1, failed: 1 });
  const ttfg = flow.comparison.find((row) => row.measure === 'timeToFirstGreenMin');
  assert.deepEqual(ttfg, {
    measure: 'timeToFirstGreenMin',
    pilot: 70,
    current: 180,
    delta: -110,
    outcome: 'better',
  });
  assert.match(reportMarkdown(report), /\*\*Verdict: ready_for_decision\*\*/);
});

test('an operator who wrote the product, or a vendor figure as baseline, is refused', () => {
  const pilot = fixture('pilot');
  pilot.operator.wroteProduct = true;
  pilot.flows[0].baseline.source = 'vendor';
  const problems = validatePilot(pilot).join('\n');
  assert.match(problems, /did not write the product/);
  assert.match(problems, /not vendor percentages/);
  delete pilot.operator.wroteProduct;
  assert.match(validatePilot(pilot).join('\n'), /wroteProduct: must be false/);
});

test('a false green reopens its audit ID and blocks the report until a fix is named', () => {
  const pilot = fixture('pilot');
  const log = [
    ...fixture('observations'),
    {
      kind: 'incident',
      incident: 'false_green',
      reopens: 'C02',
      flow: 'login-order',
      at: '2026-11-06T10:00:00Z',
      run: 'run-1',
      what: 'run passed with the order confirmation step missing from the report',
    },
  ];
  assert.deepEqual(validateLog(log, pilot), []);
  const blocked = pilotReport(pilot, log, fixture('runs'));
  assert.equal(blocked.verdict, 'blocked');
  assert.deepEqual(blocked.reopenedIds, ['C02']);
  assert.equal(blocked.register[0].state, 'reopened');
  log.at(-1).closedBy = 'PR #999';
  const closed = pilotReport(pilot, log, fixture('runs'));
  assert.equal(closed.verdict, 'ready_for_decision');
  assert.equal(closed.register[0].state, 'closed');
});

test('an incident without the ID it reopens or a known kind is not accepted as noise', () => {
  const pilot = fixture('pilot');
  const problems = validateLog(
    [{ kind: 'incident', incident: 'flaky', at: '2026-11-06T10:00:00Z' }],
    pilot,
  ).join('\n');
  assert.match(problems, /incident: one of false_green, lost_evidence, authorization, blocker/);
  assert.match(problems, /reopens: the audit ID/);
  assert.match(problems, /what: what happened/);
});

test('what was not observed stays missing and keeps the gate closed', () => {
  const pilot = fixture('pilot');
  const log = fixture('observations').filter(
    (event) => !event.kind.startsWith('diagnosis') && event.kind !== 'first_green',
  );
  const report = pilotReport(pilot, log, []);
  assert.equal(report.verdict, 'incomplete');
  assert.equal(report.flows[0].diagnosisMin, null);
  assert.equal(report.flows[0].retries, null, 'no run is not zero retries');
  assert.ok(report.missing.includes('task diagnosis: no start and end observed'));
  assert.ok(report.missing.includes('login-order: no first green observed'));
  assert.ok(report.missing.includes('login-order: no run of plan in the window'));
  const row = report.flows[0].comparison.find((r) => r.measure === 'diagnosisMin');
  assert.equal(row.outcome, 'not_comparable');
});

test('the decision is refused on a report that is not ready, and stands apart from the build', () => {
  const pilot = fixture('pilot');
  const ready = pilotReport(pilot, fixture('observations'), fixture('runs'));
  assert.deepEqual(validateDecision(fixture('decision'), ready), []);
  const notReady = pilotReport(pilot, [], []);
  assert.match(validateDecision(fixture('decision'), notReady).join('\n'), /is incomplete/);
  const bare = { ...fixture('decision') };
  delete bare.support;
  delete bare.buildApproval;
  bare.featureFreezeUntilGate = false;
  bare.evidence = [];
  const problems = validateDecision(bare, ready).join('\n');
  assert.match(problems, /support: owner, hoursPerWeek/);
  assert.match(problems, /buildApproval: the release qualified in P18/);
  assert.match(problems, /featureFreezeUntilGate/);
  assert.match(problems, /evidence:/);
  assert.match(
    validateDecision({ ...fixture('decision'), decision: 'approve' }, ready).join('\n'),
    /decision: one of/,
  );
});

test('the CLI writes the report and records a decision only on a ready report', async () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'wfm-pilot-'));
  const dir = 'scripts/fixtures/pilot';
  const { io, lines } = silent();
  const code = await main(
    [
      'report',
      '--pilot',
      `${dir}/pilot.json`,
      '--log',
      `${dir}/observations.json`,
      '--runs',
      `${dir}/runs.json`,
      '--out',
      out,
    ],
    {},
    io,
  );
  assert.equal(code, EXIT_OK, lines.error.join('\n'));
  const report = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.verdict, 'ready_for_decision');
  assert.equal(
    await main(
      ['decide', '--report', path.join(out, 'report.json'), '--decision', `${dir}/decision.json`],
      {},
      io,
    ),
    EXIT_OK,
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(out, 'decision.json'), 'utf8')).decision,
    'adopt_limited',
  );
});

test('the CLI refuses without runs or credentials, and an unusable pilot', async () => {
  const dir = 'scripts/fixtures/pilot';
  const { io, lines } = silent();
  assert.equal(
    await main(
      ['report', '--pilot', `${dir}/pilot.json`, '--log', `${dir}/observations.json`],
      {},
      io,
    ),
    EXIT_TOOL_ERROR,
  );
  assert.match(lines.error.at(-1), /WFM_PILOT_URL and WFM_PILOT_API_KEY/);
  assert.equal(await main(['report', '--pilot', `${dir}/pilot.json`], {}, io), EXIT_TOOL_ERROR);
  assert.equal(await main(['publish'], {}, io), EXIT_TOOL_ERROR);
  assert.equal(
    await main(
      ['decide', '--report', `${dir}/pilot.json`, '--decision', `${dir}/decision.json`],
      {},
      io,
    ),
    EXIT_NOT_READY,
  );
});

test('runs are read through /api/v1 with the key in a header, and never carry data from the pilot file', async () => {
  const pilot = fixture('pilot');
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, key: init.headers['X-API-Key'] });
    const body = url.includes('/units')
      ? { items: [{ unitId: 'u_1', result: { attempts: 3 } }], total: 1 }
      : { items: [{ id: 'r1', planId: 'plan-login-order', startedAt: '2026-11-03T10:00:00Z' }] };
    return { ok: true, json: async () => body };
  };
  const runs = await fetchRuns(
    pilot,
    { WFM_PILOT_URL: 'http://wfm.test/', WFM_PILOT_API_KEY: 'k' },
    fake,
  );
  assert.equal(runs.length, 1);
  assert.equal(runs[0].units[0].result.attempts, 3);
  assert.ok(calls.every((call) => call.key === 'k' && !call.url.includes('k=')));
  assert.equal(calls[0].url, 'http://wfm.test/api/v1/runs?limit=100&offset=0');
});
