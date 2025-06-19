import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import 'dotenv/config';
import loggerPromise from './logger'; // Import Winston logger promise
import { db } from './db'; // Import db instance
import { systemSettings } from '@shared/schema'; // Import systemSettings table
import { eq } from 'drizzle-orm'; // Import eq operator

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const logger = await loggerPromise; // Resolve the logger promise

  // Ensure default system settings, including logRetentionDays
  async function ensureDefaultSystemSettings() {
    const settingsToEnsure = [
      { key: 'logRetentionDays', value: process.env.LOG_RETENTION_DAYS || '7' },
      // Add other default system settings here if needed
    ];

    for (const settingToEnsure of settingsToEnsure) {
      try {
        const existingSetting = await db.select()
          .from(systemSettings)
          .where(eq(systemSettings.key, settingToEnsure.key))
          .limit(1);

        if (existingSetting.length === 0) {
          await db.insert(systemSettings).values(settingToEnsure);
          logger.info(`Initialized default system setting: ${settingToEnsure.key}=${settingToEnsure.value}`);
        }
      } catch (error) {
        // Use the resolved logger here, or console.error if logger itself might fail
        logger.error(`Failed to ensure default system setting for ${settingToEnsure.key}:`, error);
      }
    }
  }

  await ensureDefaultSystemSettings(); // Call during server startup

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    // Use the resolved logger for consistency, though the custom `log` was used before
    logger.info(`Server listening on port ${port}`);
  });
})();
