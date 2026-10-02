import { Router, type Response } from 'express';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { comments, commentBodySchema, COMMENT_KINDS, type CommentKind } from '@shared/comments';
import { tests, apiTests, mobileTests, reportTestCaseResults, users } from '@shared/schema';
import { requireRole } from '../middleware/require-role';
import { withTenantTransaction, getTenantOrgId, type TenantTx } from '../middleware/tenancy';

const router = Router();
class CommentError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const fields = { ui: comments.uiTestId, api: comments.apiTestId, mobile: comments.mobileTestId, result: comments.resultId };
const tables = { ui: tests, api: apiTests, mobile: mobileTests };
function target(kind: string, id: string) {
  if (!COMMENT_KINDS.includes(kind as CommentKind)) throw new CommentError(400, 'Invalid comment target');
  if (kind === 'result') {
    if (!id.trim() || id.length > 200) throw new CommentError(400, 'Invalid result id');
    return { kind: kind as CommentKind, id };
  }
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new CommentError(400, 'Invalid test id');
  return { kind: kind as CommentKind, id: Number(id) };
}
async function assertVisible(tx: TenantTx, kind: CommentKind, id: string | number) {
  if (kind === 'result') {
    const [row] = await tx.select({ id: reportTestCaseResults.id }).from(reportTestCaseResults).where(and(
      eq(reportTestCaseResults.id, String(id)),
      sql`(${reportTestCaseResults.uiTestId} IS NULL OR EXISTS (SELECT 1 FROM tests WHERE id = ${reportTestCaseResults.uiTestId}))`,
      sql`(${reportTestCaseResults.apiTestId} IS NULL OR EXISTS (SELECT 1 FROM api_tests WHERE id = ${reportTestCaseResults.apiTestId}))`,
      sql`(${reportTestCaseResults.mobileTestId} IS NULL OR EXISTS (SELECT 1 FROM mobile_tests WHERE id = ${reportTestCaseResults.mobileTestId}))`,
    )).limit(1);
    if (!row) throw new CommentError(404, 'Result not found');
  } else {
    const table = tables[kind];
    const [row] = await tx.select({ id: table.id }).from(table).where(eq(table.id, Number(id))).limit(1);
    if (!row) throw new CommentError(404, 'Test not found');
  }
}
function fail(res: Response, error: unknown) {
  return res.status(error instanceof CommentError ? error.status : 500).json({ error: error instanceof CommentError ? error.message : 'Could not update comments' });
}
const listColumns = { id: comments.id, authorId: comments.authorId, authorName: users.username, body: comments.body, createdAt: comments.createdAt, updatedAt: comments.updatedAt };
router.get('/api/comments/:kind/:targetId', requireRole('viewer'), async (req, res) => {
  try {
    const { kind, id } = target(req.params.kind, req.params.targetId);
    const rows = await withTenantTransaction(async tx => {
      await assertVisible(tx, kind, id);
      return tx.select(listColumns).from(comments).leftJoin(users, eq(users.id, comments.authorId))
        .where(eq(fields[kind] as any, id)).orderBy(asc(comments.createdAt), asc(comments.id));
    });
    res.json(rows);
  } catch (error) { fail(res, error); }
});
router.post('/api/comments/:kind/:targetId', requireRole('viewer'), async (req, res) => {
  const parsed = commentBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A comment must contain between 1 and 5000 characters' });
  try {
    const { kind, id } = target(req.params.kind, req.params.targetId);
    const created = await withTenantTransaction(async tx => {
      await assertVisible(tx, kind, id);
      const values = { organizationId: getTenantOrgId()!, authorId: req.user!.id, body: parsed.data.body,
        uiTestId: kind === 'ui' ? Number(id) : null, apiTestId: kind === 'api' ? Number(id) : null,
        mobileTestId: kind === 'mobile' ? Number(id) : null, resultId: kind === 'result' ? String(id) : null };
      const [row] = await tx.insert(comments).values(values).returning();
      return row;
    });
    res.status(201).json(created);
  } catch (error) { fail(res, error); }
});
for (const method of ['patch', 'delete'] as const) router[method]('/api/comments/:id', requireRole('viewer'), async (req, res) => {
  const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ error: 'Invalid comment id' });
  const parsed = commentBodySchema.safeParse(req.body);
  if (method === 'patch' && !parsed.success) return res.status(400).json({ error: 'A comment must contain between 1 and 5000 characters' });
  try {
    const row = await withTenantTransaction(async tx => {
      const [found] = await tx.select().from(comments).where(eq(comments.id, parsedId.data)).limit(1);
      if (!found) throw new CommentError(404, 'Comment not found');
      if (found.authorId !== req.user!.id && req.user!.role !== 'owner') throw new CommentError(403, 'Only the author or an owner can change a comment');
      if (method === 'delete') { await tx.delete(comments).where(eq(comments.id, found.id)); return null; }
      const [updated] = await tx.update(comments).set({ body: parsed.success ? parsed.data.body : '', updatedAt: new Date() }).where(eq(comments.id, found.id)).returning();
      return updated;
    });
    if (method === 'delete') return res.status(204).end();
    res.json(row);
  } catch (error) { fail(res, error); }
});
export default router;
