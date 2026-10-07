import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  resilienceCompose,
  reconcile,
  reconcileScenario,
  waitForRecovery,
  retainedArtifactBreaches,
} from './resilience-core.mjs';

const run = (id, overrides = {}) => ({
  id,
  status: 'completed',
  results: [{ testId: 1, success: true }],
  ...overrides,
});

test('scenario verdict excludes previous failures while final reconciliation retains them', () => {
  const rows = [run('old', { status: 'error', results: [] }), run('new')];
  assert.deepEqual(reconcileScenario(['old'], ['old', 'new'], rows), []);
  assert.match(reconcile(['old', 'new'], rows).join(), /old not completed/);
  assert.match(
    reconcileScenario(['old'], ['old', 'new'], [...rows, run('extra')]).join(),
    /unexpected/,
  );
});

test('reconciliation detects lost, extra, duplicated, failed and incomplete runs', () => {
  assert.deepEqual(reconcile(['a'], [run('a')]), []);
  assert.match(reconcile(['a'], [])[0], /missing/);
  assert.match(reconcile(['a'], [run('a'), run('b')]).join(), /unexpected/);
  assert.match(reconcile(['a'], [run('a'), run('a')]).join(), /duplicate/);
  assert.match(reconcile(['a'], [run('a', { status: 'running' })]).join(), /not completed/);
  assert.match(reconcile(['a'], [run('a', { results: [] })]).join(), /results/);
  assert.match(reconcile(['a'], [run('a', { results: [{ success: false }] })]).join(), /results/);
  assert.match(
    reconcile(['a'], [run('a', { results: [{ success: true }, { success: true }] })]).join(),
    /results/,
  );
  assert.match(reconcile(['a', 'a'], [run('a')]).join(), /duplicate expected/);
});

test('crash diagnostic requires worker_lost on exactly the interrupted ID and preserves strict recovery', () => {
  const interrupted = run('crashed', { status: 'error', failureCode: 'worker_lost', results: [] });
  assert.deepEqual(reconcile(['crashed', 'ok'], [interrupted, run('ok')], ['crashed']), []);
  assert.match(reconcile(['crashed'], [interrupted]).join(), /not completed/);
  assert.match(reconcile(['crashed'], [run('crashed')], ['crashed']).join(), /worker_lost/);
  assert.match(
    reconcile(['crashed'], [{ ...interrupted, failureCode: 'run_timed_out' }], ['crashed']).join(),
    /worker_lost/,
  );
  assert.match(
    reconcile(
      ['crashed', 'ok'],
      [interrupted, run('ok', { status: 'error', results: [] })],
      ['crashed'],
    ).join(),
    /ok not completed/,
  );
  assert.match(reconcile(['crashed'], [], ['crashed']).join(), /missing/);
  assert.match(
    reconcile(
      ['crashed'],
      [{ ...interrupted, results: [{ success: true }, { success: true }] }],
      ['crashed'],
    ).join(),
    /partial results/,
  );
  assert.match(
    reconcile(['crashed'], [{ ...interrupted, results: {} }], ['crashed']).join(),
    /partial results/,
  );
});

test('retained screenshots cannot disappear from a report or be marked unavailable', () => {
  const prefix = '/api/test-plan-executions/r/artifacts/';
  const retained = [prefix + 'first.png', prefix + 'second.png'];
  assert.deepEqual(
    retainedArtifactBreaches('r', retained, retained, { steps: [{ screenshot: retained[0] }] }),
    [],
  );
  assert.match(retainedArtifactBreaches('r', [retained[1]], retained, {}).join(), /disappeared/);
  assert.match(
    retainedArtifactBreaches('r', retained, retained, {
      nested: { evidenceUnavailable: true },
    }).join(),
    /unavailable/,
  );
});

test('a probe which succeeds after its recovery deadline still fails', async () => {
  let now = 0;
  await assert.rejects(
    waitForRecovery(
      async () => {
        now = 1001;
        return true;
      },
      1000,
      { now: () => now, sleep: async () => {} },
    ),
    /deadline/,
  );
});

test('stack persists Redis and uses distributed scheduling on API and worker', () => {
  const stack = resilienceCompose('/repo', 'key', 'session', 'abc123');
  assert.equal(stack.services.api.environment.SCHEDULER_BACKEND, 'bullmq');
  assert.equal(stack.services.worker.environment.SCHEDULER_BACKEND, 'bullmq');
  assert.equal(stack.services.worker.environment.AGENT_RELAY_URL, 'http://api:5000');
  assert.deepEqual(stack.services.redis.command, [
    'redis-server',
    '--appendonly',
    'yes',
    '--appendfsync',
    'always',
  ]);
  assert.deepEqual(stack.services.redis.volumes, ['redis_data:/data']);
  assert.equal(stack.services.agent.command[1], 'dist/wfm-agent.js');
  assert.deepEqual(stack.services.agent.profiles, ['agent']);
});

test('recovery tolerates transient disconnects but fails at a bounded deadline', async () => {
  let time = 0;
  let calls = 0;
  const io = {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  };
  const value = await waitForRecovery(
    async () => {
      if (++calls === 1) throw new Error('Redis unavailable');
      return calls === 3 ? 'recovered' : false;
    },
    2500,
    io,
  );
  assert.equal(value, 'recovered');
  assert.equal(calls, 3);
  await assert.rejects(
    waitForRecovery(async () => false, 1000, io),
    /deadline/,
  );
});

test('live runner refuses existing-stack overrides and short observation before any operation', () => {
  for (const args of [
    ['--project', 'wfm-collaudo'],
    ['--url', 'https://live.example'],
    ['--observation-seconds', '1'],
    ['--cycles', '101'],
    ['--worker-restart', 'unsafe'],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/wfm-resilience.mjs', ...args], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refused|observation|worker-restart/);
    assert.doesNotMatch(result.stdout, /build|infrastructure|Resilience evidence/);
  }
});
