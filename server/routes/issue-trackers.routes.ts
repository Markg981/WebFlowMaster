import { Router } from "express";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from 'uuid';
import { ISSUE_PROVIDERS, issueTrackers } from "@shared/schema";
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
import { encryptSecret } from "../crypto";
import { checkConnection } from "../issue-providers";
import { toConfig } from "../issue-store";
import loggerPromise from "../logger";

/**
 * Where an organization files its bugs.
 *
 * The token is a credential for a system this one does not own, so it is encrypted exactly as
 * an environment's secrets are and never travels back to a client: every answer here describes
 * the tracker and who it authenticates as, and none of them contains the token. A field that
 * returns a secret "just for editing" is how a secret ends up in a browser's memory, in a
 * bug report, and in a screenshot.
 */

const router = Router();
const logger = await loggerPromise;

const trackerSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(80),
  provider: z.enum(ISSUE_PROVIDERS),
  baseUrl: z.string().trim().url("The base URL must be a full URL, e.g. https://acme.atlassian.net"),
  projectKey: z.string().trim().min(1, "A project is required").max(100),
  issueType: z.string().trim().min(1).max(60).default('Bug'),
  userEmail: z.string().trim().email().optional().nullable(),
  token: z.string().trim().min(1, "A token is required").max(500),
});

/** Everything but the token, which is why it is written out rather than spread. */
function toListed(row: typeof issueTrackers.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.baseUrl,
    projectKey: row.projectKey,
    issueType: row.issueType,
    // Who the token belongs to, for Jira. Not the token, and not a masked version of it: a
    // mask is still a leak of length and shape, and nothing here needs either.
    authenticatesAs: row.userEmail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(error: any): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('unique') || error?.code === '23505';
}

// GET /api/issue-trackers
router.get("/api/issue-trackers", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  try {
    const rows = await withTenantTransaction((tx) =>
      tx.select().from(issueTrackers).orderBy(asc(issueTrackers.name)),
    );
    res.json(rows.map(toListed));
  } catch (error: any) {
    logger.error({ message: 'Failed to list issue trackers', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to load the issue trackers." });
  }
});

// POST /api/issue-trackers
router.post("/api/issue-trackers", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: "Unauthorized" });

  const parsed = trackerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }
  if (parsed.data.provider === 'jira' && !parsed.data.userEmail) {
    // Jira pairs an API token with an account. Storing one without the other produces a
    // tracker that authenticates as nobody and fails on the first run that needs it.
    return res.status(400).json({ error: "Jira needs the email address the API token belongs to." });
  }

  try {
    const encrypted = encryptSecret(parsed.data.token);
    const created = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .insert(issueTrackers)
        .values({
          id: uuidv4(),
          organizationId: req.user!.organizationId,
          name: parsed.data.name,
          provider: parsed.data.provider,
          baseUrl: parsed.data.baseUrl,
          projectKey: parsed.data.projectKey,
          issueType: parsed.data.issueType,
          userEmail: parsed.data.userEmail ?? null,
          encryptedToken: encrypted.encryptedValue,
          tokenIv: encrypted.iv,
          tokenAuthTag: encrypted.authTag,
          createdBy: req.user!.id,
        })
        .returning();
      return row;
    });

    res.status(201).json(toListed(created));
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: `This organization already has a tracker called "${parsed.data.name}".` });
    }
    logger.error({ message: 'Failed to create issue tracker', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to save the tracker." });
  }
});

// PUT /api/issue-trackers/:id — the token is replaced only when a new one is given.
router.put("/api/issue-trackers/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const parsed = trackerSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  const changes: Record<string, unknown> = { updatedAt: new Date() };
  for (const field of ['name', 'provider', 'baseUrl', 'projectKey', 'issueType'] as const) {
    if (parsed.data[field] !== undefined) changes[field] = parsed.data[field];
  }
  if (parsed.data.userEmail !== undefined) changes.userEmail = parsed.data.userEmail ?? null;
  if (parsed.data.token) {
    // Absent means "leave it alone", which is what an edit form that cannot show the current
    // token has to mean. An empty string would be a token nobody can authenticate with.
    const encrypted = encryptSecret(parsed.data.token);
    changes.encryptedToken = encrypted.encryptedValue;
    changes.tokenIv = encrypted.iv;
    changes.tokenAuthTag = encrypted.authTag;
  }

  try {
    const updated = await withTenantTransaction((tx) =>
      tx.update(issueTrackers).set(changes).where(eq(issueTrackers.id, req.params.id)).returning(),
    );
    if (updated.length === 0) return res.status(404).json({ error: "Tracker not found." });
    res.json(toListed(updated[0]));
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: "Another tracker already has that name." });
    }
    logger.error({ message: 'Failed to update issue tracker', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to update the tracker." });
  }
});

/**
 * POST /api/issue-trackers/:id/test — can it reach that project with those credentials?
 *
 * A read, never a write: the alternative ways to find out are creating a throwaway issue in
 * somebody's board, or discovering it from a failed run at two in the morning.
 */
router.post("/api/issue-trackers/:id/test", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [tracker] = await withTenantTransaction((tx) =>
      tx.select().from(issueTrackers).where(eq(issueTrackers.id, req.params.id)).limit(1),
    );
    if (!tracker) return res.status(404).json({ error: "Tracker not found." });

    const result = await checkConnection(toConfig(tracker));
    res.json(result);
  } catch (error: any) {
    logger.error({ message: 'Issue tracker check failed', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Could not check the tracker." });
  }
});

/**
 * DELETE /api/issue-trackers/:id — and the links to the issues it filed go with it.
 *
 * The issues themselves stay where they are: they belong to the tracker's project and to the
 * people working on them, and deleting a configuration here is not a statement about them.
 * What is lost is the knowledge that they were filed, which is why the answer says how many.
 */
router.delete("/api/issue-trackers/:id", requireRole('editor'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  try {
    const outcome = await withTenantTransaction(async (tx) => {
      const deleted = await tx.delete(issueTrackers).where(eq(issueTrackers.id, req.params.id)).returning();
      return deleted.length;
    });
    if (outcome === 0) return res.status(404).json({ error: "Tracker not found." });
    res.status(204).end();
  } catch (error: any) {
    logger.error({ message: 'Failed to delete issue tracker', error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to delete the tracker." });
  }
});

export default router;
