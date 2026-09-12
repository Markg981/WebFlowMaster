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
import { User as SelectUser } from "@shared/schema";
import createMemoryStore from "memorystore";
import { sessionRedis } from "./redis";

const MemoryStore = createMemoryStore(session);

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

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

async function comparePasswords(supplied: string, stored: string) {
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

  if (!sharedSessionMiddleware) {
    sharedSessionMiddleware = session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: createSessionStore(),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
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
    new LocalStrategy(async (username, password, done) => {
      const user = await storage.getUserByUsername(username);
      if (!user || !(await comparePasswords(password, user.password))) {
        return done(null, false);
      } else {
        return done(null, user);
      }
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
      } else {
        user = await storage.createUser(credentials);
      }

      req.login(user, (err) => {
        if (err) return next(err);
        const { password: _pw, ...safeUser } = user;
        res.status(201).json(safeUser);
      });
    } catch (err) {
      next(err);
    }
  };

  app.post("/api/register", authLimiter, registerHandler);

  app.post("/api/login", authLimiter, passport.authenticate("local"), (req, res) => {
    const { password: _pw, ...safeUser } = req.user as SelectUser;
    res.status(200).json(safeUser);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const { password: _pw, ...safeUser } = req.user as SelectUser;
    res.json(safeUser);
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
