import { Router, type Response } from 'express';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { comments, commentBodySchema, commentCreateSchema, COMMENT_KINDS, type CommentKind, type CommentRecord } from '@shared/comments';
import { tests, apiTests, mobileTests, reportTestCaseResults, users, projects, projectMembers } from '@shared/schema';
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
async function assertVisible(tx: TenantTx, kind: CommentKind, id: string | number): Promise<number[]> {
  if (kind !== 'result') {
    const table = tables[kind];
    const [row] = await tx.select({ id: table.id, projectId: table.projectId }).from(table).where(eq(table.id, Number(id))).limit(1);
    if (!row) throw new CommentError(404, 'Test not found');
    return row.projectId === null ? [] : [row.projectId];
  }
  const [row] = await tx.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.id, String(id))).limit(1);
  if (!row) throw new CommentError(404, 'Result not found');
  const projectIds: number[] = [];
  for (const [source, sourceId] of [[tests, row.uiTestId], [apiTests, row.apiTestId], [mobileTests, row.mobileTestId]] as const) {
    if (sourceId === null) continue;
    const [linked] = await tx.select({ projectId: source.projectId }).from(source).where(eq(source.id, sourceId)).limit(1);
    if (!linked) throw new CommentError(404, 'Result not found');
    if (linked.projectId !== null) projectIds.push(linked.projectId);
  }
  return projectIds;
}
async function eligibleMembers(tx: TenantTx, projectIds: number[]) {
  return tx.select({ id: users.id, username: users.username }).from(users).where(and(
    eq(users.organizationId, getTenantOrgId()!), eq(users.kind, 'person'), isNull(users.disabledAt),
    ...projectIds.map(projectId => sql`(${users.role} = 'owner' OR EXISTS (SELECT 1 FROM ${projects} p WHERE p.id = ${projectId} AND (NOT p.restricted OR EXISTS (SELECT 1 FROM ${projectMembers} m WHERE m.project_id = p.id AND m.user_id = ${users.id} AND m.organization_id = ${getTenantOrgId()!}))))`),
  )).orderBy(asc(users.username));
}
async function validateMentions(tx: TenantTx, projectIds: number[], ids: number[]) {
  const uniqueIds = [...new Set(ids)];
  const eligible = new Set((await eligibleMembers(tx, projectIds)).map(m => m.id));
  if (uniqueIds.some(id => !eligible.has(id))) throw new CommentError(400, 'Mentioned members must be able to read this target');
  return uniqueIds;
}
function commentTarget(row: CommentRecord) {
  if (row.uiTestId !== null) return { kind: 'ui' as const, id: row.uiTestId };
  if (row.apiTestId !== null) return { kind: 'api' as const, id: row.apiTestId };
  if (row.mobileTestId !== null) return { kind: 'mobile' as const, id: row.mobileTestId };
  return { kind: 'result' as const, id: row.resultId! };
}
async function findComment(tx: TenantTx, id: number) {
  const [found] = await tx.select().from(comments).where(eq(comments.id, id)).limit(1).for('update');
  if (!found) throw new CommentError(404, 'Comment not found');
  const { kind, id: targetId } = commentTarget(found);
  const projectIds = await assertVisible(tx, kind, targetId);
  return { found, projectIds };
}
function fail(res: Response, error: unknown) {
  return res.status(error instanceof CommentError ? error.status : 500).json({ error: error instanceof CommentError ? error.message : 'Could not update comments' });
}
const listColumns = { id: comments.id, authorId: comments.authorId, authorName: users.username, body: comments.body, createdAt: comments.createdAt, updatedAt: comments.updatedAt,
  parentId: comments.parentId, mentionedUserIds: comments.mentionedUserIds, resolvedAt: comments.resolvedAt, resolvedBy: comments.resolvedBy, deletedAt: comments.deletedAt };
router.get('/api/comments/:kind/:targetId/members', requireRole('viewer'), async (req, res) => {
  try {
    const { kind, id } = target(req.params.kind, req.params.targetId);
    res.json(await withTenantTransaction(async tx => eligibleMembers(tx, await assertVisible(tx, kind, id))));
  } catch (error) { fail(res, error); }
});
router.get('/api/comments/:kind/:targetId', requireRole('viewer'), async (req, res) => {
  const filter = z.enum(['all', 'open', 'resolved', 'mentions']).safeParse(req.query.filter ?? 'all');
  if (!filter.success) return res.status(400).json({ error: 'Invalid conversation filter' });
  try {
    const { kind, id } = target(req.params.kind, req.params.targetId);
    const rows = await withTenantTransaction(async tx => {
      await assertVisible(tx, kind, id);
      const rows = await tx.select(listColumns).from(comments).leftJoin(users, and(eq(users.id, comments.authorId), eq(users.organizationId, getTenantOrgId()!)))
        .where(eq(fields[kind] as any, id)).orderBy(asc(comments.createdAt), asc(comments.id));
      const cleaned = rows.map(row => row.deletedAt ? { ...row, body: '', mentionedUserIds: [] } : row);
      if (filter.data === 'all') return cleaned;
      const roots = new Set(cleaned.filter(row => !row.parentId && (filter.data === 'resolved' ? !!row.resolvedAt : filter.data === 'open' ? !row.resolvedAt : cleaned.some(c => (c.id === row.id || c.parentId === row.id) && c.mentionedUserIds.includes(req.user!.id)))).map(row => row.id));
      return cleaned.filter(row => roots.has(row.parentId ?? row.id));
    });
    res.json(rows);
  } catch (error) { fail(res, error); }
});
router.post('/api/comments/:kind/:targetId', requireRole('viewer'), async (req, res) => {
  const parsed = commentCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid comment body, parent or mentions' });
  try {
    const { kind, id } = target(req.params.kind, req.params.targetId);
    const created = await withTenantTransaction(async tx => {
      const projectIds = await assertVisible(tx, kind, id);
      if (parsed.data.parentId) {
        const { found: parent } = await findComment(tx, parsed.data.parentId);
        const parentTarget = commentTarget(parent);
        if (parent.parentId !== null || parentTarget.kind !== kind || parentTarget.id !== id) throw new CommentError(400, 'Replies must reference a root on the same target');
        if (parent.resolvedAt || parent.deletedAt) throw new CommentError(409, 'Conversation is closed');
      }
      const mentionedUserIds = await validateMentions(tx, projectIds, parsed.data.mentionedUserIds ?? []);
      const values = { organizationId: getTenantOrgId()!, authorId: req.user!.id, body: parsed.data.body, parentId: parsed.data.parentId ?? null, mentionedUserIds,
        uiTestId: kind === 'ui' ? Number(id) : null, apiTestId: kind === 'api' ? Number(id) : null,
        mobileTestId: kind === 'mobile' ? Number(id) : null, resultId: kind === 'result' ? String(id) : null };
      const [row] = await tx.insert(comments).values(values).returning();
      return row;
    });
    res.status(201).json(created);
  } catch (error) { fail(res, error); }
});
router.patch('/api/comments/:id/resolution', requireRole('viewer'), async (req, res) => {
  const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
  const parsed = z.object({ resolved: z.boolean() }).safeParse(req.body);
  if (!parsedId.success || !parsed.success) return res.status(400).json({ error: 'Invalid resolution' });
  try {
    const updated = await withTenantTransaction(async tx => {
      const { found } = await findComment(tx, parsedId.data);
      if (found.parentId !== null || found.deletedAt) throw new CommentError(400, 'Only active roots can be resolved');
      if (found.authorId !== req.user!.id && req.user!.role !== 'owner') throw new CommentError(403, 'Only the author or an owner can resolve a conversation');
      const [row] = await tx.update(comments).set({ resolvedAt: parsed.data.resolved ? new Date() : null, resolvedBy: parsed.data.resolved ? req.user!.id : null, updatedAt: new Date() }).where(eq(comments.id, found.id)).returning();
      return row;
    });
    res.json(updated);
  } catch (error) { fail(res, error); }
});
for (const method of ['patch', 'delete'] as const) router[method]('/api/comments/:id', requireRole('viewer'), async (req, res) => {
  const parsedId = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ error: 'Invalid comment id' });
  const parsed = commentBodySchema.safeParse(req.body);
  if (method === 'patch' && !parsed.success) return res.status(400).json({ error: 'Invalid comment body or mentions' });
  try {
    const row = await withTenantTransaction(async tx => {
      const { found, projectIds } = await findComment(tx, parsedId.data);
      if (found.authorId !== req.user!.id && req.user!.role !== 'owner') throw new CommentError(403, 'Only the author or an owner can change a comment');
      if (method === 'delete') {
        const replies = found.parentId === null ? await tx.select({ id: comments.id }).from(comments).where(eq(comments.parentId, found.id)).limit(1) : [];
        if (replies.length) await tx.update(comments).set({ deletedAt: new Date(), body: '', mentionedUserIds: [], updatedAt: new Date() }).where(eq(comments.id, found.id));
        else await tx.delete(comments).where(eq(comments.id, found.id));
        return null;
      }
      if (found.deletedAt) throw new CommentError(409, 'Comment was deleted');
      const mentionedUserIds = parsed.success && parsed.data.mentionedUserIds !== undefined
        ? await validateMentions(tx, projectIds, parsed.data.mentionedUserIds) : found.mentionedUserIds;
      const [updated] = await tx.update(comments).set({ body: parsed.success ? parsed.data.body : '', mentionedUserIds, updatedAt: new Date() }).where(eq(comments.id, found.id)).returning();
      return updated;
    });
    if (method === 'delete') return res.status(204).end();
    res.json(row);
  } catch (error) { fail(res, error); }
});
export default router;
