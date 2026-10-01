import { Router, type Response } from "express";
import os from "os";
import fs from "fs";
import multer from "multer";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { desc, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, browserGrids, environments, mobileTestRuns, mobileTests } from "@shared/schema";
import { MOBILE_GRID_PROVIDERS, mobileStepSchema, mobileTestSchema } from "@shared/mobile";
import { requireRole } from "../middleware/require-role";
import { getTenantOrgId, withTenantTransaction, type TenantTx } from "../middleware/tenancy";
import { auditActor, recordAudit } from "../audit";
import { toGridConfig } from "../browser-grids";
import { executeMobileRun, uploadApp, type RunDeps } from "../mobile-runner";
import { InspectorError, closeInspector, inspectorAct, inspectorSnapshot, openInspector } from "../mobile-inspector";
import { tagsOfTests } from "../test-tags";
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
      const tagged = await tagsOfTests(tx, { mobileTestIds: all.map((test) => test.id) });
      return all.map((test) => ({ ...test, tags: tagged.mobile.get(test.id) ?? [], lastRun: byTest.get(test.id) ?? null }));
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

/** A grid of the organization (RLS) that runs apps: BrowserStack or LambdaTest. */
async function mobileGrid(tx: TenantTx, gridId: string) {
  const [grid] = await tx.select().from(browserGrids).where(eq(browserGrids.id, gridId)).limit(1);
  if (!grid) throw new MobileError(404, "Grid not found.");
  if (!(MOBILE_GRID_PROVIDERS as readonly string[]).includes(grid.provider)) {
    throw new MobileError(400, `"${grid.name}" is a Playwright server, which runs browsers only. Choose a BrowserStack or LambdaTest grid.`);
  }
  return grid;
}

router.post("/api/mobile-tests", requireRole("editor"), async (req, res) => {
  const parsed = mobileTestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid mobile test", details: parsed.error.flatten() });
  try {
    const created = await withTenantTransaction(async (tx) => {
      if (parsed.data.gridId) await mobileGrid(tx, parsed.data.gridId);
      const [row] = await tx
        .insert(mobileTests)
        .values({ ...parsed.data, osVersion: parsed.data.osVersion || null, gridId: parsed.data.gridId || null, organizationId: getTenantOrgId()!, createdBy: req.user!.id })
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
      if (parsed.data.gridId) await mobileGrid(tx, parsed.data.gridId);
      const [row] = await tx
        .update(mobileTests)
        .set({ ...parsed.data, osVersion: parsed.data.osVersion || null, gridId: parsed.data.gridId || null, updatedAt: new Date() })
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
      const grid = await mobileGrid(tx, parsed.data.gridId);
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
      // Not the grid's fault, as a 502 would say: these have no storage for apps.
      if (grid.provider === "local_appium") {
        throw new MobileError(400, `"${grid.name}" is a local Appium: put the app on the agent's machine and give its path, or an http(s):// address Appium can download it from.`);
      }
      if (grid.provider === "playwright_server") {
        throw new MobileError(400, `"${grid.name}" is a Playwright server: apps are uploaded to BrowserStack or LambdaTest.`);
      }
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

// ─── The inspector (server/mobile-inspector.ts) ──────────────────────────────

const inspectSchema = mobileTestSchema
  .innerType()
  .pick({ platform: true, app: true, deviceName: true, osVersion: true })
  .extend({ gridId: z.string().min(1, "Choose the grid the device comes from.") });

const inspectActionSchema = z.union([
  z.object({ kind: z.literal("step"), step: mobileStepSchema }),
  z.object({ kind: z.literal("tapAt"), x: z.number().finite().min(0), y: z.number().finite().min(0) }),
]);

const ownerOf = (req: any) => ({ organizationId: getTenantOrgId()!, userId: req.user!.id as number });

function failInspector(res: Response, error: unknown, what: string) {
  if (error instanceof InspectorError) return res.status(error.status).json({ error: error.message });
  return fail(res, error, what);
}

/**
 * POST /api/mobile-inspector — { gridId, platform, app, deviceName, osVersion? }: opens a device with
 * the app and answers its first screen. Takes as long as the grid takes to find the device.
 */
router.post("/api/mobile-inspector", requireRole("editor"), async (req, res) => {
  const parsed = inspectSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid inspector request" });
  try {
    const grid = await withTenantTransaction(async (tx) => {
      const row = await mobileGrid(tx, parsed.data.gridId);
      await recordAudit(tx, {
        action: AUDIT_ACTIONS.MOBILE_INSPECTOR_OPENED,
        actor: auditActor(req),
        targetType: "browser_grid",
        targetId: row.id,
        metadata: { grid: row.name, device: parsed.data.deviceName, platform: parsed.data.platform },
      });
      return toGridConfig(row);
    });
    const snapshot = await openInspector(ownerOf(req), grid, { ...parsed.data, osVersion: parsed.data.osVersion || null, name: "Inspector" });
    res.status(201).json(snapshot);
  } catch (error) {
    failInspector(res, error, "open the inspector");
  }
});

router.get("/api/mobile-inspector/:id", requireRole("editor"), async (req, res) => {
  try {
    res.json(await inspectorSnapshot(req.params.id, ownerOf(req)));
  } catch (error) {
    failInspector(res, error, "read the device's screen");
  }
});

/** POST /api/mobile-inspector/:id/actions — a step, or { kind: 'tapAt', x, y }; answers the screen after it. */
router.post("/api/mobile-inspector/:id/actions", requireRole("editor"), async (req, res) => {
  const parsed = inspectActionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid action" });
  try {
    res.json(await inspectorAct(req.params.id, ownerOf(req), parsed.data));
  } catch (error) {
    failInspector(res, error, "act on the device");
  }
});

router.delete("/api/mobile-inspector/:id", requireRole("editor"), async (req, res) => {
  try {
    await closeInspector(req.params.id, ownerOf(req));
    res.status(204).end();
  } catch (error) {
    failInspector(res, error, "close the inspector");
  }
});

export default router;
