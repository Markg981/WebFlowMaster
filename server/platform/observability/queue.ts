import { Queue, type JobsOptions } from 'bullmq';
import { SpanKind } from '@opentelemetry/api';
import { captureTrace, withSpan } from '../../../shared/telemetry';

/** How long an enqueue waits for Redis: with it down, ioredis queues the command offline forever. */
const SUBMIT_TIMEOUT_MS = Number(process.env.QUEUE_SUBMIT_TIMEOUT_MS) || 10_000;

/** Capture the producer context for every submission, including shards and retries. */
export class TracedQueue extends Queue {
  override async add(name: string, data: any, opts?: JobsOptions) {
    return withSpan('queue.submit', SpanKind.PRODUCER, undefined, () => {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`The queue did not accept the job within ${SUBMIT_TIMEOUT_MS} ms`)),
          SUBMIT_TIMEOUT_MS,
        );
      });
      return Promise.race([
        super.add(name, { ...data, traceContext: captureTrace() }, opts),
        timeout,
      ]).finally(() => clearTimeout(timer));
    });
  }
}
