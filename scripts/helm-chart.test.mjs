// Static checks of deployment/helm/webflowmaster, run with `npm run test:helm`.
//
// No helm binary and no cluster are involved: the templates are checked as text, with a
// placeholder substituted for every {{ action }}, so what is verified is that the chart is
// internally consistent (every value a template reads is declared, the schema accepts the
// defaults, the control structures balance, the YAML around the actions is well formed) and
// consistent with the rest of the repository (the secrets docker-compose.yml demands, the
// commands the Dockerfiles run, the probe paths server/health.ts serves, the metrics ports,
// the queue name KEDA watches, the Prometheus job names the alert rules expect). It does not
// prove that the rendered manifests are what a cluster accepts; see the installation page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chartDir = path.join(root, 'deployment', 'helm', 'webflowmaster');
const templatesDir = path.join(chartDir, 'templates');

const read = (...parts) => readFileSync(path.join(...parts), 'utf8');
const readChart = (...parts) => read(chartDir, ...parts);

const chart = YAML.parse(readChart('Chart.yaml'));
const values = YAML.parse(readChart('values.yaml'));
const schema = JSON.parse(readChart('values.schema.json'));
const templateFiles = readdirSync(templatesDir).sort();
const yamlTemplates = templateFiles.filter((f) => /\.ya?ml$/.test(f));
const templateSources = Object.fromEntries(templateFiles.map((f) => [f, read(templatesDir, f)]));

/** Every file Helm renders: YAML templates, helpers and NOTES.txt. */
const renderedSources = Object.entries(templateSources).filter(([name]) =>
  /\.(ya?ml|tpl|txt)$/.test(name),
);

// ─── Chart.yaml ───────────────────────────────────────────────────────────────

test('Chart.yaml names a v2 chart with a semantic version and an appVersion', () => {
  assert.equal(chart.apiVersion, 'v2');
  assert.equal(chart.name, 'webflowmaster');
  assert.match(String(chart.version), /^\d+\.\d+\.\d+$/);
  assert.match(String(chart.appVersion), /^\d+\.\d+\.\d+/);
  assert.equal(chart.type, 'application');
  assert.ok(chart.description);
});

// ─── values.yaml against values.schema.json ──────────────────────────────────

function hasKeyPath(object, segments) {
  let current = object;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object' || !(segment in current)) return false;
    current = current[segment];
  }
  return true;
}

/** A hand-written subset of JSON schema, used only when the ajv package is not installed. */
function validateRequiredKeys(node, value, at = 'values') {
  const errors = [];
  if (node.$ref) {
    const target = node.$ref.replace('#/definitions/', '');
    return validateRequiredKeys(schema.definitions[target], value, at);
  }
  for (const branch of node.allOf ?? []) errors.push(...validateRequiredKeys(branch, value, at));
  if (node.type === 'object' && (value === null || typeof value !== 'object'))
    errors.push(`${at} should be an object`);
  if (node.type === 'string' && typeof value !== 'string') errors.push(`${at} should be a string`);
  if (node.type === 'integer' && !Number.isInteger(value))
    errors.push(`${at} should be an integer`);
  if (node.type === 'boolean' && typeof value !== 'boolean')
    errors.push(`${at} should be a boolean`);
  if (node.enum && !node.enum.includes(value))
    errors.push(`${at} should be one of ${node.enum.join(', ')}`);
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of node.required ?? [])
      if (!(key in value)) errors.push(`${at}.${key} is required`);
    for (const [key, child] of Object.entries(node.properties ?? {}))
      if (key in value) errors.push(...validateRequiredKeys(child, value[key], `${at}.${key}`));
    if (node.additionalProperties === false)
      for (const key of Object.keys(value))
        if (!(key in (node.properties ?? {}))) errors.push(`${at}.${key} is not a known key`);
  }
  return errors;
}

test('values.schema.json is a draft-07 object schema that accepts values.yaml', () => {
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.type, 'object');
  let Ajv;
  try {
    Ajv = require('ajv');
  } catch {
    Ajv = undefined;
  }
  if (Ajv) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(values);
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
  } else {
    assert.deepEqual(validateRequiredKeys(schema, values), []);
  }
});

test('the schema rejects what the application would reject', () => {
  let Ajv;
  try {
    Ajv = require('ajv');
  } catch {
    return; // Only the ajv path can check rejections; the fallback checks presence and types.
  }
  const validate = new Ajv({ strict: false }).compile(schema);
  const withOverride = (mutate) => {
    const copy = structuredClone(values);
    mutate(copy);
    return validate(copy);
  };
  assert.equal(
    withOverride((v) => (v.config.schedulerBackend = 'quartz')),
    false,
  );
  assert.equal(
    withOverride((v) => (v.secrets.encryptionKey = 'not-hex')),
    false,
  );
  assert.equal(
    withOverride((v) => (v.secrets.encryptionKey = 'ab'.repeat(32))),
    true,
  );
  assert.equal(
    withOverride((v) => (v.artifacts.store = 'nfs')),
    false,
  );
  assert.equal(
    withOverride((v) => (v.config.workerShutdownGraceMs = 500)),
    false,
  );
  assert.equal(
    withOverride((v) => (v.worker.keda.listLength = 2)),
    false,
  );
  assert.equal(
    withOverride((v) => (v.unknownTopLevelKey = true)),
    false,
  );
});

// ─── Templates: every .Values reference is declared ──────────────────────────

const valueReference = /\.Values((?:\.[A-Za-z_][A-Za-z0-9_]*)+)/g;

test('every .Values reference in the templates is declared in values.yaml', () => {
  const missing = [];
  for (const [name, source] of renderedSources) {
    for (const match of source.matchAll(valueReference)) {
      const segments = match[1].slice(1).split('.');
      if (!hasKeyPath(values, segments)) missing.push(`${name}: .Values${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the templates read at least one value from every top-level values.yaml section', () => {
  const referenced = new Set();
  for (const [, source] of renderedSources)
    for (const match of source.matchAll(valueReference))
      referenced.add(match[1].slice(1).split('.')[0]);
  const unused = Object.keys(values).filter((key) => !referenced.has(key));
  assert.deepEqual(unused, []);
});

// ─── Templates: control structures balance, YAML around the actions is well formed ──

const opener = /\{\{-?\s*(if|with|range|define)\b/g;
const closer = /\{\{-?\s*end\b/g;

test('if/with/range/define blocks are balanced in every template', () => {
  for (const [name, source] of renderedSources) {
    const opened = [...source.matchAll(opener)].length;
    const closed = [...source.matchAll(closer)].length;
    assert.equal(opened, closed, `${name}: ${opened} blocks opened, ${closed} closed`);
    assert.equal(
      (source.match(/\{\{/g) ?? []).length,
      (source.match(/\}\}/g) ?? []).length,
      `${name}: unbalanced {{ }}`,
    );
  }
});

/**
 * The static rendering: lines made only of actions (if/else/end/with/range/include/toYaml)
 * disappear, any other action becomes the placeholder `x`. The subset of Go templates the
 * chart uses is written so that this leaves well-formed YAML behind: block actions on lines
 * of their own, scalar actions in value position, `toYaml ... | nindent` on its own line
 * under the key it fills.
 */
function staticRender(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*\{\{.*\}\}\s*$/.test(line) || /\}\}\s*[^\s{]/.test(line))
    .map((line) => line.replace(/\{\{.*?\}\}/g, 'x'))
    .join('\n');
}

test('every YAML template parses once the actions are replaced by placeholders', () => {
  for (const name of yamlTemplates) {
    const rendered = staticRender(templateSources[name]);
    const documents = YAML.parseAllDocuments(rendered, { uniqueKeys: false });
    for (const document of documents) {
      const problems = document.errors.map((e) => e.message);
      assert.deepEqual(problems, [], `${name}:\n${rendered}`);
      const body = document.toJS();
      if (body === null || body === undefined) continue; // A template that renders nothing.
      assert.ok(body.apiVersion, `${name}: a document without apiVersion`);
      assert.ok(body.kind, `${name}: a document without kind`);
      assert.ok(body.metadata?.name, `${name}: ${body.kind} without metadata.name`);
    }
  }
});

test('every template file is a YAML manifest, a helper or the notes, and NOTES.txt exists', () => {
  for (const name of templateFiles)
    assert.match(name, /^(_[a-z-]+\.tpl|[a-z-]+\.yaml|NOTES\.txt)$/);
  assert.ok(templateFiles.includes('NOTES.txt'));
  const expected = [
    'api-deployment.yaml',
    'worker-deployment.yaml',
    'migration-job.yaml',
    'service.yaml',
    'ingress.yaml',
    'configmap.yaml',
    'secret.yaml',
    'pvc.yaml',
    'hpa.yaml',
    'keda-scaledobject.yaml',
    'pdb.yaml',
    'servicemonitor.yaml',
    'networkpolicy.yaml',
    'postgresql.yaml',
    'redis.yaml',
  ];
  for (const name of expected) assert.ok(templateFiles.includes(name), `${name} is missing`);
});

// ─── Consistency with the rest of the repository ─────────────────────────────

const compose = read(root, 'docker-compose.yml');
const composeRequiredSecrets = [
  ...new Set([...compose.matchAll(/\$\{([A-Z_]+):\?/g)].map((m) => m[1])),
];

test('the Secret template defines every variable docker-compose.yml refuses to start without', () => {
  assert.deepEqual(composeRequiredSecrets.sort(), [
    'AGENT_RELAY_SECRET',
    'ENCRYPTION_KEY',
    'POSTGRES_PASSWORD',
    'SESSION_SECRET',
  ]);
  const secret = templateSources['secret.yaml'];
  for (const name of composeRequiredSecrets)
    assert.match(secret, new RegExp(`^\\s+${name}: `, 'm'), `${name} is not a key of the Secret`);
  // The ones every installation needs are refused when empty, not rendered empty.
  for (const name of [
    'SESSION_SECRET',
    'ENCRYPTION_KEY',
    'AGENT_RELAY_SECRET',
    'DATABASE_URL',
    'REDIS_URL',
  ])
    assert.match(
      secret,
      new RegExp(`${name}: \\{\\{ required `),
      `${name} is not guarded by required`,
    );
  // ...and the chart can be told to use a Secret it did not create.
  assert.match(secret, /^\{\{- if not \.Values\.secrets\.existingSecret \}\}/);
  for (const key of [
    'existingSecret',
    'sessionSecret',
    'encryptionKey',
    'agentRelaySecret',
    'databaseUrl',
    'redisUrl',
  ])
    assert.ok(
      schema.properties.secrets.required.includes(key),
      `secrets.${key} is not required by the schema`,
    );
});

function composeCommand(service) {
  const parsed = YAML.parse(compose.replace(/\$\{[^}]*\}/g, 'x'));
  return parsed.services[service].command;
}

function dockerfileCmd(file) {
  const match = read(root, file).match(/^CMD\s+(\[.*\])\s*$/m);
  assert.ok(match, `${file} has no CMD`);
  return JSON.parse(match[1]);
}

test('the containers run the commands the Dockerfiles and docker-compose.yml run', () => {
  const command = (name) => {
    const match = templateSources[name].match(/^\s+command: (\[.*\])$/m);
    assert.ok(match, `${name} has no command`);
    return YAML.parse(match[1]);
  };
  assert.deepEqual(command('migration-job.yaml'), composeCommand('migrate'));
  assert.deepEqual(command('migration-job.yaml'), ['node', 'dist/apply-migrations.js']);
  assert.deepEqual(command('api-deployment.yaml'), dockerfileCmd('Dockerfile'));
  assert.deepEqual(command('worker-deployment.yaml'), dockerfileCmd('Dockerfile.worker'));
  // The migrator uses the api image, as the compose file does (same Dockerfile).
  assert.match(
    templateSources['migration-job.yaml'],
    /image: \{\{ include "webflowmaster\.apiImage" \. \}\}/,
  );
});

test('the migration Job is a Helm hook that runs before install and upgrade', () => {
  const job = templateSources['migration-job.yaml'];
  assert.match(job, /helm\.sh\/hook: pre-install,pre-upgrade/);
  assert.match(job, /helm\.sh\/hook-delete-policy: before-hook-creation,hook-succeeded/);
  assert.match(job, /helm\.sh\/hook-weight:/);
  // The Secret the Job reads is created by an earlier hook when the chart renders it.
  const secret = templateSources['secret.yaml'];
  assert.match(secret, /helm\.sh\/hook: pre-install,pre-upgrade/);
  assert.match(secret, /helm\.sh\/hook-weight: '-10'/);
  assert.match(job, /helm\.sh\/hook-weight: '0'/);
  assert.match(job, /key: ENCRYPTION_KEY/, 'server/crypto.ts needs ENCRYPTION_KEY at import time');
});

test('the api probes use the paths server/health.ts serves', () => {
  const health = read(root, 'server', 'health.ts');
  assert.match(health, /router\.get\('\/healthz'/);
  assert.match(health, /router\.get\('\/readyz'/);
  const api = templateSources['api-deployment.yaml'];
  const probe = (kind) => api.match(new RegExp(`${kind}:\\n\\s+httpGet:\\n\\s+path: (\\S+)`))?.[1];
  assert.equal(probe('readinessProbe'), '/readyz');
  assert.equal(probe('livenessProbe'), '/healthz');
  assert.equal(probe('startupProbe'), '/healthz');
  assert.match(
    api,
    /terminationGracePeriodSeconds: \{\{ \.Values\.api\.terminationGracePeriodSeconds \}\}/,
  );
  // server/index.ts force-exits 10 s after SIGTERM; the pod must be given at least that.
  assert.match(read(root, 'server', 'index.ts'), /process\.exit\(1\);\n\s*\}, 10000\);/);
  assert.ok(values.api.terminationGracePeriodSeconds >= 10);
});

test('the worker is given its shutdown grace and a liveness probe on the metrics port', () => {
  const worker = templateSources['worker-deployment.yaml'];
  assert.match(
    worker,
    /terminationGracePeriodSeconds: \{\{ include "webflowmaster\.workerTerminationGracePeriodSeconds" \. \}\}/,
  );
  const helper = templateSources['_helpers.tpl'];
  assert.match(
    helper,
    /add \(div \(int \.Values\.config\.workerShutdownGraceMs\) 1000\) \(int \.Values\.worker\.terminationGracePeriodMarginSeconds\)/,
  );
  assert.match(
    templateSources['configmap.yaml'],
    /WORKER_SHUTDOWN_GRACE_MS: \{\{ \.Values\.config\.workerShutdownGraceMs \| quote \}\}/,
  );
  const config = read(root, 'server', 'config.ts');
  assert.match(config, /DEFAULT_WORKER_SHUTDOWN_GRACE_MS = 30_000/);
  assert.equal(values.config.workerShutdownGraceMs, 30000);
  // The worker serves only /metrics, so liveness is a TCP check on that port, behind metrics.enabled.
  assert.match(
    worker,
    /\{\{- if \.Values\.metrics\.enabled \}\}[\s\S]*livenessProbe:\n\s+tcpSocket:\n\s+port: metrics/,
  );
  assert.doesNotMatch(worker, /readinessProbe/);
});

test('the metrics ports and the bind address match server/observability/metrics.ts', () => {
  const metrics = read(root, 'server', 'observability', 'metrics.ts');
  const ports = metrics.match(/role === 'api' \? (\d+) : (\d+)/);
  assert.equal(values.metrics.apiPort, Number(ports[1]));
  assert.equal(values.metrics.workerPort, Number(ports[2]));
  assert.match(metrics, /env\.WFM_METRICS_HOST \|\| '127\.0\.0\.1'/);
  assert.match(templateSources['configmap.yaml'], /WFM_METRICS_HOST: '0\.0\.0\.0'/);
  assert.match(templateSources['configmap.yaml'], /WFM_METRICS_ENABLED: 'true'/);
  assert.match(templateSources['secret.yaml'], /WFM_METRICS_TOKEN: \{\{ required /);
});

test('the KEDA trigger watches the BullMQ wait list of the execution queue', () => {
  const queueName = read(root, 'server', 'queue.ts').match(
    /TEST_EXECUTION_QUEUE_NAME = '([^']+)'/,
  )[1];
  const keda = templateSources['keda-scaledobject.yaml'];
  assert.match(keda, new RegExp(`listName: bull:${queueName}:wait`));
  assert.match(keda, /^\{\{- if \.Values\.worker\.keda\.enabled \}\}/);
  assert.match(keda, /kind: ScaledObject/);
  // The HPA and the ScaledObject never both own the worker's replica count.
  assert.match(
    templateSources['hpa.yaml'],
    /and \.Values\.worker\.autoscaling\.enabled \(not \.Values\.worker\.keda\.enabled\)/,
  );
  assert.match(
    templateSources['worker-deployment.yaml'],
    /and \(not \.Values\.worker\.autoscaling\.enabled\) \(not \.Values\.worker\.keda\.enabled\)/,
  );
});

test('the ServiceMonitors use the job names observability/prometheus-alerts.yml alerts on', () => {
  const alerts = read(root, 'observability', 'prometheus-alerts.yml');
  const monitor = templateSources['servicemonitor.yaml'];
  for (const job of ['wfm-api', 'wfm-worker']) {
    assert.match(alerts, new RegExp(`${job}`));
    assert.match(monitor, new RegExp(`replacement: ${job}`));
  }
  assert.match(
    monitor,
    /^\{\{- if and \.Values\.metrics\.enabled \.Values\.metrics\.serviceMonitor\.enabled \}\}/,
  );
  assert.match(monitor, /key: WFM_METRICS_TOKEN/);
});

test('optional resources sit behind their flags', () => {
  const guarded = {
    'ingress.yaml': '.Values.ingress.enabled',
    'pvc.yaml': '.Values.artifacts.persistence.enabled',
    'networkpolicy.yaml': '.Values.networkPolicy.enabled',
    'postgresql.yaml': '.Values.postgresql.enabled',
    'redis.yaml': '.Values.redis.enabled',
    'migration-job.yaml': '.Values.migrations.enabled',
    'pdb.yaml': '.Values.api.podDisruptionBudget.enabled',
    'hpa.yaml': '.Values.api.autoscaling.enabled',
  };
  for (const [name, flag] of Object.entries(guarded))
    assert.ok(
      templateSources[name].startsWith(`{{- if`) && templateSources[name].includes(flag),
      `${name} is not behind ${flag}`,
    );
  assert.match(templateSources['pdb.yaml'], /kind: PodDisruptionBudget/);
  assert.match(templateSources['networkpolicy.yaml'], /kind: NetworkPolicy/);
  // The evaluation stores say what they are.
  for (const name of ['postgresql.yaml', 'redis.yaml'])
    assert.match(templateSources[name], /EVALUATION ONLY/);
  for (const key of ['postgresql', 'redis']) assert.equal(values[key].enabled, false);
});

test('the volumes mirror docker-compose.yml and multi-replica installs are warned about', () => {
  const mounts = templateSources['_volumes.tpl'];
  for (const mountPath of ['/app/results', '/app/data/visual-baselines']) {
    assert.match(compose, new RegExp(`:${mountPath}`), `compose does not mount ${mountPath}`);
    assert.match(mounts, new RegExp(`mountPath: ${mountPath}`));
  }
  assert.match(templateSources['NOTES.txt'], /ReadWriteMany/);
  assert.match(readChart('values.yaml'), /ReadWriteMany/);
});

test('the ingress keeps the WebSocket paths open and values.yaml documents the nginx annotations', () => {
  assert.match(templateSources['ingress.yaml'], /kind: Ingress/);
  assert.match(templateSources['ingress.yaml'], /\{\{- with \.Values\.ingress\.tls \}\}/);
  assert.ok(values.ingress.annotations['nginx.ingress.kubernetes.io/proxy-read-timeout']);
  assert.ok(values.ingress.annotations['nginx.ingress.kubernetes.io/proxy-body-size']);
});
