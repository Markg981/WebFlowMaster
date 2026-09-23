import { Router } from "express";
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { apiKeys, users, AUDIT_ACTIONS } from "@shared/schema";
import { storage } from "../storage";
import { withTenantTransaction, getTenantOrgId } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { recordAudit } from "../audit";
import loggerPromise from "../logger";

/**
 * Accounts that are not people, for keys that must outlive whoever made them.
 *
 * A key acts as an account. When that account was a person, the pipeline broke the day they
 * left — or kept their access alive so it would not. A service account has a name, a role (never
 * owner), no password anyone knows and no sign-in; it holds keys, and an owner can disable it,
 * which revokes them all.
 *
 * Owners only, reads included: which machines can act in the organization, and as what, is the
 * same kind of question as who the members are.
 *
 * users has no RLS (it holds the organization pointer itself), so every query here names the
 * organization explicitly.
 */

const router = Router();
const logger = await loggerPromise;

const createSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(80),
  // Never owner: an account no person answers for must not be able to change who else is one.
  role: z.enum(["viewer", "editor"]),
});

router.get("/api/service-accounts", requireRole("owner"), async (_req, res) => {
  const organizationId = getTenantOrgId()!;
  const accounts = await withTenantTransaction((tx) =>
    tx
      .select({ id: users.id, name: users.displayName, role: users.role, createdAt: users.createdAt, disabledAt: users.disabledAt })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.kind, "service")))
      .orderBy(asc(users.displayName)),
  );
  res.json(accounts);
});

router.post("/api/service-accounts", requireRole("owner"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  const account = await storage.createServiceAccount({
    // From the request's tenant, never from the body.
    organizationId: getTenantOrgId()!,
    displayName: parsed.data.name,
    role: parsed.data.role,
    actor: { id: req.user!.id, username: req.user!.username },
  });
  logger.info({ message: "Service account created", serviceAccountId: account.id, by: req.user!.id });
  res.status(201).json({ id: account.id, name: account.displayName, role: account.role, createdAt: account.createdAt, disabledAt: null });
});

/**
 * Disables the account and revokes its keys, in one transaction.
 *
 * Not a delete: the runs it started name it, and "started by a service account that no longer
 * exists" is a worse answer than "started by GitHub Actions (disabled)". Disabling twice is a
 * 404, like revoking a key twice — there is nothing left to disable.
 */
router.delete("/api/service-accounts/:id", requireRole("owner"), async (req, res) => {
  const organizationId = getTenantOrgId()!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid service account id" });

  const outcome = await withTenantTransaction(async (tx) => {
    const now = new Date();
    const [disabled] = await tx
      .update(users)
      .set({ disabledAt: now })
      .where(and(
        eq(users.id, id),
        eq(users.organizationId, organizationId),
        eq(users.kind, "service"),
        isNull(users.disabledAt),
      ))
      .returning();
    if (!disabled) return null;

    // api_keys is under RLS, so this reaches only this organization's keys anyway.
    const revoked = await tx
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(and(eq(apiKeys.userId, id), isNull(apiKeys.revokedAt)))
      .returning();

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.SERVICE_ACCOUNT_DISABLED,
      actor: req.user!,
      targetType: "user",
      targetId: id,
      metadata: { name: disabled.displayName, revokedKeys: revoked.map((k) => k.prefix) },
    });
    return { id: disabled.id, name: disabled.displayName, role: disabled.role, createdAt: disabled.createdAt, disabledAt: disabled.disabledAt, revokedKeys: revoked.length };
  });

  if (!outcome) return res.status(404).json({ error: "Service account not found." });
  res.json(outcome);
});

export default router;
