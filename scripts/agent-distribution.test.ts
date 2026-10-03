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
    const command = readFileSync('client/src/components/settings/AgentsCard.tsx', 'utf8').match(/`npm install [^`]+`/)?.[0] || '';
    expect(packages.length).toBeGreaterThan(0);
    for (const pkg of packages) {
      expect(docker, `Docker agent dependency: ${pkg}`).toContain(pkg);
      expect(command, `Manual agent dependency: ${pkg}`).toContain(pkg);
    }
  });
});
