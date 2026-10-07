import { drillCompose } from './restore-drill-core.mjs';

export function resilienceCompose(root, key, session, id) {
  const stack = drillCompose(root, key, session, id);
  for (const name of ['api', 'worker']) {
    stack.services[name].environment = {
      ...stack.services[name].environment,
      SCHEDULER_BACKEND: 'bullmq',
      AGENT_RELAY_URL: 'http://api:5000',
      ORG_MAX_CONCURRENT_RUNS: '2',
    };
  }
  // A restart is not Redis data loss: persist the queue before acknowledging writes.
  stack.services.redis.command = ['redis-server', '--appendonly', 'yes', '--appendfsync', 'always'];
  stack.services.redis.volumes = ['redis_data:/data'];
  stack.volumes.redis_data = {};
  stack.services.agent = {
    image: stack.services.worker.image,
    command: ['node', 'dist/wfm-agent.js'],
    environment: { WFM_URL: 'http://api:5000' },
    profiles: ['agent'],
    shm_size: '1gb',
  };
  return stack;
}

/** Plans in this synthetic fixture contain exactly one browser test. */
export function reconcile(expectedIds, observed, expectedWorkerLostIds = []) {
  const breaches = [];
  const expected = new Set(expectedIds);
  const expectedWorkerLost = new Set(expectedWorkerLostIds);
  if (expected.size !== expectedIds.length) breaches.push('duplicate expected run ID');
  const ids = new Set();
  for (const run of observed) {
    if (ids.has(run.id)) breaches.push(`duplicate run ${run.id}`);
    ids.add(run.id);
    if (!expected.has(run.id)) breaches.push(`unexpected run ${run.id}`);
    const results = typeof run.results === 'string' ? JSON.parse(run.results) : run.results;
    if (expectedWorkerLost.has(run.id)) {
      if (run.status !== 'error' || run.failureCode !== 'worker_lost')
        breaches.push(
          `run ${run.id} did not report expected worker_lost: ${run.status}/${run.failureCode ?? 'none'}`,
        );
      if (results != null && (!Array.isArray(results) || results.length > 1))
        breaches.push(`run ${run.id} has duplicate or invalid partial results`);
      continue;
    }
    if (run.status !== 'completed') breaches.push(`run ${run.id} not completed: ${run.status}`);
    if (!Array.isArray(results) || results.length !== 1 || results[0].success !== true)
      breaches.push(`run ${run.id} has missing, duplicate or failed results`);
  }
  for (const id of expected) if (!ids.has(id)) breaches.push(`missing run ${id}`);
  return breaches;
}

export function retainedArtifactBreaches(runId, links, retainedLinks, report) {
  const found = [];
  const current = new Set(links);
  const prefix = `/api/test-plan-executions/${runId}/artifacts/`;
  for (const link of retainedLinks)
    if (link.startsWith(prefix) && !current.has(link))
      found.push(`Retained artifact disappeared from report for ${runId}: ${link}`);
  const unavailable = (value) =>
    value &&
    typeof value === 'object' &&
    (value.evidenceUnavailable === true || Object.values(value).some(unavailable));
  if (unavailable(report)) found.push(`Report contains unavailable evidence for ${runId}`);
  return found;
}

/** Attribute new failures to this scenario; the final inventory still checks the whole history. */
export function reconcileScenario(previousIds, expectedIds, observed, expectedWorkerLostIds = []) {
  const previous = new Set(previousIds);
  return reconcile(
    expectedIds.filter((id) => !previous.has(id)),
    observed.filter((run) => !previous.has(run.id)),
    expectedWorkerLostIds,
  );
}

export async function waitForRecovery(
  probe,
  timeoutMs,
  io = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
) {
  const deadline = io.now() + timeoutMs;
  let lastError;
  while (io.now() < deadline) {
    try {
      const value = await probe();
      if (value && io.now() <= deadline) return value;
    } catch (error) {
      lastError = error;
    }
    await io.sleep(Math.min(500, Math.max(0, deadline - io.now())));
  }
  throw new Error(`Recovery deadline exceeded${lastError ? `: ${lastError.message}` : ''}`);
}
