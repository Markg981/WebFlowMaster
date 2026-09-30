import { Router } from "express";
import type { User as SelectUser } from "@shared/schema";

// Sign-in, sign-out and registration are in server/auth.ts (setupAuth), which the passport setup
// ties to the app itself; this router holds what reads the signed-in user.

const router = Router();

// GET /api/user/profile — the signed-in user, without the password hash.
router.get("/api/user/profile", (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    // Every sibling endpoint in server/auth.ts strips the password hash before responding;
    // this one returned the whole row, handing the scrypt hash to the browser (and to XSS).
    const { password: _pw, ...safeUser } = req.user as SelectUser;
    res.json(safeUser);
});

export default router;
