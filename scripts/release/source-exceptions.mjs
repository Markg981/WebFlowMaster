import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const POLICY_FILE = 'deployment/releases/source-exceptions.json';
const TARGETS = ['package-lock.json', 'client/package-lock.json'];
const PATCH_SCRIPT = 'scripts/security/apply-braces-patch.cjs';
const PATCH_SCRIPT_SHA256 = 'e0200102d13d22ea15727ec3c777a1b36300655ab944db0ab29f93a3ad3c0bef';
const ORIGINAL_PARSER_SHA256 = 'e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310';
const PATCHED_PARSER_SHA256 = 'e138ec9323d44baed7dca13f9b40d7b7a365d3c871ef8c25c56b2d8828038862';
const REPLACEMENT =
  "      if (depth >= 100) throw new SyntaxError('braces exceeds maximum nesting depth (100)');\n      depth++;";
const EXPIRY = '2026-11-06T00:00:00.000Z';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function validatePolicy(policy, now) {
  if (
    policy?.schemaVersion !== 1 ||
    !Array.isArray(policy.exceptions) ||
    policy.exceptions.length !== 1
  )
    throw new Error('Invalid source exception policy');
  const rule = policy.exceptions[0];
  if (
    !rule ||
    rule.vulnerabilityId !== 'CVE-2026-93687' ||
    rule.package !== 'braces' ||
    rule.installedVersion !== '3.0.3' ||
    rule.severity !== 'HIGH' ||
    rule.expiresAt !== EXPIRY ||
    rule.patchScript !== PATCH_SCRIPT ||
    rule.patchScriptSha256 !== PATCH_SCRIPT_SHA256 ||
    !Array.isArray(rule.targets) ||
    rule.targets.length !== TARGETS.length ||
    rule.targets.some((target, index) => target !== TARGETS[index])
  )
    throw new Error('Invalid or broadened source exception policy');
  const instant = new Date(now).getTime();
  if (!Number.isFinite(instant)) throw new Error('Invalid source exception verification time');
  if (instant >= Date.parse(rule.expiresAt)) throw new Error('Source exception policy expired');
  return rule;
}

function validateReport(report) {
  if (report?.SchemaVersion !== 2 || !Array.isArray(report.Results))
    throw new Error('Missing or unsupported Trivy report');
  for (const result of report.Results) {
    if (
      !result ||
      typeof result !== 'object' ||
      (result.Vulnerabilities !== undefined && !Array.isArray(result.Vulnerabilities))
    )
      throw new Error('Malformed Trivy result');
    for (const finding of result.Vulnerabilities ?? []) {
      if (!['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(finding?.Severity))
        throw new Error('Malformed vulnerability severity');
    }
  }
}

// Run fresh child processes: tests cannot accidentally exercise the root's cached module
// while attesting a different parser in the client or a nested dependency tree.
const MITIGATION_TESTS = `
const assert = require('node:assert/strict');
const braces = require(process.argv[1]);
const methods = ['parse','compile','expand','stringify'];
assert.deepEqual(braces.expand('src/{api,worker}/**/*.{js,ts}'), ['src/api/**/*.js','src/api/**/*.ts','src/worker/**/*.js','src/worker/**/*.ts']);
for (const method of methods) {
  assert.doesNotThrow(() => braces[method]('\\\\{'.repeat(200)));
  assert.doesNotThrow(() => braces[method]('"' + '{'.repeat(200) + '"'));
  assert.doesNotThrow(() => braces[method]('{'.repeat(100) + 'a,b' + '}'.repeat(100)));
  assert.throws(() => braces[method]('{'.repeat(101) + 'a,b' + '}'.repeat(101)), error => error instanceof SyntaxError && /maximum nesting depth/.test(error.message));
}
process.stdout.write(JSON.stringify({passed:true,methods,maxDepth:100}));
`;

function inside(root, path) {
  const resolved = realpathSync(path),
    difference = relative(realpathSync(root), resolved);
  if (difference === '..' || difference.startsWith(`..${sep}`) || isAbsolute(difference))
    throw new Error('Installed braces copy escapes its lockfile tree');
  return resolved;
}

function verifyInstalledCopies(root) {
  const mitigations = [],
    lockfiles = [];
  for (const target of TARGETS) {
    const lockBytes = readFileSync(join(root, target)),
      lock = JSON.parse(lockBytes);
    if (
      lock.lockfileVersion !== 3 ||
      !lock.packages ||
      typeof lock.packages !== 'object' ||
      Array.isArray(lock.packages)
    )
      throw new Error(`Invalid lockfile for source exception: ${target}`);
    lockfiles.push({ path: target, sha256: sha256(lockBytes) });
    const copies = Object.entries(lock.packages).filter(([path]) => path.endsWith('/braces'));
    if (!copies.length) throw new Error(`Missing locked braces copies: ${target}`);
    const treeRoot = resolve(root, dirname(target));
    for (const [packagePath, pkg] of copies) {
      if (
        !/^node_modules\/(?:[^/]+\/)*braces$/.test(packagePath) ||
        packagePath
          .split('/')
          .some((part) => part === '.' || part === '..' || part.includes('\\')) ||
        pkg?.version !== '3.0.3'
      )
        throw new Error(`Unexpected locked braces copy: ${target}:${packagePath}`);
      const absolute = join(treeRoot, packagePath);
      let parser, packageJson;
      try {
        parser = inside(treeRoot, join(absolute, 'lib/parse.js'));
        packageJson = inside(treeRoot, join(absolute, 'package.json'));
      } catch (error) {
        throw new Error(`Missing or unsafe installed braces copy: ${target}:${packagePath}`, {
          cause: error,
        });
      }
      if (JSON.parse(readFileSync(packageJson, 'utf8')).version !== '3.0.3')
        throw new Error(`Unexpected installed braces version: ${target}:${packagePath}`);
      const source = readFileSync(parser, 'utf8').replaceAll('\r\n', '\n');
      if (
        sha256(source) !== PATCHED_PARSER_SHA256 ||
        sha256(source.replace(REPLACEMENT, '      depth++;')) !== ORIGINAL_PARSER_SHA256
      )
        throw new Error(`Unpatched or altered braces parser: ${target}:${packagePath}`);
      const executed = spawnSync(process.execPath, ['-e', MITIGATION_TESTS, resolve(absolute)], {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 128 * 1024,
        cwd: treeRoot,
        windowsHide: true,
      });
      if (executed.error || executed.status !== 0)
        throw new Error(`Braces mitigation tests failed: ${target}:${packagePath}`, {
          cause: executed.error,
        });
      let tests;
      try {
        tests = JSON.parse(executed.stdout);
      } catch {
        throw new Error(`Braces mitigation tests produced no evidence: ${target}:${packagePath}`);
      }
      if (
        tests.passed !== true ||
        tests.maxDepth !== 100 ||
        JSON.stringify(tests.methods) !== '["parse","compile","expand","stringify"]'
      )
        throw new Error(`Invalid braces mitigation tests evidence: ${target}:${packagePath}`);
      mitigations.push({ lockfile: target, packagePath, parserSha256: sha256(source), tests });
    }
  }
  return { mitigations, lockfiles };
}

/**
 * Source gate only. The original report is immutable; the caller retains that complete
 * artifact and records the returned acceptance evidence separately. Image gates never call
 * this evaluator. Every evaluation rechecks the patch and executes each installed copy.
 */
export function evaluateSourceExceptions(
  report,
  { root = process.cwd(), now = new Date(), policy, reportBytes } = {},
) {
  validateReport(report);
  const policyBytes =
    policy === undefined
      ? readFileSync(join(root, POLICY_FILE))
      : Buffer.from(JSON.stringify(policy));
  const rule = validatePolicy(policy === undefined ? JSON.parse(policyBytes) : policy, now);
  const filtered = structuredClone(report),
    accepted = [],
    blocked = [];
  for (const result of filtered.Results) {
    if (!result.Vulnerabilities) continue;
    result.Vulnerabilities = result.Vulnerabilities.filter((finding) => {
      if (!['HIGH', 'CRITICAL'].includes(finding.Severity)) return true;
      if (
        rule.targets.includes(result.Target) &&
        result.Class === 'lang-pkgs' &&
        result.Type === 'npm' &&
        finding.VulnerabilityID === rule.vulnerabilityId &&
        finding.PkgName === rule.package &&
        finding.InstalledVersion === rule.installedVersion &&
        finding.Severity === rule.severity &&
        (finding.FixedVersion === undefined || finding.FixedVersion === '')
      ) {
        accepted.push({
          target: result.Target,
          vulnerabilityId: finding.VulnerabilityID,
          package: finding.PkgName,
          installedVersion: finding.InstalledVersion,
          severity: finding.Severity,
        });
        return false;
      }
      blocked.push(
        `${result.Target}: ${finding.PkgName}@${finding.InstalledVersion} [${finding.VulnerabilityID}, ${finding.Severity}]`,
      );
      return true;
    });
  }
  if (blocked.length)
    throw new Error(
      `Source release blocked by unaccepted HIGH/CRITICAL vulnerabilities:\n${blocked.join('\n')}`,
    );
  const patchBytes = readFileSync(join(root, PATCH_SCRIPT));
  if (sha256(patchBytes) !== rule.patchScriptSha256)
    throw new Error('Altered source mitigation patch script');
  const { mitigations, lockfiles } = verifyInstalledCopies(root);
  if (
    reportBytes !== undefined &&
    JSON.stringify(JSON.parse(reportBytes)) !== JSON.stringify(report)
  )
    throw new Error('Raw Trivy report bytes do not match evaluated report');
  return {
    report: filtered,
    evidence: {
      schemaVersion: 1,
      verifiedAt: new Date(now).toISOString(),
      policySha256: sha256(policyBytes),
      patchScriptSha256: sha256(patchBytes),
      expiresAt: rule.expiresAt,
      ...(reportBytes === undefined
        ? { canonicalReportSha256: sha256(JSON.stringify(report)) }
        : { rawReportSha256: sha256(reportBytes) }),
      accepted,
      lockfiles,
      mitigations,
    },
  };
}
