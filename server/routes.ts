import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { insertTestSchema, insertTestRunSchema } from "@shared/schema";
import { z } from "zod";
import { playwrightService } from "./playwright-service";

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
      console.error("Error loading website:", error);
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
      console.error("Error detecting elements:", error);
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
      console.error("Error fetching tests:", error);
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
      console.error("Error creating test:", error);
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
      console.error("Error updating test:", error);
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

      // In real implementation, execute with Playwright
      // For now, simulate execution
      setTimeout(async () => {
        await storage.updateTestRun(testRun.id, {
          status: "completed",
          results: { success: true, steps: test.sequence },
          completedAt: new Date()
        });
      }, 3000);

      res.json({ testRun, message: "Test execution started" });
    } catch (error) {
      console.error("Error executing test:", error);
      res.status(500).json({ error: "Failed to execute test" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
