import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { v4 as uuidv4 } from 'uuid';
import { apiKeys, users, AUDIT_ACTIONS } from "@shared/schema";
import { API_SCOPE_NAMES, type ApiScope } from "@shared/api-scopes";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole, roleAllows } from "../middleware/require-role";
import { auditActor, recordAudit } from "../audit";
import { generateApiKey } from "../api-keys";
import loggerPromise from "../logger";

/**
 * Creating, listing and revoking the credentials a pipeline authenticates with.
 *
 * The secret leaves the server exactly once, in the response to the request that created it.
 * There is no endpoint that returns an existing key and there cannot be one: the row holds a
 * SHA-256, so nobody — including this application — can produce the key again. A lost key is
 * revoked and replaced, which is also the only honest thing to tell someone who lost one.
 */

const router = Router();
const logger = await loggerPromise;

const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(80),
  /** Optional lifetime. A key with no expiry is valid until somebody revokes it. */
  expiresInDays: z.number().int().min(1).max(3650).optional(),
  /**
   * What the key may do, through /api/v1 only. Left out, the key acts as its account on every
   * endpoint, as keys always have — kept for the pipelines that already use one that way.
   */
  scopes: z.array(z.enum(API_SCOPE_NAMES as [ApiScope, ...ApiScope[]])).min(1).optional(),
  /** Issue the key to a service account instead of to the caller. Owners only. */
  serviceAccountId: z.number().int().positive().optional(),
});

/** What a listing shows. Deliberately never `hashedKey`: a hash is still a secret's shadow. */
const listedColumns = {
  id: apiKeys.id,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  createdAt: apiKeys.createdAt,
  lastUsedAt: apiKeys.lastUsedAt,
  expiresAt: apiKeys.expiresAt,
  revokedAt: apiKeys.revokedAt,
  userId: apiKeys.userId,
  scopes: apiKeys.scopes,
};

/**
 * The same narrowing for a row that came back from a write.
 *
 * `returning()` hands back the whole row, `hashed_key` included, and a handler that passes
 * one of those to `res.json` publishes it. Written out rather than deleting the field from a
 * copy, so a column added later is absent by default instead of leaking by default.
 */
function toListed(row: typeof apiKeys.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    userId: row.userId,
    scopes: row.scopes,
  };
}

// GET /api/api-keys — the organization's keys, newest first.
router.get("/api/api-keys", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  // No organization predicate: RLS supplies it.
  // Who holds each key, so a key held by a service account reads as one. users has no RLS,
  // but the join goes through api_keys, which does.
  const keys = await withTenantTransaction((tx) =>
    tx
      .select({ ...listedColumns, holder: { username: users.username, kind: users.kind, displayName: users.displayName } })
      .from(apiKeys)
      .leftJoin(users, eq(apiKeys.userId, users.id))
      .orderBy(desc(apiKeys.createdAt)),
  );
  res.json(keys);
});

// POST /api/api-keys — mint one, and show it once.
router.post("/api/api-keys", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const parsed = createApiKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  // Whose key it is. The caller's own, unless it is for a service account — which only an owner
  // may issue, since the account's role, not the caller's, is what the key will carry.
  let holderId = req.user.id;
  if (parsed.data.serviceAccountId !== undefined) {
    if (!roleAllows(req.user.role, 'owner')) {
      return res.status(403).json({ error: "Only an owner can issue keys to a service account." });
    }
    const [account] = await withTenantTransaction((tx) =>
      tx
        .select({ id: users.id, kind: users.kind, disabledAt: users.disabledAt })
        .from(users)
        .where(and(eq(users.id, parsed.data.serviceAccountId!), eq(users.organizationId, req.user!.organizationId)))
        .limit(1),
    );
    if (!account || account.kind !== 'service' || account.disabledAt) {
      return res.status(404).json({ error: "Service account not found." });
    }
    holderId = account.id;
  }

  const { key, hashedKey, prefix } = generateApiKey();
  const id = uuidv4();
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  try {
    const created = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .insert(apiKeys)
        .values({
          id,
          // Stamped from the session, never from the body: a key that could name its own
          // organization would be a way to issue credentials into somebody else's.
          organizationId: req.user!.organizationId,
          userId: holderId,
          name: parsed.data.name,
          scopes: parsed.data.scopes ?? null,
          prefix,
          hashedKey,
          expiresAt,
        })
        .returning();

      // In the same transaction as the creation it records, so the two cannot disagree.
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.API_KEY_CREATED,
        actor: auditActor(req),
        targetType: 'api_key',
        targetId: id,
        // The prefix, never the key and never its hash: this table is readable by every owner
        // and cannot be redacted afterwards.
        metadata: {
          name: parsed.data.name,
          prefix,
          expiresAt: expiresAt?.toISOString() ?? null,
          scopes: parsed.data.scopes ?? null,
          ...(holderId !== req.user!.id ? { serviceAccountId: holderId } : {}),
        },
      });

      return toListed(row);
    });

    logger.info({ message: 'API key created', apiKeyId: id, userId: req.user.id });
    // `key` appears here and nowhere else, ever.
    res.status(201).json({ ...created, key });
  } catch (error: any) {
    logger.error({ message: 'Failed to create API key', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to create the API key." });
  }
});

// DELETE /api/api-keys/:id — revoke it. The row stays; the key stops working.
router.delete("/api/api-keys/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  try {
    const revoked = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        // Only a key that is still live: revoking twice would otherwise move the timestamp
        // and rewrite when it actually stopped working.
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
        .returning();
      if (!row) return null;

      await recordAudit(tx, {
        action: AUDIT_ACTIONS.API_KEY_REVOKED,
        actor: auditActor(req),
        targetType: 'api_key',
        targetId: id,
        metadata: { name: row.name, prefix: row.prefix },
      });
      return toListed(row);
    });

    // Another organization's key is not there at all under RLS, and an already-revoked one is
    // indistinguishable from it here — which is the right answer to both.
    if (!revoked) return res.status(404).json({ error: "API key not found." });
    res.json(revoked);
  } catch (error: any) {
    logger.error({ message: 'Failed to revoke API key', error: error?.message ?? String(error), apiKeyId: id });
    res.status(500).json({ error: "Failed to revoke the API key." });
  }
});

export default router;
