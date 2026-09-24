import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, SOURCE_HOST_PROVIDERS, sourceHosts, type SourceHost, type SourceHostProvider } from "@shared/schema";
import { requireRole } from "../middleware/require-role";
import { getTenantOrgId, withTenantTransaction } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { encryptSecret } from "../crypto";
import { checkSourceHost, DEFAULT_API_URLS, hostConfig } from "../commit-status";

/**
 * The GitHub or GitLab a run reports its commit status to (server/commit-status.ts).
 *
 * An owner's business, like agents and API keys: the token can write statuses on the organization's
 * repositories. Everyone sees whether one is connected and whether the last status got through,
 * because "why is there no WebFlowMaster check on my pull request?" is everyone's question. Nobody
 * gets the token back, not even its owner.
 */

const router = Router();

function view(row: SourceHost) {
  return {
    provider: row.provider,
    apiUrl: row.apiUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastDeliveryAt: row.lastDeliveryAt,
    lastDeliveryError: row.lastDeliveryError,
  };
}

const providerParam = z.enum(SOURCE_HOST_PROVIDERS);

const connectSchema = z.object({
  /** Blank: the public service. A GitHub Enterprise's https://host/api/v3, a GitLab's https://host/api/v4. */
  apiUrl: z
    .string()
    .trim()
    .url("The API URL must be a full URL, e.g. https://github.example.com/api/v3")
    .refine((value) => /^https?:\/\//i.test(value), "Only http and https")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  token: z.string().trim().min(1, "A token is required").max(500),
});

router.get("/api/source-hosts", requireRole("viewer"), async (_req, res) => {
  const rows = await withTenantTransaction((tx) => tx.select().from(sourceHosts).orderBy(asc(sourceHosts.provider)));
  res.json(rows.map(view));
});

/**
 * PUT /api/source-hosts/:provider — connects it, or replaces its URL and token.
 *
 * The token is checked before it is kept: a token that cannot even say whose it is would store a
 * connection that fails on every run, silently, which is the failure this feature exists to end.
 */
router.put("/api/source-hosts/:provider", requireRole("owner"), async (req, res) => {
  const provider = providerParam.safeParse(req.params.provider);
  if (!provider.success) return res.status(404).json({ error: "Unknown provider." });
  const parsed = connectSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });

  const apiUrl = (parsed.data.apiUrl ?? DEFAULT_API_URLS[provider.data]).replace(/\/+$/, "");
  const check = await checkSourceHost({ provider: provider.data, apiUrl, token: parsed.data.token });
  if (!check.ok) return res.status(400).json({ error: check.error });

  const encrypted = encryptSecret(parsed.data.token);
  const values = {
    apiUrl,
    encryptedToken: encrypted.encryptedValue,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
    updatedAt: new Date(),
    lastDeliveryAt: null,
    lastDeliveryError: null,
  };
  const row = await withTenantTransaction(async (tx) => {
    const [saved] = await tx
      .insert(sourceHosts)
      .values({ id: randomUUID(), organizationId: getTenantOrgId()!, provider: provider.data, createdBy: req.user!.id, ...values })
      .onConflictDoUpdate({ target: [sourceHosts.organizationId, sourceHosts.provider], set: values })
      .returning();
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.SOURCE_HOST_CONNECTED,
      actor: auditActor(req),
      targetType: "source_host",
      targetId: saved.id,
      // Whose token, never the token.
      metadata: { provider: provider.data, apiUrl, account: check.account },
    });
    return saved;
  });
  res.json({ ...view(row), account: check.account });
});

/** POST /api/source-hosts/:provider/test — does the stored token still work, and whose is it? */
router.post("/api/source-hosts/:provider/test", requireRole("owner"), async (req, res) => {
  const provider = providerParam.safeParse(req.params.provider);
  if (!provider.success) return res.status(404).json({ error: "Unknown provider." });
  const [row] = await withTenantTransaction((tx) =>
    tx.select().from(sourceHosts).where(eq(sourceHosts.provider, provider.data as SourceHostProvider)).limit(1),
  );
  if (!row) return res.status(404).json({ error: "Not connected." });
  res.json(await checkSourceHost(hostConfig(row)));
});

router.delete("/api/source-hosts/:provider", requireRole("owner"), async (req, res) => {
  const provider = providerParam.safeParse(req.params.provider);
  if (!provider.success) return res.status(404).json({ error: "Unknown provider." });
  const removed = await withTenantTransaction(async (tx) => {
    const [row] = await tx.delete(sourceHosts).where(eq(sourceHosts.provider, provider.data)).returning();
    if (row) {
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.SOURCE_HOST_REMOVED,
        actor: auditActor(req),
        targetType: "source_host",
        targetId: row.id,
        metadata: { provider: row.provider, apiUrl: row.apiUrl },
      });
    }
    return row;
  });
  if (!removed) return res.status(404).json({ error: "Not connected." });
  res.status(204).end();
});

export default router;
