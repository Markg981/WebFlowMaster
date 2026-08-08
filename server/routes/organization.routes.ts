import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { organizations, users } from "@shared/schema";
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

    // The target may already be the last owner of a *different* organization. Re-parenting
    // them here would strip that organization of its only owner in the same stroke — the
    // same lockout the last-owner checks below guard against, just reached from the other
    // organization's side. Counted inside the transaction for the same reason as those
    // checks: a read-then-write gap would let a concurrent second move race past it.
    if (target.role === "owner" && target.organizationId !== organizationId) {
      const [{ others }] = await tx
        .select({ others: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(
            eq(users.organizationId, target.organizationId),
            eq(users.role, "owner"),
            ne(users.id, target.id),
          ),
        );
      if (others === 0) {
        return { status: 409 as const, error: "Cannot move the last owner out of their organization" };
      }
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
