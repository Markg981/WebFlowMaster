import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { execFile } from 'child_process';
import { promisify } from 'util';

/**
 * The CLI the server hands out. What is worth a test: what comes back runs, as a pipeline runs
 * it (downloaded to a file, then `node wfm.mjs`), with nothing else installed next to it.
 */

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

const { default: cliRoutes } = await import('./cli.routes');

describe('GET /cli/wfm.mjs', () => {
  it('serves a CLI that runs on its own, and exits 2 without a server', async () => {
    const app = express();
    app.use(cliRoutes);
    const response = await request(app).get('/cli/wfm.mjs').expect(200);
    expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8');

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-cli-'));
    const file = path.join(dir, 'wfm.mjs');
    try {
      await fs.writeFile(file, response.text);
      const run = promisify(execFile);

      const help = await run(process.execPath, [file, 'help'], { cwd: dir });
      expect(help.stdout).toContain('wfm — run WebFlowMaster test plans from a pipeline');

      // No URL, no key: the tool's own error, with its own exit code — not a crash, not 0.
      const failed = await run(process.execPath, [file, 'run', 'plan-1'], { cwd: dir, env: { PATH: process.env.PATH ?? '' } }).catch((error) => error);
      expect(failed.code).toBe(2);
      expect(failed.stderr).toContain('WFM_URL');
    } finally {
      await fs.remove(dir);
    }
  }, 60_000);
});

describe('GET /cli/wfm-agent.mjs', () => {
  it('serves the agent, which runs next to playwright and ws and exits 2 without a token', async () => {
    const app = express();
    app.use(cliRoutes);
    const response = await request(app).get('/cli/wfm-agent.mjs').expect(200);
    expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8');

    // The agent's two dependencies are installed next to it (Dockerfile.agent does the same), so
    // the file goes somewhere node resolves this repository's node_modules from.
    const dir = await fs.mkdtemp(path.join(process.cwd(), 'node_modules', '.wfm-agent-'));
    const file = path.join(dir, 'wfm-agent.mjs');
    try {
      await fs.writeFile(file, response.text);
      const failed = await promisify(execFile)(process.execPath, [file], { cwd: dir, env: { PATH: process.env.PATH ?? '' } }).catch((error) => error);
      expect(failed.code).toBe(2);
      expect(failed.stderr).toContain('WFM_AGENT_TOKEN');
    } finally {
      await fs.remove(dir);
    }
  }, 60_000);

  it('hands out nothing else', async () => {
    const app = express();
    app.use(cliRoutes);
    await request(app).get('/cli/server.js').expect(404);
  });
});
