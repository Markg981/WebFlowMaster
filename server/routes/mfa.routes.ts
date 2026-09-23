import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { requireRole } from "../middleware/require-role";
import { withTenantTransaction, getTenantOrgId } from "../middleware/tenancy";
import { auditActor } from "../audit";
import { comparePasswords } from "../auth";
import { storage } from "../storage";
import {
  beginEnrollment,
  confirmEnrollment,
  disableMfa,
  mfaStatus,
  regenerateRecoveryCodes,
  setMfaRequired,
  verifySecondFactor,
} from "../mfa";
import loggerPromise from "../logger";

/**
 * A member's second factor, and the organization's policy on it.
 *
 * Everything here is for a person in a browser session. An API key cannot enrol, disable, or
 * change the policy: a key that could turn off its holder's second factor would make the
 * second factor decoration.
 */

const router = Router();
const logger = await loggerPromise;

function sessionOnly(req: Request, res: Response, next: NextFunction) {
  if ((req as Request & { apiKeyId?: string }).apiKeyId) {
    return res.status(403).json({ error: "The second factor is managed from a signed-in session, not with an API key." });
  }
  next();
}

const codeSchema = z.object({ code: z.string().trim().min(6).max(32) });

// GET /api/mfa — is it on, how many recovery codes are left, does the organization require it.
router.get("/api/mfa", requireRole("viewer"), sessionOnly, async (req, res) => {
  const status = await mfaStatus(req.user!.id, req.user!.organizationId);
  res.json(status);
});

// POST /api/mfa/enrollment — a new secret, as a QR code and as text for typing in by hand.
router.post("/api/mfa/enrollment", requireRole("viewer"), sessionOnly, async (req, res) => {
  const enrollment = await beginEnrollment(req.user!.id, req.user!.username);
  if (!enrollment) {
    return res.status(409).json({ error: "Two-factor authentication is already on. Turn it off first to move it to another device." });
  }
  // The secret leaves the server here and in no other response; it is stored encrypted.
  res.status(201).json(enrollment);
});

// POST /api/mfa/enrollment/confirm — a code from the app proves it was set up; answers the
// recovery codes, once.
router.post("/api/mfa/enrollment/confirm", requireRole("viewer"), sessionOnly, async (req, res) => {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the six-digit code from your app." });

  const codes = await confirmEnrollment(req.user!.id, req.user!.organizationId, auditActor(req), parsed.data.code);
  if (!codes) return res.status(400).json({ error: "That code does not match. Check the time on your phone and try the next one." });
  logger.info({ message: "MFA enabled", userId: req.user!.id });
  res.json({ recoveryCodes: codes });
});

// POST /api/mfa/recovery-codes — a new set, which needs a current code: a session left open on
// somebody's desk must not be enough to mint ways in.
router.post("/api/mfa/recovery-codes", requireRole("viewer"), sessionOnly, async (req, res) => {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a code from your app." });

  const actor = auditActor(req);
  if (!(await verifySecondFactor(req.user!.id, req.user!.organizationId, actor, parsed.data.code))) {
    return res.status(400).json({ error: "That code is not valid." });
  }
  const codes = await regenerateRecoveryCodes(req.user!.id, req.user!.organizationId, actor);
  if (!codes) return res.status(409).json({ error: "Two-factor authentication is not on." });
  res.json({ recoveryCodes: codes });
});

// DELETE /api/mfa — turn it off, with the password and a code. Refused while the organization
// requires it: the member would only be sent straight back to enrol.
router.delete("/api/mfa", requireRole("viewer"), sessionOnly, async (req, res) => {
  const parsed = z.object({ password: z.string().min(1), code: z.string().trim().min(6).max(32) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Your password and a code from your app are both needed." });

  const status = await mfaStatus(req.user!.id, req.user!.organizationId);
  if (!status.enabled) return res.status(409).json({ error: "Two-factor authentication is not on." });
  if (status.required) {
    return res.status(409).json({ error: "Your organization requires two-factor authentication, so it cannot be turned off." });
  }

  const user = await storage.getUser(req.user!.id);
  if (!user || !(await comparePasswords(parsed.data.password, user.password))) {
    return res.status(400).json({ error: "The password or the code is not valid." });
  }
  const actor = auditActor(req);
  if (!(await verifySecondFactor(user.id, user.organizationId, actor, parsed.data.code))) {
    return res.status(400).json({ error: "The password or the code is not valid." });
  }
  await disableMfa(user.id, user.organizationId, actor);
  res.status(204).end();
});

/**
 * PUT /api/organization/mfa-policy — require a second factor of every member, or stop.
 *
 * An owner can only require it once they have it themselves; otherwise the first thing the
 * policy does is lock its author into the enrolment screen, which is survivable but tells them
 * nothing they would not have learned by trying it first.
 */
router.put("/api/organization/mfa-policy", requireRole("owner"), sessionOnly, async (req, res) => {
  const parsed = z.object({ required: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const organizationId = getTenantOrgId()!;
  if (parsed.data.required && !(await mfaStatus(req.user!.id, organizationId)).enabled) {
    return res.status(409).json({ error: "Turn on two-factor authentication for yourself before requiring it of everyone." });
  }
  await setMfaRequired(organizationId, auditActor(req), parsed.data.required);
  res.json({ required: parsed.data.required });
});

/**
 * DELETE /api/organization/members/:userId/mfa — for a member who lost their phone and their
 * recovery codes. They sign in with the password and enrol again (at once, if the organization
 * requires it). Owners only, recorded, and never for oneself: that is what DELETE /api/mfa, with
 * a code, is for.
 */
router.delete("/api/organization/members/:userId/mfa", requireRole("owner"), sessionOnly, async (req, res) => {
  const organizationId = getTenantOrgId()!;
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: "Invalid user id" });
  if (userId === req.user!.id) return res.status(400).json({ error: "Turn off your own from your security settings, with a code." });

  // users has no RLS: the organization is named explicitly, so another tenant's member is not here.
  const [member] = await withTenantTransaction((tx) =>
    tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, organizationId), eq(users.kind, "person")))
      .limit(1),
  );
  if (!member) return res.status(404).json({ error: "Member not found" });

  const reset = await disableMfa(member.id, organizationId, auditActor(req), "owner");
  if (!reset) return res.status(409).json({ error: "That member does not have two-factor authentication on." });
  res.status(204).end();
});

export default router;
