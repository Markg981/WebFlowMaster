import { and, eq } from 'drizzle-orm';
import { AUDIT_ACTIONS, detectedElements, stepGroups, tests } from '@shared/schema';
import logger from '../platform/logger';
import {
  getTenantPrincipal,
  withTenantTransaction,
  type TenantTx,
} from '../platform/middleware/tenancy';
import { recordAudit } from '../tenancy/audit';
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
 * The write is a proposal accepted under conditions, never an update by id: in a tenant
 * transaction, with the source row locked and its current content compared with the fingerprint
 * the run took of it. A source that changed since (an edit, another run's repair), was deleted,
 * is archived, or cannot be written by whoever the run acts for is left untouched; the proposal
 * is kept on the step's result as a diagnostic, with the reason. No other position is ever tried
 * instead. A test's repair is recorded as a new version of its working copy and every accepted
 * write leaves an audit entry, both in the same transaction; a published version is a row of
 * test_versions and is never written, so publishing the repair is a separate, reviewed step.
 */

export type HealingTarget =
  | { kind: 'element'; elementId: string }
  | { kind: 'test'; testId: number; index: number; stepId: string | null }
  | { kind: 'group'; groupId: string; index: number; stepId: string | null };

/** Why a proposal was not written. */
export type HealingConflict =
  /** The step carries no provenance to write back to. */
  | 'no_source'
  /** The test, group, step or element is gone, or not visible to this tenant and member. */
  | 'absent'
  /** It is no longer what the run executed. */
  | 'changed'
  /** It may not be edited: an archived test. */
  | 'locked'
  /** The run acts for a member who may not edit tests. */
  | 'unauthorized'
  /** The proposal is not a selector that can be stored. */
  | 'invalid'
  /** The write itself failed; nothing was changed. */
  | 'failed';

export interface HealingOutcome {
  /** The locator the AI proposed, and the step then ran with. */
  proposedSelector: string;
  /** Where it belongs, from the step's provenance; null when there is none. */
  target: HealingTarget | null;
  status: 'applied' | 'already_applied' | 'conflict';
  reason?: HealingConflict;
  /** The working-copy version a test step's repair was recorded as. */
  version?: number;
  detail: string;
}

export interface HealingProposal {
  testId: number;
  provenance: StepProvenance | null;
  /** The shared element the step names, as the runner read it. */
  elementId: string | null;
  proposedSelector: string;
  executionId?: string | null;
  /** Who started the run, for the audit entry. The write itself is the system's. */
  startedBy?: number | null;
}

/** Roles that may edit what a run heals; without a member (a plan run) it is the system. */
const EDITING_ROLES = new Set(['editor', 'owner']);
const MAX_SELECTOR_LENGTH = 2000;

/** Where a proposal belongs: decided by provenance alone. */
export function healingTarget(proposal: HealingProposal): HealingTarget | null {
  const provenance = proposal.provenance;
  if (!provenance) return null;
  const elementId = provenance.element?.id ?? proposal.elementId;
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
    testId: proposal.testId,
    index: provenance.index,
    stepId: provenance.stepId,
  };
}

function storableSelector(selector: string): boolean {
  return (
    selector.trim() !== '' && selector.length <= MAX_SELECTOR_LENGTH && !/[\r\n]/.test(selector)
  );
}

const DETAILS: Record<HealingConflict, string> = {
  no_source: 'the step does not say where it is written',
  absent: 'it no longer exists, or this run cannot see it',
  changed: 'it was changed after the run read it',
  locked: 'it is archived and cannot be edited',
  unauthorized: 'the member this run acts for cannot edit tests',
  invalid: 'the proposal is not a storable selector',
  failed: 'the change could not be saved',
};

function where(target: HealingTarget | null): string {
  if (!target) return 'the step';
  if (target.kind === 'element') return 'the shared element';
  if (target.kind === 'group') return `step ${target.index + 1} of the step group`;
  return `step ${target.index + 1} of the test`;
}

function result(
  proposal: HealingProposal,
  target: HealingTarget | null,
  write: GuardedSelectorWrite | { status: 'conflict'; reason: HealingConflict },
  version?: number | null,
): HealingOutcome {
  const base = { proposedSelector: proposal.proposedSelector, target };
  if (write.status === 'conflict')
    return {
      ...base,
      status: 'conflict',
      reason: write.reason,
      detail: `The healed selector was not saved to ${where(target)}: ${DETAILS[write.reason]}. It is kept here as a proposal.`,
    };
  if (write.status === 'already_applied')
    return {
      ...base,
      status: 'already_applied',
      detail: `${where(target)} already carries the healed selector.`,
    };
  return {
    ...base,
    status: 'applied',
    ...(version ? { version } : {}),
    detail: `The healed selector was saved to ${where(target)}${version ? ` (version ${version})` : ''}.`,
  };
}

/** Proposes the repair to its source, and says what became of it. Never throws. */
export async function applyHealedSelector(proposal: HealingProposal): Promise<HealingOutcome> {
  const target = healingTarget(proposal);
  if (!target) return result(proposal, null, { status: 'conflict', reason: 'no_source' });
  if (!storableSelector(proposal.proposedSelector))
    return result(proposal, target, { status: 'conflict', reason: 'invalid' });
  const principal = getTenantPrincipal();
  if (principal && !EDITING_ROLES.has(principal.role))
    return result(proposal, target, { status: 'conflict', reason: 'unauthorized' });

  try {
    return await withTenantTransaction(async (tx) => {
      if (target.kind === 'element') {
        const fingerprint = proposal.provenance?.element?.fingerprint;
        // Named and not resolved: the step ran on its own copy, and the element is not that.
        if (!fingerprint) return result(proposal, target, { status: 'conflict', reason: 'absent' });
        const write = await writeHealedElementSelector(tx, {
          elementId: target.elementId,
          fingerprint,
          selector: proposal.proposedSelector,
        });
        if (write.status === 'applied')
          await audit(
            tx,
            AUDIT_ACTIONS.ELEMENT_SELECTOR_HEALED,
            'project_element',
            target,
            proposal,
          );
        return result(proposal, target, write);
      }
      if (target.kind === 'group') {
        const write = await healGroupStep(tx, target, proposal);
        if (write.status === 'applied')
          await audit(tx, AUDIT_ACTIONS.STEP_GROUP_SELECTOR_HEALED, 'step_group', target, proposal);
        return result(proposal, target, write);
      }
      const write = await healTestStep(tx, target, proposal);
      if (write.status !== 'applied') return result(proposal, target, write);
      await audit(tx, AUDIT_ACTIONS.TEST_SELECTOR_HEALED, 'test', target, proposal);
      return result(proposal, target, write, write.version);
    });
  } catch (error) {
    // Rolled back whole: no half-written step, version or audit entry.
    logger.warn('Healed selector not saved', {
      testId: proposal.testId,
      target,
      error: error instanceof Error ? error.message : String(error),
    });
    return result(proposal, target, { status: 'conflict', reason: 'failed' });
  }
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
function repairStep(
  sequence: unknown,
  index: number,
  provenance: StepProvenance,
  selector: string,
): StepWrite {
  const steps = asSteps(sequence);
  const current = steps[index];
  if (!current) return { status: 'conflict', reason: 'absent' };
  if (stepFingerprint(current) !== provenance.fingerprint) {
    const repairedAlready =
      writtenSelector(current) === selector &&
      stepFingerprint(withSelector(current, provenance.selector)) === provenance.fingerprint;
    return repairedAlready
      ? { status: 'already_applied' }
      : { status: 'conflict', reason: 'changed' };
  }
  return {
    status: 'applied',
    steps: steps.map((step, i) => (i === index ? withSelector(step, selector) : step)),
  };
}

async function healGroupStep(
  tx: TenantTx,
  target: Extract<HealingTarget, { kind: 'group' }>,
  proposal: HealingProposal,
): Promise<StepWrite> {
  const [row] = await tx
    .select()
    .from(stepGroups)
    .where(eq(stepGroups.id, target.groupId))
    .for('update');
  if (!row) return { status: 'conflict', reason: 'absent' };
  const write = repairStep(
    row.sequence,
    target.index,
    proposal.provenance!,
    proposal.proposedSelector,
  );
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
  proposal: HealingProposal,
): Promise<
  { status: 'applied'; version: number | null } | Exclude<StepWrite, { status: 'applied' }>
> {
  const [row] = await tx.select().from(tests).where(eq(tests.id, target.testId)).for('update');
  if (!row) return { status: 'conflict', reason: 'absent' };
  if (row.status === 'archived') return { status: 'conflict', reason: 'locked' };
  const selector = proposal.proposedSelector;
  const write = repairStep(row.sequence, target.index, proposal.provenance!, selector);
  if (write.status !== 'applied') return write;

  // The test's own element list, as healing has always kept it: the entry this step's target is.
  const repaired = write.steps[target.index].targetElement as { id?: unknown; tag?: unknown };
  const elementKey = typeof repaired.id === 'string' ? repaired.id : null;
  const oldSelector = proposal.provenance!.selector;
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

  // A version of the working copy, by the system: what was repaired and from which run is in
  // the audit entry. The published version, if any, stays what it was.
  const version = await recordTestVersion(tx, {
    testId: target.testId,
    organizationId: row.organizationId,
    userId: null,
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

/** Where and from which run, never the selectors: the version and the element row keep those. */
async function audit(
  tx: TenantTx,
  action:
    | typeof AUDIT_ACTIONS.TEST_SELECTOR_HEALED
    | typeof AUDIT_ACTIONS.STEP_GROUP_SELECTOR_HEALED
    | typeof AUDIT_ACTIONS.ELEMENT_SELECTOR_HEALED,
  targetType: 'test' | 'step_group' | 'project_element',
  target: HealingTarget,
  proposal: HealingProposal,
) {
  await recordAudit(tx, {
    action,
    actor: null,
    targetType,
    targetId:
      target.kind === 'element'
        ? target.elementId
        : target.kind === 'group'
          ? target.groupId
          : target.testId,
    metadata: {
      testId: proposal.testId,
      ...(target.kind === 'element' ? {} : { step: target.index + 1, stepId: target.stepId }),
      callPath: proposal.provenance?.callPath ?? [],
      executionId: proposal.executionId ?? null,
      startedBy: proposal.startedBy ?? null,
    },
  });
}
