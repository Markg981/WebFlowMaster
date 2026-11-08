import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import { runWithTenant } from '../platform/middleware/tenancy';
import { outboundDeliveries, testPlanExecutions, testPlans, users } from '@shared/schema';
import { createTestOrganization } from '../tests/factories';
import {
  attemptDelivery,
  deliveriesOf,
  recordDelivery,
  redactTarget,
  sanitizeError,
  sweepDeliveries,
} from './deliveries';

/** A notification survives an endpoint that is down: it is retried with backoff, then given up on (audit M-06). */

const reply = (status: number) => ({ ok: status < 300, status, statusText: String(status) });
const sleep = vi.fn().mockResolvedValue(undefined);
const t0 = new Date('2026-11-07T10:00:00.000Z');
const later = (ms: number) => new Date(t0.getTime() + ms);

let organizationId: number;
let executionId: string;

async function seed(): Promise<{ org: number; run: string }> {
  const org = await createTestOrganization(`Deliveries ${uuidv4().slice(0, 6)}`);
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `del-${uuidv4().slice(0, 8)}`, password: 'x', organizationId: org })
    .returning();
  const planId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'P', userId: user.id, organizationId: org } as never);
  const run = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({
    id: run,
    organizationId: org,
    testPlanId: planId,
    triggeredBy: 'manual',
  } as never);
  return { org, run };
}

const create = (now = t0) =>
  runWithTenant(organizationId, () =>
    recordDelivery({
      organizationId,
      executionId,
      kind: 'webhook',
      endpoint: 'https://hooks.test/services/SECRET-TOKEN',
      payload: { text: 'run done' },
      now,
    }),
  );
const row = async (id: string) =>
  (await privilegedDb.select().from(outboundDeliveries).where(eq(outboundDeliveries.id, id)))[0];

beforeEach(async () => {
  ({ org: organizationId, run: executionId } = await seed());
});

describe('helpers', () => {
  it('keeps secrets out of the target and of the error', () => {
    expect(redactTarget('https://hooks.test/services/SECRET')).toBe('https://hooks.test');
    expect(sanitizeError('could not reach https://hooks.test/services/SECRET boom')).toBe(
      'could not reach [url] boom',
    );
    expect(sanitizeError('x'.repeat(1000)).length).toBe(300);
  });
});

describe('attemptDelivery', () => {
  it('sends on a 500 that then answers 200 inside one attempt', async () => {
    const id = await create();
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply(500)).mockResolvedValueOnce(reply(200));
    const outcome = await runWithTenant(organizationId, () =>
      attemptDelivery(id, { fetchImpl: fetchImpl as never, sleep, now: t0 }),
    );
    expect(outcome).toBe('sent');
    expect(await row(id)).toMatchObject({ status: 'sent', attempts: 1, lastError: null });
  });

  it('queues a retry with backoff and delivers it after a restart-like gap', async () => {
    const id = await create();
    const down = vi.fn().mockResolvedValue(reply(503));
    await runWithTenant(organizationId, () =>
      attemptDelivery(id, { fetchImpl: down as never, sleep, now: t0 }),
    );
    const queued = await row(id);
    expect(queued).toMatchObject({ status: 'queued', attempts: 1 });
    expect(queued.nextAttemptAt.getTime()).toBe(later(60_000).getTime());
    expect(queued.lastError).toContain('503');

    // Not due yet: the sweep leaves it alone.
    const early = await sweepDeliveries({ fetchImpl: down as never, sleep, now: later(30_000) });
    expect(early).toEqual({ sent: 0, retry: 0, failed: 0 });

    const ok = vi.fn().mockResolvedValue(reply(200));
    const report = await sweepDeliveries({ fetchImpl: ok as never, sleep, now: later(61_000) });
    expect(report.sent).toBeGreaterThanOrEqual(1);
    expect(await row(id)).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('does not take a row another worker holds', async () => {
    const id = await create();
    const fetchImpl = vi.fn().mockResolvedValue(reply(200));
    const [a, b] = await Promise.all([
      runWithTenant(organizationId, () =>
        attemptDelivery(id, { fetchImpl: fetchImpl as never, sleep, now: t0 }),
      ),
      runWithTenant(organizationId, () =>
        attemptDelivery(id, { fetchImpl: fetchImpl as never, sleep, now: t0 }),
      ),
    ]);
    expect([a, b].sort()).toEqual(['not_due', 'sent']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after the cap, and at once on a plain refusal', async () => {
    const id = await create();
    const down = vi.fn().mockResolvedValue(reply(500));
    let now = t0;
    for (let i = 0; i < 5; i++) {
      await runWithTenant(organizationId, () =>
        attemptDelivery(id, { fetchImpl: down as never, sleep, now }),
      );
      now = new Date(now.getTime() + 31 * 60_000);
    }
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: 5 });

    const refused = await create();
    const gone = vi.fn().mockResolvedValue(reply(404));
    const outcome = await runWithTenant(organizationId, () =>
      attemptDelivery(refused, { fetchImpl: gone as never, sleep, now: t0 }),
    );
    expect(outcome).toBe('failed');
    expect(gone).toHaveBeenCalledTimes(1);
  });
});

describe('deliveriesOf', () => {
  it('lists the run deliveries without endpoint or payload, and not for another organization', async () => {
    const id = await create();
    const mine = await runWithTenant(organizationId, () => deliveriesOf(executionId));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id, target: 'https://hooks.test', status: 'queued' });
    expect(JSON.stringify(mine)).not.toContain('SECRET-TOKEN');

    const other = await seed();
    const seen = await runWithTenant(other.org, () => deliveriesOf(executionId));
    expect(seen).toEqual([]);
  });
});
