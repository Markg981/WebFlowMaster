import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { organizations, users, invitations } from "@shared/schema";
import { storage } from "../storage";
import { requireRole } from "../middleware/require-role";
import { withTenantTransaction, getTenantOrgId } from "../middleware/tenancy";

const router = Router();

const RoleSchema = z.enum(["viewer", "editor", "owner"]);

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
      .where(eq(users.organizationId, organizationId));

    return { organization, members };
  });

  res.json(result);
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
    return deleted.length > 0;
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
      .select({ id: users.id, role: users.role, organizationId: users.organizationId })
      .from(users)
      .where(eq(users.id, parsed.data.userId));

    if (!target) return { status: 404 as const };

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
        .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)));

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

    const outcome = await withTenantTransaction(async (tx) => {
      const [target] = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)));

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

      await tx.delete(users).where(and(eq(users.id, userId), eq(users.organizationId, organizationId)));
      return { status: 204 as const };
    });

    if (outcome.status === 404) return res.status(404).json({ error: "Member not found" });
    if (outcome.status === 409) {
      return res.status(409).json({ error: "An organization must keep at least one owner" });
    }
    res.status(204).end();
  },
);

export default router;
