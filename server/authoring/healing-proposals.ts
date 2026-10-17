import { randomBytes } from 'node:crypto';
import { and, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  healingProposals,
  projectElements,
  tests,
  type HealingProposalRow,
} from '@shared/schema';
import type { ExecutionAttemptRef } from '@shared/execution-identity';
import type { HealingOrigin, HealingProposalStatus, StepHealing } from '@shared/healing';
import logger from '../platform/logger';
import { withTenantTransaction, type TenantTx } from '../platform/middleware/tenancy';
import { recordAudit, type AuditActor } from '../tenancy/audit';
import {
  healingTarget,
  sourceFingerprint,
  storableSelector,
  writeHealedSelector,
  type HealedStep,
  type HealingConflict,
  type HealingTarget,
  type SourceRepair,
} from './selector-healing';

/**
 * Healing proposals: what a run may do with a repaired locator, and what only a person may (M02).
 *
 * A run whose step no longer finds its element may try a repaired locator, and the step passes on
 * it — for that run. The repair is recorded here as a proposal: run, unit and attempt, where the
 * step is written (server/authoring/step-provenance.ts), the fingerprint of the step as the run
 * read it, and the locator before and after. Nothing else is written. Approving is an editor's
 * act on the project, audited; it writes the working copy through server/authoring/selector-healing.ts
 * under the recorded fingerprint, so a source that changed since makes the proposal stale rather
 * than being overwritten. Publishing the new version stays the existing publish or review step.
 *
 * Which locator a run tries is decided here too: a fallback the test already knows — the element's
 * recorded test id, id, name or label — before the AI's suggestion, and either only if it is a
 * valid locator matching exactly one element. The model's own confidence is never asked for.
 */

/**
 * The model's answer as one locator, or nothing.
 *
 * Only a code fence around the whole answer is taken off, with its language tag when the tag is
 * the fence's first line. Nothing inside the locator is touched: "css=.btn", ".css-button" and
 * "css-grid > a" are locators, and stripping "css" out of them breaks them. An answer of several
 * lines is not one locator.
 */
export function parseLocatorAnswer(answer: string | null | undefined): string | null {
  if (!answer) return null;
  let text = answer.trim();
  const fenced = /^```([A-Za-z]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(text);
  const inline = fenced ? null : (/^```([\s\S]+?)```$/.exec(text) ?? /^`([^`]+)`$/.exec(text));
  if (fenced) text = fenced[2].trim();
  else if (inline) text = inline[1].trim();
  return storableSelector(text) ? text : null;
}

/** Attributes a recording keeps that name an element on purpose, most deliberate first. */
const FALLBACK_ATTRIBUTES = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-qa',
  'data-cy',
  'id',
  'name',
  'aria-label',
] as const;

const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Locators the test already knows for its element, from what the recording kept of it: each tried
 * before the AI is asked. A value with a {{placeholder}} is skipped — it is a template, and
 * resolving it here would put a variable's value into a stored locator.
 */
export function knownFallbacks(
  element: { tag?: unknown; attributes?: unknown } | null | undefined,
  failed: string,
): string[] {
  const attributes =
    element?.attributes && typeof element.attributes === 'object'
      ? (element.attributes as Record<string, unknown>)
      : {};
  const tag =
    typeof element?.tag === 'string' && /^[a-z][a-z0-9-]*$/i.test(element.tag)
      ? element.tag.toLowerCase()
      : '';
  const out: string[] = [];
  for (const name of FALLBACK_ATTRIBUTES) {
    const value = attributes[name];
    if (typeof value !== 'string') continue;
    const v = value.trim();
    if (!v || v.length > 200 || v.includes('{{') || /[\r\n]/.test(v)) continue;
    const candidate =
      name === 'id' && /^[A-Za-z][\w-]*$/.test(v) ? `#${v}` : `${tag}[${name}=${quoted(v)}]`;
    if (candidate !== failed && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

/**
 * The page as the model may see it. Scripts and styles go; so do the values a page carries in its
 * markup — form fields, hidden tokens, meta content — which can be a session's or a user's data.
 * The model needs the structure and the names to find an element, not what was typed into it.
 */
export function domForModel(html: string, limit = 30_000): string {
  // Until nothing changes: removing one element can join the pieces of another ("<scr<script>…").
  // An end tag may carry anything before its ">", and an element never closed runs to the end.
  let stripped = html;
  for (let previous = ''; previous !== stripped;) {
    previous = stripped;
    stripped = stripped.replace(/<(script|style)\b[\s\S]*?(?:<\/\1\b[^>]*>|$)/gi, '');
  }
  return stripped
    .replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea\s*>)/gi, '$1$2')
    .replace(
      /(<(?:input|option|meta|button|param)\b[^>]*?\s)(value|content)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
      '$1$2="***"',
    )
    .slice(0, limit);
}

export class HealingProposalError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      | 'proposal_not_found'
      | 'project_read_only'
      | 'proposal_rejected'
      | 'proposal_approved'
      | 'proposal_stale'
      | 'fingerprint_mismatch',
    message: string,
  ) {
    super(message);
  }
}

const newId = () => `hp_${randomBytes(12).toString('hex')}`;

/** What the run that heals a step knows about it. */
export interface ProposalInput {
  step: HealedStep;
  executionId: string | null;
  /** The plan run's attempt, when the run has a manifest. */
  attempt: ExecutionAttemptRef | null;
  /** The runner's position, for the report. */
  stepIndex: number;
  selector: string;
  origin: HealingOrigin;
}

function unrecorded(input: ProposalInput, detail: string, reason: string): StepHealing {
  return {
    originalSelector: input.step.provenance?.selector ?? null,
    proposedSelector: input.selector,
    origin: input.origin,
    status: 'unrecorded',
    reason,
    detail: `Passed after healing, for this run only. ${detail}`,
  };
}

function targetColumns(target: HealingTarget) {
  if (target.kind === 'element')
    return { targetKind: 'element' as const, targetRef: target.elementId, targetIndex: null };
  return {
    targetKind: target.kind,
    targetRef: target.kind === 'group' ? target.groupId : String(target.testId),
    targetIndex: target.index,
    stepId: target.stepId,
  };
}

function where(kind: HealingTarget['kind'], index: number | null): string {
  if (kind === 'element') return 'the shared element';
  if (kind === 'group') return `step ${(index ?? 0) + 1} of the step group`;
  return `step ${(index ?? 0) + 1} of the test`;
}

/**
 * Records what a run healed, as a proposal, and says so on the step. Never throws and never
 * writes the test, the group or the element: the step passed on the repair, and a person decides.
 */
export async function recordHealingProposal(input: ProposalInput): Promise<StepHealing> {
  const target = healingTarget(input.step);
  if (!target) return unrecorded(input, 'The step does not say where it is written.', 'no_source');
  const fingerprint = sourceFingerprint(input.step, target);
  if (!fingerprint)
    return unrecorded(input, 'The shared element it names was not available.', 'absent');
  if (!storableSelector(input.selector))
    return unrecorded(input, 'The repaired locator cannot be stored.', 'invalid');

  try {
    return await withTenantTransaction(async (tx) => {
      const [test] = await tx
        .select({ projectId: tests.projectId, organizationId: tests.organizationId })
        .from(tests)
        .where(eq(tests.id, input.step.testId))
        .limit(1);
      if (!test) return unrecorded(input, 'The test is not visible to this run.', 'absent');
      const selectorBefore =
        target.kind === 'element'
          ? ((
              await tx
                .select({ selector: projectElements.selector })
                .from(projectElements)
                .where(eq(projectElements.id, target.elementId))
                .limit(1)
            )[0]?.selector ?? null)
          : (input.step.provenance?.selector ?? null);
      const columns = targetColumns(target);
      const [inserted] = await tx
        .insert(healingProposals)
        .values({
          id: newId(),
          organizationId: test.organizationId,
          projectId: test.projectId,
          testId: input.step.testId,
          executionId: input.executionId,
          unitId: input.attempt?.unitId ?? null,
          attempt: input.attempt?.attempt ?? null,
          stepIndex: input.stepIndex,
          ...columns,
          callPath: input.step.provenance?.callPath ?? [],
          sourceFingerprint: fingerprint,
          origin: input.origin,
          selectorBefore,
          selectorAfter: input.selector,
        })
        .onConflictDoNothing()
        .returning();
      // The same repair of the same source, as read, is already open: this run joins it.
      const proposal =
        inserted ??
        (
          await tx
            .select()
            .from(healingProposals)
            .where(
              and(
                eq(healingProposals.targetKind, columns.targetKind),
                eq(healingProposals.targetRef, columns.targetRef),
                sql`${healingProposals.targetIndex} IS NOT DISTINCT FROM ${columns.targetIndex}`,
                eq(healingProposals.sourceFingerprint, fingerprint),
                eq(healingProposals.selectorAfter, input.selector),
                eq(healingProposals.status, 'proposed'),
              ),
            )
            .limit(1)
        )[0];
      if (!proposal) return unrecorded(input, 'The proposal could not be recorded.', 'failed');
      return {
        originalSelector: selectorBefore,
        proposedSelector: input.selector,
        origin: input.origin,
        status: 'proposed',
        proposalId: proposal.id,
        fingerprint,
        target: {
          kind: target.kind,
          ...(target.kind === 'element' ? {} : { index: target.index, stepId: target.stepId }),
        },
        detail: `Passed after healing, for this run only. A repair of ${where(target.kind, columns.targetIndex)} is proposed; nothing changes until an editor approves it.`,
      } satisfies StepHealing;
    });
  } catch (error) {
    logger.warn('Healing proposal not recorded', {
      testId: input.step.testId,
      target,
      error: error instanceof Error ? error.message : String(error),
    });
    return unrecorded(input, 'The proposal could not be recorded.', 'failed');
  }
}

export interface ProposalFilter {
  testId?: number;
  executionId?: string;
  status?: HealingProposalStatus;
}

/** The proposals the requester can see; row-level security decides which those are. */
export async function listHealingProposals(filter: ProposalFilter): Promise<HealingProposalRow[]> {
  const conditions: SQL[] = [];
  if (filter.testId !== undefined) conditions.push(eq(healingProposals.testId, filter.testId));
  if (filter.executionId) conditions.push(eq(healingProposals.executionId, filter.executionId));
  if (filter.status) conditions.push(eq(healingProposals.status, filter.status));
  return withTenantTransaction((tx) =>
    tx
      .select()
      .from(healingProposals)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(healingProposals.createdAt))
      .limit(200),
  );
}

export async function getHealingProposal(id: string): Promise<HealingProposalRow | null> {
  const [row] = await withTenantTransaction((tx) =>
    tx.select().from(healingProposals).where(eq(healingProposals.id, id)).limit(1),
  );
  return row ?? null;
}

/** The proposal, locked, if the requester may decide it. */
async function lockForDecision(tx: TenantTx, id: string): Promise<HealingProposalRow> {
  // Seen first, then locked: FOR UPDATE also applies the update policy, and a proposal a viewer
  // is looking at should answer "read only", not "not found".
  const [seen] = await tx
    .select({
      projectId: healingProposals.projectId,
      editable: sql<boolean>`app_project_editable(${healingProposals.projectId})`,
    })
    .from(healingProposals)
    .where(eq(healingProposals.id, id))
    .limit(1);
  if (!seen) throw new HealingProposalError(404, 'proposal_not_found', 'Proposal not found.');
  if (!seen.editable)
    throw new HealingProposalError(
      403,
      'project_read_only',
      "You can view this test's project but not change it.",
    );
  const [row] = await tx
    .select()
    .from(healingProposals)
    .where(eq(healingProposals.id, id))
    .for('update');
  if (!row) throw new HealingProposalError(404, 'proposal_not_found', 'Proposal not found.');
  return row;
}

function repairOf(row: HealingProposalRow): SourceRepair {
  const target: HealingTarget =
    row.targetKind === 'element'
      ? { kind: 'element', elementId: row.targetRef }
      : row.targetKind === 'group'
        ? { kind: 'group', groupId: row.targetRef, index: row.targetIndex!, stepId: row.stepId }
        : {
            kind: 'test',
            testId: Number(row.targetRef),
            index: row.targetIndex!,
            stepId: row.stepId,
          };
  return {
    testId: row.testId,
    target,
    fingerprint: row.sourceFingerprint,
    selectorBefore: row.selectorBefore,
    selector: row.selectorAfter,
    proposalId: row.id,
    executionId: row.executionId,
    callPath: row.callPath,
  };
}

/** What an approval or a rejection did. `conflict`: the proposal went stale instead. */
export interface Decision {
  proposal: HealingProposalRow;
  /** True when the proposal was already in the state asked for: nothing was done again. */
  unchanged: boolean;
  conflict?: HealingConflict;
}

/** Who, where and from which run: never the locators, which the proposal row keeps. */
function decisionMetadata(row: HealingProposalRow, extra: Record<string, unknown> = {}) {
  return {
    testId: row.testId,
    target: row.targetKind,
    ...(row.targetIndex === null ? {} : { step: row.targetIndex + 1 }),
    executionId: row.executionId,
    unitId: row.unitId,
    attempt: row.attempt,
    origin: row.origin,
    ...extra,
  };
}

/**
 * Approves a proposal: writes it to its source in the approver's name, or finds it stale.
 *
 * `fingerprint` is the source as the approver was shown it, and must be the proposal's. Approving
 * an approved proposal again changes nothing; a rejected or stale one is refused. A source that
 * changed since the run read it is not overwritten: the proposal is marked stale, in this same
 * transaction, and the caller answers with a conflict.
 */
export async function approveHealingProposal(
  id: string,
  fingerprint: string,
  actor: AuditActor,
): Promise<Decision> {
  return withTenantTransaction(async (tx) => {
    const row = await lockForDecision(tx, id);
    if (row.status === 'approved') return { proposal: row, unchanged: true };
    if (row.status === 'rejected')
      throw new HealingProposalError(409, 'proposal_rejected', 'This proposal was rejected.');
    if (row.status === 'stale')
      throw new HealingProposalError(
        409,
        'proposal_stale',
        'The step changed after the run read it; this proposal no longer applies.',
      );
    if (fingerprint !== row.sourceFingerprint)
      throw new HealingProposalError(
        409,
        'fingerprint_mismatch',
        'The proposal is not the one you were shown. Reload it and decide again.',
      );

    const write = await writeHealedSelector(tx, repairOf(row), actor);
    const now = new Date();
    if (write.status === 'conflict') {
      const [stale] = await tx
        .update(healingProposals)
        .set({ status: 'stale', reason: write.reason, updatedAt: now })
        .where(eq(healingProposals.id, id))
        .returning();
      return { proposal: stale, unchanged: false, conflict: write.reason };
    }
    const version = write.status === 'applied' ? (write.version ?? null) : null;
    const [approved] = await tx
      .update(healingProposals)
      .set({
        status: 'approved',
        decidedBy: actor.id,
        decidedAt: now,
        appliedVersion: version,
        updatedAt: now,
      })
      .where(eq(healingProposals.id, id))
      .returning();
    // Every other open proposal for the same source, as read, now describes a step that is gone.
    await tx
      .update(healingProposals)
      .set({ status: 'stale', reason: 'changed', updatedAt: now })
      .where(
        and(
          eq(healingProposals.targetKind, row.targetKind),
          eq(healingProposals.targetRef, row.targetRef),
          sql`${healingProposals.targetIndex} IS NOT DISTINCT FROM ${row.targetIndex}`,
          eq(healingProposals.sourceFingerprint, row.sourceFingerprint),
          eq(healingProposals.status, 'proposed'),
          ne(healingProposals.id, id),
        ),
      );
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.HEALING_PROPOSAL_APPROVED,
      actor,
      targetType: 'healing_proposal',
      targetId: id,
      metadata: decisionMetadata(row, { version }),
    });
    return { proposal: approved, unchanged: false };
  });
}

/** Rejects a proposal: nothing is written. Rejecting it again changes nothing. */
export async function rejectHealingProposal(
  id: string,
  note: string | null,
  actor: AuditActor,
): Promise<Decision> {
  return withTenantTransaction(async (tx) => {
    const row = await lockForDecision(tx, id);
    if (row.status === 'rejected') return { proposal: row, unchanged: true };
    if (row.status === 'approved')
      throw new HealingProposalError(
        409,
        'proposal_approved',
        'This proposal was approved. Restore the previous version to take it back.',
      );
    const now = new Date();
    const [rejected] = await tx
      .update(healingProposals)
      .set({
        status: 'rejected',
        reason: note,
        decidedBy: actor.id,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(healingProposals.id, id))
      .returning();
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.HEALING_PROPOSAL_REJECTED,
      actor,
      targetType: 'healing_proposal',
      targetId: id,
      metadata: decisionMetadata(row),
    });
    return { proposal: rejected, unchanged: false };
  });
}
