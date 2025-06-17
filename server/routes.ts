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
  AdhocDetectedElementSchema, // Import new schema for ad-hoc detected elements
  apiTestHistory,
  apiTests,
  insertApiTestHistorySchema,
  insertApiTestSchema,
  updateApiTestSchema,
  AssertionSchema // Import AssertionSchema
} from "@shared/schema";
import { z } from "zod";
import { createInsertSchema } from 'drizzle-zod';
import { db } from "./db"; // Added db import
import { eq, and, desc, sql } from "drizzle-orm"; // Added eq and and_ (using and as per drizzle-orm)
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

const proxyApiRequestBodySchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]),
  url: z.string().url({ message: "Invalid URL format" }),
  queryParams: z.record(z.string().or(z.array(z.string()))).optional(),
  headers: z.record(z.string()).optional(),
  body: z.any().optional(),
  assertions: z.array(AssertionSchema).optional(), // Added assertions
});

// Helper to safely get a value from an object using a simple dot-notation path
function getValueByPath(obj: any, path: string): any {
  if (typeof path !== 'string' || !path.trim()) return undefined;
  // Allow path segments to start with non-alphanumeric for cases like $.data.items[0] if $ is passed.
  // For simplicity, we assume path doesn't start with '$' here unless obj itself is that root.
  const keys = path.replace(/^\$\.?/, '').split('.').filter(k => k.trim());
  let current = obj;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined;
    const bracketMatch = key.match(/^(.+)\[(\d+)\]$/);
    if (bracketMatch) {
      const arrKey = bracketMatch[1];
      const index = parseInt(bracketMatch[2]);
      current = (current as any)[arrKey];
      if (!Array.isArray(current) || index >= current.length || index < 0) return undefined;
      current = current[index];
    } else {
      current = (current as any)[key];
    }
    if (current === undefined) return undefined;
  }
  return current;
}

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

  app.post("/api/proxy-api-request", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parseResult = proxyApiRequestBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.error("Invalid /api/proxy-api-request payload:", { errors: parseResult.error.flatten() });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    const { method, url: baseUrl, queryParams, headers: customHeaders, body: requestBody, assertions } = parseResult.data;
    const startTime = Date.now();
    let timeoutId: NodeJS.Timeout | undefined = undefined; // Define timeoutId here

    try {
      const targetUrl = new URL(baseUrl);
      if (queryParams) {
        Object.entries(queryParams).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            value.forEach(v => targetUrl.searchParams.append(key, v));
          } else {
            targetUrl.searchParams.set(key, value);
          }
        });
      }

      const requestOptions: RequestInit = {
        method: method,
        headers: customHeaders ? { ...customHeaders } : {},
      };

      // Remove problematic headers that should not be manually set or forwarded
      // Host is automatically set by Node's fetch. Content-Length is also auto-calculated.
      if (requestOptions.headers) {
        delete (requestOptions.headers as Record<string, string>)['host'];
        delete (requestOptions.headers as Record<string, string>)['Host'];
        delete (requestOptions.headers as Record<string, string>)['content-length'];
        delete (requestOptions.headers as Record<string, string>)['Content-Length'];
      }


      if (method !== "GET" && method !== "HEAD" && requestBody !== undefined) {
        if (typeof requestBody === 'object' && requestBody !== null) {
          requestOptions.body = JSON.stringify(requestBody);
          if (requestOptions.headers && !(requestOptions.headers as Record<string, string>)['content-type'] && !(requestOptions.headers as Record<string, string>)['Content-Type']) {
            (requestOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
          }
        } else if (typeof requestBody === 'string') {
          requestOptions.body = requestBody;
        }
      }

      // Timeout controller
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

      requestOptions.signal = controller.signal;

      const apiResponse = await fetch(targetUrl.toString(), requestOptions);
      clearTimeout(timeoutId);
      timeoutId = undefined; // Clear timeoutId after clearing the timeout

      const duration = Date.now() - startTime;
      const responseStatus = apiResponse.status;

      const responseHeaders: Record<string, string> = {};
      apiResponse.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let responseBodyContent: any;
      const contentType = apiResponse.headers.get("content-type");
      let responseText = ''; // Store raw text to handle parsing errors or empty bodies

      try {
        responseText = await apiResponse.text(); // Read body as text first
        if (contentType && contentType.includes("application/json") && responseText) {
          responseBodyContent = JSON.parse(responseText); // Then try to parse if JSON
        } else {
          responseBodyContent = responseText; // Otherwise, use the text content
        }
      } catch (parseError) {
        // If JSON parsing fails, use the raw text.
        logger.warn("Failed to parse response body as JSON, falling back to text", { url: targetUrl.toString(), contentType, error: parseError });
        responseBodyContent = responseText;
      }


      let assertionResults: Array<{ assertion: z.infer<typeof AssertionSchema>; pass: boolean; actualValue: any; error?: string }> = [];
      if (assertions && assertions.length > 0) {
        assertions.forEach(assertion => {
          if (!assertion.enabled) return; // Skip disabled assertions

          let pass = false;
          let actualValue: any = undefined;
          let evalError: string | undefined = undefined;

          try {
            switch (assertion.source) {
              case 'status_code':
                actualValue = responseStatus;
                const expectedStatus = parseInt(assertion.targetValue || '');
                if (isNaN(expectedStatus)) { evalError = "Target value is not a number"; break; }
                switch (assertion.comparison) {
                  case 'equals': pass = actualValue === expectedStatus; break;
                  case 'not_equals': pass = actualValue !== expectedStatus; break;
                  case 'greater_than': pass = actualValue > expectedStatus; break;
                  case 'less_than': pass = actualValue < expectedStatus; break;
                  case 'greater_than_or_equals': pass = actualValue >= expectedStatus; break;
                  case 'less_than_or_equals': pass = actualValue <= expectedStatus; break;
                  default: evalError = `Unsupported comparison for status_code: ${assertion.comparison}`;
                }
                break;

              case 'header':
                actualValue = responseHeaders[assertion.property?.toLowerCase() || ''];
                switch (assertion.comparison) {
                  case 'exists': pass = actualValue !== undefined; break;
                  case 'not_exists': pass = actualValue === undefined; break;
                  case 'equals': pass = actualValue === assertion.targetValue; break;
                  case 'not_equals': pass = actualValue !== assertion.targetValue; break;
                  case 'contains': pass = typeof actualValue === 'string' && actualValue.includes(assertion.targetValue || ''); break;
                  case 'not_contains': pass = typeof actualValue === 'string' && !actualValue.includes(assertion.targetValue || ''); break;
                  default: evalError = `Unsupported comparison for header: ${assertion.comparison}`;
                }
                break;

              case 'body_json_path':
                if (typeof responseBodyContent === 'object' && responseBodyContent !== null) {
                  actualValue = getValueByPath(responseBodyContent, assertion.property || '$');
                  const target = assertion.targetValue;

                  let parsedTarget: any = target;
                  if ( (typeof actualValue === 'number' || ['greater_than', 'less_than', 'greater_than_or_equals', 'less_than_or_equals'].includes(assertion.comparison)) &&
                       assertion.comparison !== 'exists' && assertion.comparison !== 'not_exists' &&
                       assertion.comparison !== 'is_empty' && assertion.comparison !== 'is_not_empty') {
                      parsedTarget = parseFloat(target || '');
                      if (isNaN(parsedTarget) && (target !== undefined && target !== null && target !== '')) { evalError = "Target value is not a number for numerical comparison"; break; }
                  } else if (typeof actualValue === 'boolean' && (target?.toLowerCase() === 'true' || target?.toLowerCase() === 'false')) {
                      if (target?.toLowerCase() === 'true') parsedTarget = true;
                      else if (target?.toLowerCase() === 'false') parsedTarget = false;
                  }


                  switch (assertion.comparison) {
                    case 'exists': pass = actualValue !== undefined; break;
                    case 'not_exists': pass = actualValue === undefined; break;
                    case 'equals': pass = actualValue == parsedTarget; break;
                    case 'not_equals': pass = actualValue != parsedTarget; break;
                    case 'contains':
                      if (typeof actualValue === 'string') pass = actualValue.includes(target || '');
                      else if (Array.isArray(actualValue)) pass = actualValue.some(item => item == target);
                      else evalError = "Actual value is not a string or array for 'contains'";
                      break;
                    case 'not_contains':
                      if (typeof actualValue === 'string') pass = !actualValue.includes(target || '');
                      else if (Array.isArray(actualValue)) pass = !actualValue.some(item => item == target);
                      else evalError = "Actual value is not a string or array for 'not_contains'";
                      break;
                    case 'is_empty':
                        if (actualValue === undefined || actualValue === null) { pass = true; } // Consider undefined/null as empty for JSON path
                        else if (typeof actualValue === 'string' || Array.isArray(actualValue)) pass = actualValue.length === 0;
                        else if (typeof actualValue === 'object') pass = Object.keys(actualValue).length === 0;
                        else evalError = "Actual value type cannot be checked for emptiness";
                        break;
                    case 'is_not_empty':
                        if (actualValue === undefined || actualValue === null) { pass = false; }
                        else if (typeof actualValue === 'string' || Array.isArray(actualValue)) pass = actualValue.length > 0;
                        else if (typeof actualValue === 'object') pass = Object.keys(actualValue).length > 0;
                        else evalError = "Actual value type cannot be checked for non-emptiness";
                        break;
                    case 'greater_than': pass = typeof actualValue === 'number' && !isNaN(parsedTarget) && actualValue > parsedTarget; break;
                    case 'less_than': pass = typeof actualValue === 'number' && !isNaN(parsedTarget) && actualValue < parsedTarget; break;
                    case 'greater_than_or_equals': pass = typeof actualValue === 'number' && !isNaN(parsedTarget) && actualValue >= parsedTarget; break;
                    case 'less_than_or_equals': pass = typeof actualValue === 'number' && !isNaN(parsedTarget) && actualValue <= parsedTarget; break;
                    default: evalError = `Unsupported comparison for body_json_path: ${assertion.comparison}`;
                  }
                } else {
                  evalError = "Response body is not JSON or path is invalid";
                   if (assertion.comparison === 'not_exists' && assertion.property && getValueByPath(responseBodyContent, assertion.property) === undefined) {
                        pass = true; // if body is not JSON, a path effectively does not exist unless it's '$'
                        actualValue = undefined;
                        evalError = undefined;
                   } else if (assertion.comparison === 'is_empty' && (!responseBodyContent || Object.keys(responseBodyContent).length === 0)) {
                        pass = true; // if body is not JSON but is empty (e.g. empty string), consider it empty
                        actualValue = responseBodyContent;
                        evalError = undefined;
                   }
                }
                break;

              case 'body_text':
                const bodyAsString = typeof responseBodyContent === 'string' ? responseBodyContent : JSON.stringify(responseBodyContent);
                actualValue = bodyAsString;
                const targetStr = assertion.targetValue || '';
                switch (assertion.comparison) {
                  case 'equals': pass = actualValue === targetStr; break;
                  case 'not_equals': pass = actualValue !== targetStr; break;
                  case 'contains': pass = actualValue.includes(targetStr); break;
                  case 'not_contains': pass = !actualValue.includes(targetStr); break;
                  case 'is_empty': pass = actualValue === ''; break;
                  case 'is_not_empty': pass = actualValue !== ''; break;
                  case 'matches_regex':
                    try { const regex = new RegExp(targetStr); pass = regex.test(actualValue); }
                    catch (e: any) { evalError = `Invalid regex: ${e.message}`; }
                    break;
                  case 'not_matches_regex':
                    try { const regex = new RegExp(targetStr); pass = !regex.test(actualValue); }
                    catch (e: any) { evalError = `Invalid regex: ${e.message}`; }
                    break;
                  default: evalError = `Unsupported comparison for body_text: ${assertion.comparison}`;
                }
                break;

              case 'response_time':
                actualValue = duration;
                const expectedTime = parseInt(assertion.targetValue || '');
                if (isNaN(expectedTime)) { evalError = "Target value is not a number for response_time"; break; }
                switch (assertion.comparison) {
                  case 'greater_than': pass = actualValue > expectedTime; break;
                  case 'less_than': pass = actualValue < expectedTime; break;
                  case 'greater_than_or_equals': pass = actualValue >= expectedTime; break;
                  case 'less_than_or_equals': pass = actualValue <= expectedTime; break;
                  default: evalError = `Unsupported comparison for response_time: ${assertion.comparison}`;
                }
                break;
              default:
                evalError = `Unknown assertion source: ${(assertion as any).source}`;
            }
          } catch (e: any) {
            logger.error("Error during assertion evaluation:", { assertion, error: e.message });
            evalError = `Evaluation error: ${e.message}`;
          }
          assertionResults.push({ assertion, pass, actualValue, error: evalError });
        });
      }

      res.status(200).json({
        success: true,
        status: responseStatus,
        headers: responseHeaders,
        body: responseBodyContent,
        duration: duration,
        assertionResults: assertionResults, // Include results in response
      });

    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId); // Ensure timeout is cleared on error too
      const duration = Date.now() - startTime;
      logger.error("Error in /api/proxy-api-request:", {
        message: error.message,
        stack: error.stack,
        url: baseUrl,
        method: method,
        type: error.name // To identify AbortError for timeouts
      });

      let errorMessage = "Failed to make API request.";
      if (error.name === 'AbortError') {
        errorMessage = "Request timed out after 30 seconds.";
      } else if (error instanceof TypeError && error.message.includes('Invalid URL')) { // Check for TypeError and message
         errorMessage = "Invalid URL provided.";
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        errorMessage = `Could not connect to the server at ${baseUrl}. Please check the URL and network.`;
      }


      res.status(500).json({
        success: false,
        error: errorMessage,
        details: error.message,
        duration: duration,
      });
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

  // --- API Test History Endpoints ---
  app.post("/api/api-test-history", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const parseResult = insertApiTestHistorySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid history data", details: parseResult.error.flatten() });
    }
    try {
      const newHistoryEntry = await db
        .insert(apiTestHistory)
        .values({ ...parseResult.data, userId: req.user.id })
        .returning();
      res.status(201).json(newHistoryEntry[0]);
    } catch (error) {
      logger.error("Error creating API test history entry:", error);
      res.status(500).json({ error: "Failed to save API test history" });
    }
  });

  app.get("/api/api-test-history", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    try {
      const historyEntries = await db
        .select()
        .from(apiTestHistory)
        .where(eq(apiTestHistory.userId, req.user.id))
        .orderBy(desc(apiTestHistory.createdAt))
        .limit(limit)
        .offset(offset);

      const totalResult = await db.select({ count: sql`count(*)` }).from(apiTestHistory).where(eq(apiTestHistory.userId, req.user.id));
      const total = totalResult[0]?.count || 0;

      res.json({
          items: historyEntries,
          page,
          limit,
          totalItems: Number(total),
          totalPages: Math.ceil(Number(total) / limit),
      });
    } catch (error) {
      logger.error("Error fetching API test history:", error);
      res.status(500).json({ error: "Failed to fetch API test history" });
    }
  });

  app.delete("/api/api-test-history/:id", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
          return res.status(401).json({ error: "Unauthorized" });
      }
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
          return res.status(400).json({ error: "Invalid history ID" });
      }
      try {
          const result = await db.delete(apiTestHistory)
              .where(and(eq(apiTestHistory.id, id), eq(apiTestHistory.userId, req.user.id)))
              .returning();
          if (result.length === 0) {
              return res.status(404).json({ error: "History entry not found or not owned by user" });
          }
          res.status(204).send();
      } catch (error) {
          logger.error(`Error deleting API test history entry ${id}:`, error);
          res.status(500).json({ error: "Failed to delete history entry" });
      }
  });

  // --- Saved API Tests Endpoints ---
  app.post("/api/api-tests", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const postApiTestSchema = insertApiTestSchema.extend({
      projectId: z.number().int().positive().optional().nullable(),
    });
    const parseResult = postApiTestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() });
    }
    try {
      const { projectId, ...testData } = parseResult.data;

      const newTest = await db
        .insert(apiTests)
        .values({
          ...testData,
          userId: req.user.id,
          projectId: projectId,
          // Stringify JSON fields
          queryParams: testData.queryParams ? JSON.stringify(testData.queryParams) : null,
          requestHeaders: testData.requestHeaders ? JSON.stringify(testData.requestHeaders) : null,
          requestBody: testData.requestBody ? (typeof testData.requestBody === 'string' ? testData.requestBody : JSON.stringify(testData.requestBody)) : null,
          assertions: testData.assertions ? JSON.stringify(testData.assertions) : null,
        })
        .returning();
      res.status(201).json(newTest[0]);
    } catch (error: any) {
      logger.error("Error creating API test:", error);
      if (error.message && error.message.includes('FOREIGN KEY constraint failed')) {
          return res.status(400).json({ error: "Invalid project ID or project does not exist." });
      }
      res.status(500).json({ error: "Failed to create API test" });
    }
  });

  app.get("/api/api-tests", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
    try {
      const query = db
        .select()
        .from(apiTests)
        .where(
          and(
            eq(apiTests.userId, req.user.id),
            projectId ? eq(apiTests.projectId, projectId) : undefined
          )
        )
        .orderBy(desc(apiTests.updatedAt));
      const tests = await query;
      res.json(tests);
    } catch (error) {
      logger.error("Error fetching API tests:", error);
      res.status(500).json({ error: "Failed to fetch API tests" });
    }
  });

  app.get("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid test ID" });
    }
    try {
      const test = await db
        .select()
        .from(apiTests)
        .where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user.id)))
        .limit(1);
      if (test.length === 0) {
        return res.status(404).json({ error: "Test not found or not owned by user" });
      }
      res.json(test[0]);
    } catch (error) {
      logger.error(`Error fetching API test ${id}:`, error);
      res.status(500).json({ error: "Failed to fetch API test" });
    }
  });

  app.put("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid test ID" });
    }
    const putApiTestSchema = updateApiTestSchema.extend({
      projectId: z.number().int().positive().optional().nullable(),
    });
    const parseResult = putApiTestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() });
    }
    try {
      const { projectId, ...testData } = parseResult.data;
      const existingTest = await db.select({id: apiTests.id}).from(apiTests)
        .where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user.id)));
      if (existingTest.length === 0) {
        return res.status(404).json({ error: "Test not found or not owned by user" });
      }

      const updatedTest = await db
        .update(apiTests)
        .set({
          ...testData,
          projectId: projectId,
          updatedAt: sql`datetime('now')`, // Corrected SQL for current timestamp in SQLite
          // Stringify JSON fields if they are part of testData (i.e., being updated)
          ...(testData.queryParams && { queryParams: JSON.stringify(testData.queryParams) }),
          ...(testData.requestHeaders && { requestHeaders: JSON.stringify(testData.requestHeaders) }),
          ...(testData.requestBody && { requestBody: typeof testData.requestBody === 'string' ? testData.requestBody : JSON.stringify(testData.requestBody) }),
          ...(testData.assertions && { assertions: JSON.stringify(testData.assertions) }),
        })
        .where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user.id)))
        .returning();

      if (updatedTest.length === 0) {
          return res.status(404).json({ error: "Test not found after update attempt" });
      }
      res.json(updatedTest[0]);
    } catch (error: any) {
      logger.error(`Error updating API test ${id}:`, error);
      if (error.message && error.message.includes('FOREIGN KEY constraint failed')) {
          return res.status(400).json({ error: "Invalid project ID or project does not exist." });
      }
      res.status(500).json({ error: "Failed to update API test" });
    }
  });

  app.delete("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid test ID" });
    }
    try {
      const result = await db
        .delete(apiTests)
        .where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user.id)))
        .returning();

      if (result.length === 0) {
          return res.status(404).json({ error: "Test not found or not owned by user" });
      }
      res.status(204).send();
    } catch (error) {
      logger.error(`Error deleting API test ${id}:`, error);
      res.status(500).json({ error: "Failed to delete API test" });
    }
  });

  return httpServer;
}

// Removed the separate delay function as it's inlined above now for simplicity.
