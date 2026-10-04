import { Router } from 'express';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { bddExecutionProfiles } from '@shared/schema';
import { BDD_PROFILE_ID } from '@shared/bdd-agent';
import { AGENT_POOL_PATTERN } from '@shared/agents';
import { requireRole } from '../middleware/require-role';
import { getTenantOrgId, withTenantTransaction } from '../middleware/tenancy';
import { advertisedBddProfiles, validateBddProfileDefinition } from '../bdd-profiles';
import { auditActor, recordAudit } from '../audit';

const router = Router();
const definition = z.object({
  name: z.string().trim().min(1).max(120), pool: z.string().regex(AGENT_POOL_PATTERN),
  projectId: z.number().int().positive().nullable().optional(),
  operatorProfileId: z.string().regex(BDD_PROFILE_ID), revision: z.string().min(1).max(160),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
}).strict();
router.get('/api/bdd/profiles/available', requireRole('viewer'), async (_req,res,next) => {
  try { res.json({ profiles: await withTenantTransaction(advertisedBddProfiles) }); } catch(error) { next(error); }
});
router.get('/api/bdd/profiles', requireRole('viewer'), async (_req,res,next) => {
  try { res.json({ profiles: await withTenantTransaction(tx => tx.select().from(bddExecutionProfiles)) }); } catch(error) { next(error); }
});
for (const method of ['post','put'] as const) {
  router[method](method === 'post' ? '/api/bdd/profiles' : '/api/bdd/profiles/:id', requireRole('owner'), async (req,res,next) => {
    const parsed = definition.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error:'Invalid BDD profile',details:parsed.error.flatten() });
    try {
      const row = await withTenantTransaction(async tx => {
        if (method === 'put') {
          const [existing] = await tx.select().from(bddExecutionProfiles).where(eq(bddExecutionProfiles.id,req.params.id)).limit(1);
          if (!existing) return undefined;
          if (existing.pool !== parsed.data.pool || existing.operatorProfileId !== parsed.data.operatorProfileId) {
            return { invalid: 'The execution target is immutable. Create a new profile to select a different pool or operator profile.' };
          }
        }
        try { await validateBddProfileDefinition(tx, parsed.data); } catch(error) { return { invalid: (error as Error).message }; }
        const fields = { ...parsed.data, projectId: parsed.data.projectId ?? null };
        const [saved] = method === 'post'
          ? await tx.insert(bddExecutionProfiles).values({ ...fields,id:randomUUID(),organizationId:getTenantOrgId()! }).returning()
          : await tx.update(bddExecutionProfiles).set({ ...fields,updatedAt:new Date() }).where(eq(bddExecutionProfiles.id,req.params.id)).returning();
        if (saved) await recordAudit(tx,{action:method === 'post' ? 'bdd_profile.created' : 'bdd_profile.updated',actor:auditActor(req),targetType:'bdd_profile',targetId:saved.id,metadata:{name:saved.name,pool:saved.pool,revision:saved.revision}});
        return saved;
      });
      if (!row) return res.status(404).json({error:'No such BDD profile.'});
      if ('invalid' in row) return res.status(400).json({error:row.invalid});
      res.status(method === 'post' ? 201 : 200).json(row);
    } catch(error) { next(error); }
  });
}
router.delete('/api/bdd/profiles/:id',requireRole('owner'),async (req,res,next) => {
  try {
    const row = await withTenantTransaction(async tx => {
      const [removed] = await tx.delete(bddExecutionProfiles).where(eq(bddExecutionProfiles.id,req.params.id)).returning();
      if (removed) await recordAudit(tx,{action:'bdd_profile.deleted',actor:auditActor(req),targetType:'bdd_profile',targetId:removed.id,metadata:{name:removed.name}});
      return removed;
    });
    if (!row) return res.status(404).json({error:'No such BDD profile.'});
    res.json({deleted:true});
  } catch(error) { next(error); }
});
export default router;
