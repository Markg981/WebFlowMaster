import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { sharedStore } from "../middleware/rate-limit-store";
import { z } from "zod";
import { AUDIT_ACTIONS } from "@shared/schema";
import { requireRole } from "../middleware/require-role";
import { getTenantOrgId } from "../middleware/tenancy";
import { auditActor } from "../audit";
import { recordAuthEvent } from "../auth";
import {
  SSO_PROTOCOLS,
  SSO_ROLES,
  SsoConfigError,
  beginSignIn,
  finishSamlSignIn,
  finishSignIn,
  samlProviderOf,
  getSsoSettings,
  removeSsoSettings,
  saveSsoSettings,
  ssoAvailable,
  testSsoProvider,
  verifySsoDomain,
  type SignInError,
  type SignedIn,
} from "../sso";
import loggerPromise from "../logger";
import { BINDING_COOKIE, REQUEST_TTL_MS, parseIdpMetadata, serviceProviderMetadata, spUrls } from "../sso-saml";
import { sessionCookieSecure } from "../config";

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

/** This installation as its users reach it. */
export function publicBase(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  return env.WEBFLOW_PUBLIC_URL?.trim().replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
}

/** Where the provider sends the browser back: the address to register with it. */
export function callbackUrl(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  return `${publicBase(req, env)}/api/sso/callback`;
}

/** What the owner gives the provider: the OpenID Connect redirect URI, or the SAML service provider's addresses. */
function providerFacing(req: Request) {
  return { callbackUrl: callbackUrl(req), saml: spUrls(publicBase(req), getTenantOrgId()!) };
}

const settingsSchema = z.object({
  protocol: z.enum(SSO_PROTOCOLS as [string, ...string[]]).default("oidc"),
  issuer: z.string().trim().min(1).max(500),
  clientId: z.string().trim().max(500).optional(),
  clientSecret: z.string().max(2000).optional(),
  samlSsoUrl: z.string().trim().max(2000).optional(),
  samlCertificate: z.string().max(20000).optional(),
  domains: z.array(z.string().max(253)).min(1).max(50),
  defaultRole: z.enum(SSO_ROLES as [string, ...string[]]),
  enabled: z.boolean(),
  required: z.boolean(),
  // Roles from the provider's groups (shared/sso-roles.ts); absent keeps what is stored.
  groupAttribute: z.string().trim().max(200).nullable().optional(),
  roleMappings: z.array(z.object({ group: z.string().max(256), role: z.string().max(20) })).max(100).optional(),
  requireGroup: z.boolean().optional(),
});

// GET /api/organization/sso — the settings (never the secret) and the address to register.
router.get("/api/organization/sso", requireRole("owner"), sessionOnly, async (req, res) => {
  res.json({ settings: await getSsoSettings(getTenantOrgId()!), ...providerFacing(req) });
});

// POST /api/organization/sso/saml-metadata — reads entity ID, sign-on URL and certificate out of the
// provider's metadata XML, to fill the form. Saves nothing.
router.post("/api/organization/sso/saml-metadata", requireRole("owner"), sessionOnly, (req, res) => {
  const xml = typeof req.body?.xml === "string" ? req.body.xml : "";
  if (!xml.trim()) return res.status(400).json({ error: "Paste the provider's metadata XML." });
  const parsed = parseIdpMetadata(xml);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  res.json(parsed);
});

// PUT /api/organization/sso — set the provider up, or change it. An empty secret keeps the stored one.
router.put("/api/organization/sso", requireRole("owner"), sessionOnly, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid single sign-on settings", details: parsed.error.flatten().fieldErrors });
  try {
    const settings = await saveSsoSettings(getTenantOrgId()!, auditActor(req), parsed.data as Parameters<typeof saveSsoSettings>[2]);
    res.json({ settings, ...providerFacing(req) });
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

// POST /api/organization/sso/domains/:domain/verify — is the TXT record there? (server/sso-domains.ts)
router.post("/api/organization/sso/domains/:domain/verify", requireRole("owner"), sessionOnly, async (req, res) => {
  const outcome = await verifySsoDomain(getTenantOrgId()!, auditActor(req), String(req.params.domain));
  if (!outcome) return res.status(404).json({ error: "This organization does not sign in that domain." });
  res.json(outcome);
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
  store: sharedStore("sso"),
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
    if (started.samlRequestId) {
      // Binds the request to this browser (server/sso-saml.ts). Cross-site, so SameSite=None, which
      // browsers accept only on a Secure cookie: without TLS the binding is not set, nor required.
      if (sessionCookieSecure()) {
        res.cookie(BINDING_COOKIE, started.samlRequestId, {
          httpOnly: true, secure: true, sameSite: "none", path: "/api/sso/saml", maxAge: REQUEST_TTL_MS,
        });
      }
      return res.redirect(303, started.url.href);
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
    signIn(req, res, next, result, "oidc");
  } catch (error) {
    next(error);
  }
});

function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// GET /api/sso/saml/:organizationId/metadata — the service provider's metadata, for the identity
// provider: entity ID, ACS address and binding. Public, like every SAML metadata document.
router.get("/api/sso/saml/:organizationId/metadata", async (req, res) => {
  const organizationId = Number(req.params.organizationId);
  const row = Number.isInteger(organizationId) ? await samlProviderOf(organizationId) : null;
  if (!row) return res.status(404).json({ error: "This organization does not sign in with SAML." });
  res.type("application/samlmetadata+xml").send(serviceProviderMetadata(row, publicBase(req)));
});

// POST /api/sso/saml/:organizationId/acs — the provider POSTs the signed response here (cross-site:
// exempt from the origin check, server/middleware/csrf.ts; the signature is the proof).
router.post("/api/sso/saml/:organizationId/acs", signInLimiter, async (req, res, next) => {
  const organizationId = Number(req.params.organizationId);
  const samlResponse = typeof req.body?.SAMLResponse === "string" ? req.body.SAMLResponse : "";
  res.clearCookie(BINDING_COOKIE, { path: "/api/sso/saml", secure: true, sameSite: "none", httpOnly: true });
  if (!Number.isInteger(organizationId) || !samlResponse) return backToSignIn(res, "expired");
  try {
    const bound = sessionCookieSecure() ? cookieValue(req, BINDING_COOKIE) : undefined;
    const result = await finishSamlSignIn(organizationId, publicBase(req), samlResponse, bound);
    if ("error" in result) {
      logger.warn({ message: "Single sign-on refused", protocol: "saml", error: result.error, detail: result.detail, organizationId });
      return backToSignIn(res, result.error);
    }
    signIn(req, res, next, result, "saml");
  } catch (error) {
    next(error);
  }
});

/** Opens the session for an account the provider vouched for, by either protocol. */
function signIn(req: Request, res: Response, next: NextFunction, { user, created, linked }: SignedIn, protocol: "oidc" | "saml") {
  // req.login starts a new session: the one that carried the state does not become the signed-in one.
  req.login(user, (loginError) => {
    if (loginError) return next(loginError);
    req.session.signedInWith = "sso";
    req.session.save(async (saveError) => {
      if (saveError) return next(saveError);
      await recordAuthEvent(user, AUDIT_ACTIONS.LOGIN_SUCCEEDED, req.ip, { method: "sso", protocol, ...(created ? { created } : {}), ...(linked ? { linked } : {}) });
      res.redirect(303, "/");
    });
  });
}

export default router;
