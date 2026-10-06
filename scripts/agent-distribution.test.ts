import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';

describe('standalone agent distribution', () => {
  it('installs every external package actually imported by the shipped agent bundle', async () => {
    const result = await build({ entryPoints: ['scripts/wfm-agent.ts'], bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false, metafile: true });
    const native = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
    const packages = [...new Set(Object.values(result.metafile.outputs).flatMap(output => output.imports)
      .filter(item => item.external && !native.has(item.path))
      .map(item => item.path.startsWith('@') ? item.path.split('/').slice(0, 2).join('/') : item.path.split('/')[0]))];
    const docker = readFileSync('Dockerfile.agent', 'utf8');
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, { dev?: boolean; version?: string }> };
    // Release images copy npm ci's production dependency tree instead of installing a
    // hand-maintained package list. Every external import must belong to that tree.
    expect(docker).toMatch(/npm ci --omit=dev --workspaces=false/);
    expect(docker).toContain('COPY --from=build /src/node_modules ./node_modules');
    const command = readFileSync('client/src/components/settings/AgentsCard.tsx', 'utf8').match(/`npm install [^`]+`/)?.[0] || '';
    expect(packages.length).toBeGreaterThan(0);
    for (const pkg of packages) {
      const installed = lock.packages[`node_modules/${pkg}`];
      expect(installed, `Docker agent locked dependency: ${pkg}`).toBeDefined();
      expect(installed.dev, `Docker agent production dependency: ${pkg}`).not.toBe(true);
      expect(command, `Manual agent dependency: ${pkg}`).toContain(pkg);
    }
  });
});
