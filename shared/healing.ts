/**
 * Healing as a proposal, and its approval as a separate, attributable act (M02, lot P13).
 *
 * A step whose locator no longer finds its element may run on a repaired one: a fallback the test
 * already knows (the element's recorded test id, id, name or label), or the AI's suggestion when
 * the deployment has AI enabled. That repair is used for the run only. What it leaves behind is a
 * proposal — run, unit, attempt, where the step is written, the fingerprint of the step as the run
 * read it, the locator before and after — and nothing in the test, its group or the shared element
 * changes until somebody who may edit the project approves it. Approving writes the working copy
 * (a new version of the test, or the group or element) under the same fingerprint check healing
 * always had; publishing that version is still the existing publish or review step.
 *
 *   proposed  — recorded by a run; nothing written
 *   approved  — written to its source by a person, with an audit entry and (for a test) a version
 *   rejected  — declined by a person; nothing written
 *   stale     — its source changed after the run read it: approving it would overwrite that change
 */

export const HEALING_PROPOSAL_STATUSES = ['proposed', 'approved', 'rejected', 'stale'] as const;
export type HealingProposalStatus = (typeof HEALING_PROPOSAL_STATUSES)[number];

/** Where the repaired locator came from. A known fallback is always tried before the AI. */
export const HEALING_ORIGINS = ['fallback', 'ai'] as const;
export type HealingOrigin = (typeof HEALING_ORIGINS)[number];

/** Which source a proposal belongs to: the test's own step, a step group's, or a shared element. */
export const HEALING_TARGET_KINDS = ['test', 'group', 'element'] as const;
export type HealingTargetKind = (typeof HEALING_TARGET_KINDS)[number];

/** The id format of a proposal: opaque, carries nothing about the test or the run. */
export const HEALING_PROPOSAL_ID_PATTERN = /^hp_[0-9a-f]{24}$/;

/**
 * What a step's result says about the healing it ran with (StepResult.healing).
 *
 * `status` is what became of the proposal when the run recorded it, not now: the report reads the
 * current status from the proposal itself. Results recorded before P13 carry the old outcomes —
 * 'applied', 'already_applied' or 'conflict' — from when a run wrote the repair directly.
 */
export interface StepHealing {
  /** The locator the step is written with, unresolved: a {{variable}} stays a placeholder. */
  originalSelector: string | null;
  /** The locator the step ran with instead. */
  proposedSelector: string;
  origin?: HealingOrigin;
  status: 'proposed' | 'unrecorded' | 'applied' | 'already_applied' | 'conflict';
  /** The recorded proposal, to approve or reject. */
  proposalId?: string;
  /** The fingerprint the approval must still match. */
  fingerprint?: string;
  target?: { kind: HealingTargetKind; index?: number; stepId?: string | null } | null;
  reason?: string;
  detail: string;
}
