/** Anything that stops taking work on close() and resolves once what it has in hand is done. */
export interface ClosableConsumer {
  close(): Promise<void>;
}

/**
 * Closes every queue consumer at once.
 *
 * A BullMQ Worker stops fetching new jobs as soon as close() is called, then waits for its active
 * ones. Closed one after another, the second consumer would keep taking jobs for as long as the
 * first one's run lasted — work a redeploy then kills when the grace period runs out. Every
 * close() is started before any is awaited, and a failing one does not cut short the wait for
 * the others: their jobs still finish before the first error is rethrown.
 */
export async function closeConsumers(consumers: readonly ClosableConsumer[]): Promise<void> {
  const results = await Promise.allSettled(consumers.map((consumer) => consumer.close()));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}
