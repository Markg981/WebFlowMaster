import { Queue, type JobsOptions } from 'bullmq';
import { SpanKind } from '@opentelemetry/api';
import { captureTrace, withSpan } from '../../shared/telemetry';

/** Capture the producer context for every submission, including shards and retries. */
export class TracedQueue extends Queue {
  override async add(name: string, data: any, opts?: JobsOptions) {
    return withSpan('queue.submit', SpanKind.PRODUCER, undefined, () =>
      super.add(name, { ...data, traceContext: captureTrace() }, opts),
    );
  }
}
