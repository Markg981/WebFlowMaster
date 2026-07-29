import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installObservability, reportClientIncident, __resetInstallForTests } from './install';
import { pushBreadcrumb, takeBreadcrumbs, __resetBreadcrumbs } from './breadcrumbs';

const posted = () =>
  vi.mocked(globalThis.fetch).mock.calls
    .filter(([url]) => String(url) === '/api/incidents')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

beforeEach(() => {
  __resetBreadcrumbs();
  __resetInstallForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ incidentId: 'inc_abc123' }), { status: 202 })),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('reportClientIncident', () => {
  it('posts the report with session, breadcrumbs and route', async () => {
    pushBreadcrumb({ type: 'click', target: '#execute' });

    reportClientIncident({ name: 'TypeError', message: 'boom', stack: 'TypeError: boom\n    at x' });
    await vi.waitFor(() => expect(posted()).toHaveLength(1));

    const [report] = posted();
    expect(report).toMatchObject({ name: 'TypeError', message: 'boom' });
    expect(report.sessionId).toBeTruthy();
    expect(report.correlationId).toBeTruthy();
    expect(report.breadcrumbs).toEqual([
      expect.objectContaining({ type: 'click', target: '#execute' }),
    ]);
  });

  it('never throws when the transport is unavailable', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => reportClientIncident({ name: 'Error', message: 'x' })).not.toThrow();
  });
});

describe('installObservability', () => {
  it('reports an unhandled rejection', async () => {
    installObservability();

    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('promise blew up') }),
    );

    await vi.waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].message).toBe('promise blew up');
  });

  it('records a click breadcrumb carrying a usable target', () => {
    installObservability();
    const button = document.createElement('button');
    button.id = 'execute';
    document.body.appendChild(button);

    button.click();

    expect(takeBreadcrumbs()).toContainEqual(
      expect.objectContaining({ type: 'click', target: '#execute' }),
    );
  });

  /**
   * A focus breadcrumb records that a field was touched, never what was typed into it —
   * otherwise a password would travel with every incident from that page.
   */
  it('records field identity on focus but never the value', () => {
    installObservability();
    const input = document.createElement('input');
    input.id = 'password';
    input.value = 'hunter2-super-secret';
    document.body.appendChild(input);

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    const crumbs = takeBreadcrumbs();
    expect(crumbs).toContainEqual(expect.objectContaining({ type: 'focus', target: '#password' }));
    expect(JSON.stringify(crumbs)).not.toContain('hunter2-super-secret');
  });

  it('is idempotent', () => {
    installObservability();
    installObservability();
    const button = document.createElement('button');
    button.id = 'once';
    document.body.appendChild(button);

    button.click();

    expect(takeBreadcrumbs().filter((c) => c.type === 'click')).toHaveLength(1);
  });
});
