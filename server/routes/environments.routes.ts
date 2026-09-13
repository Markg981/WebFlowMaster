import { Router } from "express";
import { environments, secrets } from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import loggerPromise from "../logger";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { encryptSecret } from "../crypto";

/**
 * Environments and their secrets.
 *
 * The Settings screen has always called these six endpoints and none of them existed
 * anywhere in server/. The tables were there, the AES-256-GCM helpers were there, and both
 * resolveVariables and loadLoginState read from them — but nothing could put a row in
 * through the application. So the card was a dead screen, every `{{secret_…}}` fell back to
 * the process defaults because an environment could not exist, and the saved-login work had
 * nowhere to attach.
 */

const router = Router();
const logger = await loggerPromise;

const environmentNameSchema = z.object({
  name: z.string().trim().min(1, "Environment name is required").max(120),
});

const secretSchema = z.object({
  // The name has to survive being written as `{{name}}`: the substitution pattern is
  // [\w.]+, so a key with a space in it would be stored and then silently never resolve.
  keyName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[\w.]+$/, "Use letters, digits, underscores and dots — no spaces"),
  value: z.string().min(1, "A secret needs a value"),
});

/** The columns that may leave the server. Never the ciphertext, the iv or the auth tag. */
const publicSecretColumns = {
  id: secrets.id,
  environmentId: secrets.environmentId,
  keyName: secrets.keyName,
  createdAt: secrets.createdAt,
  updatedAt: secrets.updatedAt,
};

function toPublicSecret(row: { id: number; environmentId: number; keyName: string; createdAt: Date; updatedAt: Date }) {
  const { id, environmentId, keyName, createdAt, updatedAt } = row;
  return { id, environmentId, keyName, createdAt, updatedAt };
}

router.get("/api/environments", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  try {
    // No organization filter: the RLS policy applies it.
    const rows = await withTenantTransaction((tx) =>
      tx
        .select({
          id: environments.id,
          name: environments.name,
          description: environments.description,
          createdAt: environments.createdAt,
          // Enough for the interface to say whether a saved login exists and how old it
          // is, without handing out the session itself.
          loginStateCapturedAt: environments.loginStateCapturedAt,
        })
        .from(environments)
        .orderBy(asc(environments.name)),
    );
    res.json(rows);
  } catch (error: any) {
    logger.error({ message: "Error fetching environments", error: error.message });
    res.status(500).json({ error: "Failed to fetch environments" });
  }
});

router.post("/api/environments", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const parsed = environmentNameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid environment", details: parsed.error.flatten() });
  }

  try {
    const created = await withTenantTransaction((tx) =>
      tx
        .insert(environments)
        .values({
          name: parsed.data.name,
          // Both derived from the session, never from the body.
          userId: req.user!.id,
          organizationId: req.user!.organizationId,
        })
        .returning(),
    );
    const { id, name, description, createdAt } = created[0];
    res.status(201).json({ id, name, description, createdAt });
  } catch (error: any) {
    // `name` is globally unique in the schema, so a clash can be another tenant's name.
    // Reporting it as a conflict is the honest answer and leaks only that the name is taken.
    if (/unique|duplicate/i.test(error.message ?? '')) {
      return res.status(409).json({ error: "An environment with that name already exists" });
    }
    logger.error({ message: "Error creating environment", error: error.message });
    res.status(500).json({ error: "Failed to create environment" });
  }
});

router.delete("/api/environments/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid environment id" });

  try {
    const deleted = await withTenantTransaction((tx) =>
      // Secrets go with it through the FK's ON DELETE CASCADE: an orphaned secret could
      // not be deleted through the interface and would still be decryptable.
      tx.delete(environments).where(eq(environments.id, id)).returning(),
    );
    // Under RLS another organization's row is simply not there, so 404 is the correct
    // answer rather than a leak.
    if (deleted.length === 0) return res.status(404).json({ error: "Environment not found" });
    res.status(204).end();
  } catch (error: any) {
    logger.error({ message: "Error deleting environment", error: error.message });
    res.status(500).json({ error: "Failed to delete environment" });
  }
});

router.get("/api/environments/:id/secrets", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  const environmentId = Number(req.params.id);
  if (!Number.isInteger(environmentId)) return res.status(400).json({ error: "Invalid environment id" });

  try {
    const rows = await withTenantTransaction((tx) =>
      tx
        .select(publicSecretColumns)
        .from(secrets)
        .where(eq(secrets.environmentId, environmentId))
        .orderBy(asc(secrets.keyName)),
    );
    res.json(rows);
  } catch (error: any) {
    logger.error({ message: "Error fetching secrets", error: error.message });
    res.status(500).json({ error: "Failed to fetch secrets" });
  }
});

router.post("/api/environments/:id/secrets", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  const environmentId = Number(req.params.id);
  if (!Number.isInteger(environmentId)) return res.status(400).json({ error: "Invalid environment id" });

  const parsed = secretSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid secret", details: parsed.error.flatten() });
  }

  try {
    const created = await withTenantTransaction(async (tx) => {
      // The environment has to exist *and* be visible under RLS. Without this the insert
      // would fail on the foreign key with a 500 for what is really a 404.
      const [environment] = await tx
        .select({ id: environments.id })
        .from(environments)
        .where(eq(environments.id, environmentId))
        .limit(1);
      if (!environment) return null;

      const { encryptedValue, iv, authTag } = encryptSecret(parsed.data.value);

      // Replace rather than accumulate: two rows with one name make `{{name}}` resolve to
      // whichever the query happens to return first, which changes for no visible reason.
      await tx
        .delete(secrets)
        .where(and(eq(secrets.environmentId, environmentId), eq(secrets.keyName, parsed.data.keyName)));

      const rows = await tx
        .insert(secrets)
        .values({
          environmentId,
          keyName: parsed.data.keyName,
          encryptedValue,
          iv,
          authTag,
          userId: req.user!.id,
          organizationId: req.user!.organizationId,
        })
        .returning();
      // Never the ciphertext, the iv or the auth tag: a response is rendered in a browser
      // and passes through proxies, and encrypting the column buys nothing if the value
      // comes back out of the API.
      return toPublicSecret(rows[0]);
    });

    if (!created) return res.status(404).json({ error: "Environment not found" });
    // Deliberately the public columns only: a response is rendered in a browser and passes
    // through proxies, and encrypting the column buys nothing if the value comes back out.
    res.status(201).json(created);
  } catch (error: any) {
    logger.error({ message: "Error saving secret", error: error.message });
    res.status(500).json({ error: "Failed to save secret" });
  }
});

router.delete("/api/secrets/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid secret id" });

  try {
    const deleted = await withTenantTransaction((tx) =>
      tx.delete(secrets).where(eq(secrets.id, id)).returning(),
    );
    if (deleted.length === 0) return res.status(404).json({ error: "Secret not found" });
    res.status(204).end();
  } catch (error: any) {
    logger.error({ message: "Error deleting secret", error: error.message });
    res.status(500).json({ error: "Failed to delete secret" });
  }
});

export default router;
