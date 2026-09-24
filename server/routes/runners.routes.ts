import { Router } from "express";
import { AUDIT_ACTIONS } from "@shared/schema";
import { requireRole } from "../middleware/require-role";
import { requireInstallationAdmin } from "../installation-admin";
import { withTenantTransaction } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { listRunners, setRunnerDesiredState, statusOf } from "../runner-registry";

/**
 * The runners, for whoever keeps the installation running. Owners see them; draining and resuming
 * one is for the installation's administrators (server/installation-admin.ts), because a runner
 * serves every organization and draining one is an operational decision.
 *
 * What is shown is the machine — host, version, browsers, how many jobs it has — and never whose
 * jobs they are.
 */

const router = Router();

router.get("/api/runners", requireRole("owner"), async (_req, res) => {
  res.json(await listRunners());
});

/**
 * POST /api/runners/:id/drain — finish what it has, take nothing new. The runner hears it at its
 * next heartbeat; its job count then says when it is safe to stop.
 */
router.post("/api/runners/:id/drain", requireRole("owner"), requireInstallationAdmin, async (req, res) => {
  const runner = await setRunnerDesiredState(req.params.id, "drain");
  if (!runner) return res.status(404).json({ error: "Runner not found" });
  await withTenantTransaction((tx) =>
    recordAudit(tx, {
      action: AUDIT_ACTIONS.RUNNER_DRAINED,
      actor: auditActor(req),
      targetType: 'runner',
      targetId: runner.id,
      metadata: { hostname: runner.hostname, activeJobs: runner.activeJobs },
    }),
  );
  res.json({ ...runner, status: statusOf(runner) });
});

router.post("/api/runners/:id/resume", requireRole("owner"), requireInstallationAdmin, async (req, res) => {
  const runner = await setRunnerDesiredState(req.params.id, "active");
  if (!runner) return res.status(404).json({ error: "Runner not found" });
  await withTenantTransaction((tx) =>
    recordAudit(tx, {
      action: AUDIT_ACTIONS.RUNNER_RESUMED,
      actor: auditActor(req),
      targetType: 'runner',
      targetId: runner.id,
      metadata: { hostname: runner.hostname },
    }),
  );
  res.json({ ...runner, status: statusOf(runner) });
});

export default router;
