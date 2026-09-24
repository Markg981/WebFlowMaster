import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, gte, like, lte, ne, sql, type SQL } from "drizzle-orm";
import { organizations, users, invitations, auditLog, AUDIT_ACTIONS } from "@shared/schema";
import { storage } from "../storage";
import { requireRole } from "../middleware/require-role";
import { withTenantTransaction, getTenantOrgId } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { exportOrganization, eraseOrganization } from "../organization-lifecycle";
import { transferMemberContent } from "../member-removal";
import loggerPromise from "../logger";
import { liveRunCounts, quotasFor } from "../tenant-quotas";
import { availableRunnerCount } from "../runner-registry";

const router = Router();

const RoleSchema = z.enum(["viewer", "editor", "owner"]);

/**
 * The organization's share of the execution plane: its limits and what it is using now.
 *
 * So a team whose run is "queued" for a while can see why — two already running, the limit is
 * two — instead of wondering whether the system is broken. Read-only: the limits are the
 * operator's to set (see server/tenant-quotas.ts).
 */
router.get("/api/organization/usage", requireRole("viewer"), async (_req: Request, res: Response) => {
  const organizationId = getTenantOrgId()!;
  const usage = await withTenantTransaction(async (tx) => {
    const [quotas, counts] = await Promise.all([quotasFor(tx, organizationId), liveRunCounts(tx, organizationId)]);
    return { ...counts, ...quotas };
  });
  // Zero means every run will wait however much room the organization has: say so, since that
  // is the question a run sitting in "queued" raises first.
  res.json({ ...usage, runnersOnline: await availableRunnerCount() });
});

/**
 * users is not an org-scoped RLS table (it holds the organization pointer itself), so these
 * handlers filter by organizationId explicitly. Every query below carries that filter.
 */
router.get("/api/organization", requireRole("viewer"), async (_req: Request, res: Response) => {
  const organizationId = getTenantOrgId()!;

  const result = await withTenantTransaction(async (tx) => {
    const [organization] = await tx
      .select({ id: organizations.id, name: organizations.name, createdAt: organizations.createdAt })
      .from(organizations)
      .where(eq(organizations.id, organizationId));

    // An explicit column list, never select(): the password hash must not leave the database.
    const members = await tx
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      // People. Service accounts are listed, and managed, under /api/service-accounts.
      .where(and(eq(users.organizationId, organizationId), eq(users.kind, "person")));

    return { organization, members };
  });

  res.json(result);
});

/**
 * The audit trail. Owner-only: it names who did what, which is exactly the information a
 * viewer or editor has no business enumerating.
 *
 * No organizationId predicate — audit_log IS an RLS table (unlike users and invitations), so
 * the policy scopes this. Nothing here can write, either: app_user holds SELECT and INSERT on
 * this table and nothing more, so there is no route that could erase an entry even by mistake.
 */
const AUDIT_ACTION_VALUES = Object.values(AUDIT_ACTIONS) as string[];
/** 'test' for test.created, test.updated…: what a person filtering the trail thinks in. */
const AUDIT_CATEGORIES = [...new Set(AUDIT_ACTION_VALUES.map((action) => action.split(".")[0]))];

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().refine((value) => AUDIT_ACTION_VALUES.includes(value), "Unknown action").optional(),
  category: z.string().refine((value) => AUDIT_CATEGORIES.includes(value), "Unknown category").optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
  targetType: z.string().max(40).optional(),
  targetId: z.string().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

/** The most a CSV export holds. Past it, narrow the filter: the trail is not a backup. */
const AUDIT_EXPORT_LIMIT = 10_000;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  // A cell starting with = + - @ is a formula to a spreadsheet; the trail is read in one.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

router.get("/api/organization/audit-log", requireRole("owner"), async (req: Request, res: Response) => {
  const parsed = auditQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }
  const query = parsed.data;

  const conditions: SQL[] = [];
  if (query.action) conditions.push(eq(auditLog.action, query.action));
  if (query.category) conditions.push(like(auditLog.action, `${query.category}.%`));
  if (query.actorUserId) conditions.push(eq(auditLog.actorUserId, query.actorUserId));
  if (query.targetType) conditions.push(eq(auditLog.targetType, query.targetType));
  if (query.targetId) conditions.push(eq(auditLog.targetId, query.targetId));
  if (query.from) conditions.push(gte(auditLog.createdAt, query.from));
  if (query.to) conditions.push(lte(auditLog.createdAt, query.to));

  const exporting = query.format === "csv";
  // One more than asked for, so the answer can say whether there is a next page without a count.
  const take = exporting ? AUDIT_EXPORT_LIMIT : query.limit + 1;

  const rows = await withTenantTransaction((tx) =>
    tx
      .select()
      .from(auditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(take)
      .offset(exporting ? 0 : query.offset),
  );

  if (exporting) {
    const columns = ["createdAt", "action", "actorUsername", "actorUserId", "apiKeyId", "ipAddress", "targetType", "targetId", "metadata"] as const;
    const lines = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(lines.join("\r\n") + "\r\n");
  }

  const hasMore = rows.length > query.limit;
  res.json({
    entries: rows.slice(0, query.limit),
    limit: query.limit,
    offset: query.offset,
    hasMore,
    categories: AUDIT_CATEGORIES,
  });
});

/**
 * Data portability. Owner-only, and it is the whole organization: members, tests, plans,
 * executions, the audit trail. Credentials are excluded by exportOrganization — this is a
 * customer taking their data with them, not a credential dump, and the file will be emailed.
 */
router.get("/api/organization/export", requireRole("owner"), async (_req: Request, res: Response) => {
  const organizationId = getTenantOrgId()!;
  const payload = await exportOrganization(organizationId);

  res.setHeader('Content-Disposition', `attachment; filename="organization-${organizationId}-export.json"`);
  res.json(payload);
});

/**
 * Erasure. Irreversible, and it takes every member account with it.
 *
 * Requires the organization's own name in the body. Not security — an owner is already
 * authorised — but a deliberate pause: this is the one endpoint whose accidental success cannot
 * be undone, and `DELETE /api/organization` is two characters away from `DELETE
 * /api/organization/members/:id`.
 *
 * Recorded in the application log rather than the audit trail: an audit entry about erasing an
 * organization would be erased along with it. The log outlives the tenant.
 */
router.delete("/api/organization", requireRole("owner"), async (req: Request, res: Response) => {
  const organizationId = getTenantOrgId()!;
  const parsed = z.object({ confirmName: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Provide confirmName, the organization's name." });
  }

  const [organization] = await withTenantTransaction((tx) =>
    tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)),
  );
  if (!organization) return res.status(404).json({ error: "Organization not found" });

  if (parsed.data.confirmName !== organization.name) {
    return res.status(400).json({ error: "confirmName does not match the organization's name." });
  }

  const logger = await loggerPromise;
  logger.warn({
    message: 'Organization erased',
    organizationId,
    organizationName: organization.name,
    byUserId: req.user!.id,
    byUsername: req.user!.username,
  });

  const { deleted } = await eraseOrganization(organizationId);

  // The caller's own account is among the rows just deleted, so their session now points at
  // nothing. Ending it is tidier than letting the next request fail to deserialise a user — but
  // the response must not depend on it: the erasure has already committed, and reporting it is
  // the last thing anyone will ever learn about this organization. Guarded because req.logout
  // only exists where passport is mounted.
  if (typeof req.logout === 'function') {
    req.logout(() => undefined);
  }
  res.json({ erased: true, deleted });
});

/**
 * How someone actually joins an organization they did not create.
 *
 * POST /api/organization/members cannot do it: a user belongs to exactly one organization, so
 * moving an existing account would take that person's own data away from them. An invitation
 * names a username that does not exist yet, and registration with the token puts the new
 * account here instead of in an organization of its own.
 */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

router.get("/api/organization/invitations", requireRole("owner"), async (_req: Request, res: Response) => {
  const organizationId = getTenantOrgId()!;

  // invitations has no RLS policy (registration must read it before any tenant context
  // exists), so the organizationId predicate here is the isolation, not a belt-and-braces.
  const pending = await withTenantTransaction((tx) =>
    tx
      .select({
        id: invitations.id,
        username: invitations.username,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(eq(invitations.organizationId, organizationId)),
  );

  // The token is deliberately absent: it is a bearer credential, and this endpoint exists to
  // show who has been invited, not to re-read secrets. It is returned once, at creation.
  res.json(pending);
});

router.post("/api/organization/invitations", requireRole("owner"), async (req: Request, res: Response) => {
  const organizationId = getTenantOrgId()!;
  const parsed = z
    .object({
      username: z.string().min(3),
      // No 'owner': granting ownership is a deliberate act on an existing member (PATCH), not
      // something an unaccepted invitation can pre-authorise.
      role: z.enum(["viewer", "editor"]).default("editor"),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  // Privileged and outside the tenant transaction: this asks a question about the global
  // username namespace, which is not org-scoped and which app_user cannot read anyway.
  const existing = await storage.getUserByUsername(parsed.data.username);
  if (existing) {
    return res.status(409).json({
      error:
        "That username already exists. An invitation can only create a new account; an " +
        "existing user cannot be moved between organizations.",
    });
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  try {
    const created = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .insert(invitations)
        .values({
          organizationId,
          username: parsed.data.username,
          role: parsed.data.role,
          token,
          invitedByUserId: req.user!.id,
          expiresAt,
        })
        .returning();

      // The token is deliberately not in the metadata: this table is readable by every owner
      // and cannot be redacted afterwards.
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.INVITATION_CREATED,
        actor: auditActor(req),
        targetType: 'invitation',
        targetId: row.id,
        metadata: { username: row.username, role: row.role, expiresAt: row.expiresAt.toISOString() },
      });

      return row;
    });

    // The only time the token is ever returned. Whoever calls this has to deliver it to the
    // invitee themselves — there is no mail transport in this application.
    res.status(201).json({
      id: created.id,
      username: created.username,
      role: created.role,
      token: created.token,
      expiresAt: created.expiresAt,
    });
  } catch (e: unknown) {
    if (/unique/i.test((e as Error).message ?? "")) {
      return res.status(409).json({ error: "That username has already been invited." });
    }
    throw e;
  }
});

router.delete("/api/organization/invitations/:id", requireRole("owner"), async (req: Request, res: Response) => {
  const organizationId = getTenantOrgId()!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid invitation id" });

  const removed = await withTenantTransaction(async (tx) => {
    const deleted = await tx
      .delete(invitations)
      .where(and(eq(invitations.id, id), eq(invitations.organizationId, organizationId)))
      .returning();
    if (deleted.length === 0) return false;

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.INVITATION_REVOKED,
      actor: auditActor(req),
      targetType: 'invitation',
      targetId: id,
      metadata: { username: deleted[0].username, role: deleted[0].role },
    });
    return true;
  });

  if (!removed) return res.status(404).json({ error: "Invitation not found" });
  res.status(204).end();
});

router.post("/api/organization/members", requireRole("owner"), async (req: Request, res: Response) => {
  const organizationId = getTenantOrgId()!;
  const parsed = z.object({ userId: z.number().int().positive(), role: RoleSchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const outcome = await withTenantTransaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, role: users.role, organizationId: users.organizationId, kind: users.kind })
      .from(users)
      .where(eq(users.id, parsed.data.userId));

    // A service account's role is set where it was created; this is for people.
    if (!target || target.kind !== "person") return { status: 404 as const };

    // A user who already belongs to another organization cannot be pulled into this one.
    //
    // Without this the endpoint is a cross-tenant member-theft vector: the lookup above is by
    // id alone, so an owner could enumerate ids and re-parent anyone in the system into their
    // own organization — stripping that person of access to their own organization's data and
    // handing them this one's. Ownership of an organization is authority over its membership,
    // not authority over other people's accounts.
    //
    // Which leaves this endpoint able only to set the role of someone already here — growing
    // an organization is what POST /api/organization/invitations is for. An invitation names
    // a username that does not exist yet, so the new account is created inside this
    // organization rather than moved into it, and nobody loses their own.
    if (target.organizationId !== organizationId) {
      return {
        status: 409 as const,
        error:
          "That user already belongs to another organization. Invite a new user instead: " +
          "moving an existing member between organizations would take away their access to " +
          "their own organization's data.",
      };
    }

    // .returning() takes no column-list argument here: TenantTx is typed as a union across
    // the node-postgres and PGlite drivers (server/db.ts's DbType), and TypeScript collapses
    // an update-builder method that differs across a union's members down to the narrowest
    // common overload — the zero-argument one. Select the safe fields back out afterward
    // instead, so the password hash picked up by the full-row returning never leaves this
    // function.
    const [updatedRow] = await tx
      .update(users)
      .set({ organizationId, role: parsed.data.role })
      .where(eq(users.id, parsed.data.userId))
      .returning();
    const updated = { id: updatedRow.id, username: updatedRow.username, role: updatedRow.role };

    return { status: 201 as const, body: updated };
  });

  if (outcome.status === 404) return res.status(404).json({ error: "User not found" });
  if (outcome.status === 409) return res.status(409).json({ error: outcome.error });
  res.status(201).json(outcome.body);
});

router.patch(
  "/api/organization/members/:userId",
  requireRole("owner"),
  async (req: Request, res: Response) => {
    const organizationId = getTenantOrgId()!;
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: "Invalid user id" });

    const parsed = z.object({ role: RoleSchema }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid role", details: parsed.error.flatten() });
    }

    const outcome = await withTenantTransaction(async (tx) => {
      const [target] = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.organizationId, organizationId), eq(users.kind, "person")));

      if (!target) return { status: 404 as const };

      // Counted inside the transaction, not before it: a read-then-write check would let two
      // concurrent demotions both observe a second owner and both succeed.
      if (target.role === "owner" && parsed.data.role !== "owner") {
        const [{ others }] = await tx
          .select({ others: sql<number>`count(*)::int` })
          .from(users)
          .where(
            and(
              eq(users.organizationId, organizationId),
              eq(users.role, "owner"),
              ne(users.id, userId),
            ),
          );
        if (others === 0) return { status: 409 as const };
      }

      // See the comment on the POST handler's update above: .returning() takes no argument
      // here because of how TenantTx's union type collapses the update builder's overloads.
      const [updatedRow] = await tx
        .update(users)
        .set({ role: parsed.data.role })
        .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)))
        .returning();
      const updated = { id: updatedRow.id, username: updatedRow.username, role: updatedRow.role };

      await recordAudit(tx, {
        action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
        actor: auditActor(req),
        targetType: 'user',
        targetId: userId,
        // Both sides: "changed to editor" is not answerable without knowing what it was.
        metadata: { username: updatedRow.username, from: target.role, to: parsed.data.role },
      });

      return { status: 200 as const, body: updated };
    });

    if (outcome.status === 404) return res.status(404).json({ error: "Member not found" });
    if (outcome.status === 409) {
      return res.status(409).json({ error: "An organization must keep at least one owner" });
    }
    res.json(outcome.body);
  },
);

router.delete(
  "/api/organization/members/:userId",
  requireRole("owner"),
  async (req: Request, res: Response) => {
    const organizationId = getTenantOrgId()!;
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: "Invalid user id" });

    const body = z
      .object({ transferTo: z.number().int().positive().optional() })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return res.status(400).json({ error: "Invalid payload", details: body.error.flatten() });
    }

    const outcome = await withTenantTransaction(async (tx) => {
      const [target] = await tx
        .select({ id: users.id, role: users.role, username: users.username })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.organizationId, organizationId), eq(users.kind, "person")));

      if (!target) return { status: 404 as const };

      if (target.role === "owner") {
        const [{ others }] = await tx
          .select({ others: sql<number>`count(*)::int` })
          .from(users)
          .where(
            and(
              eq(users.organizationId, organizationId),
              eq(users.role, "owner"),
              ne(users.id, userId),
            ),
          );
        if (others === 0) return { status: 409 as const };
      }

      // Who takes over what the member made (server/member-removal.ts): the member the request
      // names, or the owner removing them, or — when an owner removes themselves — the longest-
      // standing other owner, who exists because the check above passed.
      let heir: { id: number; username: string } | undefined;
      const named = body.data.transferTo ?? (req.user!.id !== userId ? req.user!.id : undefined);
      if (named !== undefined) {
        if (named === userId) return { status: 400 as const, error: "transferTo must be another member" };
        [heir] = await tx
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(and(eq(users.id, named), eq(users.organizationId, organizationId), eq(users.kind, "person")));
        if (!heir) return { status: 400 as const, error: "transferTo is not a member of this organization" };
      } else {
        [heir] = await tx
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(and(eq(users.organizationId, organizationId), eq(users.role, "owner"), eq(users.kind, "person"), ne(users.id, userId)))
          .orderBy(asc(users.createdAt), asc(users.id))
          .limit(1);
      }

      const transferred = await transferMemberContent(tx, organizationId, userId, heir!.id);

      // Audit before the delete, not after: actor_user_id is ON DELETE SET NULL, and an owner
      // removing themselves would otherwise null out the actor on their own entry. The
      // denormalised actor_username survives either way, but the id is worth keeping when it
      // can be.
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.MEMBER_REMOVED,
        actor: auditActor(req),
        targetType: 'user',
        targetId: userId,
        metadata: { username: target.username, role: target.role, transferredTo: heir!.username, transferred },
      });

      await tx.delete(users).where(and(eq(users.id, userId), eq(users.organizationId, organizationId)));
      return { status: 200 as const, body: { removed: userId, transferredTo: { id: heir!.id, username: heir!.username }, transferred } };
    });

    if (outcome.status === 404) return res.status(404).json({ error: "Member not found" });
    if (outcome.status === 400) return res.status(400).json({ error: outcome.error });
    if (outcome.status === 409) {
      return res.status(409).json({ error: "An organization must keep at least one owner" });
    }
    res.json(outcome.body);
  },
);

export default router;
