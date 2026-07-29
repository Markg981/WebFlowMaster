import fs from 'node:fs/promises';
import path from 'node:path';
import type { Incident, IncidentRepro, ReproConfidence } from '../../shared/observability';

/**
 * `.repro.ts` is collected by neither vitest config (the server one includes
 * `server/**\/*.test.ts`, the client one the default `**\/*.{test,spec}.*`). So a pending
 * reproduction cannot redden the main suites, and promoting one to a permanent regression
 * test after the fix is a rename to `.test.ts`.
 */
export const REPRO_COMMAND = "npx vitest run --include '**/*.repro.ts'";

const json = (value: unknown): string => JSON.stringify(value ?? null, null, 2);

function header(incident: Incident): string {
  const origin = incident.origin ? `${incident.origin.file}:${incident.origin.line}` : 'unresolved';
  return `/**
 * Reproduction for ${incident.id} — ${incident.title}
 *
 * Origin:  ${origin}
 * Kind:    ${incident.kind}
 * Seen:    ${incident.count}x, last ${incident.lastSeen}
 *
 * Generated from .observability/incidents/${incident.id}.json.
 * Once the bug is fixed and this passes, rename it to .test.ts to keep it as a
 * permanent regression test.
 */`;
}

function serverApiRepro(incident: Incident): string {
  const trigger = incident.trigger as {
    method?: string; path?: string; body?: unknown; userId?: number;
  };
  const method = (trigger.method ?? 'GET').toLowerCase();

  return `${header(incident)}
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';

let app: Application;
const mockUser = { id: ${trigger.userId ?? 1}, username: 'repro-user' };

beforeAll(async () => {
  const tempApp = express();
  tempApp.use(express.json());
  tempApp.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = mockUser as never;
    req.isAuthenticated = (() => true) as never;
    next();
  });
  const { registerRoutes } = await import('../routes');
  await registerRoutes(tempApp);
  app = tempApp;
});

describe('${incident.id}: ${incident.title}', () => {
  it('does not fail with a server error', async () => {
    const response = await request(app)
      .${method}('${trigger.path ?? '/'}')
      .send(${json(trigger.body)});

    expect(response.status).toBeLessThan(500);
  });
});
`;
}

function jobRepro(incident: Incident): string {
  const trigger = incident.trigger as { jobName?: string; jobData?: unknown };

  return `${header(incident)}
import { describe, it, expect } from 'vitest';

const jobName = ${json(trigger.jobName)};
const jobData = ${json(trigger.jobData)};

describe('${incident.id}: ${incident.title}', () => {
  it('processes the captured job without throwing', async () => {
    // The worker dispatches on job.name; this calls the handler that job reached.
    const { processTestPlanJob } = await import('../test-execution-service');
    const data = jobData as { planId: string; testPlanRunId: string; userId: number };

    await expect(
      processTestPlanJob(data.planId, data.testPlanRunId, data.userId),
    ).resolves.not.toThrow();

    expect(jobName).toBeTruthy();
  });
});
`;
}

function runnerRepro(incident: Incident): string {
  const trigger = incident.trigger as Record<string, unknown>;

  return `${header(incident)}
import { describe, it, expect } from 'vitest';

/**
 * Confidence: medium. The captured phase is "${String(trigger.phase)}". Reproducing it may
 * need a real browser, in which case run this on a machine with a display.
 */
const context = ${json(trigger)};

describe('${incident.id}: ${incident.title}', () => {
  // The entry point depends on which phase failed, so the call is left to be written: a
  // generated body that always threw would fail for the wrong reason and teach nothing.
  it.todo('completes the runner phase that failed');

  it('keeps the captured context available while the reproduction is written', async () => {
    const { PlaywrightService } = await import('../playwright-service');

    expect(new PlaywrightService()).toBeDefined();
    expect(context.phase).toBeTruthy();
  });
});
`;
}

function clientRuntimeRepro(incident: Incident): string {
  const trigger = incident.trigger as { route?: string; componentStack?: string; props?: unknown };
  const crumbs = incident.breadcrumbs.map((crumb) => ` *   ${JSON.stringify(crumb)}`).join('\n');
  const componentStack = (trigger.componentStack ?? '')
    .split('\n')
    .map((line) => `\n *   ${line}`)
    .join('');

  return `${header(incident)}
/**
 * Confidence: best-effort. A React render crash depends on props, state and hook history,
 * which cannot be fully captured. What is known:
 *
 * Route: ${trigger.route ?? 'unknown'}
 *
 * Component stack:${componentStack}
 *
 * Breadcrumbs before the crash:
${crumbs || ' *   (none captured)'}
 */
import { describe, it, expect } from 'vitest';

const capturedProps = ${json(trigger.props)};

describe('${incident.id}: ${incident.title}', () => {
  it.todo('renders the failing component with the captured props');

  it('keeps the captured context available while the reproduction is written', () => {
    expect(capturedProps !== undefined).toBe(true);
  });
});
`;
}

/**
 * Writes a reproduction for an incident and returns where it went.
 *
 * An existing file is never overwritten: once a human or agent has finished a
 * reproduction, a later recurrence must not silently discard that work.
 */
export async function generateRepro(incident: Incident, repoRoot: string): Promise<IncidentRepro> {
  const isClient = incident.kind === 'client-runtime';
  // Written next to the suite that will own it, so promoting it is only a rename.
  const relativePath = isClient
    ? `client/src/__repro__/${incident.id}.repro.ts`
    : `server/__repro__/${incident.id}.repro.ts`;

  const confidence: ReproConfidence =
    incident.kind === 'client-runtime' ? 'best-effort'
    : incident.kind === 'runner' ? 'medium'
    : 'high';

  const content =
    incident.kind === 'server-api' ? serverApiRepro(incident)
    : incident.kind === 'job' ? jobRepro(incident)
    : incident.kind === 'runner' ? runnerRepro(incident)
    : clientRuntimeRepro(incident);

  const absolute = path.join(repoRoot, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });

  try {
    await fs.access(absolute);
    // Already there — leave it alone.
  } catch {
    await fs.writeFile(absolute, content, 'utf8');
  }

  return { path: relativePath, command: REPRO_COMMAND, confidence };
}
