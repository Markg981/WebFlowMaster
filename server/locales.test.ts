import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { canonicalLocale, normalizeLocales, passLabel } from '@shared/locales';
import { insertTestPlanSchema } from '@shared/schema';
import { buildExecutionSnapshot } from './execution-snapshot';

describe('language codes', () => {
  it('reads the ways people write them', () => {
    expect(canonicalLocale('it')).toBe('it');
    expect(canonicalLocale(' it_it ')).toBe('it-IT');
    expect(canonicalLocale('zh-hant-tw')).toBe('zh-Hant-TW');
    expect(canonicalLocale('es-419')).toBe('es-419');
    expect(canonicalLocale('english')).toBeNull();
    expect(canonicalLocale('')).toBeNull();
  });

  it('keeps each once, in order, and at most ten', () => {
    expect(normalizeLocales(['it-IT', 'IT_it', 'en', 42, 'nope!'])).toEqual(['it-IT', 'en']);
    expect(normalizeLocales('it-IT')).toEqual([]);
    const many = ['aa', 'ab', 'ae', 'af', 'ak', 'am', 'an', 'ar', 'as', 'av', 'ay'];
    expect(normalizeLocales(many)).toHaveLength(10);
  });

  it('labels a pass with the browser and the language', () => {
    expect(passLabel('chromium', 'it-IT')).toBe('chromium · it-IT');
    expect(passLabel(null, 'it-IT')).toBe('it-IT');
    expect(passLabel('firefox', undefined)).toBe('firefox');
    expect(passLabel(undefined, undefined)).toBeNull();
  });

  it('is refused by name when a plan is saved with one that is not a code', () => {
    const base = { name: 'P', userId: 1, organizationId: 1 };
    expect(insertTestPlanSchema.safeParse({ ...base, locales: ['it_IT', 'en'] })).toMatchObject({ success: true, data: { locales: ['it-IT', 'en'] } });
    const refused = insertTestPlanSchema.safeParse({ ...base, locales: ['english'] });
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toContain('A language is a code');
  });

  it('is fixed in the run snapshot, so a plan edited while the run waits does not change it', () => {
    const snapshot = buildExecutionSnapshot({ id: 'p', name: 'P', locales: ['it-IT', 'bad code'] } as any, []);
    expect(snapshot.locales).toEqual(['it-IT']);
  });
});

describe('a test run in a language', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Shows what the browser told the server and what it tells the page.
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
        `<!doctype html><title>Lang</title><span id="header">${String(req.headers['accept-language'] ?? '')}</span>` +
          `<span id="nav"></span><span id="money"></span>` +
          `<script>document.getElementById('nav').textContent = navigator.language;` +
          `document.getElementById('money').textContent = (1234.5).toLocaleString();</script>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const step = (id: string, selector: string | undefined, value: string) => ({
    id: `s-${id}-${selector ?? ''}`,
    action: { id, type: id, name: id, icon: 'x', description: id },
    targetElement: selector ? { id: 'e', type: 'element', selector, text: '', tag: 'span', attributes: {} } : undefined,
    value,
  });

  const run = async (locale?: string) => {
    const { playwrightService } = await import('./playwright-service');
    return playwrightService.executeTestSequence(
      {
        id: 1, userId: 1, organizationId: 1, projectId: null, name: 'lang', url: `${baseUrl}/`,
        sequence: [
          step('assertTextContains', '#header', locale ?? 'en'),
          step('assertTextContains', '#nav', locale ?? 'en'),
          step('executeScript', undefined, locale ? `return '{{locale}}' === '${locale}'` : 'return true'),
        ],
        elements: [], preconditions: null, status: 'draft',
      } as never,
      1,
      undefined,
      undefined,
      { baseUrl },
      undefined,
      locale ? { locale } : undefined,
    );
  };

  it('starts the browser in that language: header, navigator.language, formats and {{locale}}', async () => {
    const result = await run('it-IT');
    const failures = (result.steps ?? []).filter((s) => s.status === 'failed').map((s) => `${s.type}: ${s.error}`);
    expect(failures).toEqual([]);

    const german = await run('de-DE');
    expect((german.steps ?? []).filter((s) => s.status === 'failed')).toEqual([]);
  }, 90_000);
});
