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
import { connection } from "./redis";

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
});

// Choose a session store: Redis for real deployments (shared across instances /
// the worker process), in-memory only for the test environment where no Redis is required.
function createSessionStore(): session.Store {
  if (process.env.NODE_ENV === "test") {
    return new MemoryStore({ checkPeriod: 86400000 });
  }
  return new RedisStore({ client: connection, prefix: "wfm:sess:" });
}

// Rate limiter applied to authentication endpoints to slow down brute-force attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // max attempts per window per IP
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

export function setupAuth(app: Express) {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be set for session security.");
  }

  const sessionSettings: session.SessionOptions = {
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
  };

  // Baseline HTTP hardening. CSP is disabled because the SPA (Vite dev server /
  // bundled client) needs inline assets; enable a tailored CSP separately if required.
  app.use(helmet({ contentSecurityPolicy: false }));

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
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
      const { username, password } = parsed.data;

      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        res.status(400).json({ message: "Username already exists" });
        return;
      }

      // Only persist explicitly validated fields (no mass-assignment from req.body).
      const user = await storage.createUser({
        username,
        password: await hashPassword(password),
      });

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
