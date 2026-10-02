import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import type { AddressInfo } from 'net';
import type { Browser } from 'playwright';
import { parseDownloadChecks, parseGeolocation } from '@shared/downloads';
import { parseCsv } from './download-check';
import { executeStep } from './step-executor';

/** Checking what a test downloads, and where the browser says it is (shared/downloads.ts). */

describe('parsing', () => {
  it('reads download checks, separated by ; so a text may hold commas', () => {
    expect(parseDownloadChecks('name: report-*.csv; contains: Rossi, Mario; rows >= 3; size < 2KB')).toEqual([
      { kind: 'name', pattern: 'report-*.csv', text: 'name: report-*.csv' },
      { kind: 'contains', value: 'Rossi, Mario', text: 'contains: Rossi, Mario' },
      { kind: 'number', field: 'rows', op: '>=', value: 3, text: 'rows >= 3' },
      { kind: 'number', field: 'size', op: '<', value: 2048, text: 'size < 2KB' },
    ]);
    expect(parseDownloadChecks('type: docx')).toEqual({ error: expect.stringContaining('Unknown type') });
    expect(parseDownloadChecks('rows 3')).toEqual({ error: expect.stringContaining('not a check') });
  });

  it('reads a position, and refuses one off the globe', () => {
    expect(parseGeolocation('45.4642, 9.19')).toEqual({ latitude: 45.4642, longitude: 9.19, accuracy: 10 });
    expect(parseGeolocation('45, 9, 100')).toEqual({ latitude: 45, longitude: 9, accuracy: 100 });
    expect(parseGeolocation('Milano')).toEqual({ error: expect.stringContaining('not a position') });
    expect(parseGeolocation('95, 9')).toEqual({ error: expect.stringContaining('Latitude') });
  });

  it('parses CSV with quotes, and guesses the delimiter', () => {
    expect(parseCsv('a;b\n"x; y";"he said ""hi"""\n\n1;2\n')).toEqual([['a', 'b'], ['x; y', 'he said "hi"'], ['1', '2']]);
  });
});

describe('in a real browser', () => {
  let browser: Browser;
  let server: http.Server;
  let base = '';
  let pdf: Buffer;

  beforeAll(async () => {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const maker = await browser.newPage();
    await maker.setContent('<h1>Invoice 42</h1><p>Total 1.234,50 EUR</p>');
    pdf = await maker.pdf();
    await maker.close();
    server = http.createServer((req, res) => {
      if (req.url === '/report.csv') {
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="report-2026.csv"' });
        return res.end('name;city\n"Rossi, Mario";Milano\nBianchi;Roma\n');
      }
      if (req.url === '/invoice.pdf') {
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="invoice-42.pdf"' });
        return res.end(pdf);
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<a id="csv" href="/report.csv">CSV</a> <a id="pdf" href="/invoice.pdf">PDF</a> <a id="none" href="#">nothing</a>
        <button id="where" onclick="navigator.geolocation.getCurrentPosition(p => document.title = p.coords.latitude + ',' + p.coords.longitude)">where</button>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const step = (id: string, value?: string, selector?: string) => ({ action: { id, name: id }, value, targetElement: selector ? { selector } : undefined });

  it('checks a CSV download and keeps it with the run, setting variables', async () => {
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
    await page.goto(base);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-dl-test-'));
    const vars: Record<string, string> = {};
    const ok = await executeStep({ page, vars, artifactDir: dir }, step('expectDownload', 'name: report-*.csv; type: csv; rows = 3; columns = 2; contains: rossi, MARIO', '#csv'));
    expect(ok).toMatchObject({ status: 'passed', detail: expect.stringContaining('report-2026.csv (csv') });
    expect(ok.download).toMatchObject({ name: 'report-2026.csv', rows: 3, columns: 2 });
    expect(await fs.pathExists(ok.download!.fileUrl!)).toBe(true);
    expect(vars).toMatchObject({ 'download.name': 'report-2026.csv', 'download.rows': '3' });

    const bad = await executeStep({ page, vars, artifactDir: dir }, step('expectDownload', 'rows >= 10; contains: Verdi; pages >= 1', '#csv'));
    expect(bad.status).toBe('failed');
    expect(bad.error).toContain('rows >= 10 (found 3); contains: Verdi (not found); pages >= 1 (found not a PDF)');
    await page.context().close();
    await fs.remove(dir);
  });

  it('reads a PDF’s text and pages', async () => {
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
    await page.goto(base);
    const outcome = await executeStep({ page, vars: {} }, step('expectDownload', 'type: pdf; pages = 1; contains: Total 1.234,50 EUR', '#pdf'));
    expect(outcome).toMatchObject({ status: 'passed' });
    expect(outcome.download).toMatchObject({ type: 'pdf', pages: 1 });
    expect(outcome.download!.fileUrl).toBeUndefined(); // no run: nothing kept
    await page.context().close();
  });

  it('says so when the click downloads nothing', async () => {
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
    await page.goto(base);
    page.setDefaultTimeout(1500);
    const { executeStep: run } = await import('./step-executor');
    const outcome = await Promise.race([
      run({ page, vars: {} }, step('expectDownload', '', '#none')),
      new Promise((r) => setTimeout(() => r('slow'), 20_000)),
    ]);
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringContaining('did not download a file') });
    await page.context().close();
  }, 30_000);

  it('moves the browser', async () => {
    const page = await browser.newPage();
    await page.goto(base);
    const outcome = await executeStep({ page, vars: {} }, step('setGeolocation', '45.4642, 9.19'));
    expect(outcome).toMatchObject({ status: 'passed', detail: expect.stringContaining('45.4642, 9.19') });
    await page.click('#where');
    await expect.poll(() => page.title()).toBe('45.4642,9.19');
    expect(await executeStep({ page, vars: {} }, step('setGeolocation', 'Milano'))).toMatchObject({ status: 'failed' });
    await page.close();
  });
});
