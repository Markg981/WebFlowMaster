// P04 (C10): the local quickstart publishes nothing beyond the loopback.
//
// The check reads the configuration Docker Compose would actually run (`docker compose config`),
// not the YAML text: an overlay that adds a port to a list merges with the base one instead of
// replacing it, so a file can look loopback-only while the merged stack still listens on every
// interface. Each local profile is rendered with its overlays and every published port must name
// a loopback host IP.
//
// Shared exposure belongs to deployment/ (TLS and the reverse proxy are the operator's), not to
// these files. Run with: node --test scripts/security/compose-bindings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Every profile someone starts on a workstation, as it is started (see the files' headers).
const LOCAL_PROFILES = [
  { name: 'quickstart', files: ['docker-compose.yml'] },
  { name: 'quickstart + telemetry', files: ['docker-compose.yml', 'docker-compose.telemetry.yml'] },
  {
    name: 'collaudo (all profiles)',
    files: ['docker-compose.yml', 'collaudo/docker-compose.collaudo.yml'],
    envFile: 'collaudo/collaudo.env',
  },
  {
    name: 'collaudo + promo demo',
    files: [
      'docker-compose.yml',
      'collaudo/docker-compose.collaudo.yml',
      'marketing/promo-video/docker-compose.demo.yml',
    ],
    envFile: 'collaudo/collaudo.env',
  },
  { name: 'observability', files: ['docker-compose.observability.yml'] },
  { name: 'e2e stores', files: ['e2e/docker-compose.yml'] },
];

// Compose files that are not a local profile, and why. A new compose file must be added to one
// of the two lists, so nobody ships one the check silently ignores.
const NOT_LOCAL = {
  // Runs in WSL's own Docker Engine (it needs /dev/kvm); the collaudo containers reach Appium
  // through host.docker.internal:4723, which is not the WSL loopback.
  'collaudo/mobile/docker-compose.mobile.yml': 'Android emulator in the WSL engine',
  'deployment/releases/compose.yml': 'shared deployment, operator-supplied TLS and proxy',
  'deployment/saas-network/compose.yml': 'shared deployment, standalone',
  'deployment/saas-network/check.compose.yml': 'disposable boundary harness',
  'deployment/bdd-agent/compose.example.yml': 'agent example, publishes nothing',
};

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

// The values the files require (`${VAR:?…}`); rendering needs them, their content is irrelevant.
const PLACEHOLDER_ENV = {
  POSTGRES_PASSWORD: 'x',
  SESSION_SECRET: 'x',
  ENCRYPTION_KEY: '0'.repeat(63) + '1',
  AGENT_RELAY_SECRET: 'x',
  GRAFANA_ADMIN_PASSWORD: 'x',
};

/** Publications reachable from beyond this machine, as `service: description` strings. */
export function publicBindings(config) {
  const found = [];
  for (const [service, def] of Object.entries(config.services ?? {})) {
    if (def.network_mode === 'host') found.push(`${service}: network_mode host`);
    for (const port of def.ports ?? []) {
      if (port.published === undefined || port.published === '') continue;
      if (!LOOPBACK.has(port.host_ip ?? '')) {
        found.push(
          `${service}: ${port.host_ip || '0.0.0.0'}:${port.published}->${port.target}/${port.protocol ?? 'tcp'}`,
        );
      }
    }
  }
  return found;
}

function dockerCompose() {
  const probe = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  return probe.status === 0;
}

function render({ files, envFile }) {
  const args = ['compose', '--project-directory', root];
  if (envFile) args.push('--env-file', path.join(root, envFile));
  for (const f of files) args.push('-f', path.join(root, f));
  args.push('--profile', '*', 'config', '--format', 'json');
  const out = execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...PLACEHOLDER_ENV },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

test('the checker flags a publication without a loopback host IP', () => {
  const config = {
    services: {
      postgres: {
        ports: [
          { target: 5432, published: '5432', host_ip: '127.0.0.1', protocol: 'tcp' },
          // What a list merge leaves behind: the overlay's entry next to the base one.
          { target: 5432, published: '55432', protocol: 'tcp' },
        ],
      },
      redis: { expose: ['6379'] },
      agent: { network_mode: 'host' },
    },
  };
  assert.deepEqual(publicBindings(config), [
    'postgres: 0.0.0.0:55432->5432/tcp',
    'agent: network_mode host',
  ]);
});

test('every compose file in the repository is classified', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(f));
  const known = new Set([...LOCAL_PROFILES.flatMap((p) => p.files), ...Object.keys(NOT_LOCAL)]);
  assert.deepEqual(
    tracked.filter((f) => !known.has(f)),
    [],
    'add the file to LOCAL_PROFILES or NOT_LOCAL',
  );
});

const hasDocker = dockerCompose();
// CI must render the stacks: a skipped check there would be a false green.
const skip = !hasDocker && !process.env.CI ? 'docker compose is not available' : false;

for (const profile of LOCAL_PROFILES) {
  test(`${profile.name}: the merged configuration publishes only on the loopback`, { skip }, () => {
    const config = render(profile);
    assert.ok(Object.keys(config.services ?? {}).length > 0, 'the profile rendered no services');
    assert.deepEqual(publicBindings(config), []);
  });
}

test('the quickstart still publishes what the host-run server and the tools use', { skip }, () => {
  const config = render(LOCAL_PROFILES[0]);
  const published = Object.entries(config.services)
    .flatMap(([s, d]) => (d.ports ?? []).map((p) => `${s}:${p.published}`))
    .sort();
  assert.deepEqual(published, [
    'api:5000',
    'mailpit:1025',
    'mailpit:8025',
    'postgres:5432',
    'redis:6379',
  ]);
  // Not set to Secure: this stack is plain HTTP on localhost.
  assert.ok(config.services.api.environment.SESSION_COOKIE_SECURE === 'false');
});
