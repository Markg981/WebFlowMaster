// A synthetic installation recovered into a second, fresh Docker Compose project.
// This command accepts no project/database/bucket override: it cannot restore over live data.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { main as backup, readManifest } from './wfm-backup.ts';
import { drillCompose, recoveryMetrics } from './restore-drill-core.mjs';

if (process.argv.length > 2)
  throw new Error('backup:drill takes no arguments; only disposable local fixtures are supported.');
const root = process.cwd();
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const workingTreeDirty =
  execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().length > 0;
const id = randomUUID().replaceAll('-', '').slice(0, 12);
const directory = path.resolve('restore-drill-artifacts', id);
fs.mkdirSync(directory, { recursive: true });
const file = path.join(directory, 'compose.json');
fs.writeFileSync(
  file,
  JSON.stringify(
    drillCompose(root, randomBytes(32).toString('hex'), randomBytes(32).toString('hex'), id),
  ),
);
const source = `wfm-drill-source-${id}`;
const target = `wfm-drill-target-${id}`;
const phases = [];
const transcript = fs.createWriteStream(path.join(directory, 'operations.log'));
let recoveryStart;
let manifest;
let browser;
let failure;
let historicalRun;
let recoveredRun;
const images = {};

function command(project, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', '-p', project, '-f', file, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
      transcript.write(data);
    });
    child.stderr.on('data', (data) => transcript.write(data));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(
            new Error(`Docker ${args.slice(0, 3).join(' ')} failed (${code}); see operations.log`),
          ),
    );
  });
}
async function phase(name, operation) {
  console.log(name);
  const start = performance.now();
  const result = { name, success: false, durationMs: 0 };
  phases.push(result);
  try {
    const value = await operation();
    result.success = true;
    return value;
  } finally {
    result.durationMs = Math.round(performance.now() - start);
  }
}
function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
async function json(request, method, url, data) {
  const response = await request[method](url, data === undefined ? {} : { data });
  ensure(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`);
  return response.json();
}
async function url(project) {
  return `http://${await command(project, ['port', 'api', '5000'])}`;
}
async function ready(base) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/registration`)).ok) return;
    } catch {
      /* booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Application did not become ready in 90 seconds');
}
async function initialize(project) {
  await command(project, ['up', '-d', '--wait', 'postgres', 'redis']);
  await command(project, [
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
  await command(project, ['run', '--rm', '-T', 'migrate']);
  await command(project, [
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
    'GRANT app_user TO wfm_drill; GRANT USAGE ON SCHEMA drizzle TO wfm_drill; GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO wfm_drill; ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA drizzle GRANT SELECT ON TABLES TO wfm_drill;',
  ]);
  await command(project, ['up', '-d', 'api', 'worker']);
  const base = await url(project);
  await ready(base);
  images[project] = await command(project, ['images', '--format', 'json']);
  return base;
}
const password = `Drill!${randomBytes(16).toString('hex')}`;
async function account(base, username, register) {
  const context = await browser.newContext({ baseURL: base, locale: 'en-US' });
  const page = await context.newPage();
  await page.goto('/auth');
  if (register) {
    await page.getByRole('tab', { name: 'Register', exact: true }).click();
    await page.locator('#register-username').fill(username);
    await page.locator('#register-password').fill(password);
    await page.locator('#confirm-password').fill(password);
    await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  } else {
    await page.locator('#login-username').fill(username);
    await page.locator('#login-password').fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  }
  await page.waitForURL('**/dashboard');
  return { context, page };
}
async function run(page, planId) {
  await page.goto(`/test-plan/${planId}/run`);
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Recovery secret', exact: true }).click();
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/run-test-plan/${planId}`) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Start Execution', exact: true }).click();
  const response = await pending;
  ensure(response.ok(), `Run could not start: ${await response.text()}`);
  const runId = (await response.json()).data.id;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const execution = await json(page.request, 'get', `/api/test-plan-executions/${runId}`);
    if (['completed', 'failed', 'cancelled'].includes(execution.status)) {
      ensure(
        execution.status === 'completed' &&
          execution.results.length === 1 &&
          execution.results[0].success,
        `Run ${runId} did not pass: ${JSON.stringify(execution.results)}`,
      );
      return runId;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Run ${runId} exceeded 120 seconds`);
}
async function report(page, planId, runId, label) {
  await page.goto(`/test-plans/${planId}/executions/${runId}/report`);
  await page.getByText('100.00% Pass Rate', { exact: true }).waitFor();
  const body = await json(page.request, 'get', `/api/test-plan-executions/${runId}/report`);
  const serialized = JSON.stringify(body);
  const links = [
    ...new Set(serialized.match(/\/api\/test-plan-executions\/[^"\s]+\/artifacts\/[^"\s]+/g) ?? []),
  ];
  ensure(links.length > 0, 'Report has no artifact links');
  const evidence = [];
  for (const link of links) {
    const response = await page.request.get(link);
    ensure(response.ok(), `Evidence unavailable: ${link}`);
    const data = await response.body();
    ensure(data.length > 0, `Empty evidence: ${link}`);
    evidence.push({
      url: link,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
  }
  fs.writeFileSync(
    path.join(directory, `${label}-evidence.json`),
    JSON.stringify(evidence, null, 2),
  );
  await page.screenshot({ path: path.join(directory, `${label}-report.png`), fullPage: true });
  return evidence;
}

try {
  await phase('build', async () => {
    await command(source, ['build', 'api', 'worker']);
  });
  browser = await chromium.launch({ headless: true });
  const sourceUrl = await phase('source-start', () => initialize(source));
  const owner = await account(sourceUrl, `owner_${id}`, true);
  const other = await account(sourceUrl, `other_${id}`, true);
  const environment = await json(owner.page.request, 'post', '/api/environments', {
    name: 'Recovery secret',
  });
  await json(owner.page.request, 'post', `/api/environments/${environment.id}/secrets`, {
    keyName: 'recoveryPath',
    value: 'auth',
  });
  const test = await json(owner.page.request, 'post', '/api/tests', {
    name: 'Recovery browser evidence',
    url: 'http://api:5000/{{recoveryPath}}',
    elements: [],
    module: 'Recovery',
    component: 'Browser',
    sequence: [
      {
        id: 'navigate',
        action: {
          id: 'navigate',
          type: 'navigate',
          name: 'Open restored secret URL',
          icon: 'g',
          description: 'Recovery',
        },
        value: 'http://api:5000/{{recoveryPath}}',
        targetElement: null,
      },
    ],
  });
  await json(owner.page.request, 'post', `/api/tests/${test.id}/publish`, {});
  const plan = await json(owner.page.request, 'post', '/api/test-plans', {
    name: 'Recovery plan',
    selectedTests: [{ id: test.id, type: 'ui' }],
    captureScreenshots: 'always',
    testMachinesConfig: [{ browserName: 'chromium', headless: true }],
    maxParallelTests: 1,
  });
  historicalRun = await phase('source-run', () => run(owner.page, plan.id));
  const original = await report(owner.page, plan.id, historicalRun, 'source');
  // A real image in the second archive, so an empty baseline directory cannot pass the drill.
  const relativeImage = decodeURIComponent(original[0].url.split('/artifacts/')[1]);
  const baseline = `/app/data/visual-baselines/org_1/test_${test.id}/chromium/recovery.png`;
  let baselineHash;
  await phase('baseline-fixture', async () => {
    await command(source, ['exec', '-T', 'api', 'mkdir', '-p', path.posix.dirname(baseline)]);
    await command(source, [
      'exec',
      '-T',
      'api',
      'cp',
      `/app/results/${plan.id}/${historicalRun}/${relativeImage}`,
      baseline,
    ]);
    baselineHash = await command(source, ['exec', '-T', 'api', 'sha256sum', baseline]);
  });
  await phase('backup', async () => {
    ensure(
      (await backup([
        'create',
        '--out',
        path.join(directory, 'backup'),
        '-p',
        source,
        '-f',
        file,
      ])) === 0,
      'Backup failed',
    );
  });
  const backupDir = path.join(
    directory,
    'backup',
    fs.readdirSync(path.join(directory, 'backup'))[0],
  );
  manifest = readManifest(backupDir);
  await owner.context.close();
  await other.context.close();
  await phase('source-destroy', () => command(source, ['down', '-v', '--remove-orphans']));
  recoveryStart = performance.now();
  let targetUrl = await phase('target-start', () => initialize(target));
  await phase('checksum-db-rls-verification', async () => {
    ensure(
      (await backup(['verify', backupDir, '-p', target, '-f', file])) === 0,
      'Verification failed',
    );
  });
  await phase('restore', async () => {
    ensure(
      (await backup(['restore', backupDir, '-p', target, '-f', file, '--yes'])) === 0,
      'Restore failed',
    );
    targetUrl = await url(target);
    await ready(targetUrl);
  });
  const recovered = await phase('login', () => account(targetUrl, `owner_${id}`, false));
  await phase('restored-baseline', async () => {
    ensure(
      (await command(target, ['exec', '-T', 'api', 'sha256sum', baseline])) === baselineHash,
      'Restored baseline differs from original',
    );
  });
  await phase('historical-report-evidence', async () => {
    const restored = await report(recovered.page, plan.id, historicalRun, 'restored');
    ensure(
      JSON.stringify(restored) === JSON.stringify(original),
      'Restored evidence differs from original',
    );
  });
  await phase('tenant-isolation', async () => {
    const foreign = await account(targetUrl, `other_${id}`, false);
    try {
      ensure(
        (await json(foreign.page.request, 'get', '/api/tests')).length === 0,
        'Other tenant can list restored tests',
      );
      ensure(
        (
          await foreign.page.request.get(`/api/test-plan-executions/${historicalRun}/report`)
        ).status() === 404,
        'Other tenant can read restored report',
      );
      ensure(
        (await foreign.page.request.get(original[0].url)).status() === 404,
        'Other tenant can read restored evidence',
      );
    } finally {
      await foreign.context.close();
    }
  });
  recoveredRun = await phase('recovered-run-secret-decryption', () => run(recovered.page, plan.id));
  await phase('new-report-evidence', () => report(recovered.page, plan.id, recoveredRun, 'new'));
  await recovered.context.close();
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  const metrics =
    manifest && recoveryStart !== undefined
      ? recoveryMetrics(manifest.createdAt, recoveryStart, performance.now(), phases)
      : { phases, success: false };
  if (failure) metrics.success = false;
  // No credential values, generated Compose file or passwords in published evidence.
  fs.writeFileSync(
    path.join(directory, 'recovery.json'),
    JSON.stringify(
      {
        ...metrics,
        sourceRevision,
        workingTreeDirty,
        syntheticFixture: true,
        artifactStore: 'local',
        s3Recovery: 'not-tested',
        historicalRun,
        recoveredRun,
        images,
        error: failure ? String(failure) : undefined,
      },
      null,
      2,
    ),
  );
  const cleanupErrors = [];
  try {
    await browser?.close();
  } catch (error) {
    cleanupErrors.push(`Browser teardown: ${error}`);
    process.exitCode = 1;
  }
  for (const project of [source, target]) {
    // Preserve diagnostic logs when possible; failure to read logs must not skip cleanup.
    try {
      await command(project, ['logs', '--no-color']);
    } catch {
      /* project may not exist */
    }
    try {
      await command(project, ['down', '-v', '--remove-orphans']);
    } catch (error) {
      cleanupErrors.push(String(error));
      console.error(`Cleanup ${project}: ${error}`);
      process.exitCode = 1;
    }
  }
  if (cleanupErrors.length) {
    metrics.success = false;
    fs.writeFileSync(
      path.join(directory, 'recovery.json'),
      JSON.stringify(
        {
          ...metrics,
          sourceRevision,
          workingTreeDirty,
          syntheticFixture: true,
          artifactStore: 'local',
          s3Recovery: 'not-tested',
          historicalRun,
          recoveredRun,
          images,
          cleanupErrors,
          error: failure ? String(failure) : undefined,
        },
        null,
        2,
      ),
    );
  }
  fs.unlinkSync(file);
  transcript.end();
  console.log(`Recovery evidence: ${directory}`);
  if (failure) process.exitCode = 1;
}
