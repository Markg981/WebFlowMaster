import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadBddProfiles, publicBddProfiles, type OperatorBddProfile } from './bdd-profiles';
import { runBddOnDedicatedHost, serveBddSession } from './agent-bdd-session';
import type { BddAgentRequest } from '../shared/bdd-agent';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';

async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
  if (process.platform === 'linux') {
    try {
      // kill(pid, 0) also succeeds for terminated children awaiting reaping by init.
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      return !/^State:\s+Z\b/m.test(status);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  return true;
}

const profile: OperatorBddProfile = {
  id: 'sample',
  label: 'Sample',
  provider: 'cucumber-js',
  revision: 'abc123',
  maxDurationMs: 10000,
  projectDirectory: path.resolve('scripts/fixtures/bdd'),
  requirePaths: ['support.cjs'],
  importPaths: [],
  maxConcurrency: 1,
  environment: ['TEST_ALLOWED'],
};
const request = (step: string): BddAgentRequest => ({
  source: `Feature: Runtime\n Scenario: one\n  Given ${step}\n`,
  uri: 'run.feature',
  scenarioLine: 2,
  profile: { id: 'sample', revision: 'abc123' },
  variables: { value: 'world', password: 'supersecret' },
  timeoutMs: 10000,
});
describe('dedicated real Cucumber runtime', () => {
  it('distinguishes an active process from a terminated process', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const closed = new Promise<void>((resolve, reject) => {
      child.once('close', () => resolve());
      child.once('error', reject);
    });
    try {
      expect(await isProcessRunning(child.pid!)).toBe(true);
    } finally {
      child.kill('SIGKILL');
      await closed;
    }
    expect(await isProcessRunning(child.pid!)).toBe(false);
  });
  it('runs exactly one Examples row with World, hooks, doc strings and DataTables', async () => {
    const result = await runBddOnDedicatedHost(
      {
        ...request('row 2'),
        source:
          'Feature: Runtime\n Scenario Outline: selected\n  Given row <n>\n  And document:\n   """\n   payload <n>\n   """\n  Then table:\n   | <n> |\n Examples:\n   | n |\n   | 1 |\n   | 2 |\n Scenario: forbidden\n  Given row 1\n',
        exampleLine: 13,
      },
      [profile],
    );
    expect(result.status).toBe('passed');
    expect(result.steps.filter((s) => s.kind === 'step')).toHaveLength(3);
    expect(result.steps.filter((s) => s.kind === 'hook')).toHaveLength(2);
  });
  it.each(['missing', 'ambiguous', 'pending'])('fails %s steps', async (step) => {
    const result = await runBddOnDedicatedHost(request(step), [profile]);
    expect(result.status).toBe('failed');
    expect(result.steps.some((s) => s.status !== 'PASSED')).toBe(true);
  });
  it.each([
    ['hang', /deadline/],
    ['exit early', /[Ii]ncomplete/],
    ['oversize attachment', /attachments exceed/],
    ['oversize output', /output exceeds/],
  ])('fails incomplete or bounded %s runs', async (step, diagnostic) => {
    const result = await runBddOnDedicatedHost(
      { ...request(step as string), timeoutMs: step === 'hang' ? 3000 : 10000 },
      [profile],
    );
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(diagnostic as RegExp);
  });
  it('records failing hooks and never passes skipped steps', async () => {
    const result = await runBddOnDedicatedHost(
      { ...request('check environment'), variables: { failHook: 'yes' } },
      [profile],
    );
    expect(result.status).toBe('failed');
    expect(result.steps.some((step) => step.kind === 'hook' && step.status === 'FAILED')).toBe(
      true,
    );
    expect(result.steps.some((step) => step.status === 'SKIPPED')).toBe(true);
  });
  it('returns redacted text attachments and omits active content', async () => {
    const result = await runBddOnDedicatedHost(request('text attachment'), [profile]);
    expect(result.status).toBe('passed');
    expect(result.attachments).toEqual([
      { mediaType: 'text/plain', text: 'password=[redacted] [redacted]' },
    ]);
    expect(JSON.stringify(result)).not.toContain('<script>');
  });
  it.each(['descendant', 'descendant hang', 'descendant inherited output'])(
    'terminates owned %s processes on completion or abort',
    async (step) => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'wfm-bdd-tree-test-'));
      const pidFile = path.join(dir, 'pid');
      const abort = new AbortController();
      try {
        const execution = runBddOnDedicatedHost(
          { ...request(step), variables: { pidFile } },
          [profile],
          abort.signal,
        );
        let pid = 0;
        for (let attempt = 0; attempt < 160; attempt++) {
          try {
            pid = Number(await readFile(pidFile, 'utf8'));
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
        expect(pid).toBeGreaterThan(0);
        if (step.includes('hang')) abort.abort();
        const result = await execution;
        expect(result.status).toBe(step.includes('hang') ? 'cancelled' : 'passed');
        // SIGKILL delivery and orphan reaping are asynchronous on Linux.
        await expect.poll(() => isProcessRunning(pid), { timeout: 2000 }).toBe(false);
      } finally {
        abort.abort();
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
  it('runs real ESM and TypeScript support', async () => {
    for (const [file, step, loader] of [
      ['support.mjs', 'ESM loaded', undefined],
      ['support.ts', 'TypeScript loaded', 'tsx'],
    ] as const) {
      const result = await runBddOnDedicatedHost(request(step), [
        { ...profile, requirePaths: [], importPaths: [file], loader },
      ]);
      expect(result.status).toBe('passed');
    }
  });
  it('redacts credentials and operator paths', async () => {
    const result = await runBddOnDedicatedHost(request('credentials'), [profile]);
    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('supersecret');
    expect(JSON.stringify(result)).not.toContain(profile.projectDirectory);
  });
  it('only inherits operator allowlisted environment', async () => {
    process.env.WFM_AGENT_TOKEN = 'forbidden';
    process.env.TEST_ALLOWED = 'operator-value';
    const result = await runBddOnDedicatedHost(request('check environment'), [profile]);
    expect(result.status).toBe('passed');
    delete process.env.WFM_AGENT_TOKEN;
    delete process.env.TEST_ALLOWED;
  });
  it('rejects revision, selector, oversize source and concurrency before support loads', async () => {
    for (const bad of [
      { ...request('exit early'), profile: { id: 'sample', revision: 'wrong' } },
      { ...request('exit early'), scenarioLine: 50 },
      { ...request('exit early'), source: 'x'.repeat(20 * 1024 * 1024 + 1) },
    ])
      expect((await runBddOnDedicatedHost(bad, [profile])).status).toBe('failed');
    const controller = new AbortController();
    const running = runBddOnDedicatedHost(request('hang'), [profile], controller.signal);
    const second = await runBddOnDedicatedHost(request('exit early'), [profile]);
    expect(second.error).toMatch(/concurrency/i);
    controller.abort();
    expect((await running).status).toBe('cancelled');
  });
  it('loads strict operator manifest and advertises no paths', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wfm-bdd-manifest-'));
    try {
      const manifest = path.join(dir, 'profiles.json');
      await writeFile(manifest, JSON.stringify({ profiles: [profile] }));
      const loaded = await loadBddProfiles(manifest);
      expect(publicBddProfiles(loaded)).toEqual([
        {
          id: 'sample',
          label: 'Sample',
          provider: 'cucumber-js',
          revision: 'abc123',
          maxDurationMs: 10000,
        },
      ]);
      for (const bad of [
        { ...profile, requirePaths: ['../secret.cjs'] },
        { ...profile, environment: ['NODE_OPTIONS'] },
        { ...profile, command: 'evil' },
      ]) {
        await writeFile(manifest, JSON.stringify({ profiles: [bad] }));
        await expect(loadBddProfiles(manifest)).rejects.toThrow();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('executes the bundled distributed child using project-local Cucumber', async () => {
    await mkdir(path.resolve('tmp'), { recursive: true });
    const dir = await mkdtemp(path.resolve('tmp/bdd-bundle-'));
    try {
      await Promise.all([
        build({
          entryPoints: ['scripts/agent-bdd-session.ts'],
          platform: 'node',
          packages: 'external',
          bundle: true,
          format: 'esm',
          outfile: path.join(dir, 'session.mjs'),
        }),
        build({
          entryPoints: ['scripts/bdd-child.ts'],
          platform: 'node',
          packages: 'external',
          bundle: true,
          format: 'esm',
          outfile: path.join(dir, 'wfm-bdd-child.mjs'),
        }),
      ]);
      const runtime = await import(
        /* @vite-ignore */ pathToFileURL(path.join(dir, 'session.mjs')).href
      );
      const result = await runtime.runBddOnDedicatedHost(request('ESM loaded'), [
        { ...profile, requirePaths: [], importPaths: ['support.mjs'] },
      ]);
      expect(result.status).toBe('passed');
      expect(result.steps[0].name).toBe('ESM loaded');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('checks ticket-bound profiles and cleans a real disconnected WebSocket session before done', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wfm-bdd-session-')),
      pidFile = path.join(dir, 'pid');
    const server = http.createServer(),
      sockets = new WebSocketServer({ server });
    let doneResolve: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      doneResolve = resolve;
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    sockets.on('connection', (socket) =>
      serveBddSession(socket, { id: 'sample', revision: 'abc123' }, [profile], doneResolve),
    );
    const client = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
    try {
      await new Promise<void>((resolve) => client.once('open', resolve));
      client.send(JSON.stringify({ ...request('descendant hang'), variables: { pidFile } }));
      let pid = 0;
      for (let attempt = 0; attempt < 160; attempt++) {
        try {
          pid = Number(await readFile(pidFile, 'utf8'));
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(pid).toBeGreaterThan(0);
      client.terminate();
      await done;
      await expect.poll(() => isProcessRunning(pid), { timeout: 2000 }).toBe(false);
    } finally {
      client.terminate();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('rejects a WebSocket request outside its signed profile', async () => {
    const server = http.createServer(),
      sockets = new WebSocketServer({ server });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    sockets.on('connection', (socket) =>
      serveBddSession(socket, { id: 'other', revision: 'abc123' }, [profile], () => {}),
    );
    const client = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
    try {
      await new Promise<void>((resolve) => client.once('open', resolve));
      const reply = new Promise<any>((resolve) =>
        client.once('message', (raw) => resolve(JSON.parse(raw.toString()))),
      );
      client.send(JSON.stringify(request('exit early')));
      expect((await reply).result).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('authorized profile'),
      });
    } finally {
      client.terminate();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
