import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  apiTests,
  insertApiTestSchema,
  insertTestSchema,
  mobileTests,
  projects,
  testPlanApiPayloadSchema,
  testPlanSelectedTests,
  testPlans,
  tests,
} from '@shared/schema';
import type { TenantTx } from '../platform/middleware/tenancy';
import { recordAudit, type AuditActor } from '../tenancy/audit';
import { recordTestVersion, recordTypedTestVersion } from './test-version-store';

/**
 * The sample project a new organization can start from: web and API tests against the Northwind
 * Shop (server/http/routes/demo-shop.routes.ts), which the application serves itself, and plans
 * that run them. The same storefront and journeys as the promo video
 * (marketing/promo-video/demo/build-data.mjs), so what the video shows is what a new user gets.
 *
 * Everything is created the way the product creates it — validated by the schemas the routes use,
 * version 1 recorded, every row audited — in the caller's transaction, so it all exists or none
 * of it does. Nothing is faked: there is no history until the plans run.
 */

export const SAMPLE_PROJECT_NAME = 'Northwind Shop (sample)';

/** Every test and plan name starts with this, so the library says where they came from. */
const PREFIX = 'Sample · ';

const action = (id: string, name: string) => ({
  id,
  name,
  type: id,
  icon: 'circle',
  description: name,
});
const el = (selector: string, tag = 'div', text = '') => ({
  id: selector,
  tag,
  text,
  type: tag,
  selector,
  attributes: {},
});
const step = (
  id: string,
  act: ReturnType<typeof action>,
  value = '',
  target?: ReturnType<typeof el>,
) => ({ id, value, action: act, ...(target ? { targetElement: target } : {}) });

const NAVIGATE = action('navigate', 'Navigate');
const INPUT = action('input', 'Input Text');
const CLICK = action('click', 'Click Element');
const WAIT = action('waitForElement', 'Wait for Element');
const ASSERT_TEXT = action('assertTextContains', 'Assert Text Contains');
// A native <select>: 'select'. ('selectByText' is for dropdowns built from other elements.)
const SELECT = action('select', 'Select Option');

/** The test that fails on purpose, so the sample has a failure report to open. */
export const FAILING_TEST = `${PREFIX}Promo banner shows the discount`;

function webTests(shop: string) {
  return [
    {
      name: `${PREFIX}Sign in with valid credentials`,
      url: `${shop}/login/`,
      module: 'Account',
      priority: 'Critical' as const,
      sequence: [
        step('nav', NAVIGATE, `${shop}/login/`),
        step('user', INPUT, 'maya.chen', el('#username', 'input')),
        step('pass', INPUT, 'Coffee-2026', el('#password', 'input')),
        step('submit', CLICK, '', el("button[type='submit']", 'button', 'Sign in')),
        step('check', ASSERT_TEXT, 'Welcome back, Maya!', el('#flash')),
      ],
    },
    {
      name: `${PREFIX}Sign in rejects a wrong password`,
      url: `${shop}/login/`,
      module: 'Account',
      priority: 'High' as const,
      sequence: [
        step('nav', NAVIGATE, `${shop}/login/`),
        step('user', INPUT, 'maya.chen', el('#username', 'input')),
        step('pass', INPUT, 'not-the-password', el('#password', 'input')),
        step('submit', CLICK, '', el("button[type='submit']", 'button', 'Sign in')),
        step('check', ASSERT_TEXT, 'Wrong username or password.', el('#flash')),
      ],
    },
    {
      name: `${PREFIX}Order confirmation appears`,
      url: `${shop}/checkout/`,
      module: 'Checkout',
      priority: 'Critical' as const,
      sequence: [
        step('nav', NAVIGATE, `${shop}/checkout/`),
        step('order', CLICK, '', el('#place-order', 'button', 'Place order')),
        step('wait', WAIT, 'visible', el('#confirmation')),
        step('check', ASSERT_TEXT, 'Order confirmed', el('#confirmation')),
      ],
    },
    {
      name: `${PREFIX}Express shipping updates the total`,
      url: `${shop}/checkout/`,
      module: 'Checkout',
      priority: 'Medium' as const,
      sequence: [
        step('nav', NAVIGATE, `${shop}/checkout/`),
        step('choose', SELECT, 'express', el('#shipping', 'select')),
        step('check', ASSERT_TEXT, '€9.90', el('#shipping-cost', 'span')),
      ],
    },
    {
      // Fails on purpose: the banner offers free shipping, not a discount.
      name: FAILING_TEST,
      url: `${shop}/catalog/`,
      module: 'Catalog',
      priority: 'Medium' as const,
      sequence: [
        step('nav', NAVIGATE, `${shop}/catalog/`),
        step('check', ASSERT_TEXT, '20% off everything', el('#promo')),
      ],
    },
  ];
}

const assertion = (source: string, comparison: string, targetValue: string, property?: string) => ({
  id: randomUUID(),
  source,
  enabled: true,
  comparison,
  targetValue,
  ...(property ? { property } : {}),
});

function apiTestDefinitions(shop: string) {
  return [
    {
      name: `${PREFIX}Orders API: place an order`,
      method: 'POST',
      url: `${shop}/api/orders`,
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: JSON.stringify({ product: 'Espresso Roast', quantity: 2 }),
      bodyType: 'raw',
      module: 'Orders API',
      assertions: [
        assertion('status_code', 'equals', '201'),
        assertion('body_json_path', 'equals', 'Espresso Roast', 'product'),
      ],
      // The next test reads the order back by this number: a flow, not two isolated calls.
      extractions: [
        { id: randomUUID(), name: 'orderId', source: 'body_json_path', property: 'id' },
      ],
    },
    {
      name: `${PREFIX}Orders API: read the order back`,
      method: 'GET',
      url: `${shop}/api/orders/{{orderId}}`,
      requestHeaders: {},
      requestBody: '',
      bodyType: 'raw',
      module: 'Orders API',
      assertions: [
        assertion('status_code', 'equals', '200'),
        assertion('body_json_path', 'equals', 'confirmed', 'status'),
      ],
      extractions: [],
    },
    {
      name: `${PREFIX}Storefront health check`,
      method: 'GET',
      url: `${shop}/api/health`,
      requestHeaders: {},
      requestBody: '',
      bodyType: 'raw',
      module: 'Orders API',
      assertions: [
        assertion('status_code', 'equals', '200'),
        assertion('body_json_path', 'equals', 'ok', 'status'),
        assertion('response_time', 'less_than', '3000'),
      ],
      extractions: [],
    },
  ];
}

const machine = (browserName: string) => ({
  os: 'linux',
  osVersion: 'Ubuntu 22.04',
  browserName,
  browserVersion: 'latest',
  headless: true,
});

const CAPTURE = {
  captureScreenshots: 'on_failed_steps',
  captureVideo: 'on_failure',
  captureTrace: 'on_failure',
  captureNetwork: 'always',
  reRunOnFailure: 'none',
};

type PlanSpec = {
  name: string;
  description: string;
  browsers: string[];
  maxParallelTests: number;
  web: string[];
  api: string[];
};

/** The plan the sample runs as soon as it is created: quick, and green on a working installation. */
export const FIRST_RUN_PLAN = `${PREFIX}Checkout smoke`;

function planSpecs(web: string[], api: string[]): PlanSpec[] {
  return [
    {
      name: FIRST_RUN_PLAN,
      description: 'The paths that take money: sign in, place an order, pick a shipping method.',
      browsers: ['chromium'],
      maxParallelTests: 2,
      web: [web[0], web[2], web[3]],
      api: [],
    },
    {
      name: `${PREFIX}Storefront regression`,
      description: 'Every storefront journey on Chromium, Firefox and WebKit.',
      browsers: ['chromium', 'firefox', 'webkit'],
      maxParallelTests: 4,
      web: web.filter((name) => name !== FAILING_TEST),
      api: [],
    },
    {
      name: `${PREFIX}Orders API contract`,
      description: 'Place an order, read it back by its number and check the service is up.',
      browsers: ['chromium'],
      maxParallelTests: 1,
      web: [],
      api,
    },
    {
      name: `${PREFIX}Catalog checks (fails on purpose)`,
      description:
        'The promo banner check fails, to show what a failure looks like: the step, the screenshot, the video and the trace.',
      browsers: ['chromium'],
      maxParallelTests: 1,
      web: [FAILING_TEST, web[3]],
      api: [],
    },
  ];
}

export class SampleProjectExistsError extends Error {
  override readonly name = 'SampleProjectExistsError';
  constructor(readonly projectId: number | null) {
    super(
      projectId === null
        ? 'Tests from the sample project are still here: delete them before creating it again.'
        : 'This organization already has the sample project.',
    );
  }
}

/**
 * Whether to offer the sample: only to an organization that has no tests of any kind yet, the
 * moment it helps. Once there is work of its own, the offer would be clutter.
 */
export async function sampleProjectOffered(tx: TenantTx): Promise<boolean> {
  for (const table of [tests, apiTests, mobileTests]) {
    const [any] = await tx.select({ id: table.id }).from(table).limit(1);
    if (any) return false;
  }
  const [sample] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.name, SAMPLE_PROJECT_NAME))
    .limit(1);
  return !sample;
}

export interface SampleProject {
  projectId: number;
  tests: number;
  apiTests: number;
  plans: { id: string; name: string }[];
  /** The plan to run first (FIRST_RUN_PLAN). */
  firstRunPlanId: string;
}

/**
 * Creates the sample project in the caller's organization. `shopUrl` is where the runners reach
 * the Northwind Shop, without a trailing slash. Refuses, with SampleProjectExistsError, when the
 * project or any of its tests is already there: a second copy would only be confusing, and test
 * names are unique in an organization.
 */
export async function createSampleProject(
  tx: TenantTx,
  input: { organizationId: number; userId: number; actor: AuditActor; shopUrl: string },
): Promise<SampleProject> {
  const { organizationId, userId, actor } = input;
  const shop = input.shopUrl.replace(/\/+$/, '');
  const webDefinitions = webTests(shop);
  const apiDefinitions = apiTestDefinitions(shop);

  const [existing] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.name, SAMPLE_PROJECT_NAME))
    .limit(1);
  if (existing) throw new SampleProjectExistsError(existing.id);
  const leftovers = [
    ...(await tx
      .select({ id: tests.id })
      .from(tests)
      .where(
        inArray(
          tests.name,
          webDefinitions.map((t) => t.name),
        ),
      )
      .limit(1)),
    ...(await tx
      .select({ id: apiTests.id })
      .from(apiTests)
      .where(
        inArray(
          apiTests.name,
          apiDefinitions.map((t) => t.name),
        ),
      )
      .limit(1)),
  ];
  if (leftovers.length > 0) throw new SampleProjectExistsError(null);

  const [project] = await tx
    .insert(projects)
    .values({ name: SAMPLE_PROJECT_NAME, userId, organizationId })
    .returning();
  await recordAudit(tx, {
    action: AUDIT_ACTIONS.PROJECT_CREATED,
    actor,
    targetType: 'project',
    targetId: project.id,
    metadata: { name: project.name, sample: true },
  });

  const webIds = new Map<string, number>();
  for (const definition of webDefinitions) {
    const values = insertTestSchema.parse({
      ...definition,
      projectId: project.id,
      elements: [],
      status: 'saved',
    });
    const [row] = await tx
      .insert(tests)
      .values({ ...values, userId, organizationId })
      .returning();
    await recordTestVersion(tx, { testId: row.id, organizationId, userId, test: row });
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.TEST_CREATED,
      actor,
      targetType: 'test',
      targetId: row.id,
      metadata: { name: row.name, sample: true },
    });
    webIds.set(row.name, row.id);
  }

  const apiIds = new Map<string, number>();
  for (const definition of apiDefinitions) {
    const values = insertApiTestSchema.parse({
      ...definition,
      projectId: project.id,
      queryParams: {},
      authType: 'none',
    });
    const [row] = await tx
      .insert(apiTests)
      .values({ ...values, userId, organizationId })
      .returning();
    await recordTypedTestVersion(tx, {
      testType: 'api',
      testId: row.id,
      organizationId,
      userId,
      test: row,
    });
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.API_TEST_CREATED,
      actor,
      targetType: 'api_test',
      targetId: row.id,
      metadata: { name: row.name, sample: true },
    });
    apiIds.set(row.name, row.id);
  }

  const plans: SampleProject['plans'] = [];
  for (const spec of planSpecs(
    webDefinitions.map((t) => t.name),
    apiDefinitions.map((t) => t.name),
  )) {
    const { selectedTests, ...plan } = testPlanApiPayloadSchema.parse({
      name: spec.name,
      description: spec.description,
      testMachinesConfig: spec.browsers.map(machine),
      maxParallelTests: spec.maxParallelTests,
      ...CAPTURE,
      selectedTests: [
        ...spec.web.map((name) => ({ id: webIds.get(name)!, type: 'ui' as const })),
        ...spec.api.map((name) => ({ id: apiIds.get(name)!, type: 'api' as const })),
      ],
    });
    const [row] = await tx
      .insert(testPlans)
      .values({
        ...plan,
        id: randomUUID(),
        userId,
        organizationId,
        // jsonb stored through JSON.stringify, as the plan routes do.
        testMachinesConfig: JSON.stringify(plan.testMachinesConfig),
        notificationSettings: null,
      })
      .returning();
    await tx.insert(testPlanSelectedTests).values(
      selectedTests.map((selected) => ({
        testPlanId: row.id,
        organizationId,
        testId: selected.type === 'ui' ? selected.id : null,
        apiTestId: selected.type === 'api' ? selected.id : null,
        mobileTestId: null,
        testType: selected.type,
      })),
    );
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.PLAN_CREATED,
      actor,
      targetType: 'test_plan',
      targetId: row.id,
      metadata: { name: row.name, tests: selectedTests.length, sample: true },
    });
    plans.push({ id: row.id, name: row.name });
  }

  return {
    projectId: project.id,
    tests: webIds.size,
    apiTests: apiIds.size,
    plans,
    firstRunPlanId: plans.find((p) => p.name === FIRST_RUN_PLAN)!.id,
  };
}
