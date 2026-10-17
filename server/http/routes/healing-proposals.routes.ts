import type { Response } from 'express';
import { z } from 'zod';
import { HEALING_PROPOSAL_ID_PATTERN, HEALING_PROPOSAL_STATUSES } from '@shared/healing';
import type { HealingProposalRow } from '@shared/schema';
import { asyncRouter } from '../../platform/middleware/async-router';
import logger from '../../platform/logger';
import { auditActor } from '../../tenancy/audit';
import { requireRole } from '../middleware/require-role';
import {
  HealingProposalError,
  approveHealingProposal,
  getHealingProposal,
  listHealingProposals,
  rejectHealingProposal,
  type Decision,
} from '../../authoring/healing-proposals';

/**
 * Healing proposals: what runs repaired, and a member's decision on each (M02,
 * server/authoring/healing-proposals.ts).
 *
 * Reading is a viewer's right, as reading the report is. Deciding is an edit of the project:
 * the editor role, and the project's own access when it is restricted (row-level security checks
 * the same thing). An approval names the fingerprint the approver was shown, so a decision is
 * about exactly that proposal; approving it twice is one approval, and a proposal whose step
 * changed is answered with a conflict, never written over the change.
 */

const router = asyncRouter();

const listQuery = z.object({
  testId: z.coerce.number().int().positive().optional(),
  executionId: z.string().min(1).max(200).optional(),
  status: z.enum(HEALING_PROPOSAL_STATUSES).optional(),
});
const approveBody = z.object({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) });
const rejectBody = z.object({ note: z.string().trim().max(500).optional().nullable() });

/** The proposal as the client sees it: what was healed, where, from which run, and its decision. */
function view(row: HealingProposalRow) {
  return {
    id: row.id,
    testId: row.testId,
    projectId: row.projectId,
    executionId: row.executionId,
    unitId: row.unitId,
    attempt: row.attempt,
    stepIndex: row.stepIndex,
    target: {
      kind: row.targetKind,
      ref: row.targetRef,
      index: row.targetIndex,
      stepId: row.stepId,
      callPath: row.callPath,
    },
    fingerprint: row.sourceFingerprint,
    origin: row.origin,
    selectorBefore: row.selectorBefore,
    selectorAfter: row.selectorAfter,
    status: row.status,
    reason: row.reason,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    appliedVersion: row.appliedVersion,
    createdAt: row.createdAt,
  };
}

function validId(res: Response, id: string): boolean {
  if (HEALING_PROPOSAL_ID_PATTERN.test(id)) return true;
  res.status(404).json({ error: 'Proposal not found.', code: 'proposal_not_found' });
  return false;
}

function answer(res: Response, decision: Decision) {
  if (decision.conflict)
    return res.status(409).json({
      error:
        decision.conflict === 'locked'
          ? 'The test is archived; nothing was changed.'
          : 'The step changed after the run read it; nothing was changed and the proposal is now stale.',
      code: 'proposal_stale',
      proposal: view(decision.proposal),
    });
  return res.json({ proposal: view(decision.proposal), unchanged: decision.unchanged });
}

function failed(res: Response, error: unknown, what: string) {
  if (error instanceof HealingProposalError)
    return res.status(error.status).json({ error: error.message, code: error.code });
  logger.error({ message: `Failed to ${what} healing proposal`, error: String(error) });
  return res.status(500).json({ error: `Failed to ${what} the proposal.` });
}

// GET /api/healing-proposals?testId=&executionId=&status=
router.get('/api/healing-proposals', requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ error: 'Invalid filter', details: parsed.error.flatten() });
  const rows = await listHealingProposals(parsed.data);
  res.json(rows.map(view));
});

// GET /api/healing-proposals/:id
router.get('/api/healing-proposals/:id', requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  if (!validId(res, req.params.id)) return;
  const row = await getHealingProposal(req.params.id);
  if (!row)
    return res.status(404).json({ error: 'Proposal not found.', code: 'proposal_not_found' });
  res.json(view(row));
});

// POST /api/healing-proposals/:id/approve { fingerprint }
router.post('/api/healing-proposals/:id/approve', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!validId(res, req.params.id)) return;
  const parsed = approveBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: 'The fingerprint you were shown is required.' });
  try {
    answer(
      res,
      await approveHealingProposal(req.params.id, parsed.data.fingerprint, auditActor(req)),
    );
  } catch (error) {
    failed(res, error, 'approve');
  }
});

// POST /api/healing-proposals/:id/reject { note? }
router.post('/api/healing-proposals/:id/reject', requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!validId(res, req.params.id)) return;
  const parsed = rejectBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid note' });
  try {
    answer(
      res,
      await rejectHealingProposal(req.params.id, parsed.data.note ?? null, auditActor(req)),
    );
  } catch (error) {
    failed(res, error, 'reject');
  }
});

export default router;
