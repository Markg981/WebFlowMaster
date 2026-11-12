import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComparisonRun } from '@shared/schema';
import { emptyVerdictCounts } from '@shared/comparison';

/**
 * The one notification a comparison sends: what it says, which switch it answers to, and that a
 * webhook is recorded on one of its runs. The plan read, the mail and the delivery are stubbed.
 */

const plan = vi.hoisted(() => ({
  row: { name: 'Checkout', notificationSettings: {} as Record<string, unknown> } as
    { name: string; notificationSettings: Record<string, unknown> } | undefined,
}));
const deliveries = vi.hoisted(() => ({
  recordDelivery: vi.fn(async (_input: Record<string, unknown>) => 'delivery-1'),
  attemptDelivery: vi.fn(async (_id: string) => 'sent' as const),
}));
const mail = vi.hoisted(() => ({ mailRunFinished: vi.fn(async (..._args: unknown[]) => []) }));

vi.mock('../platform/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../platform/middleware/tenancy', () => ({
  withTenantTransaction: async (fn: (tx: unknown) => unknown) => {
    const chain = {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      limit: async () => (plan.row ? [plan.row] : []),
    };
    return fn(chain);
  },
}));
vi.mock('./deliveries', () => deliveries);
vi.mock('./run-mail', () => mail);
vi.mock('../platform/report-links', () => ({
  comparisonUrlFor: (id: string) => `https://wfm.test/comparisons/${id}`,
  comparisonPathFor: (id: string) => `/comparisons/${id}`,
  reportUrlFor: () => undefined,
  reportPathFor: () => undefined,
}));

const { buildComparisonPayload, comparisonLine, comparisonRunStatus, notifyComparisonFinished } =
  await import('./comparison-notifications');

function comparison(overrides: Partial<ComparisonRun> = {}): ComparisonRun {
  const byVerdict = { ...emptyVerdictCounts(), identical: 4, different: 1 };
  return {
    id: 'cmp-1',
    organizationId: 7,
    testPlanId: 'plan-1',
    name: 'Angular 22',
    baselineEnvironmentId: 1,
    candidateEnvironmentId: 2,
    baselineEnvironmentName: 'prod',
    candidateEnvironmentName: 'staging',
    baselineExecutionId: 'run-b',
    candidateExecutionId: 'run-c',
    mode: 'sequential',
    policy: {},
    status: 'completed',
    verdict: 'regressions',
    summary: { total: 5, byVerdict, byModule: [], droppedDifferences: 0 },
    failureCode: null,
    failureMessage: null,
    idempotencyKey: null,
    requestedByUserId: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: new Date(),
    ...overrides,
  } as ComparisonRun;
}

beforeEach(() => {
  plan.row = {
    name: 'Checkout',
    notificationSettings: { failed: true, webhookUrl: 'https://hooks.slack.com/services/x' },
  };
  deliveries.recordDelivery.mockClear();
  deliveries.attemptDelivery.mockClear();
  mail.mailRunFinished.mockClear();
});

describe('what a comparison notification says', () => {
  it('answers to the run switches: parity passes, regressions fail, an error did not run', () => {
    expect(comparisonRunStatus(comparison({ verdict: 'parity' }))).toBe('completed');
    expect(comparisonRunStatus(comparison({ verdict: 'parity_with_accepted' }))).toBe('completed');
    expect(comparisonRunStatus(comparison({ verdict: 'regressions' }))).toBe('failed');
    expect(comparisonRunStatus(comparison({ verdict: 'inconclusive' }))).toBe('failed');
    expect(comparisonRunStatus(comparison({ status: 'error', verdict: null }))).toBe('error');
    expect(comparisonRunStatus(comparison({ status: 'cancelled', verdict: null }))).toBe(
      'cancelled',
    );
    expect(comparisonRunStatus(comparison({ status: 'running', verdict: null }))).toBeNull();
  });

  it('names the plan, the two sides, the verdict and the counts in one line', () => {
    expect(comparisonLine(comparison(), 'Checkout')).toBe(
      'Checkout (Angular 22), prod → staging: REGRESSIONS — 4 identical, 1 different.',
    );
    expect(
      comparisonLine(
        comparison({ status: 'error', verdict: null, failureMessage: 'The baseline run failed.' }),
        'Checkout',
      ),
    ).toBe('Checkout (Angular 22), prod → staging: could not compare — The baseline run failed..');
  });

  it('carries the verdict, the counts and the parity report link, in Slack format for Slack', () => {
    const payload = buildComparisonPayload(
      comparison(),
      'Checkout',
      'https://hooks.slack.com/services/x',
    );
    expect(payload).toMatchObject({
      event: 'comparison.completed',
      status: 'completed',
      testPlan: { id: 'plan-1', name: 'Checkout' },
      comparison: {
        id: 'cmp-1',
        verdict: 'regressions',
        summary: { total: 5 },
        url: 'https://wfm.test/comparisons/cmp-1',
      },
    });
    expect(payload.text).toContain('https://wfm.test/comparisons/cmp-1');
    expect(payload.attachments).toBeDefined();
    expect(
      buildComparisonPayload(comparison(), 'Checkout', 'https://example.test/hook'),
    ).not.toHaveProperty('attachments');
  });
});

describe('sending it', () => {
  it('records one webhook on the candidate run and sends it, when the switch is on', async () => {
    await notifyComparisonFinished(comparison());
    expect(mail.mailRunFinished).toHaveBeenCalledTimes(1);
    expect(deliveries.recordDelivery).toHaveBeenCalledTimes(1);
    expect(deliveries.recordDelivery.mock.calls[0][0]).toMatchObject({
      organizationId: 7,
      executionId: 'run-c',
      kind: 'webhook',
      endpoint: 'https://hooks.slack.com/services/x',
    });
    expect(deliveries.attemptDelivery).toHaveBeenCalledWith('delivery-1');
  });

  it('stays quiet when the switch is off, when cancelled, or when no run started', async () => {
    await notifyComparisonFinished(comparison({ verdict: 'parity' }));
    await notifyComparisonFinished(comparison({ status: 'cancelled', verdict: null }));
    plan.row!.notificationSettings = { notExecuted: true, webhookUrl: 'https://example.test/h' };
    await notifyComparisonFinished(
      comparison({
        status: 'error',
        verdict: null,
        baselineExecutionId: null,
        candidateExecutionId: null,
      }),
    );
    expect(deliveries.recordDelivery).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    deliveries.recordDelivery.mockRejectedValueOnce(new Error('db down'));
    await expect(notifyComparisonFinished(comparison())).resolves.toBeUndefined();
    plan.row = undefined;
    await expect(notifyComparisonFinished(comparison())).resolves.toBeUndefined();
  });
});
