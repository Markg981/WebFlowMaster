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
const LOCKS = ['package-lock.json', 'client/package-lock.json'];

describe('the dependency lockfiles', () => {
  it.each(LOCKS)('%s holds no copy of braces or micromatch', (file) => {
    const packages = Object.keys(readJson(file).packages);
    expect(packages.filter((p) => /(^|\/)node_modules\/(braces|micromatch)$/.test(p))).toEqual([]);
  });

  it.each(LOCKS)('%s keeps the lightningcss binaries the client lists, at the locked version', (file) => {
    const { packages } = readJson(file);
    const locked = packages['node_modules/lightningcss']?.version;
    const listed: Record<string, string> = readJson('client/package.json').optionalDependencies ?? {};
    const platforms = Object.entries(listed).filter(([name]) => name.startsWith('lightningcss-'));
    expect(locked).toBeTruthy();
    expect(platforms.map(([name]) => name)).toContain('lightningcss-linux-x64-gnu');
    for (const [name, version] of platforms) {
      expect(version, `${name} in client/package.json`).toBe(locked);
      expect(packages[`node_modules/${name}`]?.version, `${name} in ${file}`).toBe(locked);
    }
  });
});
