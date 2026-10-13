import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { apiNotFound, serveDocs } from './static';
import { securityHeaders } from './platform/security-headers';

describe('serveDocs', () => {
  const inline = 'window.__VP_HASH_MAP__=JSON.parse("{}")';
  const hash = `'sha256-${crypto.createHash('sha256').update(inline).digest('base64')}'`;
  let docsDir: string;

  beforeAll(() => {
    docsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-docs-'));
    const page = (body: string) =>
      `<!DOCTYPE html><html><head><script>${inline}</script>` +
      `<script type="module" src="/docs/assets/app.js"></script></head><body>${body}</body></html>`;
    fs.mkdirSync(path.join(docsDir, 'en', 'guide'), { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'index.html'), page('home'));
    fs.writeFileSync(path.join(docsDir, '404.html'), page('not found'));
    fs.writeFileSync(path.join(docsDir, 'en', 'guide', 'results.html'), page('results'));
    fs.writeFileSync(path.join(docsDir, 'en', 'guide', 'index.html'), page('guide'));
  });
  afterAll(() => fs.rmSync(docsDir, { recursive: true, force: true }));

  function app(docs: string | null, csp = 'enforce') {
    const a = express();
    a.use(securityHeaders({ NODE_ENV: 'production', CONTENT_SECURITY_POLICY: csp }));
    serveDocs(a, docs);
    a.use('*', (_req, res) => res.type('html').send('<!DOCTYPE html><html>client</html>'));
    return a;
  }

  it('serves pages by their clean URL, and directories by their index', async () => {
    const page = await request(app(docsDir)).get('/docs/en/guide/results');
    expect(page.status).toBe(200);
    expect(page.text).toContain('results');
    expect((await request(app(docsDir)).get('/docs/en/guide/')).text).toContain('guide');
  });

  it("answers a missing page with the manual's 404, not the client", async () => {
    const res = await request(app(docsDir)).get('/docs/en/guide/nothing-here');
    expect(res.status).toBe(404);
    expect(res.text).toContain('not found');
  });

  it("allows the pages' own inline scripts by hash, and only under /docs", async () => {
    const docs = await request(app(docsDir)).get('/docs/en/guide/results');
    expect(docs.headers['content-security-policy']).toContain(`script-src 'self' ${hash}`);
    const client = await request(app(docsDir)).get('/tests');
    expect(client.headers['content-security-policy']).not.toContain('sha256');

    const reportOnly = await request(app(docsDir, 'report-only')).get('/docs/');
    expect(reportOnly.headers['content-security-policy-report-only']).toContain(hash);
  });

  it('says how to add the manual when the build has none', async () => {
    const res = await request(app(null)).get('/docs/en/guide/results');
    expect(res.status).toBe(404);
    expect(res.text).toMatch(/npm run build:docs/);
  });
});

describe('apiNotFound', () => {
  // The same order as server/index.ts: routes, then the /api 404, then the client's catch-all.
  const app = express();
  app.get('/api/user', (_req, res) => res.json({ ok: true }));
  app.use('/api', apiNotFound);
  app.use('*', (_req, res) => res.type('html').send('<!DOCTYPE html><html></html>'));

  it('answers an /api path no route handles with a JSON 404, not the client (collaudo SEC-17)', async () => {
    const res = await request(app).post('/api/reports/generate').send({});
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual({ error: 'No such endpoint.' });
  });

  it('leaves real routes and client routes alone', async () => {
    expect((await request(app).get('/api/user')).body).toEqual({ ok: true });
    const page = await request(app).get('/test-plans');
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/<!DOCTYPE html>/);
  });

  it('does not take paths that only begin with the letters api', async () => {
    expect((await request(app).get('/apidocs')).status).toBe(200);
  });
});
