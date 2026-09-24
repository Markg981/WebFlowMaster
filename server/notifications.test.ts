import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildPayload,
  describeUnsupported,
  mergeNotificationSettings,
  sendRunNotification,
  shouldNotify,
  summaryLine,
  switchForStatus,
  type RunSummary,
} from './notifications';

/**
 * The wizard's four switches and the schedule's override JSON were written and never read.
 * These are the rules by which they are now read, and the promise that reading them cannot
 * change the verdict of the run they describe.
 */

const summary: RunSummary = {
  planId: 'plan-1',
  planName: 'Nightly regression',
  executionId: 'exec-1',
  status: 'failed',
  totalTests: 10,
  passedTests: 7,
  failedTests: 3,
  skippedTests: 0,
  durationMs: 95_000,
  triggeredBy: 'scheduled',
  browsers: ['chromium', 'firefox'],
};

afterEach(() => {
  delete process.env.WEBFLOW_PUBLIC_URL;
  vi.restoreAllMocks();
});

describe('switchForStatus', () => {
  it('files a run that could not produce results under "not executed"', () => {
    expect(switchForStatus('completed')).toBe('passed');
    expect(switchForStatus('failed')).toBe('failed');
    expect(switchForStatus('error')).toBe('notExecuted');
    expect(switchForStatus('running')).toBeNull();
  });
});

describe('shouldNotify', () => {
  it('honours the wizard switches', () => {
    expect(shouldNotify({ failed: true }, 'failed')).toBe(true);
    expect(shouldNotify({ failed: false }, 'failed')).toBe(false);
    expect(shouldNotify({ passed: true }, 'failed')).toBe(false);
  });

  it("accepts the schedule form's own onSuccess/onFailure vocabulary", () => {
    expect(shouldNotify({ onFailure: true }, 'failed')).toBe(true);
    expect(shouldNotify({ passed: true, onSuccess: false }, 'completed')).toBe(false);
  });

  it('stays silent when nothing was configured, and for a run that has not finished', () => {
    expect(shouldNotify({}, 'failed')).toBe(false);
    expect(shouldNotify({ failed: true }, 'running')).toBe(false);
  });
});

describe('mergeNotificationSettings', () => {
  it("lets a schedule change only the destination and keep the plan's choice of when", () => {
    const merged = mergeNotificationSettings(
      { failed: true, passed: false, webhookUrl: 'https://plan.example/hook' },
      { webhookUrl: 'https://schedule.example/hook' },
    );

    expect(merged.webhookUrl).toBe('https://schedule.example/hook');
    expect(merged.failed).toBe(true);
    expect(merged.passed).toBe(false);
  });

  it('survives the column being null, a string, or anything else old rows hold', () => {
    expect(mergeNotificationSettings(null, undefined)).toEqual({});
    expect(mergeNotificationSettings('nonsense', ['also nonsense'])).toEqual({});
  });
});

describe('summaryLine and buildPayload', () => {
  it('says the verdict, the counts and the browsers in one line', () => {
    const line = summaryLine(summary);

    expect(line).toContain('Nightly regression');
    expect(line).toContain('FAILED');
    expect(line).toContain('7/10 passed');
    expect(line).toContain('3 failed');
    expect(line).toContain('chromium, firefox');
  });

  it('names the build and the commit for a run a pipeline started', () => {
    const ci = { provider: 'github' as const, repository: 'acme/shop', commit: '3f2a1c9d0e1b', branch: 'main', pullRequest: '17', buildId: '9001' };

    expect(summaryLine({ ...summary, ci })).toContain(', GitHub Actions · acme/shop@3f2a1c9 on main · PR 17 · build 9001).');
    expect((buildPayload({ ...summary, ci }) as any).execution.ci).toEqual(ci);
  });

  it('carries a text field, which is what Slack and Teams both render', () => {
    const payload = buildPayload(summary) as any;

    expect(typeof payload.text).toBe('string');
    expect(payload.execution.failedTests).toBe(3);
    expect(payload.execution.url).toBeUndefined();
  });

  it('links back to the run once the installation knows its own address', () => {
    process.env.WEBFLOW_PUBLIC_URL = 'https://qa.example.com/';

    const payload = buildPayload(summary) as any;

    // The path the client actually serves. This used to be `/test-plan-executions/{id}`,
    // which no route has ever matched: every notification carried a link to a missing page.
    expect(payload.execution.url).toBe('https://qa.example.com/test-plans/plan-1/executions/exec-1/report');
    expect(payload.text).toContain('https://qa.example.com/test-plans/plan-1/executions/exec-1/report');
  });
});

describe('sendRunNotification', () => {
  it('posts the payload to the configured webhook', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as any);

    const result = await sendRunNotification(
      { failed: true, webhookUrl: 'https://hooks.example/abc' },
      summary,
      { fetchImpl: fetchImpl as any },
    );

    expect(result.delivered).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://hooks.example/abc');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).status).toBe('failed');
  });

  it('sends nothing when this outcome was not one to report', async () => {
    const fetchImpl = vi.fn();

    const result = await sendRunNotification(
      { failed: false, webhookUrl: 'https://hooks.example/abc' },
      summary,
      { fetchImpl: fetchImpl as any },
    );

    expect(result.delivered).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('says plainly that no destination was configured', async () => {
    const result = await sendRunNotification({ failed: true }, summary, { fetchImpl: vi.fn() as any });

    expect(result.delivered).toBe(false);
    expect(result.reason).toContain('No notification webhook URL');
  });

  it('refuses a URL that is not http(s) rather than handing it to fetch', async () => {
    const fetchImpl = vi.fn();

    const result = await sendRunNotification(
      { failed: true, webhookUrl: 'file:///etc/passwd' },
      summary,
      { fetchImpl: fetchImpl as any },
    );

    expect(result.error).toContain('http://');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a rejecting receiver without throwing, because the run is already over', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' } as any);

    const result = await sendRunNotification(
      { failed: true, webhookUrl: 'https://hooks.example/gone' },
      summary,
      { fetchImpl: fetchImpl as any },
    );

    expect(result.delivered).toBe(false);
    expect(result.error).toContain('404');
  });

  it('swallows a network failure the same way', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND hooks.example'));

    const result = await sendRunNotification(
      { failed: true, webhookUrl: 'https://hooks.example/abc' },
      summary,
      { fetchImpl: fetchImpl as any },
    );

    expect(result.delivered).toBe(false);
    expect(result.error).toContain('ENOTFOUND');
  });
});

describe('describeUnsupported', () => {
  it('admits that an email list in the override is not delivered by this build', () => {
    expect(describeUnsupported({ emails: ['qa@example.com'] }).join(' ')).toContain('webhook only');
    expect(describeUnsupported({})).toEqual([]);
  });
});
