import type { Express } from "express";
import { createServer, type Server } from "http";
import logger from "./logger"; // Import Winston logger
import { setupAuth } from "./auth";
import { storage } from "./storage";
import {
  insertTestSchema,
  insertTestRunSchema,
  userSettings,
  projects, // Added projects table
  insertProjectSchema, // Added insertProjectSchema
  tests, // Added tests table
  AdhocTestStepSchema, // Import new schema for ad-hoc test steps
  AdhocDetectedElementSchema // Import new schema for ad-hoc detected elements
} from "@shared/schema";
import { z } from "zod";
import { createInsertSchema } from 'drizzle-zod';
import { db } from "./db"; // Added db import
import { eq, and } from "drizzle-orm"; // Added eq and and_ (using and as per drizzle-orm)
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
  url: z.string().url({ message: "Invalid URL format" }).min(1, {message: "URL cannot be empty"}),
  sequence: z.array(AdhocTestStepSchema).min(1, { message: "Sequence must contain at least one step" }),
  elements: z.array(AdhocDetectedElementSchema), // Can be an empty array if no elements are pre-supplied
  name: z.string().optional().default("Ad-hoc Test"), // Provide a default name
});

// Zod schema for POST /api/start-recording
const startRecordingSchema = z.object({
  url: z.string().url({ message: "Invalid URL format" }).min(1, {message: "URL cannot be empty"}),
});

// Zod schema for POST /api/stop-recording
const stopRecordingSchema = z.object({
  sessionId: z.string().min(1, {message: "Session ID cannot be empty"}),
});

// Zod schema for GET /api/get-recorded-actions
const getRecordedActionsSchema = z.object({
  sessionId: z.string().min(1, {message: "Session ID cannot be empty"}),
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

  // Project management endpoints
  app.get("/api/projects", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const userId = req.user.id;
      const userProjects = await db.select().from(projects).where(eq(projects.userId, userId));
      res.json(userProjects);
    } catch (error) {
      logger.error("Error fetching projects:", { error });
      res.status(500).json({ error: "Failed to fetch projects" });
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

  app.post("/api/projects", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const userId = req.user.id;

      const projectSchema = insertProjectSchema.pick({ name: true });
      const validatedData = projectSchema.parse(req.body);

      const newProject = await db
        .insert(projects)
        .values({
          name: validatedData.name,
          userId: userId,
        })
        .returning(); // Get the created project back

      if (newProject.length === 0) {
        // Should not happen with SQLite returning but good practice
        return res.status(500).json({ error: "Failed to create project due to database error" });
      }

      res.status(201).json(newProject[0]);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid project data", details: error.errors });
      }
      logger.error("Error creating project:", { error });
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  app.delete("/api/projects/:projectId", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const userId = req.user.id;
      const projectIdParam = req.params.projectId;

      // Validate projectId is a number
      const projectId = parseInt(projectIdParam, 10);
      if (isNaN(projectId)) {
        return res.status(400).json({ error: "Invalid project ID format." });
      }

      // Check if the project exists and belongs to the user
      const projectToDelete = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
        .limit(1);

      if (projectToDelete.length === 0) {
        return res.status(404).json({ error: "Project not found or you do not have permission to delete it." });
      }

      // Update associated tests: set projectId to null
      // Only update tests that belong to this project AND this user
      await db
        .update(tests)
        .set({ projectId: null })
        .where(and(eq(tests.projectId, projectId), eq(tests.userId, userId)));

      // Delete the project
      const deleteResult = await db
        .delete(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

      if (deleteResult.rowCount === 0) {
        // This case should ideally not be reached if the initial check passed
        // and no concurrent modification happened.
        logger.warn(`Project ${projectId} was not found for deletion after tests update, possibly already deleted.`);
        return res.status(404).json({ error: "Project not found, possibly already deleted." });
      }

      res.status(204).send();
    } catch (error) {
      logger.error(`Error deleting project ${req.params.projectId}:`, { error });
      res.status(500).json({ error: "Failed to delete project" });
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

      // Using safeParse to handle validation explicitly
      const parseResult = executeDirectTestSchema.safeParse(req.body);

      if (!parseResult.success) {
        console.error("BEGIN INVALID PAYLOAD FOR /api/execute-test-direct ---");
        console.error("Payload:", JSON.stringify(req.body, null, 2));
        console.error("Validation Errors:", JSON.stringify(parseResult.error.flatten(), null, 2));
        console.error("END INVALID PAYLOAD ---");
        return res.status(400).json({
          error: "Invalid request payload",
          details: parseResult.error.flatten(),
          detectedElements: []
        });
      }

      const validatedData = parseResult.data; // Use validated data from safeParse
      const userId = req.user.id;

      // Call the actual service method
      const executionResult = await playwrightService.executeAdhocSequence(validatedData, userId);

      if (executionResult.success) {
        res.status(200).json({
          success: true,
          steps: executionResult.steps,
          duration: executionResult.duration,
          detectedElements: executionResult.detectedElements
        });
      } else {
        res.status(400).json({
          success: false,
          error: executionResult.error,
          steps: executionResult.steps,
          duration: executionResult.duration,
          detectedElements: executionResult.detectedElements
        });
      }

    } catch (error) {
      // This catch block now handles errors other than Zod validation,
      // as Zod errors are handled by safeParse.
      logger.error("Error in /api/execute-test-direct (non-validation):", {
        message: error instanceof Error ? error.message : "Unknown error",
        error
      });
      const errorMessage = error instanceof Error ? error.message : "Unknown error during direct test execution";
      res.status(500).json({
        success: false,
        error: "Failed to execute test directly",
        details: errorMessage,
        detectedElements: []
      });
    }
  });

  // Recording API Endpoints
  app.post("/api/start-recording", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
      const parseResult = startRecordingSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ success: false, error: "Invalid request payload", details: parseResult.error.flatten() });
      }
      const { url } = parseResult.data;
      const userId = req.user.id;

      const result = await playwrightService.startRecordingSession(url, userId);
      if (result.success) {
        res.status(200).json({ success: true, sessionId: result.sessionId });
      } else {
        res.status(500).json({ success: false, error: result.error || "Failed to start recording session" });
      }
    } catch (error) {
      logger.error("Error in /api/start-recording:", { error });
      const errorMessage = error instanceof Error ? error.message : "Unknown server error";
      res.status(500).json({ success: false, error: "Server error starting recording session", details: errorMessage });
    }
  });

  app.post("/api/stop-recording", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
      const parseResult = stopRecordingSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ success: false, error: "Invalid request payload", details: parseResult.error.flatten() });
      }
      const { sessionId } = parseResult.data;
      const userId = req.user.id; // For validation within the service

      const result = await playwrightService.stopRecordingSession(sessionId, userId);
      if (result.success) {
        // Transform RecordedAction to match frontend's DragDropTestStep structure if necessary
        // For now, assuming direct compatibility or frontend handles transformation.
        // The frontend expects DragDropTestStep[], while backend provides RecordedAction[]
        // This transformation is NOT done here yet. Placeholder for future.
        res.status(200).json({ success: true, sequence: result.actions });
      } else {
        res.status(500).json({ success: false, error: result.error || "Failed to stop recording session" });
      }
    } catch (error) {
      logger.error("Error in /api/stop-recording:", { error });
      const errorMessage = error instanceof Error ? error.message : "Unknown server error";
      res.status(500).json({ success: false, error: "Server error stopping recording session", details: errorMessage });
    }
  });

  app.get("/api/get-recorded-actions", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
      // Validate query parameters
      const parseResult = getRecordedActionsSchema.safeParse(req.query);
      if (!parseResult.success) {
        return res.status(400).json({ success: false, error: "Invalid query parameters", details: parseResult.error.flatten() });
      }
      const { sessionId } = parseResult.data;
      const userId = req.user.id; // For validation

      const result = await playwrightService.getRecordedActions(sessionId, userId);

      if (!result.success) {
        // Check specifically for the "session not found" error from the service
        if (result.error === "Recording session not found or already stopped.") {
          logger.warn(`Attempt to get actions for non-existent or ended session ${sessionId} by user ${userId}.`);
          return res.status(200).json({ // Respond with 200 OK but indicate session status in the body
            success: false,
            error: result.error,
            sessionEnded: true,
            sequence: [] // Provide an empty sequence
          });
        }
        // For other types of errors from getRecordedActions (e.g., unexpected internal errors)
        logger.error(`Error fetching actions for session ${sessionId} (user ${userId}): ${result.error}`);
        return res.status(500).json({
          success: false,
          error: result.error || "Server error while trying to get recorded actions",
          sessionEnded: false // Session might still exist but another error occurred
        });
      }

      // Success: session is active, and actions are retrieved
      res.status(200).json({
        success: true,
        sequence: result.actions,
        sessionEnded: false // Session is active
      });

    } catch (error) {
      logger.error("Critical error in /api/get-recorded-actions route:", { error });
      const errorMessage = error instanceof Error ? error.message : "Unknown server error";
      // Ensure sessionEnded is part of the response for consistency, defaulting to false for unexpected errors
      res.status(500).json({
        success: false,
        error: "Server error in get-recorded-actions route",
        details: errorMessage,
        sessionEnded: false
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

// Removed the separate delay function as it's inlined above now for simplicity.
