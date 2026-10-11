import { Router } from 'express';

/**
 * Probes for whatever runs the web process: Docker's HEALTHCHECK, a load balancer, Kubernetes.
 *
 *   GET /healthz  the process answers HTTP. No dependency is touched, so a database outage does
 *                 not get a healthy process restarted.
 *   GET /readyz   it can serve requests: PostgreSQL answers, the Redis behind queues and rate
 *                 limits answers, the session store is connected. 503 names what is not.
 *
 * The image's HEALTHCHECK used to fetch /api/user and accept anything under 500, so a 401 with
 * the database down counted as healthy. Neither probe needs a session or a token, and the
 * answers carry check names only, never an error message or a host name.
 */
export type ReadinessCheck = () => Promise<unknown> | unknown;
export type CheckResult = 'ok' | 'failed';

export async function readiness(checks: Record<string, ReadinessCheck>, timeoutMs = 2_000) {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]): Promise<[string, CheckResult]> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const passed = await Promise.race([
          Promise.resolve().then(check).then((value) => value !== false),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
        ]);
        return [name, passed ? 'ok' : 'failed'];
      } catch {
        return [name, 'failed'];
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const results = Object.fromEntries(entries);
  return { ready: entries.every(([, result]) => result === 'ok'), checks: results };
}

export function healthRouter(checks: Record<string, ReadinessCheck>, timeoutMs?: number): Router {
  const router = Router();
  router.get('/healthz', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });
  router.get('/readyz', async (_req, res) => {
    const { ready, checks: results } = await readiness(checks, timeoutMs);
    res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not ready', checks: results });
  });
  return router;
}
