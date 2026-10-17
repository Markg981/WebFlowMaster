import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * What the lockfiles must keep true, checked where a dependency update would break it.
 *
 * braces 3.0.3 (CVE-2026-93687, no fixed release) reached both locks through Tailwind 3,
 * @typescript-eslint 7 and @types/jest. It was patched in node_modules after every install,
 * under a source exception that expired on 6 November 2026. Tailwind 4 and the updates that
 * removed it leave no copy: one that comes back fails here before it reaches a release scan.
 *
 * Tailwind 4 compiles CSS through lightningcss, whose binary is a per-platform optional package.
 * npm 11 drops those packages from the workspace lock when it rewrites it, and the Linux build in
 * CI and in the images then fails with "Cannot find module ../lightningcss.linux-x64-gnu.node".
 * client/package.json lists them as optional dependencies so the lock keeps them; their version
 * has to follow the lightningcss that Tailwind installs.
 */
const repoRoot = path.resolve(__dirname, '..', '..');
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
const readText = (file: string) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const LOCKS = ['package-lock.json'];

/**
 * monaco-editor 0.57.0 runs its own copy of dompurify 3.4.15 (vs/base/browser/dompurify), affected
 * by GHSA-p98j-92pf-mc4p and GHSA-6688-9rhm-gjv2; the npm dompurify it declares is never imported,
 * so an override would only silence the audit. Both advisories need IN_PLACE sanitization of a
 * live node, which neither Monaco nor this code base uses. The decision, with its expiry, is in
 * docs/SECURITY-AUDIT.md: these checks fail when one of its premises stops holding.
 */
const PATCHED_DOMPURIFY = [3, 4, 16];
const isPatched = (version: string) => {
  const parts = version.split('.').map(Number);
  for (let i = 0; i < PATCHED_DOMPURIFY.length; i++) {
    if (parts[i] !== PATCHED_DOMPURIFY[i]) return parts[i] > PATCHED_DOMPURIFY[i];
  }
  return true;
};
const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(rel);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [rel] : [];
  });

describe('the dependency lockfiles', () => {
  it.each(LOCKS)('%s holds no copy of braces or micromatch', (file) => {
    const packages = Object.keys(readJson(file).packages);
    expect(packages.filter((p) => /(^|\/)node_modules\/(braces|micromatch)$/.test(p))).toEqual([]);
  });

  it.each(LOCKS)(
    '%s keeps the lightningcss binaries the client lists, at the locked version',
    (file) => {
      const { packages } = readJson(file);
      const locked = packages['node_modules/lightningcss']?.version;
      const listed: Record<string, string> =
        readJson('client/package.json').optionalDependencies ?? {};
      const platforms = Object.entries(listed).filter(([name]) => name.startsWith('lightningcss-'));
      expect(locked).toBeTruthy();
      expect(platforms.map(([name]) => name)).toContain('lightningcss-linux-x64-gnu');
      for (const [name, version] of platforms) {
        expect(version, `${name} in client/package.json`).toBe(locked);
        expect(packages[`node_modules/${name}`]?.version, `${name} in ${file}`).toBe(locked);
      }
    },
  );
});

describe("Monaco's bundled dompurify", () => {
  const monaco = 'node_modules/monaco-editor/esm/vs/base/browser';
  const bundled = /version\s*=\s*'(\d+\.\d+\.\d+)'/.exec(
    readText(`${monaco}/dompurify/dompurify.js`),
  )?.[1];
  const monacoVersion =
    readJson('package-lock.json').packages['node_modules/monaco-editor']?.version;

  it('is the copy the triage records, or a patched one', () => {
    expect(bundled).toBeTruthy();
    if (isPatched(bundled!)) return;
    const triage = readText('docs/SECURITY-AUDIT.md');
    expect(triage, 'docs/SECURITY-AUDIT.md must name the installed Monaco').toContain(
      `monaco-editor\` ${monacoVersion}`,
    );
    expect(triage).toContain(`dompurify ${bundled}`);
  });

  it('is never asked to sanitize in place, by Monaco or by this code base', () => {
    if (isPatched(bundled!)) return;
    for (const file of [`${monaco}/domSanitize.js`, `${monaco}/markdownRenderer.js`]) {
      expect(readText(file), file).not.toMatch(/IN_PLACE/);
    }
    const ours = ['client/src', 'server', 'shared'].flatMap(sourceFiles);
    const offending = ours.filter((file) => {
      if (file === path.join('server', 'tests', 'dependency-locks.test.ts')) return false;
      return /IN_PLACE|from ['"]dompurify|require\(['"]dompurify/.test(readText(file));
    });
    expect(offending).toEqual([]);
  });
});
