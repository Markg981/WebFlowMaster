import { createServer, type Server } from "http";
import { Express } from "express";
import { setupAuth } from "./auth";

import projectsRoutes from "./routes/projects.routes";
import testsRoutes from "./routes/tests.routes";
import testPlansRoutes from "./routes/test-plans.routes";
import uploadsRoutes from "./routes/uploads.routes";
import reportsRoutes from "./routes/reports.routes";
import authRoutes from "./routes/auth.routes";

export async function registerRoutes(app: Express): Promise<Server> {
    // Auth First
    setupAuth(app); // Attaches passport strategies
    
    // API Routers
    app.use(authRoutes);
    app.use(projectsRoutes);
    app.use(testsRoutes);
    app.use(testPlansRoutes);
    app.use(uploadsRoutes);
    app.use(reportsRoutes);

    // Health / Misc
    app.get("/api/health", (req, res) => res.json({ status: "ok" }));

    const httpServer = createServer(app);
    return httpServer;
}
