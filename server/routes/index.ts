import { Router, Express } from "express";
import { setupAuth } from "../auth";

import projectsRoutes from "./projects.routes";
import testsRoutes from "./tests.routes";
import testPlansRoutes from "./test-plans.routes";
import uploadsRoutes from "./uploads.routes";
import reportsRoutes from "./reports.routes";
import authRoutes from "./auth.routes";

export async function registerRoutes(app: Express) {
    // Auth First
    setupAuth(app); // Attaches passport strategies
    
    // API Routers
    // Note: We mount them directly to app if they contain full paths (e.g. /api/tests)
    // or we could mount them to /api if they were relative.
    // In this refactor, I kept full paths in modules for zero-change compatibility with frontend.
    
    app.use(authRoutes);
    app.use(projectsRoutes);
    app.use(testsRoutes);
    app.use(testPlansRoutes);
    app.use(uploadsRoutes);
    app.use(reportsRoutes);

    // Health / Misc
    app.get("/api/health", (req, res) => res.json({ status: "ok" }));

    return app;
}
