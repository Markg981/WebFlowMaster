import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { insertTestSchema, insertTestRunSchema } from "@shared/schema";
import { z } from "zod";

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

      // In a real implementation, you would use a headless browser or secure proxy
      // For now, return success with the URL
      res.json({ success: true, url, loaded: true });
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

      // Mock detected elements - in real implementation, use Playwright + Omniparser
      const mockElements = [
        {
          id: "search-input",
          type: "input",
          selector: 'input[placeholder="Search GitHub"]',
          text: "",
          tag: "input",
          attributes: { placeholder: "Search GitHub", type: "text" }
        },
        {
          id: "sign-in-btn",
          type: "button",
          selector: "button.bg-blue-600",
          text: "Sign in",
          tag: "button",
          attributes: { class: "bg-blue-600" }
        },
        {
          id: "hero-title",
          type: "heading",
          selector: "h1.text-5xl",
          text: "Let's build from here",
          tag: "h1",
          attributes: { class: "text-5xl font-bold" }
        },
        {
          id: "start-free-btn",
          type: "button",
          selector: "button.bg-green-600",
          text: "Start for free",
          tag: "button",
          attributes: { class: "bg-green-600" }
        },
        {
          id: "enterprise-btn",
          type: "button",
          selector: "button.border",
          text: "Start enterprise trial",
          tag: "button",
          attributes: { class: "border" }
        }
      ];

      res.json({ elements: mockElements });
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
