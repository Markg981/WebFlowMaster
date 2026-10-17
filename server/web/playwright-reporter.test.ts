import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { and, eq } from 'drizzle-orm';
import type { Browser, Page } from 'playwright';
import {
  auditLog,
  healingProposals,
  projectElements,
  projects,
  stepGroups,
  testVersions,
  tests,
} from '@shared/schema';

/**
 * Healing at run time: the step passes on a repaired locator, and that is all the run does (P10 C05,
 * P13 M02).
 *
 * P10 made a run's repair go to the step's source as it is written — the test's step, the group's
 * step or the shared element — instead of whichever step of the test sat at the runner's position.
 * P13 takes the write away from the run altogether: the repair is used for this run and recorded as
 * a proposal with where it belongs, and nothing in the test, the group or the element changes until
 * an editor approves it (server/authoring/healing-proposals.test.ts). These drive a real Chromium
 * page against the in-memory database.
 */

const mocks = vi.hoisted(() => ({ logs: [] as string[] }));
vi.mock('../identity/storage', () => ({ storage: { getUserSettings: vi.fn() } }));
vi.mock('../http/websocket', () => ({
  getWsEmitter: () => ({
    emitExecutionLog: (_id: string, entry: { message: string }) => mocks.logs.push(entry.message),
  }),
}));

const { chromium } = await import('playwright');
const { privilegedDb } = await import('../platform/db');
const { runWithTenant } = await import('../platform/middleware/tenancy');
const { createTestOrganization, createTestUser } = await import('../tests/factories');
const { aiService } = await import('../authoring/ai-automation-service');
const { prepareSequence } = await import('../authoring/executable-definition');
const { elementIdOfStep } = await import('../authoring/step-elements');
const { provenanceOf } = await import('../authoring/step-provenance');
const { PlaywrightReporter } = await import('./playwright-reporter');
const { TestRunner } = await import('./playwright/test-runner');

const PAGE =
  '<button id="first">One</button>' +
  '<button id="second" style="color: blue">Two</button>' +
  '<button id="third" data-testid="third-button">Three</button>' +
  '<span class="twin">A</span><span class="twin">B</span>' +
  '<input type="hidden" name="csrf" value="tok-secret">';

const click = (id: string, selector: string, target: Record<string, unknown> = {}) => ({
  id,
  action: { id: 'click', name: `Click ${id}` },
  targetElement: { selector, ...target },
});
const call = (id: string, groupId: string) => ({
  id,
  action: { id: 'callGroup', name: 'Call' },
  value: groupId,
});

let browser: Browser;
let page: Page;
let organizationId: number;
let userId: number;
let projectId: number;
/** What the model proposes for a selector, by the selector that failed. */
let proposals: Record<string, string>;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  organizationId = await createTestOrganization('Healing Org');
  userId = await createTestUser(organizationId, `healer-${uuidv4().slice(0, 6)}`);
  const [project] = await privilegedDb
    .insert(projects)
    .values({ name: 'Healing App', userId, organizationId })
    .returning();
  projectId = project.id;
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  mocks.logs.length = 0;
  proposals = { '#gone': '#second', '#missing': '#third', '#twin-gone': '.twin' };
  // The deployment's AI switch, on: no test calls the model, the answers are these.
  vi.spyOn(aiService, 'isAvailable').mockReturnValue(true);
  vi.spyOn(aiService, 'healSelector').mockImplementation(
    async (selector: string) => proposals[selector] ?? null,
  );
  page = await browser.newPage();
  page.setDefaultTimeout(400);
  await page.setContent(PAGE);
  return async () => {
    vi.restoreAllMocks();
    await page.close();
  };
});

async function seedTest(sequence: unknown[], extra: Partial<typeof tests.$inferInsert> = {}) {
  const [row] = await privilegedDb
    .insert(tests)
    .values({
      userId,
      organizationId,
      name: `Heal ${uuidv4().slice(0, 4)}`,
      url: '',
      sequence,
      elements: [],
      ...extra,
    })
    .returning();
  return row;
}
async function seedGroup(sequence: unknown[]) {
  const id = uuidv4();
  await privilegedDb
    .insert(stepGroups)
    .values({ id, organizationId, userId, name: `Group ${id.slice(0, 4)}`, sequence });
  return id;
}
async function seedElement(selector: string) {
  const id = uuidv4();
  await privilegedDb
    .insert(projectElements)
    .values({ id, organizationId, projectId, name: `El ${id.slice(0, 4)}`, selector });
  return id;
}
const testRow = async (id: number) =>
  (await privilegedDb.select().from(tests).where(eq(tests.id, id)))[0];
const groupRow = async (id: string) =>
  (await privilegedDb.select().from(stepGroups).where(eq(stepGroups.id, id)))[0];
const proposalsOf = (testId: number) =>
  privilegedDb.select().from(healingProposals).where(eq(healingProposals.testId, testId));
const healedAudits = (targetId: string | number) =>
  privilegedDb
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.targetId, String(targetId))));

/** The runner's loop, for the clicks: each prepared step driven with its own provenance. */
async function drive(testId: number, sequence: unknown) {
  const prepared = await prepareSequence(sequence);
  expect(prepared.errors).toEqual([]);
  const reporter = new PlaywrightReporter(page);
  const outcomes = [];
  for (const [index, step] of prepared.steps.entries()) {
    reporter.setContext({
      testId,
      provenance: provenanceOf(step),
      elementId: elementIdOfStep(step),
      executionId: 'exec-heal',
      stepIndex: index,
      element: step.targetElement as { tag?: unknown; attributes?: unknown },
    });
    reporter.resetStepState();
    await reporter.click((step.targetElement as { selector: string }).selector);
    outcomes.push(reporter.lastHealing);
  }
  return { prepared, outcomes };
}

describe('a run heals for itself and proposes the repair where the step is written', () => {
  it('passes the group step on the repair, proposes it for the group, and changes nothing (real runner)', async () => {
    const group = await seedGroup([click('g1', '#first'), click('g2', '#gone')]);
    // The page is built by the test's first step: the runner opens a blank one. Written third,
    // the independent click is the runner's fourth step — the position the old repair used.
    const setup = {
      id: 't1',
      action: { id: 'executeScript', name: 'Build the page' },
      value: `document.body.innerHTML = ${JSON.stringify(PAGE)};`,
    };
    const assertion = {
      id: 't4',
      action: { id: 'assertTextContains', name: 'Check the third button' },
      targetElement: { selector: '#third' },
      value: 'Three',
    };
    const sequence = [setup, call('c2', group), click('t3', '#third'), assertion];
    const test = await seedTest(sequence);

    const result = await runWithTenant(organizationId, () =>
      new TestRunner().executeTestSequence(test, null, undefined, 'exec-heal', {}, undefined, {
        runtime: {
          pageLoadTimeoutMs: 5_000,
          elementTimeoutMs: 400,
          screenshots: 'never',
          retryFailedStep: false,
        },
      }),
    );

    expect(result.success).toBe(true);
    const healed = result.steps!.filter((step) => step.healed);
    expect(healed).toHaveLength(1);
    expect(healed[0]).toMatchObject({
      stepId: 'g2',
      calledFrom: 'c2',
      status: 'passed',
      healing: {
        status: 'proposed',
        origin: 'ai',
        originalSelector: '#gone',
        proposedSelector: '#second',
        target: { kind: 'group', index: 1 },
      },
    });
    expect(healed[0].details).toContain('Passed after healing, for this run only');
    // The steps after the healed one ran as they would have, the assertion included (the first
    // result is the runner's "Initial State").
    expect(result.steps!.map((s) => s.stepId)).toEqual([undefined, 't1', 'g1', 'g2', 't3', 't4']);
    expect(result.steps!.every((s) => s.status === 'passed')).toBe(true);
    expect(result.steps!.filter((s) => !s.healed).every((s) => !s.healing)).toBe(true);
    // Nothing persistent beyond the proposal.
    expect((await groupRow(group)).sequence).toEqual([click('g1', '#first'), click('g2', '#gone')]);
    expect((await testRow(test.id)).sequence).toEqual(sequence);
    const [proposal] = await proposalsOf(test.id);
    expect(proposal).toMatchObject({ targetKind: 'group', targetRef: group, targetIndex: 1 });
    expect(await healedAudits(group)).toHaveLength(0);
    expect(mocks.logs.some((line) => line.includes('Passed after healing'))).toBe(true);
  }, 30_000);

  it("proposes the test's own step after a group at its written position, and writes no version", async () => {
    const group = await seedGroup([click('g1', '#first'), click('g2', '#second')]);
    const sequence = [call('c1', group), click('t2', '#missing')];
    const test = await seedTest(sequence, { publishedVersion: 1 });

    const { outcomes } = await runWithTenant(organizationId, () => drive(test.id, sequence));

    expect(outcomes[2]).toMatchObject({
      status: 'proposed',
      target: { kind: 'test', index: 1, stepId: 't2' },
    });
    expect(outcomes[0]).toBeNull();
    expect((await testRow(test.id)).sequence).toEqual(sequence);
    expect(
      await privilegedDb.select().from(testVersions).where(eq(testVersions.testId, test.id)),
    ).toHaveLength(0);
  });

  it('proposes a shared element repair to the element, and leaves the element as it is', async () => {
    const element = await seedElement('#gone');
    const sequence = [click('t1', '#gone', { elementId: element })];
    const test = await seedTest(sequence);

    const { outcomes } = await runWithTenant(organizationId, () => drive(test.id, sequence));

    expect(outcomes[0]).toMatchObject({ status: 'proposed', target: { kind: 'element' } });
    const [row] = await privilegedDb
      .select()
      .from(projectElements)
      .where(eq(projectElements.id, element));
    expect(row).toMatchObject({ selector: '#gone', healedAt: null });
  });
});

describe('which locator a run tries', () => {
  it('a known fallback from the recording, before the AI is asked', async () => {
    const sequence = [
      click('t1', '#renamed', { tag: 'button', attributes: { 'data-testid': 'third-button' } }),
    ];
    const test = await seedTest(sequence);

    const { outcomes } = await runWithTenant(organizationId, () => drive(test.id, sequence));

    expect(outcomes[0]).toMatchObject({
      origin: 'fallback',
      proposedSelector: 'button[data-testid="third-button"]',
    });
    expect(aiService.healSelector).not.toHaveBeenCalled();
  });

  it('never a suggestion that matches more than one element: the step fails as it first did', async () => {
    const sequence = [click('t1', '#twin-gone')];
    const test = await seedTest(sequence);
    const reporter = new PlaywrightReporter(page);
    reporter.setContext({ testId: test.id, provenance: null, elementId: null });

    await expect(reporter.click('#twin-gone')).rejects.toThrow(/#twin-gone/);
    expect(reporter.lastActionHealed).toBe(false);
    expect(await proposalsOf(test.id)).toHaveLength(0);
  });

  it('never the AI when the deployment has not enabled it', async () => {
    vi.mocked(aiService.isAvailable).mockReturnValue(false);
    const reporter = new PlaywrightReporter(page);
    await expect(reporter.click('#gone')).rejects.toThrow();
    expect(aiService.healSelector).not.toHaveBeenCalled();
  });

  it('shows the model the page without its form values or tokens', async () => {
    const reporter = new PlaywrightReporter(page);
    await reporter.click('#gone');
    const shown = vi.mocked(aiService.healSelector).mock.calls.at(-1)?.[1] ?? '';
    expect(shown).toContain('id="second"');
    expect(shown).not.toContain('tok-secret');
  });
});

describe('the highlight', () => {
  it('is put back after the action, so screenshots and the healing DOM never carry it', async () => {
    const reporter = new PlaywrightReporter(page);
    await reporter.click('#first');
    await reporter.click('#second');
    const styles = await page.evaluate(() =>
      ['first', 'second'].map((id) => document.getElementById(id)!.getAttribute('style')),
    );
    expect(styles).toEqual([null, 'color: blue']);

    // A failing click: what the model is shown has no outline either.
    await reporter.click('#gone');
    const shown = vi.mocked(aiService.healSelector).mock.calls.at(-1)?.[1] ?? '';
    expect(shown).not.toContain('solid red');
    expect(await page.locator('#second').getAttribute('style')).toBe('color: blue');
  });
});
