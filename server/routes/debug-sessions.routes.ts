import { Router } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { AdhocDetectedElementSchema, AdhocTestStepSchema, PreconditionSchema } from "@shared/schema";
import { DEBUG_COMMANDS, allowedCommands, type DebugState } from "@shared/debug-session";
import { requireRole } from "../middleware/require-role";
import { withTenantTransaction } from "../middleware/tenancy";
import { SharedDataError, expandSharedDataset } from "../test-data";
import { sharedSetIdOf } from "@shared/test-data";
import { browserTasks, BrowserTaskError } from "../browser-tasks";
import { debugChannel } from "../debug-session";
import loggerPromise from "../logger";
import { quotaErrorBody } from '../tenant-quotas';

/**
 * Debug sessions from the builder (shared/debug-session.ts).
 *
 * Starting one hands the run to wherever browsers run and answers at once; the builder then reads
 * the session's state and sends it commands. A session belongs to the person who started it — to
 * anyone else, in their organization or not, it does not exist — and a person has one at a time:
 * starting another stops the first, whose browser would otherwise wait out its idle time.
 */

const router = Router();
const logger = await loggerPromise;

const startSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  sequence: z.array(AdhocTestStepSchema).min(1),
  elements: z.array(AdhocDetectedElementSchema).optional().default([]),
  preconditions: z.array(PreconditionSchema).optional().nullable(),
  environmentId: z.number().int().positive().optional().nullable(),
  dataset: z.array(z.record(z.string())).optional().nullable(),
  /** Ids of the steps to stop before. */
  breakpoints: z.array(z.string().max(200)).max(1000).optional().default([]),
  /** Which row of the dataset to debug with, counted from 0. */
  datasetRow: z.number().int().min(0).optional(),
});

const commandSchema = z.object({
  type: z.enum(DEBUG_COMMANDS),
  patch: z.object({ selector: z.string().max(2000).optional(), value: z.string().max(10_000).optional() }).optional(),
  breakpoints: z.array(z.string().max(200)).max(1000).optional(),
});

const channel = debugChannel;

/** The session, when it is the caller's. */
async function ownSession(req: any, id: string): Promise<DebugState | null> {
  const ch = await channel();
  const meta = await ch.meta(id);
  if (!meta || meta.userId !== req.user?.id || meta.organizationId !== req.user?.organizationId) return null;
  return ch.read(id);
}

const initialState = (id: string, breakpoints: string[]): DebugState => ({
  id,
  status: "starting",
  paused: null,
  steps: [],
  variables: [],
  breakpoints,
  outcome: null,
  updatedAt: new Date().toISOString(),
});

router.post("/api/debug-sessions", requireRole("editor"), async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  const user = req.user as any;
  const { breakpoints, datasetRow, ...given } = parsed.data;
  // A shared data set's rows, in place of the marker the test keeps (shared/test-data.ts).
  let payload: typeof given = given;
  try {
    if (sharedSetIdOf(given.dataset) !== null) payload = await withTenantTransaction((tx) => expandSharedDataset(tx, given));
  } catch (error) {
    if (error instanceof SharedDataError) return res.status(400).json({ error: error.message });
    throw error;
  }
  if (datasetRow !== undefined && datasetRow >= (payload.dataset?.length ?? 0)) {
    return res.status(400).json({ error: `The dataset has ${payload.dataset?.length ?? 0} row(s); row ${datasetRow + 1} does not exist.` });
  }
  const id = uuidv4();

  try {
    const ch = await channel();
    const previous = await ch.activeFor(user.id);
    if (previous) await ch.send(previous, { type: "stop" });

    await ch.open(id, { userId: user.id, organizationId: user.organizationId, createdAt: new Date().toISOString() });
    await ch.publish(id, initialState(id, breakpoints));
    await ch.setActive(user.id, id);
    await browserTasks.start({
      task: { kind: "debug-sequence", sessionId: id, breakpoints, datasetRow, payload: payload as any },
      userId: user.id,
      organizationId: user.organizationId,
    });
    res.status(201).json({ id, state: await ch.read(id) });
  } catch (error: any) {
    // Admission can fail after channel initialization; do not leave a phantom active debug.
    const ch = await channel();
    if (await ch.meta(id)) {
      await ch.publish(id, { ...initialState(id, breakpoints), status: 'finished', outcome: { success: false, error: error?.message ?? String(error), skipped: 0 } });
      if (await ch.activeFor(user.id) === id) await ch.setActive(user.id, null);
    }
    if (error instanceof BrowserTaskError) return res.status(error.status).json({ error: error.message, code: error.code });
    const quota = quotaErrorBody(error);
    if (quota) return res.status(429).json(quota);
    logger.error({ message: "Failed to start a debug session", error: error?.message ?? String(error) });
    res.status(500).json({ error: "Failed to start the debug session." });
  }
});

router.get("/api/debug-sessions/:id", requireRole("editor"), async (req, res) => {
  const state = await ownSession(req, req.params.id);
  if (!state) return res.status(404).json({ error: "Debug session not found." });
  res.json(state);
});

router.post("/api/debug-sessions/:id/commands", requireRole("editor"), async (req, res) => {
  const parsed = commandSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  const state = await ownSession(req, req.params.id);
  if (!state) return res.status(404).json({ error: "Debug session not found." });

  const allowed = allowedCommands(state);
  if (!allowed.includes(parsed.data.type)) {
    return res.status(409).json({
      error: allowed.length === 0
        ? "The debug session has ended."
        : `"${parsed.data.type}" does not apply now. The session accepts: ${allowed.join(", ")}.`,
      allowed,
    });
  }
  await (await channel()).send(req.params.id, parsed.data);
  res.status(202).json({ accepted: parsed.data.type });
});

export default router;
