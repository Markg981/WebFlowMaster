import { describe, it, expect, vi } from 'vitest';
import { callWithRetry } from './issue-providers';
import { sendRunNotification, type RunSummary } from './notifications';
import { publishResults } from './test-management-providers';

/** Outbound deliveries try up to three times, and an export that took nothing says so (audit C-21). */

const reply = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  text: async () => JSON.stringify(body),
});
const sleep = vi.fn().mockResolvedValue(undefined);

describe('callWithRetry', () => {
  it('succeeds after a failure that comes back once', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(200));
    const answer = await callWithRetry('https://tool.test/x', {}, { fetchImpl, sleep });
    expect(answer.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after three attempts and does not repeat a plain refusal', async () => {
    const down = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      callWithRetry('https://tool.test/x', {}, { fetchImpl: down, sleep }),
    ).rejects.toThrow(/ECONNRESET/);
    expect(down).toHaveBeenCalledTimes(3);
    const refused = vi.fn().mockResolvedValue(reply(400));
    await callWithRetry('https://tool.test/x', {}, { fetchImpl: refused, sleep });
    expect(refused).toHaveBeenCalledTimes(1);
  });
});

describe('sendRunNotification', () => {
  const summary = {
    planId: 'p',
    planName: 'Nightly',
    executionId: 'e',
    status: 'failed',
    totalTests: 1,
    passedTests: 0,
    failedTests: 1,
    skippedTests: 0,
    durationMs: 1000,
    triggeredBy: 'scheduled',
  } as RunSummary;
  const settings = { webhookUrl: 'https://hooks.test/x', onFailure: true } as never;

  it('delivers when the webhook fails once and then answers', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply(500)).mockResolvedValueOnce(reply(200));
    const result = await sendRunNotification(settings, summary, {
      fetchImpl: fetchImpl as never,
      sleep,
    });
    expect(result).toEqual({ delivered: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('Zephyr publishing', () => {
  it('publishes nothing when every execution is refused', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/statuses'))
        return reply(200, { values: [{ name: 'Pass' }, { name: 'Fail' }] });
      if (url.includes('/testcycles')) return reply(200, { key: 'SHOP-R1' });
      return reply(400, { message: 'no' });
    });
    const outcome = await publishResults(
      {
        provider: 'zephyr_scale',
        baseUrl: 'https://z.test/v2',
        projectKey: 'SHOP',
        token: 't',
      } as never,
      {
        title: 't',
        description: 'd',
        startedAt: null,
        finishedAt: null,
        results: [
          { caseKey: 'SHOP-T1', outcome: 'passed', comment: '', durationMs: 1, finishedAt: null },
        ] as never,
      },
      { fetchImpl: fetchImpl as never, sleep },
    );
    expect(outcome.published).toBe(0);
    expect(outcome.problems).toHaveLength(1);
  });
});
