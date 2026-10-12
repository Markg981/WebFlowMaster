import logger from '../logger';
import { sweepSubscriptions } from './service';

/**
 * Runs the subscription sweep (server/billing/service.ts) on an interval, the way the artifact
 * retention sweep runs: soon after start, then every twelve hours. Started by the web server;
 * one replica sweeping twice is harmless, since every change is under an idempotency key.
 */
export function startBillingSweep(intervalMs = 12 * 60 * 60_000): () => void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      const report = await sweepSubscriptions();
      if (report.suspended.length > 0 || report.trialsEnded.length > 0)
        logger.info({ message: 'Billing sweep', ...report });
    } catch (error) {
      logger.error({ message: 'The billing sweep failed', error: (error as Error)?.message });
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void sweep(), 2 * 60_000);
  const timer = setInterval(() => void sweep(), intervalMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
