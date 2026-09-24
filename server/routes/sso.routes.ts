import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { AUDIT_ACTIONS } from "@shared/schema";
import { requireRole } from "../middleware/require-role";
import { getTenantOrgId } from "../middleware/tenancy";
import { auditActor } from "../audit";
import { recordAuthEvent } from "../auth";
import {
  SSO_ROLES,
  SsoConfigError,
  beginSignIn,
  finishSignIn,
  getSsoSettings,
  removeSsoSettings,
  saveSsoSettings,
  ssoAvailable,
  testSsoProvider,
  type SignInError,
} from "../sso";
import loggerPromise from "../logger";

/**
 * Single sign-on (server/sso.ts): an owner's settings for the organization's identity provider,
 * and the two legs of signing in through it.
 *
 * The settings are for a person in a browser session, like the second-factor policy: a key that
 * could point the organization's sign-in at another provider would be a key to every account.
 */

const router = Router();
const logger = await loggerPromise;

function sessionOnly(req: Request, res: Response, next: NextFunction) {
  if ((req as Request & { apiKeyId?: string }).apiKeyId) {
    return res.status(403).json({ error: "Single sign-on is set up from a signed-in session, not with an API key." });
  }
  next();
}

/** Where the provider sends the browser back: the address to register with it. */
export function callbackUrl(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  const base = env.WEBFLOW_PUBLIC_URL?.trim().replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
  return `${base}/api/sso/callback`;
}

const settingsSchema = z.object({
  issuer: z.string().trim().min(1).max(500),
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().max(2000).optional(),
  domains: z.array(z.string().max(253)).min(1).max(50),
  defaultRole: z.enum(SSO_ROLES as [string, ...string[]]),
  enabled: z.boolean(),
  required: z.boolean(),
});

// GET /api/organization/sso — the settings (never the secret) and the address to register.
router.get("/api/organization/sso", requireRole("owner"), sessionOnly, async (req, res) => {
  res.json({ settings: await getSsoSettings(getTenantOrgId()!), callbackUrl: callbackUrl(req) });
});

// PUT /api/organization/sso — set the provider up, or change it. An empty secret keeps the stored one.
router.put("/api/organization/sso", requireRole("owner"), sessionOnly, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid single sign-on settings", details: parsed.error.flatten().fieldErrors });
  try {
    const settings = await saveSsoSettings(getTenantOrgId()!, auditActor(req), parsed.data as Parameters<typeof saveSsoSettings>[2]);
    res.json({ settings, callbackUrl: callbackUrl(req) });
  } catch (error) {
    if (error instanceof SsoConfigError) {
      return res.status(error.code === "domain_taken" ? 409 : 400).json({ error: error.message, code: error.code });
    }
    throw error;
  }
});

// DELETE /api/organization/sso — members sign in with passwords again.
router.delete("/api/organization/sso", requireRole("owner"), sessionOnly, async (req, res) => {
  if (!(await removeSsoSettings(getTenantOrgId()!, auditActor(req)))) return res.status(404).json({ error: "Single sign-on is not set up." });
  res.status(204).end();
});

// POST /api/organization/sso/test — does the saved provider answer?
router.post("/api/organization/sso/test", requireRole("owner"), sessionOnly, async (_req, res) => {
  res.json(await testSsoProvider(getTenantOrgId()!));
});

// ─── Signing in: public, before anyone is signed in ─────────────────────────────

// Loose: a whole office signs in from one address each morning, and the provider has its own
// limits on guessing passwords. This only keeps the domain lookup from being hammered.
const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "test" ? 100000 : 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

/** Back to the sign-in page, which explains the code. */
function backToSignIn(res: Response, error: SignInError) {
  res.redirect(303, `/auth?sso_error=${encodeURIComponent(error)}`);
}

// GET /api/sso/available — whether the sign-in page shows "Sign in with SSO".
router.get("/api/sso/available", async (_req, res) => {
  res.json({ available: await ssoAvailable() });
});

// GET /api/sso/start?email= — a navigation, not a fetch: it ends at the provider's sign-in page.
router.get("/api/sso/start", signInLimiter, async (req, res, next) => {
  const email = typeof req.query.email === "string" ? req.query.email.slice(0, 320) : "";
  try {
    const started = await beginSignIn(email, callbackUrl(req));
    if ("error" in started) {
      if (started.detail) logger.warn({ message: "Single sign-on could not start", error: started.error, detail: started.detail });
      return backToSignIn(res, started.error);
    }
    req.session.ssoPending = started.pending;
    req.session.save((error) => (error ? next(error) : res.redirect(303, started.url.href)));
  } catch (error) {
    next(error);
  }
});

// GET /api/sso/callback — the provider sends the browser back here.
router.get("/api/sso/callback", signInLimiter, async (req, res, next) => {
  const pending = req.session.ssoPending;
  delete req.session.ssoPending;
  try {
    const current = new URL(req.originalUrl, callbackUrl(req));
    const result = await finishSignIn(pending, current);
    if ("error" in result) {
      logger.warn({ message: "Single sign-on refused", error: result.error, detail: result.detail, organizationId: result.organizationId });
      return backToSignIn(res, result.error);
    }
    const { user, created, linked } = result;
    // req.login starts a new session: the one that carried the state does not become the signed-in one.
    req.login(user, (loginError) => {
      if (loginError) return next(loginError);
      req.session.signedInWith = "sso";
      req.session.save(async (saveError) => {
        if (saveError) return next(saveError);
        await recordAuthEvent(user, AUDIT_ACTIONS.LOGIN_SUCCEEDED, req.ip, { method: "sso", ...(created ? { created } : {}), ...(linked ? { linked } : {}) });
        res.redirect(303, "/");
      });
    });
  } catch (error) {
    next(error);
  }
});

export default router;
