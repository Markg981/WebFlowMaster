import { Router } from "express";
import passport from "passport";
import { setupAuth } from "../auth";

// Note: Much of the auth logic is currently in setupAuth which attaches directly to the app.
// For this refactor, we will import setupAuth and let it do its thing, 
// but eventually, we should move the endpoints here.

// For now, this router might be empty or just handle specific additional auth routes if any.
// Since setupAuth takes 'app', we can keep using it in the main index for now 
// or refactor setupAuth to return a router. 
// Given the complexity of passport setup, we'll keep setupAuth in main index for the moment
// but create this file for future expansion (e.g. user profile routes).

const router = Router();

// Placeholder for user profile route if we move it from setupAuth
router.get("/api/user/profile", (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
    res.json(req.user);
});

export default router;
