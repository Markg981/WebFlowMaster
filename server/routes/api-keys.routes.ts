import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { v4 as uuidv4 } from 'uuid';
import { apiKeys, AUDIT_ACTIONS } from "@shared/schema";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { recordAudit } from "../audit";
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
  };
}

// GET /api/api-keys — the organization's keys, newest first.
router.get("/api/api-keys", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  // No organization predicate: RLS supplies it.
  const keys = await withTenantTransaction((tx) =>
    tx.select(listedColumns).from(apiKeys).orderBy(desc(apiKeys.createdAt)),
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
          userId: req.user!.id,
          name: parsed.data.name,
          prefix,
          hashedKey,
          expiresAt,
        })
        .returning();

      // In the same transaction as the creation it records, so the two cannot disagree.
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.API_KEY_CREATED,
        actor: { id: req.user!.id, username: req.user!.username },
        targetType: 'api_key',
        targetId: id,
        // The prefix, never the key and never its hash: this table is readable by every owner
        // and cannot be redacted afterwards.
        metadata: { name: parsed.data.name, prefix, expiresAt: expiresAt?.toISOString() ?? null },
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
        actor: { id: req.user!.id, username: req.user!.username },
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
