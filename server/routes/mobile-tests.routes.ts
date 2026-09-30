import { Router, type Response } from "express";
import os from "os";
import fs from "fs";
import multer from "multer";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { desc, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, browserGrids, environments, mobileTestRuns, mobileTests } from "@shared/schema";
import { MOBILE_GRID_PROVIDERS, mobileTestSchema } from "@shared/mobile";
import { requireRole } from "../middleware/require-role";
import { getTenantOrgId, withTenantTransaction } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { toGridConfig } from "../browser-grids";
import { executeMobileRun, uploadApp, type RunDeps } from "../mobile-runner";
import loggerPromise from "../logger";

/**
 * Tests of native mobile apps: writing them, running one on a grid's device, and uploading the
 * app it runs (shared/mobile.ts, server/mobile-runner.ts).
 *
 * A run takes minutes — the grid finds a device and installs the app — so it is started here and
 * followed from the page, which reads its steps as they are written.
 */

const router = Router();
const logger = await loggerPromise;

/** What runs the runs. A field so the tests can hand the runner a stand-in grid. */
export const mobileRunner: { deps: RunDeps; start: (runId: string, organizationId: number, userId: number) => Promise<void> } = {
  deps: {},
  start: (runId, organizationId, userId) => executeMobileRun(runId, organizationId, userId, mobileRunner.deps),
};

class MobileError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof MobileError) return res.status(error.status).json({ error: error.message });
  const message = (error as Error)?.message ?? "";
  if (/unique|duplicate/i.test(message)) return res.status(409).json({ error: "A mobile test with this name already exists." });
  logger.error({ message: `Failed to ${what}`, error: message });
  return res.status(500).json({ error: `Failed to ${what}.` });
}

const idOf = (raw: string) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new MobileError(400, "Invalid mobile test id.");
  return id;
};

/** A run as the page follows it; the screenshot only when asked for one run. */
const runColumns = {
  id: mobileTestRuns.id,
  mobileTestId: mobileTestRuns.mobileTestId,
  gridId: mobileTestRuns.gridId,
  environmentId: mobileTestRuns.environmentId,
  status: mobileTestRuns.status,
  device: mobileTestRuns.device,
  steps: mobileTestRuns.steps,
  error: mobileTestRuns.error,
  sessionUrl: mobileTestRuns.sessionUrl,
  startedAt: mobileTestRuns.startedAt,
  finishedAt: mobileTestRuns.finishedAt,
  createdAt: mobileTestRuns.createdAt,
};

router.get("/api/mobile-tests", requireRole("viewer"), async (_req, res) => {
  try {
    const rows = await withTenantTransaction(async (tx) => {
      const all = await tx.select().from(mobileTests).orderBy(mobileTests.name);
      // The latest run of each, for the list's status column.
      const latest = await tx
        .selectDistinctOn([mobileTestRuns.mobileTestId], { mobileTestId: mobileTestRuns.mobileTestId, status: mobileTestRuns.status, createdAt: mobileTestRuns.createdAt })
        .from(mobileTestRuns)
        .orderBy(mobileTestRuns.mobileTestId, desc(mobileTestRuns.createdAt));
      const byTest = new Map(latest.map((r) => [r.mobileTestId, r]));
      return all.map((test) => ({ ...test, lastRun: byTest.get(test.id) ?? null }));
    });
    res.json(rows);
  } catch (error) {
    fail(res, error, "load the mobile tests");
  }
});

router.get("/api/mobile-tests/:id", requireRole("viewer"), async (req, res) => {
  try {
    const id = idOf(req.params.id);
    const found = await withTenantTransaction(async (tx) => {
      const [test] = await tx.select().from(mobileTests).where(eq(mobileTests.id, id)).limit(1);
      if (!test) return null;
      const runs = await tx.select(runColumns).from(mobileTestRuns).where(eq(mobileTestRuns.mobileTestId, id)).orderBy(desc(mobileTestRuns.createdAt)).limit(10);
      return { ...test, runs };
    });
    if (!found) return res.status(404).json({ error: "Mobile test not found." });
    res.json(found);
  } catch (error) {
    fail(res, error, "load the mobile test");
  }
});

router.post("/api/mobile-tests", requireRole("editor"), async (req, res) => {
  const parsed = mobileTestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid mobile test", details: parsed.error.flatten() });
  try {
    const created = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .insert(mobileTests)
        .values({ ...parsed.data, osVersion: parsed.data.osVersion || null, organizationId: getTenantOrgId()!, createdBy: req.user!.id })
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.MOBILE_TEST_CREATED,
        actor: auditActor(req),
        targetType: "mobile_test",
        targetId: row.id,
        metadata: { name: row.name, platform: row.platform },
      });
      return row;
    });
    res.status(201).json(created);
  } catch (error) {
    fail(res, error, "create the mobile test");
  }
});

router.put("/api/mobile-tests/:id", requireRole("editor"), async (req, res) => {
  const parsed = mobileTestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid mobile test", details: parsed.error.flatten() });
  try {
    const id = idOf(req.params.id);
    const updated = await withTenantTransaction(async (tx) => {
      const [row] = await tx
        .update(mobileTests)
        .set({ ...parsed.data, osVersion: parsed.data.osVersion || null, updatedAt: new Date() })
        .where(eq(mobileTests.id, id))
        .returning();
      if (!row) throw new MobileError(404, "Mobile test not found.");
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.MOBILE_TEST_UPDATED,
        actor: auditActor(req),
        targetType: "mobile_test",
        targetId: id,
        metadata: { name: row.name, steps: row.steps.length },
      });
      return row;
    });
    res.json(updated);
  } catch (error) {
    fail(res, error, "update the mobile test");
  }
});

router.delete("/api/mobile-tests/:id", requireRole("editor"), async (req, res) => {
  try {
    const id = idOf(req.params.id);
    await withTenantTransaction(async (tx) => {
      const [row] = await tx.delete(mobileTests).where(eq(mobileTests.id, id)).returning();
      if (!row) throw new MobileError(404, "Mobile test not found.");
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.MOBILE_TEST_DELETED,
        actor: auditActor(req),
        targetType: "mobile_test",
        targetId: id,
        metadata: { name: row.name },
      });
    });
    res.status(204).end();
  } catch (error) {
    fail(res, error, "delete the mobile test");
  }
});

const runSchema = z.object({
  gridId: z.string().min(1, "Choose the grid the device comes from."),
  environmentId: z.number().int().positive().optional().nullable(),
});

/** POST /api/mobile-tests/:id/runs — { gridId, environmentId? }: starts a run; the page follows it. */
router.post("/api/mobile-tests/:id/runs", requireRole("editor"), async (req, res) => {
  const parsed = runSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid run" });
  try {
    const id = idOf(req.params.id);
    const organizationId = getTenantOrgId()!;
    const run = await withTenantTransaction(async (tx) => {
      const [test] = await tx.select().from(mobileTests).where(eq(mobileTests.id, id)).limit(1);
      if (!test) throw new MobileError(404, "Mobile test not found.");
      if (test.steps.length === 0) throw new MobileError(400, "The test has no steps to run.");
      const [grid] = await tx.select().from(browserGrids).where(eq(browserGrids.id, parsed.data.gridId)).limit(1);
      if (!grid) throw new MobileError(404, "Grid not found.");
      if (!(MOBILE_GRID_PROVIDERS as readonly string[]).includes(grid.provider)) {
        throw new MobileError(400, `"${grid.name}" is a Playwright server, which runs browsers only. Choose a BrowserStack or LambdaTest grid.`);
      }
      if (parsed.data.environmentId) {
        const [environment] = await tx.select({ id: environments.id }).from(environments).where(eq(environments.id, parsed.data.environmentId)).limit(1);
        if (!environment) throw new MobileError(404, "Environment not found.");
      }
      const [row] = await tx
        .insert(mobileTestRuns)
        .values({
          id: uuidv4(),
          organizationId,
          mobileTestId: id,
          gridId: grid.id,
          environmentId: parsed.data.environmentId ?? null,
          status: "queued",
          device: [test.deviceName, test.osVersion].filter(Boolean).join(" · "),
          requestedBy: req.user!.id,
        })
        .returning();
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.MOBILE_TEST_RUN,
        actor: auditActor(req),
        targetType: "mobile_test",
        targetId: id,
        metadata: { name: test.name, grid: grid.name, device: row.device, runId: row.id },
      });
      const { screenshot: _screenshot, organizationId: _org, requestedBy: _by, ...shown } = row;
      return shown;
    });
    // Not awaited: the page follows the run. Whatever goes wrong is written on the run itself.
    void mobileRunner.start(run.id, organizationId, req.user!.id).catch((error) => logger.error({ message: "Mobile run crashed", runId: run.id, error: String(error?.message ?? error) }));
    res.status(202).json(run);
  } catch (error) {
    fail(res, error, "start the run");
  }
});

router.get("/api/mobile-test-runs/:runId", requireRole("viewer"), async (req, res) => {
  try {
    const [run] = await withTenantTransaction((tx) => tx.select().from(mobileTestRuns).where(eq(mobileTestRuns.id, req.params.runId)).limit(1));
    if (!run) return res.status(404).json({ error: "Run not found." });
    res.json(run);
  } catch (error) {
    fail(res, error, "load the run");
  }
});

const MAX_APP_BYTES = 1024 * 1024 * 1024;
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: MAX_APP_BYTES, files: 1 } });

/**
 * POST /api/browser-grids/:id/apps — multipart "file" (.apk, .aab or .ipa): stores the app on the
 * grid and answers its address there, for a mobile test's app. The file is not kept here.
 */
router.post("/api/browser-grids/:id/apps", requireRole("editor"), (req, res) => {
  upload.single("file")(req, res, async (uploadError: any) => {
    const file = req.file;
    const cleanup = () => file && fs.promises.unlink(file.path).catch(() => undefined);
    try {
      if (uploadError) {
        throw new MobileError(uploadError?.code === "LIMIT_FILE_SIZE" ? 413 : 400, uploadError?.code === "LIMIT_FILE_SIZE" ? "An app is at most 1 GB." : "The upload failed.");
      }
      if (!file) throw new MobileError(400, "Choose the app file: .apk, .aab or .ipa.");
      if (!/\.(apk|aab|ipa)$/i.test(file.originalname)) throw new MobileError(400, "An app is an .apk, .aab or .ipa file.");
      const [grid] = await withTenantTransaction((tx) => tx.select().from(browserGrids).where(eq(browserGrids.id, req.params.id)).limit(1));
      if (!grid) throw new MobileError(404, "Grid not found.");
      let app: string;
      try {
        app = await uploadApp(toGridConfig(grid), file.path, file.originalname);
      } catch (error: any) {
        throw new MobileError(502, String(error?.message ?? error));
      }
      await withTenantTransaction((tx) =>
        recordAudit(tx, {
          action: AUDIT_ACTIONS.MOBILE_APP_UPLOADED,
          actor: auditActor(req),
          targetType: "browser_grid",
          targetId: grid.id,
          metadata: { grid: grid.name, file: file.originalname, bytes: file.size, app },
        }),
      );
      res.status(201).json({ app });
    } catch (error) {
      fail(res, error, "upload the app");
    } finally {
      await cleanup();
    }
  });
});

export default router;
