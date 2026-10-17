import { and, eq } from 'drizzle-orm';
import { AUDIT_ACTIONS, detectedElements, stepGroups, tests } from '@shared/schema';
import type { TenantTx } from '../platform/middleware/tenancy';
import { recordAudit, type AuditActor } from '../tenancy/audit';
import { writeHealedElementSelector, type GuardedSelectorWrite } from './step-elements';
import { asSteps, type SequenceStep } from './step-groups';
import { stepFingerprint, writtenSelector, type StepProvenance } from './step-provenance';
import { recordTestVersion } from './test-version-store';

/**
 * Writing a healed selector back to where the step is written, and nowhere else (C05).
 *
 * The AI proposes a locator; it never says which step it belongs to. That comes from the step's
 * provenance (server/authoring/step-provenance.ts), fixed when the sequence was prepared:
 *
 * - a step that names a shared element repairs the element — one row, read by every test;
 * - a step of a step group repairs the group's step, at its position in the group;
 * - a step of the test itself repairs the test's working copy, at its position as written.
 *
 * Since P13 (M02) a run never calls this: it records a proposal (server/authoring/healing-proposals.ts)
 * and a member approves it, in whose transaction and name this runs. The write is still accepted
 * under conditions, never an update by id: with the source row locked and its current content
 * compared with the fingerprint the run took of it. A source that changed since (an edit, another
 * approved repair), was deleted or is archived is left untouched and the proposal goes stale. No
 * other position is ever tried instead. A test's repair is recorded as a new version of its working
 * copy and every accepted write leaves an audit entry, both in the same transaction; a published
 * version is a row of test_versions and is never written, so publishing the repair is a separate,
 * reviewed step.
 */

export type HealingTarget =
  | { kind: 'element'; elementId: string }
  | { kind: 'test'; testId: number; index: number; stepId: string | null }
  | { kind: 'group'; groupId: string; index: number; stepId: string | null };

/** Why a repair was not written to its source. */
export type HealingConflict =
  /** The test, group, step or element is gone, or not visible to this tenant and member. */
  | 'absent'
  /** It is no longer what the run executed. */
  | 'changed'
  /** It may not be edited: an archived test. */
  | 'locked';

/** Where a step is written, as a run saw it: the provenance and the shared element it names. */
export interface HealedStep {
  testId: number;
  provenance: StepProvenance | null;
  /** The shared element the step names, as the runner read it. */
  elementId: string | null;
}

/** An approved proposal, as the source write needs it. */
export interface SourceRepair {
  testId: number;
  target: HealingTarget;
  /** The step (or the element) as the run read it: written over only if it still says this. */
  fingerprint: string;
  /** The selector written in the step before, as the run read it. */
  selectorBefore: string | null;
  selector: string;
  /** For the audit entry: which proposal, run and group calls. */
  proposalId: string;
  executionId: string | null;
  callPath: Array<{ index: number; stepId: string | null }>;
}

export type SourceWrite =
  | { status: 'applied'; version?: number }
  | { status: 'already_applied' }
  | { status: 'conflict'; reason: HealingConflict };

export const MAX_SELECTOR_LENGTH = 2000;

/** Where a repair belongs: decided by provenance alone. */
export function healingTarget(step: HealedStep): HealingTarget | null {
  const provenance = step.provenance;
  if (!provenance) return null;
  const elementId = provenance.element?.id ?? step.elementId;
  if (elementId) return { kind: 'element', elementId };
  if (provenance.source === 'group')
    return provenance.groupId
      ? {
          kind: 'group',
          groupId: provenance.groupId,
          index: provenance.index,
          stepId: provenance.stepId,
        }
      : null;
  return {
    kind: 'test',
    testId: step.testId,
    index: provenance.index,
    stepId: provenance.stepId,
  };
}

/**
 * What the source must still say for the repair to be written: the element as the run resolved
 * it, or the step as written. Null for a named element the run could not resolve — the step ran
 * on its own copy, and the element is not that.
 */
export function sourceFingerprint(step: HealedStep, target: HealingTarget): string | null {
  if (target.kind === 'element') return step.provenance?.element?.fingerprint ?? null;
  return step.provenance?.fingerprint ?? null;
}

export function storableSelector(selector: string): boolean {
  return (
    selector.trim() !== '' && selector.length <= MAX_SELECTOR_LENGTH && !/[\r\n]/.test(selector)
  );
}

/**
 * Writes an approved repair to its source, in the approver's transaction and name. The caller has
 * checked that the approver may edit the project; row-level security checks it again.
 */
export async function writeHealedSelector(
  tx: TenantTx,
  repair: SourceRepair,
  actor: AuditActor,
): Promise<SourceWrite> {
  const { target } = repair;
  if (target.kind === 'element') {
    const write: GuardedSelectorWrite = await writeHealedElementSelector(tx, {
      elementId: target.elementId,
      fingerprint: repair.fingerprint,
      selector: repair.selector,
    });
    if (write.status === 'applied')
      await audit(tx, AUDIT_ACTIONS.ELEMENT_SELECTOR_HEALED, 'project_element', repair, actor);
    return write;
  }
  if (target.kind === 'group') {
    const write = await healGroupStep(tx, target, repair);
    if (write.status !== 'applied') return write;
    await audit(tx, AUDIT_ACTIONS.STEP_GROUP_SELECTOR_HEALED, 'step_group', repair, actor);
    return { status: 'applied' };
  }
  const write = await healTestStep(tx, target, repair, actor);
  if (write.status !== 'applied') return write;
  await audit(tx, AUDIT_ACTIONS.TEST_SELECTOR_HEALED, 'test', repair, actor);
  return write.version ? { status: 'applied', version: write.version } : { status: 'applied' };
}

type StepWrite =
  | { status: 'applied'; steps: SequenceStep[] }
  | { status: 'already_applied' }
  | { status: 'conflict'; reason: HealingConflict };

function withSelector(step: SequenceStep, selector: string | null): SequenceStep {
  const target = (step.targetElement ?? {}) as Record<string, unknown>;
  return { ...step, targetElement: { ...target, selector } };
}

/** The sequence with its step at `index` repaired, if that step is still the one the run executed. */
function repairStep(sequence: unknown, index: number, repair: SourceRepair): StepWrite {
  const steps = asSteps(sequence);
  const current = steps[index];
  if (!current) return { status: 'conflict', reason: 'absent' };
  if (stepFingerprint(current) !== repair.fingerprint) {
    const repairedAlready =
      writtenSelector(current) === repair.selector &&
      stepFingerprint(withSelector(current, repair.selectorBefore)) === repair.fingerprint;
    return repairedAlready
      ? { status: 'already_applied' }
      : { status: 'conflict', reason: 'changed' };
  }
  return {
    status: 'applied',
    steps: steps.map((step, i) => (i === index ? withSelector(step, repair.selector) : step)),
  };
}

async function healGroupStep(
  tx: TenantTx,
  target: Extract<HealingTarget, { kind: 'group' }>,
  repair: SourceRepair,
): Promise<StepWrite> {
  const [row] = await tx
    .select()
    .from(stepGroups)
    .where(eq(stepGroups.id, target.groupId))
    .for('update');
  if (!row) return { status: 'conflict', reason: 'absent' };
  const write = repairStep(row.sequence, target.index, repair);
  if (write.status !== 'applied') return write;
  await tx
    .update(stepGroups)
    .set({ sequence: write.steps, updatedAt: new Date() })
    .where(eq(stepGroups.id, target.groupId));
  return write;
}

async function healTestStep(
  tx: TenantTx,
  target: Extract<HealingTarget, { kind: 'test' }>,
  repair: SourceRepair,
  actor: AuditActor,
): Promise<
  { status: 'applied'; version: number | null } | Exclude<StepWrite, { status: 'applied' }>
> {
  const [row] = await tx.select().from(tests).where(eq(tests.id, target.testId)).for('update');
  if (!row) return { status: 'conflict', reason: 'absent' };
  if (row.status === 'archived') return { status: 'conflict', reason: 'locked' };
  const selector = repair.selector;
  const write = repairStep(row.sequence, target.index, repair);
  if (write.status !== 'applied') return write;

  // The test's own element list, as healing has always kept it: the entry this step's target is.
  const repaired = write.steps[target.index].targetElement as { id?: unknown; tag?: unknown };
  const elementKey = typeof repaired.id === 'string' ? repaired.id : null;
  const oldSelector = repair.selectorBefore;
  const elements = Array.isArray(row.elements) ? (row.elements as Record<string, unknown>[]) : [];
  const at = elements.findIndex((element) =>
    elementKey ? element.id === elementKey : element.selector === oldSelector,
  );
  const nextElements =
    at === -1 ? undefined : elements.map((e, i) => (i === at ? { ...e, selector } : e));

  const [updated] = await tx
    .update(tests)
    .set({
      sequence: write.steps,
      ...(nextElements ? { elements: nextElements } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tests.id, target.testId))
    .returning();

  if (elementKey)
    await syncDetectedElement(
      tx,
      row.organizationId,
      target.testId,
      elementKey,
      write.steps[target.index],
      oldSelector,
      selector,
    );

  // A version of the working copy, by the member who approved it: restoring the version before
  // takes the repair back. The published version, if any, stays what it was.
  const version = await recordTestVersion(tx, {
    testId: target.testId,
    organizationId: row.organizationId,
    userId: actor.id,
    test: updated,
  });
  return { status: 'applied', version: version?.version ?? null };
}

/** The normalized copy of the test's element, kept in step with the sequence. */
async function syncDetectedElement(
  tx: TenantTx,
  organizationId: number,
  testId: number,
  elementId: string,
  step: SequenceStep,
  oldSelector: string | null,
  selector: string,
) {
  const [existing] = await tx
    .select()
    .from(detectedElements)
    .where(and(eq(detectedElements.testId, testId), eq(detectedElements.elementId, elementId)))
    .limit(1);
  if (existing) {
    await tx
      .update(detectedElements)
      .set({ selector, originalSelector: existing.originalSelector || existing.selector })
      .where(eq(detectedElements.id, existing.id));
    return;
  }
  const target = step.targetElement as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  await tx.insert(detectedElements).values({
    organizationId,
    testId,
    elementId,
    selector,
    originalSelector: oldSelector,
    type: text(target.tag),
    text: text(target.text),
    tag: text(target.tag),
    attributes: target.attributes ?? null,
  });
}

/** Where, from which run and by whose approval, never the selectors: the proposal keeps those. */
async function audit(
  tx: TenantTx,
  action:
    | typeof AUDIT_ACTIONS.TEST_SELECTOR_HEALED
    | typeof AUDIT_ACTIONS.STEP_GROUP_SELECTOR_HEALED
    | typeof AUDIT_ACTIONS.ELEMENT_SELECTOR_HEALED,
  targetType: 'test' | 'step_group' | 'project_element',
  repair: SourceRepair,
  actor: AuditActor,
) {
  const { target } = repair;
  await recordAudit(tx, {
    action,
    actor,
    targetType,
    targetId:
      target.kind === 'element'
        ? target.elementId
        : target.kind === 'group'
          ? target.groupId
          : target.testId,
    metadata: {
      testId: repair.testId,
      ...(target.kind === 'element' ? {} : { step: target.index + 1, stepId: target.stepId }),
      callPath: repair.callPath,
      executionId: repair.executionId,
      proposalId: repair.proposalId,
    },
  });
}
