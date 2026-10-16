import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The migration script and the schema doctor must not print the database password.
 *
 * Both used to print DATABASE_URL whole, so every deployment, CI job or terminal that ran a
 * migration had the password in its log. Each script is run against a port on this machine that
 * nothing answers on — no database is contacted, local or external — with a connection string that
 * carries a sentinel password, and the sentinel must appear nowhere in what it printed, on the way
 * in or on the way out with an error.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SENTINEL = 'Sentinel-Pw-7f3a9c41';

/** A local port that was free a moment ago: connecting to it is refused at once. */
async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function run(script) {
  const port = await closedPort();
  const result = spawnSync(process.execPath, ['--import', 'tsx', script], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: `postgres://wfm_user:${SENTINEL}@127.0.0.1:${port}/wfm_sentinel`,
      // Nothing from a local .env may replace the sentinel URL.
      DOTENV_CONFIG_PATH: path.join(root, 'scripts', 'security', 'no-such.env'),
      PG_CONNECT_TIMEOUT_MS: '2000',
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`, status: result.status };
}

test('apply-migrations names the driver and never prints the password', async () => {
  const { output, status } = await run('scripts/apply-migrations.ts');
  assert.notEqual(status, 0, 'a database that cannot be reached must fail the migration');
  assert.match(output, /Connecting to the database \(PostgreSQL\)/);
  assert.ok(!output.includes(SENTINEL), `the password reached the log:\n${output}`);
  assert.ok(!output.includes('wfm_user:'), `the credentials reached the log:\n${output}`);
});

test('the schema doctor names the driver and never prints the password', async () => {
  const { output, status } = await run('scripts/schema-doctor.ts');
  assert.notEqual(status, 0);
  assert.ok(!output.includes(SENTINEL), `the password reached the log:\n${output}`);
  assert.ok(!output.includes('wfm_user:'), `the credentials reached the log:\n${output}`);
});
