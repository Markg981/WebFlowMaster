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
 * by GHSA-p98j-92pf-mc4p and GHSA-6688-9rhm-gjv2, and imports nothing else. client/monaco-dompurify.ts
 * points that import at the dompurify the client installs, in the build and in the dev pre-bundle;
 * these checks fail when the swap would stop happening or would bring back an affected version.
 */
const PATCHED_DOMPURIFY = [3, 4, 17];
const isPatched = (version: string) => {
  const parts = version.split('.').map(Number);
  for (let i = 0; i < PATCHED_DOMPURIFY.length; i++) {
    if (parts[i] !== PATCHED_DOMPURIFY[i]) return parts[i] > PATCHED_DOMPURIFY[i];
  }
  return true;
};

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
  // The copy the client resolves: its own when npm nests it, the hoisted one otherwise.
  const { packages } = readJson('package-lock.json');
  const installed = (
    packages['client/node_modules/dompurify'] ?? packages['node_modules/dompurify']
  )?.version as string | undefined;

  it('is imported from where the client build swaps it', () => {
    expect(bundled).toBeTruthy();
    expect(readText(`${monaco}/domSanitize.js`)).toContain(
      `import purify from './dompurify/dompurify.js'`,
    );
    expect(readText('client/vite.config.ts')).toMatch(/plugins:\s*\[monacoDompurify\(\)/);
  });

  it('is replaced by a patched dompurify installed for the client', () => {
    const declared: string = readJson('client/package.json').dependencies.dompurify;
    expect(isPatched(declared.replace(/^[\^~]/, '')), `client declares ${declared}`).toBe(true);
    expect(installed, 'client/node_modules/dompurify in package-lock.json').toBeTruthy();
    expect(isPatched(installed!), `client installs ${installed}`).toBe(true);
  });
});
