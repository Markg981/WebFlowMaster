import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForWorker } from './wait-worker.mjs';

test('waits for delayed queue registration rather than treating process start as readiness', async () => {
  let calls = 0;
  await waitForWorker({ getWorkers: async () => ++calls === 3 ? [{ id: 'live-worker' }] : [] }, { timeoutMs: 500, pollMs: 5 });
  assert.equal(calls, 3);
});
test('fails within the deadline if no worker registers', async () => {
  await assert.rejects(waitForWorker({ getWorkers: async () => [] }, { timeoutMs: 30, pollMs: 5 }), /No live worker/);
});
test('a stalled queue lookup cannot bypass the readiness deadline', async () => {
  await assert.rejects(waitForWorker({ getWorkers: () => new Promise(() => {}) }, { timeoutMs: 30, pollMs: 5 }), /No live worker/);
});
