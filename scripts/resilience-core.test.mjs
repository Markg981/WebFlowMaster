import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  resilienceCompose,
  reconcile,
  reconcileScenario,
  waitForRecovery,
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
  ]) {
    const result = spawnSync(process.execPath, ['scripts/wfm-resilience.mjs', ...args], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refused|observation/);
    assert.doesNotMatch(result.stdout, /build|infrastructure|Resilience evidence/);
  }
});
