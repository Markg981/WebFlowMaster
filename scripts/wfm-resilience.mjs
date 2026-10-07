// Real, disposable installation. Node 22.19+ strips the reused endurance runner's types.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { request } from 'playwright';
import { runLoad } from './wfm-load.ts';
import {
  resilienceCompose,
  reconcile,
  reconcileScenario,
  waitForRecovery,
  retainedArtifactBreaches,
} from './resilience-core.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'Usage: npm run load:resilience -- [--cycles 1] [--recovery-timeout 180] [--observation-seconds 40] [--worker-restart graceful|crash]\nBuilds a disposable Docker stack; never accepts existing project, URL or credentials. Crash mode verifies worker_lost without replaying interrupted work.',
  );
  process.exit(0);
}
const settings = {
  '--cycles': 1,
  '--recovery-timeout': 180,
  '--observation-seconds': 40,
  '--worker-restart': 'graceful',
};
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '--worker-restart') {
    if (!['graceful', 'crash'].includes(args[i + 1]))
      throw new Error('--worker-restart accepts graceful or crash.');
    settings[args[i]] = args[i + 1];
    continue;
  }
  const n = Number(args[i + 1]);
  if (!(args[i] in settings) || !Number.isSafeInteger(n) || n < 1 || n > 3600)
    throw new Error(
      'Only positive integer --cycles, --recovery-timeout and --observation-seconds are accepted; existing stack overrides are refused.',
    );
  settings[args[i]] = n;
}
if (settings['--cycles'] > 100 || settings['--observation-seconds'] < 40)
  throw new Error(
    'At most 100 cycles; observation must be at least 40 seconds to cover stalled-job redelivery.',
  );

const id = randomUUID().replaceAll('-', '').slice(0, 12);
const project = `wfm-resilience-${id}`;
const directory = path.resolve('resilience-artifacts', id);
fs.mkdirSync(directory, { recursive: true });
const composeFile = path.join(directory, 'compose.json');
fs.writeFileSync(
  composeFile,
  JSON.stringify(
    resilienceCompose(
      process.cwd(),
      randomBytes(32).toString('hex'),
      randomBytes(32).toString('hex'),
      id,
    ),
  ),
);
const evidence = {
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    encoding: 'utf8',
  }).trim(),
  project,
  settings,
  syntheticFixture: true,
  artifactStore: 'local',
  schedulerBackend: 'bullmq',
  scenarioPurpose:
    settings['--worker-restart'] === 'crash'
      ? 'crash-detection-without-replay'
      : 'controlled-restart-recovery',
  expectedWorkerLostIds: [],
  startedAt: new Date().toISOString(),
  phases: [],
  cycles: [],
  breaches: [],
  cleanupErrors: [],
  success: false,
};
const transcript = fs.createWriteStream(path.join(directory, 'operations.log'));
const contexts = [];
const agentContainers = [];
const retainedHashes = new Map();
const timeout = settings['--recovery-timeout'] * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};

function command(args, extraEnv = {}, direct = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      direct ? args : ['compose', '-p', project, '-f', composeFile, ...args],
      {
        env: { ...process.env, ...extraEnv },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
      transcript.write(data);
    });
    child.stderr.on('data', (data) => transcript.write(data));
    const timer = setTimeout(
      () => {
        child.kill();
        reject(new Error(`Docker ${args[0]} deadline exceeded`));
      },
      args[0] === 'build' ? 900_000 : 180_000,
    );
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`Docker ${args[0]} failed (${code}); see operations.log`));
    });
  });
}
async function phase(name, operation) {
  console.log(name);
  const start = Date.now();
  const record = { name, success: false, startedAt: new Date(start).toISOString() };
  evidence.phases.push(record);
  try {
    const result = await operation();
    record.success = !(result?.breaches?.length > 0);
    return result;
  } catch (error) {
    record.error = error.message;
    throw error;
  } finally {
    record.durationMs = Date.now() - start;
  }
}
async function json(client, method, url, data) {
  const response = await client[method](url, data === undefined ? {} : { data });
  ensure(response.ok(), `${method} ${url}: HTTP ${response.status()}`);
  return response.json();
}
async function inventory(tenant) {
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const result = await json(
      tenant.client,
      'get',
      `/api/test-plan-executions?planId=${tenant.plan.id}&limit=100&offset=${offset}`,
    );
    items.push(...result.items);
    if (result.items.length < 100) return items;
    ensure(offset < 10000, 'Unexpected unbounded fixture inventory');
  }
}
async function artifacts(tenant, runId) {
  const report = await json(tenant.client, 'get', `/api/test-plan-executions/${runId}/report`);
  const links = [
    ...new Set(
      JSON.stringify(report).match(/\/api\/test-plan-executions\/[^"\s]+\/artifacts\/[^"\s]+/g) ??
        [],
    ),
  ];
  ensure(links.length > 0, `Run ${runId} produced no artifact links`);
  const missing = retainedArtifactBreaches(runId, links, retainedHashes.keys(), report);
  ensure(missing.length === 0, missing.join('; '));
  const hashes = [];
  for (const link of links) {
    ensure(
      link.startsWith(`/api/test-plan-executions/${runId}/artifacts/`),
      'Artifact belongs to another run',
    );
    const response = await tenant.client.get(link);
    ensure(response.ok(), `Artifact unavailable for ${runId}: HTTP ${response.status()}`);
    const bytes = await response.body();
    ensure(bytes.length > 0, `Empty artifact for ${runId}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    ensure(
      !retainedHashes.has(link) || retainedHashes.get(link) === sha256,
      `Retained artifact changed for ${runId}`,
    );
    retainedHashes.set(link, sha256);
    hashes.push({ url: link, bytes: bytes.length, sha256 });
  }
  return hashes;
}
async function connected(tenant, timeoutMs = timeout) {
  return waitForRecovery(async () => {
    const { agents } = await json(tenant.client, 'get', '/api/agents');
    return agents.find((agent) => agent.id === tenant.agentId && agent.connected);
  }, timeoutMs);
}
async function start(tenant, key) {
  const response = await tenant.client.post(`/api/v1/plans/${tenant.plan.id}/runs`, {
    headers: { Authorization: `Bearer ${tenant.key}`, 'Idempotency-Key': key },
    data: {},
  });
  ensure(response.status() === 202, `Run enqueue HTTP ${response.status()}`);
  const run = await response.json();
  ensure(typeof run.id === 'string' && run.id.length > 0, 'Missing accepted run ID');
  return run.id;
}
async function createTenant(base, index) {
  const client = await request.newContext({ baseURL: base, timeout: 15_000 });
  contexts.push(client);
  await json(client, 'post', '/api/register', {
    username: `resilience_${id}_${index}`,
    password: `R!${randomBytes(16).toString('hex')}`,
  });
  const pool = `resilience-${index}`;
  const registration = await json(client, 'post', '/api/agents', { name: pool, pool });
  // Pass the token through the environment, never command output or the persisted report.
  await command(
    ['run', '-d', '--name', `${project}-agent-${index}`, '-e', 'WFM_AGENT_TOKEN', 'agent'],
    { WFM_AGENT_TOKEN: registration.token },
  );
  agentContainers.push(`${project}-agent-${index}`);
  const test = await json(client, 'post', '/api/tests', {
    name: 'Resilience evidence',
    url: 'http://api:5000/auth',
    elements: [],
    sequence: [
      {
        id: 'navigate',
        action: { id: 'navigate', type: 'navigate', name: 'Navigate' },
        value: 'http://api:5000/auth',
        targetElement: null,
      },
      {
        id: 'wait',
        action: { id: 'wait', type: 'wait', name: 'Controlled work' },
        value: '5000',
        targetElement: null,
      },
    ],
  });
  await json(client, 'post', `/api/tests/${test.id}/publish`, {});
  const plan = await json(client, 'post', '/api/test-plans', {
    name: 'Resilience plan',
    selectedTests: [{ id: test.id, type: 'ui' }],
    agentPool: pool,
    captureScreenshots: 'always',
    testMachinesConfig: [{ browserName: 'chromium', headless: true }],
    maxParallelTests: 1,
  });
  const key = await json(client, 'post', '/api/api-keys', {
    name: 'Resilience',
    scopes: ['plans:read', 'runs:read', 'runs:write'],
  });
  const tenant = { client, plan, key: key.key, agentId: registration.agent.id, expected: [] };
  await connected(tenant);
  return tenant;
}

try {
  await phase('build', () => command(['build', 'api', 'worker']));
  await phase('infrastructure', async () => {
    await command(['up', '-d', '--wait', 'postgres', 'redis']);
    await command([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'webflowmaster',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      "CREATE ROLE wfm_drill LOGIN PASSWORD 'drill' BYPASSRLS; GRANT CREATE ON SCHEMA public TO wfm_drill; ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO wfm_drill; ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO wfm_drill;",
    ]);
    await command(['run', '--rm', '-T', 'migrate']);
    await command([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'webflowmaster',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'GRANT app_user TO wfm_drill; GRANT USAGE ON SCHEMA drizzle TO wfm_drill; GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO wfm_drill;',
    ]);
    await command(['up', '-d', 'api', 'worker']);
  });
  const base = `http://${await command(['port', 'api', '5000'])}`;
  await waitForRecovery(
    async () => (await fetch(`${base}/api/registration`, { signal: AbortSignal.timeout(5000) })).ok,
    timeout,
  );
  evidence.images = await command(['images', '--format', 'json']);
  const tenants = await phase('two-tenants-and-real-agents', async () => [
    await createTenant(base, 0),
    await createTenant(base, 1),
  ]);
  // Reads and plan queues retain their existing latency, quota and completion verdicts.
  await phase('endurance-baseline', async () => {
    const load = await runLoad({
      baseUrl: base,
      targets: tenants.map((t) => ({ key: t.key, planId: t.plan.id })),
      readers: 2,
      readSeconds: 2,
      runs: 2,
      maxConcurrent: 2,
      runTimeoutSeconds: settings['--recovery-timeout'],
      pollSeconds: 1,
      maxP95Ms: 2000,
      maxErrorRate: 0,
      requestTimeoutSeconds: 15,
    });
    evidence.baseline = load;
    evidence.breaches.push(...load.breaches);
    ensure(
      load.code === 0,
      'Endurance baseline failed; inspect worker/agent logs before injecting faults',
    );
    for (const tenant of tenants) {
      const rows = await inventory(tenant);
      tenant.expected.push(...rows.map((run) => run.id));
      ensure(rows.length === 2, 'Baseline must create exactly two runs per tenant');
      evidence.baselineArtifacts ??= [];
      evidence.baselineArtifacts.push(
        ...(await Promise.all(
          rows.map(async (run) => ({ runId: run.id, files: await artifacts(tenant, run.id) })),
        )),
      );
    }
  });
  for (let cycle = 1; cycle <= settings['--cycles']; cycle++) {
    for (const fault of ['worker', 'redis']) {
      try {
        await phase(`cycle-${cycle}-${fault}-recovery`, async () => {
          const previousIds = tenants.map((tenant) => [...tenant.expected]);
          const record = { cycle, fault, accepted: [], schedules: [], artifacts: [], breaches: [] };
          evidence.cycles.push(record);
          await command(['stop', '-t', '30', 'worker']);
          for (const [index, tenant] of tenants.entries()) {
            const key = `resilience-${id}-${cycle}-${fault}-${index}`;
            const accepted = await start(tenant, key);
            tenant.expected.push(accepted);
            record.accepted.push(accepted);
            // Replay the same intent: the server must return the same ID.
            ensure(
              (await start(tenant, key)) === accepted,
              'Idempotency replay created a different run',
            );
            const dueAt = Date.now() + 5000;
            const schedule = await json(tenant.client, 'post', '/api/test-plan-schedules', {
              testPlanId: tenant.plan.id,
              scheduleName: `resilience-${cycle}-${fault}`,
              frequency: 'once',
              nextRunAt: Math.ceil(dueAt / 1000),
              timezone: 'UTC',
              retryOnFailure: 'none',
            });
            record.schedules.push({
              tenant: index,
              id: schedule.id,
              dueAt: new Date(dueAt).toISOString(),
            });
          }
          // One-off occurrences become due while the consumer is unavailable.
          if (fault === 'redis') await command(['stop', '-t', '10', 'redis']);
          await sleep(6000);
          const recoveryStart = Date.now();
          const recoveryDeadline = recoveryStart + timeout;
          const remainingRecoveryMs = () => Math.max(0, recoveryDeadline - Date.now());
          if (fault === 'redis') await command(['up', '-d', '--wait', 'redis']);
          await command(['up', '-d', 'worker']);
          if (fault === 'worker') {
            const interruptedId = await waitForRecovery(async () => {
              const rows = await inventory(tenants[0]);
              const active = rows.find(
                (run) => record.accepted.includes(run.id) && run.status === 'running',
              );
              const { agents } = await json(tenants[0].client, 'get', '/api/agents');
              return active &&
                agents.some((agent) => agent.id === tenants[0].agentId && agent.activeSessions > 0)
                ? active.id
                : false;
            }, remainingRecoveryMs());
            if (settings['--worker-restart'] === 'crash') {
              evidence.expectedWorkerLostIds.push(interruptedId);
              record.expectedWorkerLostIds = [interruptedId];
              await command(['kill', '-s', 'SIGKILL', 'worker']);
              await command(['up', '-d', 'worker']);
            } else {
              await command(['restart', '-t', '30', 'worker']);
            }
          }
          for (const tenant of tenants) await connected(tenant, remainingRecoveryMs());
          for (const entry of record.schedules) {
            const tenant = tenants[entry.tenant];
            const rows = await waitForRecovery(async () => {
              const all = await inventory(tenant);
              return all.some((run) => run.scheduleId === entry.id) ? all : false;
            }, remainingRecoveryMs());
            const scheduled = rows.filter((run) => run.scheduleId === entry.id);
            ensure(scheduled.length === 1, `Schedule ${entry.id} created duplicate occurrences`);
            entry.runId = scheduled[0].id;
            tenant.expected.push(entry.runId);
          }
          await waitForRecovery(async () => {
            const inventories = await Promise.all(tenants.map(inventory));
            const currentIds = [
              ...record.accepted,
              ...record.schedules.map((entry) => entry.runId),
            ];
            const rows = inventories.flat();
            return currentIds.every((id) =>
              rows.some(
                (run) =>
                  run.id === id &&
                  ['completed', 'failed', 'error', 'cancelled', 'timed_out'].includes(run.status),
              ),
            );
          }, remainingRecoveryMs());
          record.settledDurationMs = Date.now() - recoveryStart;
          ensure(record.settledDurationMs <= timeout, 'Recovery deadline exceeded');
          // Observe again after the stall interval: a late duplicate cannot pass on first completion.
          await sleep(settings['--observation-seconds'] * 1000);
          for (const [index, tenant] of tenants.entries()) {
            const rows = await inventory(tenant);
            record.breaches.push(
              ...reconcileScenario(
                previousIds[index],
                tenant.expected,
                rows,
                evidence.expectedWorkerLostIds,
              ),
            );
            record.artifacts.push(
              ...(await Promise.all(
                rows
                  .filter((run) => run.status === 'completed')
                  .map(async (run) => ({ runId: run.id, files: await artifacts(tenant, run.id) })),
              )),
            );
            record.observed = [
              ...(record.observed ?? []),
              ...rows.map((run) => ({
                id: run.id,
                scheduleId: run.scheduleId,
                status: run.status,
                failureCode: run.failureCode,
              })),
            ];
          }
          evidence.breaches.push(...record.breaches.map((b) => `cycle ${cycle} ${fault}: ${b}`));
          record.recovered = record.breaches.length === 0 && !record.expectedWorkerLostIds?.length;
          if (record.expectedWorkerLostIds?.length)
            record.crashDetectionPassed = record.breaches.length === 0;
          record.recoveryDurationMs = record.recovered ? record.settledDurationMs : null;
          return record;
        });
      } catch (error) {
        evidence.breaches.push(`cycle ${cycle} ${fault}: ${error.message}`);
      }
    }
    try {
      await phase(`cycle-${cycle}-agent-reconnect`, async () => {
        const fresh = [];
        for (const [index, tenant] of tenants.entries()) {
          // A controlled agent restart between runs verifies reconnect and new-session capacity.
          await command(['restart', `${project}-agent-${index}`], {}, true);
          await connected(tenant);
          const runId = await start(tenant, `resilience-${id}-${cycle}-agent-${index}`);
          tenant.expected.push(runId);
          fresh.push(runId);
        }
        await waitForRecovery(async () => {
          const rows = (await Promise.all(tenants.map(inventory))).flat();
          return fresh.every((id) =>
            rows.some((run) => run.id === id && run.status === 'completed'),
          );
        }, timeout);
      });
    } catch (error) {
      evidence.breaches.push(`cycle ${cycle} agent: ${error.message}`);
    }
  }
  await phase('final-reconciliation-and-retained-artifacts', async () => {
    evidence.final = [];
    const finalBreaches = [];
    for (const tenant of tenants) {
      const rows = await inventory(tenant);
      const found = reconcile(tenant.expected, rows, evidence.expectedWorkerLostIds);
      evidence.breaches.push(...found);
      finalBreaches.push(...found);
      evidence.final.push({
        expected: tenant.expected,
        observed: rows.map((run) => ({
          id: run.id,
          status: run.status,
          scheduleId: run.scheduleId,
          failureCode: run.failureCode,
        })),
        artifacts: await Promise.all(
          rows
            .filter((run) => run.status === 'completed')
            .map(async (run) => ({ runId: run.id, files: await artifacts(tenant, run.id) })),
        ),
      });
    }
    return { breaches: finalBreaches };
  });
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  // Logs and reports survive cleanup; generated secrets and only this project's volumes are removed.
  try {
    fs.writeFileSync(path.join(directory, 'containers.log'), await command(['logs', '--no-color']));
  } catch (error) {
    evidence.cleanupErrors.push(String(error));
  }
  for (const client of contexts)
    await client.dispose().catch((error) => evidence.cleanupErrors.push(String(error)));
  for (const container of agentContainers) {
    try {
      await command(['rm', '-f', container], {}, true);
    } catch (error) {
      evidence.cleanupErrors.push(String(error));
    }
  }
  try {
    await command(['down', '-v', '--remove-orphans']);
  } catch (error) {
    evidence.cleanupErrors.push(String(error));
  }
  evidence.endedAt = new Date().toISOString();
  evidence.success =
    !evidence.error && evidence.breaches.length === 0 && evidence.cleanupErrors.length === 0;
  evidence.successfulRecovery = evidence.success && evidence.expectedWorkerLostIds.length === 0;
  fs.writeFileSync(path.join(directory, 'resilience.json'), JSON.stringify(evidence, null, 2));
  fs.unlinkSync(composeFile);
  transcript.end();
  console.log(`Resilience evidence: ${directory}`);
  if (!evidence.success) process.exitCode = 1;
}
