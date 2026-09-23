import { Router } from "express";
import { z } from "zod";
import { projects, projectMembers, users, insertProjectSchema, AUDIT_ACTIONS } from "@shared/schema";
import { auditActor, recordAudit } from "../audit";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import loggerPromise from "../logger";
import { withTenantTransaction, getTenantOrgId } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";

const router = Router();
const logger = await loggerPromise;

type Role = 'viewer' | 'editor' | 'owner';
const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

/**
 * What the requester may do in a project: their organization role, narrowed by their role on the
 * project when it is restricted. Never widened. Row-level security enforces the same thing (see
 * migrations/0031_project_access.sql); this is for the interface, so it does not offer an edit
 * the database would refuse.
 */
export function effectiveProjectRole(organizationRole: string, restricted: boolean, memberRole: string | null): Role | null {
  if (organizationRole === 'owner') return 'owner';
  const base = (organizationRole in RANK ? organizationRole : 'viewer') as Role;
  if (!restricted) return base;
  if (!memberRole) return null;
  const project = memberRole as Role;
  return RANK[project] < RANK[base] ? project : base;
}

// GET /api/projects - The projects the requester can see, with what they may do in each.
router.get("/api/projects", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  try {
    // No organization filter here on purpose: RLS applies it, and hides restricted projects the
    // requester is not on.
    const rows = await withTenantTransaction(async (tx) => {
      const visible = await tx.select().from(projects).orderBy(desc(projects.createdAt));
      const mine = await tx
        .select({ projectId: projectMembers.projectId, role: projectMembers.role })
        .from(projectMembers)
        .where(eq(projectMembers.userId, req.user!.id));
      const roleOn = new Map(mine.map((m) => [m.projectId, m.role]));
      return visible.map((project) => ({
        ...project,
        access: effectiveProjectRole(req.user!.role, project.restricted, roleOn.get(project.id) ?? null),
      }));
    });
    res.json(rows);
  } catch (error: any) {
    logger.error({ message: "Error fetching projects", error: error.message, stack: error.stack });
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// POST /api/projects - Create a new project. Always open; an owner can restrict it afterwards.
router.post("/api/projects", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const parseResult = insertProjectSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid project data", details: parseResult.error.flatten() });
  }

  try {
    const newProject = await withTenantTransaction(async (tx) => {
      const rows = await tx
        .insert(projects)
        .values({ ...parseResult.data, userId: (req.user as any).id, organizationId: (req.user as { organizationId: number }).organizationId })
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.PROJECT_CREATED,
        actor: auditActor(req),
        targetType: 'project',
        targetId: rows[0].id,
        metadata: { name: rows[0].name },
      });
      return rows;
    });
    res.status(201).json(newProject[0]);
  } catch (error: any) {
    logger.error({ message: "Error creating project", error: error.message });
    res.status(500).json({ error: "Failed to create project" });
  }
});

/** Who is on a project, as the owner's access dialog shows it. */
async function accessOf(tx: Parameters<Parameters<typeof withTenantTransaction>[0]>[0], projectId: number) {
  const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;
  const members = await tx
    .select({ userId: projectMembers.userId, role: projectMembers.role, username: users.username })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(users.username));
  return { projectId: project.id, name: project.name, restricted: project.restricted, members };
}

// GET /api/projects/:id/access — owners only: who can reach a project, and as what.
router.get("/api/projects/:id/access", requireRole('owner'), async (req, res) => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId)) return res.status(400).json({ error: "Invalid project id" });
  const access = await withTenantTransaction((tx) => accessOf(tx, projectId));
  if (!access) return res.status(404).json({ error: "Project not found" });
  res.json(access);
});

const accessSchema = z.object({
  restricted: z.boolean(),
  members: z
    .array(z.object({ userId: z.number().int().positive(), role: z.enum(['viewer', 'editor']) }))
    .max(500)
    .refine((list) => new Set(list.map((m) => m.userId)).size === list.length, "A member is listed twice"),
});

/**
 * PUT /api/projects/:id/access — owners only. Restricts (or opens) a project and replaces its
 * member list, in one transaction with its audit entry.
 *
 * The list is kept when a project is opened again: opening is often temporary, and making the
 * owner retype it would be the punishment for having been careful.
 */
router.put("/api/projects/:id/access", requireRole('owner'), async (req, res) => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId)) return res.status(400).json({ error: "Invalid project id" });
  const parsed = accessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  const organizationId = getTenantOrgId()!;

  const outcome = await withTenantTransaction(async (tx) => {
    const before = await accessOf(tx, projectId);
    if (!before) return { status: 404 as const };

    // People of this organization only. users has no RLS, so the organization is named here.
    const ids = parsed.data.members.map((m) => m.userId);
    const found = ids.length
      ? await tx
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(and(inArray(users.id, ids), eq(users.organizationId, organizationId), eq(users.kind, 'person')))
      : [];
    if (found.length !== ids.length) return { status: 400 as const };
    const nameOf = new Map(found.map((u) => [u.id, u.username]));

    await tx.update(projects).set({ restricted: parsed.data.restricted }).where(eq(projects.id, projectId));
    await tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    if (parsed.data.members.length > 0) {
      await tx.insert(projectMembers).values(
        parsed.data.members.map((m) => ({ projectId, userId: m.userId, organizationId, role: m.role })),
      );
    }

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.PROJECT_ACCESS_CHANGED,
      actor: auditActor(req),
      targetType: 'project',
      targetId: projectId,
      metadata: {
        name: before.name,
        from: before.restricted ? 'restricted' : 'open',
        to: parsed.data.restricted ? 'restricted' : 'open',
        members: parsed.data.members.map((m) => ({ username: nameOf.get(m.userId), role: m.role })),
      },
    });
    return { status: 200 as const, body: await accessOf(tx, projectId) };
  });

  if (outcome.status === 404) return res.status(404).json({ error: "Project not found" });
  if (outcome.status === 400) return res.status(400).json({ error: "Every member must be a person in this organization." });
  res.json(outcome.body);
});

export default router;
