/**
 * The R1 rollback contract, checked before a release is built.
 *
 *   node scripts/release/compatibility.mjs check             declaration matches the code
 *   node scripts/release/compatibility.mjs check 1.2.0       the same, plus the rules for tag v1.2.0
 *
 * deployment/releases/data-compatibility.json declares the execution formats a release reads
 * (`SUPPORTED_EXECUTION_PROTOCOLS` in shared/execution-provenance.ts) and the oldest release an
 * installation may roll back to once it has run this one. A format change that is not declared
 * fails every build. A tagged release must declare its minimum, never above itself; when its
 * formats differ from the previous v* tag's (or there is no previous tag) the minimum is the
 * release itself, because older code would refuse or misread what it writes.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DECLARATION = 'deployment/releases/data-compatibility.json';
export const PROTOCOLS_SOURCE = 'shared/execution-provenance.ts';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** The protocol lists out of the TypeScript constant, without compiling it. */
export function parseSupportedProtocols(source) {
  const block = /export const SUPPORTED_EXECUTION_PROTOCOLS = \{([\s\S]*?)\} as const;/.exec(
    source,
  );
  if (!block) throw new Error(`SUPPORTED_EXECUTION_PROTOCOLS not found in ${PROTOCOLS_SOURCE}`);
  const formats = {};
  for (const [, name, list] of block[1].matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm))
    formats[name] = list
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map(Number);
  if (!Object.keys(formats).length) throw new Error('SUPPORTED_EXECUTION_PROTOCOLS is empty');
  return formats;
}

const canonical = (formats) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(formats ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, list]) => [name, [...list].sort((a, b) => a - b)]),
    ),
  );

export const sameFormats = (a, b) => canonical(a) === canonical(b);

/** -1, 0 or 1; a pre-release sorts before its release, pre-releases compare as text. */
export function compareVersions(a, b) {
  const [x, y] = [SEMVER.exec(a), SEMVER.exec(b)];
  if (!x || !y) throw new Error(`Not a semantic version: ${x ? b : a}`);
  for (let i = 1; i <= 3; i += 1)
    if (Number(x[i]) !== Number(y[i])) return Number(x[i]) < Number(y[i]) ? -1 : 1;
  if (x[4] === y[4]) return 0;
  if (!x[4]) return 1;
  if (!y[4]) return -1;
  return x[4] < y[4] ? -1 : 1;
}

/**
 * What is wrong, as messages; empty means the gate passes. `previous` is the declaration at the
 * previous v* tag, or null when there is none or it had no declaration.
 */
export function checkCompatibility({ declaration, codeFormats, version, previous }) {
  const problems = [];
  if (!sameFormats(declaration.formats, codeFormats))
    problems.push(
      `${DECLARATION} declares formats ${canonical(declaration.formats)} but ${PROTOCOLS_SOURCE} reads ${canonical(codeFormats)}: update the declaration and its minimumRollbackRelease.`,
    );
  if (!version) return problems;
  const minimum = declaration.minimumRollbackRelease;
  if (typeof minimum !== 'string' || !SEMVER.test(minimum)) {
    problems.push(`${DECLARATION} must declare minimumRollbackRelease for release ${version}.`);
    return problems;
  }
  if (compareVersions(minimum, version) > 0)
    problems.push(`minimumRollbackRelease ${minimum} is newer than release ${version}.`);
  const changed = !previous || !sameFormats(previous.formats, declaration.formats);
  if (changed && minimum !== version)
    problems.push(
      `Release ${version} ${previous ? 'changes the execution formats' : 'is the first with declared formats'}: minimumRollbackRelease must be ${version}, not ${minimum}.`,
    );
  if (!changed && previous.minimumRollbackRelease && minimum !== previous.minimumRollbackRelease)
    problems.push(
      `The formats did not change since the previous release, so minimumRollbackRelease stays ${previous.minimumRollbackRelease}, not ${minimum}.`,
    );
  return problems;
}

function previousDeclaration(version) {
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const tags = git('tag', '--list', 'v*', '--merged', 'HEAD')
    .split('\n')
    .map((tag) => tag.trim().replace(/^v/, ''))
    .filter((tag) => SEMVER.test(tag) && compareVersions(tag, version) < 0)
    .sort(compareVersions);
  const last = tags.at(-1);
  if (!last) return null;
  try {
    return JSON.parse(git('show', `v${last}:${DECLARATION}`));
  } catch {
    return null; // a release from before the declaration existed
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, version] = process.argv.slice(2);
  if (command !== 'check' || (version && !SEMVER.test(version))) {
    console.error('Usage: compatibility.mjs check [<version>]');
    process.exit(2);
  }
  const declaration = JSON.parse(readFileSync(DECLARATION, 'utf8'));
  const problems = checkCompatibility({
    declaration,
    codeFormats: parseSupportedProtocols(readFileSync(PROTOCOLS_SOURCE, 'utf8')),
    version,
    previous: version ? previousDeclaration(version) : null,
  });
  for (const problem of problems) console.error(`::error::${problem}`);
  if (problems.length) process.exit(1);
  console.log(
    version
      ? `Release ${version}: minimum rollback release ${declaration.minimumRollbackRelease}`
      : `${DECLARATION} matches ${PROTOCOLS_SOURCE}`,
  );
}
