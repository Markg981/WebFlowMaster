import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import {
  apiTests,
  testPlans,
  testPlanSelectedTests,
  testPlanExecutions,
} from '@shared/schema';
import { createTestOrganization, createTestUser } from './tests/factories';
import { processTestPlanJob } from './test-execution-service';

/**
 * A plan of API tests, run as a flow.
 *
 * Two things were missing and they compounded. `runTest`'s API branch was
 * `Math.random() > 0.2` under a TODO, so no request was ever made and every API test in a
 * plan reported a fabricated result. And nothing could carry a value from one response into
 * the next request, so even once they ran for real a plan could only check endpoints in
 * isolation — never authenticate, create, read back, delete, which is what an API test of a
 * system like DMO actually is.
 */

let server: http.Server;
let baseUrl: string;
let organizationId: number;
let userId: number;
let requests: Array<{ method: string; url: string; auth?: string }>;

/** A tiny API with a session and one resource, enough to need a real flow to exercise. */
beforeAll(async () => {
  const orders = new Map<string, { id: string; status: string }>();
  let nextId = 1000;

  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      requests.push({
        method: req.method ?? '',
        url: url.pathname,
        auth: req.headers.authorization,
      });

      const json = (status: number, payload: unknown) =>
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));

      if (url.pathname === '/auth' && req.method === 'POST') {
        return json(200, { token: 'tok-secret-123' });
      }

      // Everything else needs the token the /auth call handed out.
      if (req.headers.authorization !== 'Bearer tok-secret-123') {
        return json(401, { error: 'unauthenticated' });
      }

      if (url.pathname === '/orders' && req.method === 'POST') {
        const id = String(nextId++);
        orders.set(id, { id, status: 'confirmed' });
        return json(201, { id, status: 'confirmed' });
      }

      const match = url.pathname.match(/^\/orders\/(.+)$/);
      if (match && req.method === 'GET') {
        const order = orders.get(match[1]);
        return order ? json(200, order) : json(404, { error: 'not found' });
      }

      return json(404, { error: 'no route' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  organizationId = await createTestOrganization('Chaining Org');
  userId = await createTestUser(organizationId, 'chaining-user');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  requests = [];
  await privilegedDb.delete(testPlanSelectedTests);
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(apiTests);
});

let uuidCounter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`;

async function makeApiTest(spec: Record<string, unknown>): Promise<number> {
  const [row] = await privilegedDb
    .insert(apiTests)
    .values({ userId, organizationId, ...spec } as never)
    .returning();
  return row.id;
}

/** A plan containing the given API tests, in order. */
async function makePlan(apiTestIds: number[]): Promise<string> {
  const planId = `plan-${uuid()}`;
  await privilegedDb.insert(testPlans).values({
    id: planId,
    name: 'Order flow',
    userId,
    organizationId,
  } as never);
  for (const apiTestId of apiTestIds) {
    await privilegedDb.insert(testPlanSelectedTests).values({
      testPlanId: planId,
      organizationId,
      apiTestId,
      testType: 'api',
    } as never);
  }
  return planId;
}

async function runPlan(planId: string) {
  const executionId = `exec-${uuid()}`;
  // The job expects its execution row to already exist — the route or the scheduler
  // creates it before enqueuing, and processTestPlanJob reads the organization off it to
  // establish the tenant context.
  await privilegedDb.insert(testPlanExecutions).values({
    id: executionId,
    testPlanId: planId,
    organizationId,
    status: 'pending',
    triggeredBy: 'manual',
  } as never);

  await processTestPlanJob(planId, executionId, userId);
  const [execution] = await privilegedDb
    .select()
    .from(testPlanExecutions)
    .where(eq(testPlanExecutions.id, executionId));
  return execution;
}

describe('an API test inside a plan', () => {
  it('actually sends its request', async () => {
    const id = await makeApiTest({
      name: 'auth',
      method: 'POST',
      url: `${baseUrl}/auth`,
      assertions: [
        { id: uuid(), source: 'status_code', comparison: 'equals', targetValue: '200', enabled: true },
      ],
    });

    await runPlan(await makePlan([id]));

    // Under the placeholder this stayed empty and the plan still reported a result.
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual(['POST /auth']);
  }, 60_000);

  it('reports failure from the assertions, not from a coin flip', async () => {
    const id = await makeApiTest({
      name: 'expects the wrong status',
      method: 'POST',
      url: `${baseUrl}/auth`,
      assertions: [
        { id: uuid(), source: 'status_code', comparison: 'equals', targetValue: '204', enabled: true },
      ],
    });
    const planId = await makePlan([id]);

    // Five runs: the behaviour this replaces passed four times in five at random.
    for (let i = 0; i < 5; i++) {
      const execution = await runPlan(planId);
      expect(execution.status).toBe('failed');
    }
  }, 120_000);
});

describe('carrying a value from one request to the next', () => {
  it('runs authenticate → create → read back as one flow', async () => {
    const auth = await makeApiTest({
      name: '1 authenticate',
      method: 'POST',
      url: `${baseUrl}/auth`,
      assertions: [
        { id: uuid(), source: 'status_code', comparison: 'equals', targetValue: '200', enabled: true },
      ],
      extractions: [{ id: uuid(), name: 'token', source: 'body_json_path', property: 'token' }],
    });

    const create = await makeApiTest({
      name: '2 create an order',
      method: 'POST',
      url: `${baseUrl}/orders`,
      requestHeaders: { Authorization: 'Bearer {{token}}' },
      assertions: [
        { id: uuid(), source: 'status_code', comparison: 'equals', targetValue: '201', enabled: true },
      ],
      extractions: [{ id: uuid(), name: 'orderId', source: 'body_json_path', property: 'id' }],
    });

    const readBack = await makeApiTest({
      name: '3 read it back',
      method: 'GET',
      // Both variables come from earlier responses, not from configuration.
      url: `${baseUrl}/orders/{{orderId}}`,
      requestHeaders: { Authorization: 'Bearer {{token}}' },
      assertions: [
        { id: uuid(), source: 'status_code', comparison: 'equals', targetValue: '200', enabled: true },
        { id: uuid(), source: 'body_json_path', property: 'status', comparison: 'equals', targetValue: 'confirmed', enabled: true },
      ],
    });

    const execution = await runPlan(await makePlan([auth, create, readBack]));

    expect(execution.status).toBe('completed');
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST /auth',
      'POST /orders',
      'GET /orders/1000',
    ]);
    // The token really travelled: the API returns 401 without it, and the last two
    // assertions could not have passed.
    expect(requests[1].auth).toBe('Bearer tok-secret-123');
    expect(requests[2].auth).toBe('Bearer tok-secret-123');
  }, 120_000);

  it('fails the dependent request rather than sending a literal placeholder', async () => {
    const create = await makeApiTest({
      name: 'uses a token nobody captured',
      method: 'POST',
      url: `${baseUrl}/orders`,
      requestHeaders: { Authorization: 'Bearer {{token}}' },
      assertions: [
        { id: uuid(), source: 'status_code', comparison: 'equals', targetValue: '201', enabled: true },
      ],
    });

    const execution = await runPlan(await makePlan([create]));

    expect(execution.status).toBe('failed');
    // The request still goes out — only the URL is refused outright — and the target
    // rejects it, which is the honest outcome for an unresolved header.
    expect(requests[0]?.auth).toBe('Bearer {{token}}');
  }, 60_000);
});
