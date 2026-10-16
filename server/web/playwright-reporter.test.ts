import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { and, eq } from 'drizzle-orm';
import type { Browser, Page } from 'playwright';
import {
  auditLog,
  projectElements,
  projects,
  stepGroups,
  testVersions,
  tests,
} from '@shared/schema';

/**
 * Where a healed selector is written (C05, P10).
 *
 * The runner used to give the healing pass its own position in the expanded sequence, and the
 * pass wrote the repair at that position of the test's saved sequence. With a two-step group
 * before an independent click, repairing the group's second step rewrote the independent click.
 * These drive a real Chromium page against the in-memory database: a repair goes to the step's
 * source as it is written — the test's step, the group's step or the shared element — under a
 * fingerprint check, with a version and an audit entry, or nowhere at all.
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
const { applyHealedSelector } = await import('../authoring/selector-healing');
const { elementIdOfStep } = await import('../authoring/step-elements');
const { provenanceOf } = await import('../authoring/step-provenance');
const { PlaywrightReporter } = await import('./playwright-reporter');
const { TestRunner } = await import('./playwright/test-runner');

const PAGE =
  '<button id="first">One</button>' +
  '<button id="second" style="color: blue">Two</button>' +
  '<button id="third">Three</button>';

const click = (id: string, selector: string, elementId?: string) => ({
  id,
  action: { id: 'click', name: `Click ${id}` },
  targetElement: { selector, ...(elementId ? { elementId } : {}) },
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
  proposals = { '#gone': '#second', '#missing': '#third' };
  vi.spyOn(aiService, 'healSelector').mockImplementation(
    async (selector: string) => proposals[selector] ?? null,
  );
  page = await browser.newPage();
  page.setDefaultTimeout(400);
  await page.setContent(PAGE);
  return async () => {
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
const audits = (action: string, targetId: string | number) =>
  privilegedDb
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.targetId, String(targetId))));

const selectorsOf = (sequence: unknown) =>
  (sequence as Array<{ targetElement?: { selector: string } }>).map(
    (s) => s.targetElement?.selector,
  );

/** The runner's loop, for the clicks: each prepared step driven with its own provenance. */
async function drive(testId: number, sequence: unknown) {
  const prepared = await prepareSequence(sequence);
  expect(prepared.errors).toEqual([]);
  const reporter = new PlaywrightReporter(page);
  const outcomes = [];
  for (const step of prepared.steps) {
    reporter.setContext({
      testId,
      provenance: provenanceOf(step),
      elementId: elementIdOfStep(step),
      executionId: 'exec-heal',
    });
    reporter.resetStepState();
    await reporter.click((step.targetElement as { selector: string }).selector);
    outcomes.push(reporter.lastHealing);
  }
  return { prepared, outcomes };
}

describe('a run heals the step where it is written', () => {
  it('repairs the group, not the independent click after it (the audit case, real runner)', async () => {
    const group = await seedGroup([click('g1', '#first'), click('g2', '#gone')]);
    // The page is built by the test's first step: the runner opens a blank one. Written third,
    // the independent click is the runner's fourth step — the position the old repair used.
    const setup = {
      id: 't1',
      action: { id: 'executeScript', name: 'Build the page' },
      value: `document.body.innerHTML = ${JSON.stringify(PAGE)};`,
    };
    const sequence = [setup, call('c2', group), click('t3', '#third')];
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
    const healed = result.steps!.find((step) => step.healed);
    expect(healed).toMatchObject({
      stepId: 'g2',
      calledFrom: 'c2',
      healing: { status: 'applied', target: { kind: 'group', groupId: group, index: 1 } },
    });
    expect(selectorsOf((await groupRow(group)).sequence)[1]).toBe('#second');
    expect((await testRow(test.id)).sequence).toEqual(sequence);
  }, 30_000);

  it('repairs the group step and leaves the independent click untouched', async () => {
    const group = await seedGroup([click('g1', '#first'), click('g2', '#gone')]);
    const sequence = [call('c1', group), click('t2', '#third')];
    const test = await seedTest(sequence);

    const { outcomes } = await runWithTenant(organizationId, () => drive(test.id, sequence));

    expect(outcomes[1]).toMatchObject({
      status: 'applied',
      proposedSelector: '#second',
      target: { kind: 'group', groupId: group, index: 1, stepId: 'g2' },
    });
    expect(outcomes[0]).toBeNull();
    expect(outcomes[2]).toBeNull();
    const stored = await groupRow(group);
    expect(selectorsOf(stored.sequence)).toEqual(['#first', '#second']);
    // The test is exactly what it was: the click after the group kept its own selector.
    expect((await testRow(test.id)).sequence).toEqual(sequence);
    expect(await audits('step_group.selector_healed', group)).toHaveLength(1);
    expect(await audits('test.selector_healed', test.id)).toHaveLength(0);
  });

  it("repairs the test's own step after a group at its written position, as a new version", async () => {
    const group = await seedGroup([click('g1', '#first'), click('g2', '#second')]);
    const sequence = [call('c1', group), click('t2', '#missing')];
    const test = await seedTest(sequence, { publishedVersion: 1 });
    // The published version: a row of test_versions, which healing never writes.
    await privilegedDb.insert(testVersions).values({
      organizationId,
      testId: test.id,
      version: 1,
      name: test.name,
      url: '',
      sequence,
      elements: [],
      summary: 'Created.',
    });

    const { outcomes } = await runWithTenant(organizationId, () => drive(test.id, sequence));

    expect(outcomes[2]).toMatchObject({
      status: 'applied',
      target: { kind: 'test', testId: test.id, index: 1, stepId: 't2' },
      version: 2,
    });
    const row = await testRow(test.id);
    expect(selectorsOf(row.sequence)[1]).toBe('#third');
    expect((row.sequence as unknown[])[0]).toEqual(sequence[0]);
    expect(row.publishedVersion).toBe(1);
    const versions = await privilegedDb
      .select()
      .from(testVersions)
      .where(eq(testVersions.testId, test.id))
      .orderBy(testVersions.version);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0].sequence).toEqual(sequence);
    expect(versions[1].createdBy).toBeNull();
    expect((await groupRow(group)).sequence).toEqual([
      click('g1', '#first'),
      click('g2', '#second'),
    ]);
    const [entry] = await audits('test.selector_healed', test.id);
    expect(entry.metadata).toMatchObject({ step: 2, stepId: 't2', executionId: 'exec-heal' });
    // Where and from which run, never the selectors.
    expect(JSON.stringify(entry.metadata)).not.toContain('#third');
  });

  it('repairs a group called twice once; the second call finds it already repaired', async () => {
    const group = await seedGroup([click('g1', '#gone')]);
    const sequence = [call('c1', group), call('c2', group)];
    const test = await seedTest(sequence);

    const { prepared, outcomes } = await runWithTenant(organizationId, () =>
      drive(test.id, sequence),
    );

    expect(provenanceOf(prepared.steps[1])?.callPath).toEqual([{ index: 1, stepId: 'c2' }]);
    expect(outcomes.map((o) => o?.status)).toEqual(['applied', 'already_applied']);
    expect(await audits('step_group.selector_healed', group)).toHaveLength(1);
    expect((await testRow(test.id)).sequence).toEqual(sequence);
  });

  it('lets one of two concurrent repairs of the same step win, and reports the other', async () => {
    const group = await seedGroup([click('g1', '#gone')]);
    const sequence = [call('c1', group)];
    const test = await seedTest(sequence);
    const prepared = await runWithTenant(organizationId, () => prepareSequence(sequence));
    const provenance = provenanceOf(prepared.steps[0]);

    const outcomes = await runWithTenant(organizationId, () =>
      Promise.all(
        ['#second', '#third'].map((proposedSelector) =>
          applyHealedSelector({ testId: test.id, provenance, elementId: null, proposedSelector }),
        ),
      ),
    );

    const applied = outcomes.filter((o) => o.status === 'applied');
    expect(applied).toHaveLength(1);
    expect(outcomes.find((o) => o.status !== 'applied')).toMatchObject({
      status: 'conflict',
      reason: 'changed',
    });
    expect(selectorsOf((await groupRow(group)).sequence)[0]).toBe(applied[0].proposedSelector);
  });

  it('keeps the proposal when the source changed after the run read it, and writes nothing', async () => {
    const sequence = [click('t1', '#gone'), click('t2', '#third')];
    const test = await seedTest(sequence);
    const prepared = await runWithTenant(organizationId, () => prepareSequence(sequence));
    // Somebody edits the step while the run is going.
    const edited = [{ ...sequence[0], value: 'edited' }, sequence[1]];
    await privilegedDb.update(tests).set({ sequence: edited }).where(eq(tests.id, test.id));

    const outcome = await runWithTenant(organizationId, () =>
      applyHealedSelector({
        testId: test.id,
        provenance: provenanceOf(prepared.steps[0]),
        elementId: null,
        proposedSelector: '#second',
      }),
    );

    expect(outcome).toMatchObject({
      status: 'conflict',
      reason: 'changed',
      proposedSelector: '#second',
    });
    expect((await testRow(test.id)).sequence).toEqual(edited);
    expect(await audits('test.selector_healed', test.id)).toHaveLength(0);
  });

  it('repairs a shared element in the repository, and never falls back to the test when it is gone', async () => {
    const element = await seedElement('#gone');
    const sequence = [click('t1', '#gone', element)];
    const test = await seedTest(sequence);

    const { outcomes } = await runWithTenant(organizationId, () => drive(test.id, sequence));
    expect(outcomes[0]).toMatchObject({
      status: 'applied',
      target: { kind: 'element', elementId: element },
    });
    const [row] = await privilegedDb
      .select()
      .from(projectElements)
      .where(eq(projectElements.id, element));
    expect(row).toMatchObject({ selector: '#second', originalSelector: '#gone' });
    expect(row.healedAt).not.toBeNull();
    expect(await audits('project_element.selector_healed', element)).toHaveLength(1);

    // Deleted: the step runs on its own copy, and the repair has nowhere it belongs.
    await privilegedDb.delete(projectElements).where(eq(projectElements.id, element));
    const again = await runWithTenant(organizationId, () => drive(test.id, sequence));
    expect(again.outcomes[0]).toMatchObject({ status: 'conflict', reason: 'absent' });
    expect((await testRow(test.id)).sequence).toEqual(sequence);
  });

  it('writes nothing for a viewer, or into an archived test', async () => {
    const sequence = [click('t1', '#gone')];
    const test = await seedTest(sequence);
    const viewer = await runWithTenant(organizationId, () => drive(test.id, sequence), {
      userId,
      role: 'viewer',
    });
    expect(viewer.outcomes[0]).toMatchObject({ status: 'conflict', reason: 'unauthorized' });

    const archived = await seedTest(sequence, { status: 'archived' });
    const locked = await runWithTenant(organizationId, () => drive(archived.id, sequence));
    expect(locked.outcomes[0]).toMatchObject({ status: 'conflict', reason: 'locked' });
    expect((await testRow(test.id)).sequence).toEqual(sequence);
    expect((await testRow(archived.id)).sequence).toEqual(sequence);
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
