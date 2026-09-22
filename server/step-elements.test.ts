import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from './db';
import { projects, projectElements } from '@shared/schema';
import { runWithTenant } from './middleware/tenancy';
import { createTestOrganization, createTestUser } from './tests/factories';
import {
  elementIdOfStep,
  recordHealedSelector,
  referencedElementIds,
  resolveSequenceForRun,
  resolveStepElements,
} from './step-elements';

/**
 * The same button used to be written down once per test that touched it, so the application
 * moving it broke every copy separately — and the healing pass repaired whichever copy
 * happened to run. These are the rules by which a step can name the shared one instead.
 */

const stepWith = (target: Record<string, unknown> | undefined) => ({
  action: { id: 'click', name: 'Click Save' },
  targetElement: target,
});

describe('referencedElementIds', () => {
  it('lists what a sequence names, once each', () => {
    const sequence = [
      stepWith({ selector: '#a', elementId: 'el-1' }),
      stepWith({ selector: '#b' }),
      stepWith({ selector: '#c', elementId: 'el-1' }),
      stepWith(undefined),
    ];

    expect(referencedElementIds(sequence)).toEqual(['el-1']);
  });

  it('is empty for a sequence written before the repository existed', () => {
    expect(referencedElementIds([stepWith({ selector: '#a' })])).toEqual([]);
    expect(elementIdOfStep(stepWith({ selector: '#a' }))).toBeNull();
  });
});

describe('resolveStepElements', () => {
  it("replaces the step's selector with the repository's current one", () => {
    const { steps, resolved } = resolveStepElements(
      [stepWith({ selector: '#old', elementId: 'el-1', text: 'Save' })],
      [{ id: 'el-1', selector: '#new-save-button' }],
    );

    expect((steps[0].targetElement as any).selector).toBe('#new-save-button');
    expect(resolved).toBe(1);
  });

  it('keeps everything else the step carries, because the repository owns where, not what', () => {
    const { steps } = resolveStepElements(
      [stepWith({ selector: '#old', elementId: 'el-1', text: 'Save', tag: 'button' })],
      [{ id: 'el-1', selector: '#new' }],
    );

    expect((steps[0].targetElement as any).text).toBe('Save');
    expect((steps[0].targetElement as any).tag).toBe('button');
    expect(steps[0].action).toEqual({ id: 'click', name: 'Click Save' });
  });

  it('carries the frame chain from the repository, and keeps the step’s own when it has none', () => {
    const fromRepository = resolveStepElements(
      [stepWith({ selector: '#old', elementId: 'el-1', frameSelector: '#old-frame' })],
      [{ id: 'el-1', selector: '#new', frameSelector: '#iframe' }],
    );
    const fromStep = resolveStepElements(
      [stepWith({ selector: '#old', elementId: 'el-1', frameSelector: '#step-frame' })],
      [{ id: 'el-1', selector: '#new', frameSelector: null }],
    );

    expect((fromRepository.steps[0].targetElement as any).frameSelector).toBe('#iframe');
    expect((fromStep.steps[0].targetElement as any).frameSelector).toBe('#step-frame');
  });

  it('falls back to the selector the step was saved with when the element is gone', () => {
    const { steps, unresolved } = resolveStepElements(
      [stepWith({ selector: '#still-works', elementId: 'deleted' })],
      [],
    );

    expect((steps[0].targetElement as any).selector).toBe('#still-works');
    expect(unresolved).toEqual(['deleted']);
  });

  it('leaves a sequence that names nothing exactly as it was', () => {
    const sequence = [stepWith({ selector: '#a' }), stepWith(undefined)];

    const { steps, resolved } = resolveStepElements(sequence, [{ id: 'el-1', selector: '#new' }]);

    expect(steps).toEqual(sequence);
    expect(resolved).toBe(0);
  });
});

describe('against the database', () => {
  let organizationId: number;
  let otherOrganizationId: number;
  let userId: number;
  let projectId: number;
  let otherProjectId: number;

  beforeAll(async () => {
    organizationId = await createTestOrganization('Elements Org');
    userId = await createTestUser(organizationId, 'elements-user');
    otherOrganizationId = await createTestOrganization('Other Elements Org');
    const otherUserId = await createTestUser(otherOrganizationId, 'other-elements-user');

    const [project] = await privilegedDb
      .insert(projects)
      .values({ name: 'App', userId, organizationId })
      .returning();
    projectId = project.id;
    const [otherProject] = await privilegedDb
      .insert(projects)
      .values({ name: 'Other App', userId: otherUserId, organizationId: otherOrganizationId })
      .returning();
    otherProjectId = otherProject.id;
  });

  beforeEach(async () => {
    await privilegedDb.delete(projectElements);
  });

  async function seedElement(org: number, project: number, selector: string) {
    const id = uuidv4();
    await privilegedDb.insert(projectElements).values({
      id,
      organizationId: org,
      projectId: project,
      name: `Save button ${id.slice(0, 4)}`,
      selector,
    });
    return id;
  }

  it('resolves through the repository at run time', async () => {
    const id = await seedElement(organizationId, projectId, '#current-save');

    const result = await runWithTenant(organizationId, () =>
      resolveSequenceForRun([stepWith({ selector: '#stale', elementId: id })]),
    );

    expect((result.steps[0].targetElement as any).selector).toBe('#current-save');
    expect(result.resolved).toBe(1);
  });

  it("cannot read another organization's element, and the step keeps its own selector", async () => {
    const id = await seedElement(otherOrganizationId, otherProjectId, '#theirs');

    const result = await runWithTenant(organizationId, () =>
      resolveSequenceForRun([stepWith({ selector: '#mine', elementId: id })]),
    );

    expect((result.steps[0].targetElement as any).selector).toBe('#mine');
    expect(result.unresolved).toEqual([id]);
  });

  it('does not query at all for a sequence that names no element', async () => {
    // No tenant context on purpose: this is what every test written before the repository
    // looks like, and it must not need one.
    const result = await resolveSequenceForRun([stepWith({ selector: '#a' })]);

    expect(result.resolved).toBe(0);
    expect(result.steps).toHaveLength(1);
  });

  it('records a healed selector once, where every test that names it will read it', async () => {
    const id = await seedElement(organizationId, projectId, '#was-here');

    const updated = await runWithTenant(organizationId, () => recordHealedSelector(id, '#is-here-now'));
    const afterwards = await runWithTenant(organizationId, () =>
      resolveSequenceForRun([stepWith({ selector: '#was-here', elementId: id })]),
    );

    expect(updated).toBe(true);
    expect((afterwards.steps[0].targetElement as any).selector).toBe('#is-here-now');
    const [row] = await privilegedDb.select().from(projectElements);
    expect(row.healedAt).not.toBeNull();
  });

  it("will not heal another organization's element", async () => {
    const id = await seedElement(otherOrganizationId, otherProjectId, '#theirs');

    const updated = await runWithTenant(organizationId, () => recordHealedSelector(id, '#hijacked'));

    expect(updated).toBe(false);
    const [row] = await privilegedDb.select().from(projectElements);
    expect(row.selector).toBe('#theirs');
  });
});
