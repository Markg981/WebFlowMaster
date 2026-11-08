import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { outboundDeliveries, type OutboundDelivery } from '@shared/schema';
import { privilegedDb } from '../platform/db';
import { runWithTenant, withTenantTransaction } from '../platform/middleware/tenancy';
import logger from '../platform/logger';
import { postWebhook, type SendDeps } from './notifications';

/**
 * What a finished run owes outside, kept until it is delivered or given up (audit M-06).
 *
 * The row is written before the first attempt and updated after each. The attempt that follows
 * the run is the first; whatever it leaves queued (the process stopped, the endpoint was down) is
 * retried by the sweep the web server runs, with a growing pause, up to DELIVERY_MAX_ATTEMPTS.
 * Two sweeps never post the same row twice: an attempt first moves `next_attempt_at` forward
 * (its lease) in one UPDATE ... RETURNING, and only the statement that changed the row proceeds.
 */

export const DELIVERY_MAX_ATTEMPTS = 5;
/** Pause after attempt N (1-based): 1, 5, 15 and 30 minutes, about an hour in all. */
export const DELIVERY_BACKOFF_MS = [60_000, 300_000, 900_000, 1_800_000];
/** How long an attempt owns its row before another sweep may take it over. */
export const DELIVERY_LEASE_MS = 120_000;
const BATCH = 25;
const ERROR_MAX = 300;

/** The URL without its path or query: those carry the webhook's secret. */
export function redactTarget(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'invalid URL';
  }
}

/** Cuts the message and removes any URL in it, which may carry the webhook's token. */
export function sanitizeError(message: string): string {
  return message.replace(/https?:\/\/\S+/gi, '[url]').slice(0, ERROR_MAX);
}

export function nextPause(attempts: number): number {
  return DELIVERY_BACKOFF_MS[Math.min(attempts, DELIVERY_BACKOFF_MS.length) - 1] ?? 0;
}

/** Writes the delivery down, due now. Inside the run's organization. */
export async function recordDelivery(input: {
  organizationId: number;
  executionId: string;
  kind: string;
  endpoint: string;
  payload: Record<string, unknown>;
  now?: Date;
}): Promise<string> {
  const id = randomUUID();
  await withTenantTransaction(async (tx) => {
    await tx.insert(outboundDeliveries).values({
      id,
      organizationId: input.organizationId,
      executionId: input.executionId,
      kind: input.kind,
      target: redactTarget(input.endpoint),
      endpoint: input.endpoint,
      payload: input.payload,
      nextAttemptAt: input.now ?? new Date(),
    });
  });
  return id;
}

export type AttemptOutcome = 'sent' | 'retry' | 'failed' | 'not_due';

/** Claims one due delivery and tries it once. Inside the delivery's organization. */
export async function attemptDelivery(
  id: string,
  deps: SendDeps & { now?: Date; maxAttempts?: number } = {},
): Promise<AttemptOutcome> {
  const now = deps.now ?? new Date();
  const maxAttempts = deps.maxAttempts ?? DELIVERY_MAX_ATTEMPTS;
  const claimed = await withTenantTransaction((tx) =>
    tx
      .update(outboundDeliveries)
      .set({ nextAttemptAt: new Date(now.getTime() + DELIVERY_LEASE_MS), updatedAt: now })
      .where(
        and(
          eq(outboundDeliveries.id, id),
          eq(outboundDeliveries.status, 'queued'),
          lte(outboundDeliveries.nextAttemptAt, now),
        ),
      )
      .returning(),
  );
  const row = claimed[0];
  if (!row) return 'not_due';

  const result = await postWebhook(row.endpoint, JSON.stringify(row.payload), deps);
  const attempts = row.attempts + 1;
  const done = result.delivered;
  const final = !done && (result.retryable === false || attempts >= maxAttempts);
  await withTenantTransaction(async (tx) => {
    await tx
      .update(outboundDeliveries)
      .set({
        status: done ? 'sent' : final ? 'failed' : 'queued',
        attempts,
        lastError: done ? null : sanitizeError(result.error ?? 'Not delivered.'),
        nextAttemptAt: new Date(now.getTime() + (done || final ? 0 : nextPause(attempts))),
        updatedAt: new Date(),
      })
      .where(eq(outboundDeliveries.id, id));
  });
  return done ? 'sent' : final ? 'failed' : 'retry';
}

/** Retries every due queued delivery, across organizations. */
export async function sweepDeliveries(
  deps: SendDeps & { now?: Date; maxAttempts?: number } = {},
): Promise<{ sent: number; retry: number; failed: number }> {
  const now = deps.now ?? new Date();
  const due = await privilegedDb
    .select({ id: outboundDeliveries.id, organizationId: outboundDeliveries.organizationId })
    .from(outboundDeliveries)
    .where(and(eq(outboundDeliveries.status, 'queued'), lte(outboundDeliveries.nextAttemptAt, now)))
    .orderBy(asc(outboundDeliveries.nextAttemptAt))
    .limit(BATCH);
  const report = { sent: 0, retry: 0, failed: 0 };
  for (const item of due) {
    const outcome = await runWithTenant(item.organizationId, () => attemptDelivery(item.id, deps));
    if (outcome === 'sent' || outcome === 'retry' || outcome === 'failed') report[outcome]++;
  }
  return report;
}

/** What the run's page shows: never the endpoint or the payload. */
export type DeliveryView = Pick<
  OutboundDelivery,
  'id' | 'kind' | 'target' | 'status' | 'attempts' | 'lastError' | 'nextAttemptAt' | 'updatedAt'
>;

export async function deliveriesOf(executionId: string): Promise<DeliveryView[]> {
  return withTenantTransaction((tx) =>
    tx
      .select({
        id: outboundDeliveries.id,
        kind: outboundDeliveries.kind,
        target: outboundDeliveries.target,
        status: outboundDeliveries.status,
        attempts: outboundDeliveries.attempts,
        lastError: outboundDeliveries.lastError,
        nextAttemptAt: outboundDeliveries.nextAttemptAt,
        updatedAt: outboundDeliveries.updatedAt,
      })
      .from(outboundDeliveries)
      .where(eq(outboundDeliveries.executionId, executionId))
      .orderBy(desc(outboundDeliveries.createdAt)),
  );
}

/** Sweeps every intervalMs until stopped. Started by the web server, which always runs. */
export function startDeliverySweep(intervalMs = 30_000): () => void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      const report = await sweepDeliveries();
      if (report.sent + report.retry + report.failed > 0)
        logger.info({ message: 'Retried outbound deliveries', ...report });
    } catch (error) {
      logger.error({
        message: 'The delivery sweep failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void sweep(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
