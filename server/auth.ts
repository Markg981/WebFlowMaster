import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, type RequestHandler } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { z } from "zod";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { RedisStore } from "connect-redis";
import { storage } from "./storage";
import { AUDIT_ACTIONS, User as SelectUser, type AuditAction } from "@shared/schema";
import { recordAudit } from "./audit";
import { runWithTenant, withTenantTransaction } from "./middleware/tenancy";
import loggerPromise from "./logger";
import { isMfaEnabled, mfaStatus, verifySecondFactor } from "./mfa";
import createMemoryStore from "memorystore";
import { sessionRedis } from "./redis";
import { sessionCookieSecure } from "./config";
import { registrationMode, registrationPolicy } from "./registration";

const MemoryStore = createMemoryStore(session);

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

declare module "express-session" {
  interface SessionData {
    /** A password accepted, a second factor still owed. Not a login: req.user stays unset. */
    mfaPending?: { userId: number; expiresAt: number; attempts: number };
  }
}

/** How long a password step stays good for its code step. */
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Wrong codes allowed per challenge before the password must be typed again. */
const MFA_MAX_ATTEMPTS = 5;

/**
 * The user as the client sees it: never the password hash, plus the two facts about the second
 * factor the client acts on — whether it is on, and whether the organization insists on it and
 * it is not (in which case every other request answers mfa_enrollment_required).
 */
async function publicUser(user: SelectUser) {
  const { password: _pw, ...safeUser } = user;
  const status = await mfaStatus(user.id, user.organizationId);
  return { ...safeUser, mfaEnabled: status.enabled, mfaEnrollmentRequired: status.required && !status.enabled };
}

/**
 * Signing in and out, in the trail of the user's organization.
 *
 * Its own transaction, necessarily: the session it describes is not a database change. And
 * best effort, unlike every other entry — a sign-in refused because the trail could not be
 * written would lock everybody out whenever the database hiccups, which is a worse failure than
 * a missing line.
 */
async function recordAuthEvent(
  user: Pick<SelectUser, 'id' | 'username' | 'organizationId'>,
  action: AuditAction,
  ipAddress: string | undefined,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await runWithTenant(user.organizationId, () =>
      withTenantTransaction((tx) =>
        recordAudit(tx, {
          action,
          actor: { id: user.id, username: user.username, ipAddress: ipAddress ?? null },
          targetType: 'user',
          targetId: user.id,
          ...(metadata ? { metadata } : {}),
        }),
      ),
    );
  } catch (error: any) {
    const logger = await loggerPromise;
    logger.error({ message: 'Could not record a sign-in event', action, userId: user.id, error: error?.message ?? String(error) });
  }
}

// Validation schema for the registration endpoint (prevents mass-assignment
// and rejects malformed/missing credentials before hashing).
const registerSchema = z.object({
  username: z.string().trim().min(3, "Username must be at least 3 characters").max(64),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  // Optional. Present, it makes the new account a member of the inviting organization
  // instead of the owner of a brand new one. 64 hex characters — see randomBytes(32) in
  // server/routes/organization.routes.ts.
  invitationToken: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

// Choose a session store: Redis for real deployments (shared across instances /
// the worker process), in-memory only where no Redis is required. This runs after
// index.ts has attempted connectSessionRedis(). `isOpen` is NOT authoritative here:
// node-redis sets it on entry to connect(), before a socket exists, so it is true even
// when the connection was refused. Only `isReady` means the handshake completed.
export function createSessionStore(): session.Store {
  if (process.env.NODE_ENV === "test") {
    return new MemoryStore({ checkPeriod: 86400000 });
  }
  if (sessionRedis.isReady) {
    // Uses the node-redis client (sessionRedis), not the ioredis one: connect-redis peer-
    // depends on `redis` >= 5 and calls set(key, val, {EX}), mGet() and scanIterator().
    return new RedisStore({ client: sessionRedis, prefix: "wfm:sess:" });
  }
  // Redis is unreachable. In production a shared store is mandatory (multiple instances +
  // the worker must see the same sessions), so refuse to start on an in-memory store.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Session Redis is not connected. Refusing to start in production without a shared session store — check REDIS_URL and that Redis is reachable.",
    );
  }
  // Development convenience only: don't make local work depend on a running Redis. Sessions
  // live in memory (lost on restart, single-process), which is fine for one developer.
  console.warn(
    "[auth] Redis unavailable — using an in-memory session store for local development. " +
      "Sessions will not persist across restarts. Start Redis to use the shared store.",
  );
  return new MemoryStore({ checkPeriod: 86400000 });
}

// Rate limiter applied to authentication endpoints to slow down brute-force attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // Effectively disabled under test so the suite isn't throttled; enforced in real runs.
  max: process.env.NODE_ENV === "test" ? 100000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts, please try again later." },
});

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

// Built once, on the first setupAuth(app) call, and reused after — see getSessionMiddleware.
let sharedSessionMiddleware: RequestHandler | undefined;

export function setupAuth(app: Express) {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be set for session security.");
  }
  // A malformed REGISTRATION stops the start, rather than the first registration.
  registrationMode();

  if (!sharedSessionMiddleware) {
    // Said out loud, because the symptom of getting this wrong is a 200 from /api/login
    // followed by silence: the browser drops the cookie and every later request is
    // anonymous, with nothing in any log connecting the two.
    if (process.env.NODE_ENV === "production" && !sessionCookieSecure()) {
      console.warn(
        "[auth] SESSION_COOKIE_SECURE=false: the session cookie will be sent over plain " +
          "HTTP. Acceptable for a local stack; put TLS in front of this before anyone else " +
          "can reach it.",
      );
    }

    sharedSessionMiddleware = session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: createSessionStore(),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: sessionCookieSecure(),
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      },
    });
  }

  // Baseline HTTP hardening. CSP is disabled because the SPA (Vite dev server /
  // bundled client) needs inline assets; enable a tailored CSP separately if required.
  app.use(helmet({ contentSecurityPolicy: false }));

  app.set("trust proxy", 1);
  app.use(sharedSessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy({ passReqToCallback: true }, async (req, username, password, done) => {
      const user = await storage.getUserByUsername(username);
      // An unknown username is not recorded: it belongs to no organization, and a trail of
      // them would be a list of guesses — some of them other people's passwords typed into
      // the wrong box.
      if (!user) return done(null, false);
      // A service account has a password only because the column requires one: it is random
      // and nobody knows it. Refused before comparing anyway, so that stays true even if
      // somebody one day sets it by hand.
      if (user.kind !== 'person' || user.disabledAt) {
        await recordAuthEvent(user, AUDIT_ACTIONS.LOGIN_FAILED, req.ip, { reason: 'not_a_person' });
        return done(null, false);
      }
      if (!(await comparePasswords(password, user.password))) {
        await recordAuthEvent(user, AUDIT_ACTIONS.LOGIN_FAILED, req.ip, { reason: 'wrong_password' });
        return done(null, false);
      }
      return done(null, user);
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    const user = await storage.getUser(id);
    done(null, user);
  });

  const registerHandler: RequestHandler = async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: "Invalid registration data",
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }
      const { username, password, invitationToken } = parsed.data;

      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        res.status(400).json({ message: "Username already exists" });
        return;
      }

      // Only persist explicitly validated fields (no mass-assignment from req.body).
      const credentials = { username, password: await hashPassword(password) };

      // With a token the account joins the inviting organization at the role the invitation
      // named; without one it gets a fresh organization and owns it. The distinction is the
      // whole point of invitations: a user belongs to exactly one organization, so joining
      // someone else's has to happen at the moment the account is created rather than by
      // moving an existing one.
      let user;
      if (invitationToken) {
        const result = await storage.createUserFromInvitation(credentials, invitationToken);
        if ('error' in result) {
          // One message for all three cases. Distinguishing "no such token" from "expired"
          // from "already used" would let someone probe the token space for near-misses.
          res.status(400).json({ message: "That invitation is not valid." });
          return;
        }
        user = result;
      } else if (registrationMode() === 'open') {
        user = await storage.createUser(credentials);
      } else {
        // Invitation only (server/registration.ts): without one, only the installation's first
        // account may be created, and createFirstUser decides that under a lock.
        const first = await storage.createFirstUser(credentials);
        if (!first) {
          res.status(403).json({
            message: "Accounts on this installation are created by invitation. Ask an owner of your organization to invite you.",
            code: "invitation_required",
          });
          return;
        }
        user = first;
      }

      // Joining an organization that requires a second factor means enrolling next, which the
      // answer says through mfaEnrollmentRequired.
      req.login(user, async (err) => {
        if (err) return next(err);
        try {
          res.status(201).json(await publicUser(user));
        } catch (error) {
          next(error);
        }
      });
    } catch (err) {
      next(err);
    }
  };

  app.post("/api/register", authLimiter, registerHandler);

  // Public: the sign-in page asks it whether to offer a registration form at all.
  app.get("/api/registration", async (_req, res, next) => {
    try {
      res.json(await registrationPolicy());
    } catch (error) {
      next(error);
    }
  });

  /**
   * The password step. With no second factor it signs the user in, as it always did. With one
   * it signs nobody in: it puts a short-lived challenge in the session and answers
   * { mfaRequired: true }, and only POST /api/login/mfa with a valid code completes the login.
   * Until then the session is as anonymous as it was — req.user is not set — so a password
   * alone reaches nothing.
   */
  app.post("/api/login", authLimiter, (req, res, next) => {
    passport.authenticate("local", async (err: unknown, user: SelectUser | false) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      try {
        if (await isMfaEnabled(user.id)) {
          req.session.mfaPending = { userId: user.id, expiresAt: Date.now() + MFA_CHALLENGE_TTL_MS, attempts: 0 };
          return req.session.save((saveError) => (saveError ? next(saveError) : res.status(200).json({ mfaRequired: true })));
        }
        req.login(user, async (loginError) => {
          if (loginError) return next(loginError);
          await recordAuthEvent(user, AUDIT_ACTIONS.LOGIN_SUCCEEDED, req.ip);
          res.status(200).json(await publicUser(user));
        });
      } catch (error) {
        next(error);
      }
    })(req, res, next);
  });

  /**
   * The second step: a code from the authenticator app, or a recovery code.
   *
   * Five wrong codes end the challenge and the password has to be typed again — the code space
   * is a million, and without a limit per challenge the rate limiter alone would be the only
   * thing between a stolen password and a guessed code.
   */
  app.post("/api/login/mfa", authLimiter, async (req, res, next) => {
    const pending = req.session.mfaPending;
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    if (!pending || pending.expiresAt < Date.now()) {
      delete req.session.mfaPending;
      return res.status(401).json({ message: "Sign in with your password again.", code: "mfa_challenge_expired" });
    }
    try {
      const user = await storage.getUser(pending.userId);
      if (!user || user.kind !== "person" || user.disabledAt) {
        delete req.session.mfaPending;
        return res.status(401).json({ message: "Unauthorized" });
      }
      const method = await verifySecondFactor(user.id, user.organizationId, { id: user.id, username: user.username, ipAddress: req.ip ?? null }, code);
      if (!method) {
        pending.attempts += 1;
        await recordAuthEvent(user, AUDIT_ACTIONS.LOGIN_FAILED, req.ip, { reason: "wrong_mfa_code" });
        if (pending.attempts >= MFA_MAX_ATTEMPTS) {
          delete req.session.mfaPending;
          return res.status(401).json({ message: "Too many wrong codes. Sign in with your password again.", code: "mfa_challenge_expired" });
        }
        return res.status(401).json({ message: "That code is not valid.", code: "mfa_code_invalid" });
      }
      delete req.session.mfaPending;
      // req.login regenerates the session: the challenge's session id does not become the
      // signed-in one.
      req.login(user, async (loginError) => {
        if (loginError) return next(loginError);
        await recordAuthEvent(user, AUDIT_ACTIONS.LOGIN_SUCCEEDED, req.ip, { mfa: method });
        res.status(200).json(await publicUser(user));
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/logout", async (req, res, next) => {
    // Before the session is gone, while it still says who this was.
    if (req.isAuthenticated?.() && req.user) {
      await recordAuthEvent(req.user as SelectUser, AUDIT_ACTIONS.LOGOUT, req.ip);
    }
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", async (req, res, next) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      res.json(await publicUser(req.user as SelectUser));
    } catch (error) {
      next(error);
    }
  });
}

/**
 * The exact session middleware `setupAuth` mounts on the Express app — same secret, same
 * store (Redis in real deployments, memorystore otherwise). The WebSocket upgrade handler
 * (server/websocket.ts) needs this to resolve `req.session`/`req.user` for a raw upgrade
 * request; building a second `session(...)` instance would use a different store connection
 * and a login made over HTTP would not be found when the socket looks up its session.
 *
 * Throws if called before setupAuth(app) has run once, since there is nothing to share yet.
 */
export function getSessionMiddleware(): RequestHandler {
  if (!sharedSessionMiddleware) {
    throw new Error(
      "getSessionMiddleware() was called before setupAuth(app) ran — the shared session " +
        "middleware is built there.",
    );
  }
  return sharedSessionMiddleware;
}
