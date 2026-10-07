import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { drillCompose, recoveryMetrics } from './restore-drill-core.mjs';

test('existing project overrides are refused before Docker or fixture creation', () => {
  const result = spawnSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/restore-drill.mjs', '--project', 'live'],
    { encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /takes no arguments/);
  assert.doesNotMatch(result.stdout, /build|source-start|Recovery evidence/);
});

test('isolated Compose never mounts a host path or uses external stores', () => {
  const config = drillCompose('/repo', 'key', 'session');
  assert.deepEqual(config.services.api.ports, ['127.0.0.1::5000']);
  assert.equal(config.services.postgres.ports, undefined);
  assert.equal(config.services.redis.ports, undefined);
  assert.equal(config.services.api.environment.ARTIFACT_STORE, 'local');
  for (const volume of Object.values(config.volumes)) assert.deepEqual(volume, {});
  assert.deepEqual(config.services.worker.volumes, config.services.api.volumes);
  assert.match(config.services.api.environment.DATABASE_URL, /wfm_drill:/);
});

test('recovery metrics distinguish restore duration from backup age and fail incomplete probes', () => {
  const phases = [{ name: 'restore', durationMs: 12, success: true }];
  assert.deepEqual(
    recoveryMetrics('2026-10-07T10:00:00Z', 1000, 5000, phases, new Date('2026-10-07T10:00:30Z')),
    {
      recoveryDurationMs: 4000,
      backupAgeAtRecoveryMs: 30000,
      phases,
      success: true,
    },
  );
  assert.equal(
    recoveryMetrics('2026-10-07T10:00:00Z', 0, 1, [
      { name: 'login', durationMs: 1, success: false },
    ]).success,
    false,
  );
});
