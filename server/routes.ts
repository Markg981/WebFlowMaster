import type { Express } from "express";
import { createServer, type Server } from "http";
import logger from "./logger"; // Import Winston logger
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { insertTestSchema, insertTestRunSchema, userSettings } from "@shared/schema";
import { z } from "zod";
import { createInsertSchema } from 'drizzle-zod';
import { playwrightService } from "./playwright-service";

// Zod schema for validating POST /api/settings request body
const userSettingsBodySchema = createInsertSchema(userSettings, {
  // Override default Zod types if needed, e.g. for stricter validation
  playwrightHeadless: z.boolean().optional(),
  playwrightDefaultTimeout: z.number().int().positive().optional(),
  playwrightWaitTime: z.number().int().positive().optional(),
  theme: z.string().optional(),
  defaultTestUrl: z.string().url().or(z.literal('')).optional().nullable(),
  playwrightBrowser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
}).omit({ userId: true });

// Zod schema for POST /api/execute-test-direct
const executeDirectTestSchema = z.object({
  url: z.string().url({ message: "Invalid URL format" }),
  sequence: z.array(z.any(), { message: "Sequence must be an array" }),
  elements: z.array(z.any(), { message: "Elements must be an array" }),
  name: z.string().optional(),
});


export function registerRoutes(app: Express): Server {
  // Setup authentication routes
  setupAuth(app);

  // Website proxy endpoint for secure loading
  app.post("/api/load-website", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      // Use Playwright to load the website
      const result = await playwrightService.loadWebsite(url);
      res.json(result);
    } catch (error) {
      logger.error("Error loading website:", { error });
      res.status(500).json({ error: "Failed to load website" });
    }
  });

  // Element detection endpoint
  app.post("/api/detect-elements", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      // Use Playwright to detect elements
      const elements = await playwrightService.detectElements(url);
      res.json({ elements });
    } catch (error) {
      logger.error("Error detecting elements:", { error });
      res.status(500).json({ error: "Failed to detect elements" });
    }
  });

  // Test management endpoints
  app.get("/api/tests", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const tests = await storage.getTestsByUser(req.user!.id);
      res.json(tests);
    } catch (error) {
      logger.error("Error fetching tests:", { error });
      res.status(500).json({ error: "Failed to fetch tests" });
    }
  });

  app.post("/api/tests", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const validatedData = insertTestSchema.parse({
        ...req.body,
        userId: req.user!.id
      });

      const test = await storage.createTest(validatedData);
      res.status(201).json(test);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid test data", details: error.errors });
      }
      logger.error("Error creating test:", { error });
      res.status(500).json({ error: "Failed to create test" });
    }
  });

  app.put("/api/tests/:id", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const testId = parseInt(req.params.id);
      const existingTest = await storage.getTest(testId);

      if (!existingTest || existingTest.userId !== req.user!.id) {
        return res.status(404).json({ error: "Test not found" });
      }

      const validatedData = insertTestSchema.partial().parse(req.body);
      const updatedTest = await storage.updateTest(testId, validatedData);

      if (!updatedTest) {
        return res.status(404).json({ error: "Test not found" });
      }

      res.json(updatedTest);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid test data", details: error.errors });
      }
      logger.error("Error updating test:", { error });
      res.status(500).json({ error: "Failed to update test" });
    }
  });

  // Test execution endpoint
  app.post("/api/tests/:id/execute", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const testId = parseInt(req.params.id);
      const test = await storage.getTest(testId);

      if (!test || test.userId !== req.user!.id) {
        return res.status(404).json({ error: "Test not found" });
      }

      // Create test run record
      const testRun = await storage.createTestRun({
        testId,
        status: "running",
        results: null
      });

      // Execute the test using PlaywrightService
      const executionResult = await playwrightService.executeTestSequence(test, req.user!.id);

      // Update test run record with results
      const updatedTestRun = await storage.updateTestRun(testRun.id, {
        status: executionResult.success ? "completed" : "failed",
        results: {
          success: executionResult.success,
          steps: executionResult.steps,
          error: executionResult.error,
          duration: executionResult.duration,
         },
        completedAt: new Date(),
      });

      res.json({
        testRun: updatedTestRun || { ...testRun, status: executionResult.success ? "completed" : "failed" }, // Fallback if updateTestRun returns undefined
        message: executionResult.success ? "Test execution completed" : "Test execution failed"
      });
    } catch (error) {
      // Ensure testRun status is updated to 'failed' if an error occurs before/during execution call that's not caught by executeTestSequence
      // This part might be tricky if testRun.id is not available or if the error is within storage calls themselves.
      // For now, focusing on errors from playwrightService call or general route errors.
      if (req.body.testRunId) { // Assuming testRunId might be passed or available if created before error
         await storage.updateTestRun(req.body.testRunId, {
            status: "failed",
            results: { success: false, error: error instanceof Error ? error.message : "Unknown error during setup" },
            completedAt: new Date(),
        });
      }
      logger.error("Error executing test route:", { error });
      res.status(500).json({ error: "Failed to execute test" });
    }
  });

  // User settings endpoints
  app.get("/api/settings", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const userId = req.user.id;
      const settings = await storage.getUserSettings(userId);

      // Return actual settings or the specified defaults if none found or partial
      const responseSettings = {
        theme: settings?.theme || 'light',
        defaultTestUrl: settings?.defaultTestUrl || '', // API returns empty string for null
        playwrightBrowser: settings?.playwrightBrowser || 'chromium',
        playwrightHeadless: settings?.playwrightHeadless !== undefined ? Boolean(settings.playwrightHeadless) : true,
        playwrightDefaultTimeout: settings?.playwrightDefaultTimeout || 30000,
        playwrightWaitTime: settings?.playwrightWaitTime || 1000,
      };
      res.json(responseSettings);
    } catch (error) {
      logger.error("Error fetching settings:", { error });
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const userId = req.user.id;

      const validatedData = userSettingsBodySchema.parse(req.body);

      // Prepare data for upsert, ensuring userId is included
      const settingsData = { ...validatedData, userId };

      const savedSettings = await storage.upsertUserSettings(userId, settingsData);
      // Ensure boolean conversion for response
      if (savedSettings.playwrightHeadless !== undefined) {
        savedSettings.playwrightHeadless = Boolean(savedSettings.playwrightHeadless);
      }
      res.json(savedSettings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid settings data", details: error.errors });
      }
      logger.error("Error saving settings:", { error });
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // New route for direct test execution
  app.post("/api/execute-test-direct", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const validatedData = executeDirectTestSchema.parse(req.body);
      const userId = req.user.id;

      // Call the actual service method
      const executionResult = await playwrightService.executeAdhocSequence(validatedData, userId);

      // The executionResult from executeAdhocSequence is expected to be:
      // executionResult now includes detectedElements:
      // { success: boolean; steps?: StepResult[]; error?: string; duration?: number; detectedElements?: DetectedElement[] }

      if (executionResult.success) {
        res.status(200).json({
          success: true,
          steps: executionResult.steps,
          duration: executionResult.duration,
          detectedElements: executionResult.detectedElements
        });
      } else {
        // Send 400 or another appropriate error code based on the nature of 'executionResult.error'
        // For simplicity, using 400 for any controlled failure from the service.
        res.status(400).json({
          success: false,
          error: executionResult.error,
          steps: executionResult.steps,
          duration: executionResult.duration,
          detectedElements: executionResult.detectedElements
        });
      }

    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Invalid request payload",
          details: error.errors,
          detectedElements: [] // Default for this error type
        });
      }
      logger.error("Error in /api/execute-test-direct:", { error });
      const errorMessage = error instanceof Error ? error.message : "Unknown error during direct test execution";
      res.status(500).json({
        success: false,
        error: "Failed to execute test directly",
        details: errorMessage,
        detectedElements: [] // Default for critical server errors
      });
    }
  });


  const httpServer = createServer(app);
  return httpServer;
}

// Removed the separate delay function as it's inlined above now for simplicity.
