import type { Express } from "express";
import { createServer, type Server } from "http";
import logger, { updateLogLevel } from "./logger"; // Import Winston logger and updateLogLevel
import { setupAuth } from "./auth";
import { storage } from "./storage";
import {
  insertTestSchema,
  insertTestRunSchema,
  userSettings,
  projects,
  insertProjectSchema,
  tests,
  AdhocTestStepSchema,
  AdhocDetectedElementSchema,
  apiTestHistory,
  apiTests,
  insertApiTestHistorySchema,
  insertApiTestSchema,
  updateApiTestSchema,
  AssertionSchema, // Import AssertionSchema
  schedules,
  insertScheduleSchema,
  updateScheduleSchema,
  // schedulesRelations, // Not currently used in this file, but good to be aware of
  testPlans,             // Import testPlans table schema
  insertTestPlanSchema,  // Import Zod schema for inserting test plans
  updateTestPlanSchema,  // Import Zod schema for updating test plans
  selectTestPlanSchema,   // Import Zod schema for selecting test plans
  systemSettings,        // Import systemSettings table schema
  insertSystemSettingSchema // Import Zod schema for systemSettings
} from "@shared/schema";
import { z } from "zod";
import { v4 as uuidv4 } from 'uuid'; // For generating IDs
import { createInsertSchema } from 'drizzle-zod';
import { db } from "./db";
import { eq, and, desc, sql, leftJoin, getTableColumns, asc } from "drizzle-orm"; // Added leftJoin, getTableColumns, and asc
import { playwrightService } from "./playwright-service";
import type { Logger as WinstonLogger } from 'winston';


// Zod schema for validating POST /api/settings request body
const userSettingsBodySchema = createInsertSchema(userSettings, {
  playwrightHeadless: z.boolean().optional(),
  playwrightDefaultTimeout: z.number().int().positive().optional(),
  playwrightWaitTime: z.number().int().positive().optional(),
  theme: z.string().optional(),
  defaultTestUrl: z.string().url().or(z.literal('')).optional().nullable(),
  playwrightBrowser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
}).omit({ userId: true });

const executeDirectTestSchema = z.object({
  url: z.string().url({ message: "Invalid URL format" }).min(1, {message: "URL cannot be empty"}),
  sequence: z.array(AdhocTestStepSchema).min(1, { message: "Sequence must contain at least one step" }),
  elements: z.array(AdhocDetectedElementSchema),
  name: z.string().optional().default("Ad-hoc Test"),
});

const startRecordingSchema = z.object({
  url: z.string().url({ message: "Invalid URL format" }).min(1, {message: "URL cannot be empty"}),
});

const stopRecordingSchema = z.object({
  sessionId: z.string().min(1, {message: "Session ID cannot be empty"}),
});

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

export async function registerRoutes(app: Express): Promise<Server> {
  const resolvedLogger: WinstonLogger = await logger; // Resolve the logger promise
  setupAuth(app);

  const loadWebsiteBodySchema = z.object({
    url: z.string().min(1, { message: "URL cannot be empty" }).url({ message: "Invalid URL format" }),
  });

  app.post("/api/load-website", async (req, res) => {
    resolvedLogger.http(`POST /api/load-website - Handler reached. UserId: ${(req.user as any)?.id}`);
    resolvedLogger.debug({ message: "POST /api/load-website - Request body:", body: req.body });

    const parseResult = loadWebsiteBodySchema.safeParse(req.body);

    if (!parseResult.success) {
      resolvedLogger.warn({ message: "POST /api/load-website - Invalid request body", errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ success: false, error: 'Invalid request payload', details: parseResult.error.flatten() });
    }

    const { url } = parseResult.data;
    const userId = (req.user as any)?.id as number | undefined;

    try {
      resolvedLogger.debug({ message: `POST /api/load-website - Calling playwrightService.loadWebsite`, url, userId });
      const result = await playwrightService.loadWebsite(url, userId);
      resolvedLogger.debug({ message: `POST /api/load-website - playwrightService.loadWebsite returned`, success: result?.success, url, userId });

      if (result.success) {
        res.json({ success: true, screenshot: result.screenshot, html: result.html });
      } else {
        resolvedLogger.error({ message: `POST /api/load-website - playwrightService.loadWebsite failed`, error: result.error, url, userId });
        res.status(500).json({ success: false, error: result.error || 'Failed to load website using Playwright service.' });
      }
    } catch (error: any) {
      resolvedLogger.error({ message: "POST /api/load-website - Critical error in route handler", error: error.message, stack: error.stack, url, userId });
      const errorMessage = error instanceof Error ? error.message : 'Unknown internal server error';
      res.status(500).json({ success: false, error: `Internal server error: ${errorMessage}` });
    }
  });

  app.post("/api/proxy-api-request", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parseResult = proxyApiRequestBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({ message: "POST /api/proxy-api-request - Invalid payload", errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    const { method, url: baseUrl, queryParams, headers: customHeaders, body: requestBody, assertions } = parseResult.data;
    const startTime = Date.now();
    let timeoutId: NodeJS.Timeout | undefined = undefined;

    try {
      const targetUrl = new URL(baseUrl);
      if (queryParams) {
        Object.entries(queryParams).forEach(([key, value]) => {
          if (Array.isArray(value)) { value.forEach(v => targetUrl.searchParams.append(key, v)); }
          else { targetUrl.searchParams.set(key, value); }
        });
      }

      const requestOptions: RequestInit = { method, headers: customHeaders ? { ...customHeaders } : {} };
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

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 30000);
      requestOptions.signal = controller.signal;

      const apiResponse = await fetch(targetUrl.toString(), requestOptions);
      clearTimeout(timeoutId);
      timeoutId = undefined;

      const duration = Date.now() - startTime;
      const responseStatus = apiResponse.status;
      const responseHeaders: Record<string, string> = {};
      apiResponse.headers.forEach((value, key) => { responseHeaders[key] = value; });

      let responseBodyContent: any;
      const contentType = apiResponse.headers.get("content-type");
      let responseText = await apiResponse.text();
      try {
        if (contentType && contentType.includes("application/json") && responseText) {
          responseBodyContent = JSON.parse(responseText);
        } else {
          responseBodyContent = responseText;
        }
      } catch (parseError) {
        resolvedLogger.warn("Failed to parse response body as JSON, falling back to text", { url: targetUrl.toString(), contentType, error: parseError });
        responseBodyContent = responseText;
      }

      let assertionResults: Array<{ assertion: z.infer<typeof AssertionSchema>; pass: boolean; actualValue: any; error?: string }> = [];
      if (assertions && assertions.length > 0) {
        assertions.forEach(assertion => {
          if (!assertion.enabled) return;
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
                        if (actualValue === undefined || actualValue === null) { pass = true; }
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
                        pass = true; actualValue = undefined; evalError = undefined;
                   } else if (assertion.comparison === 'is_empty' && (!responseBodyContent || (typeof responseBodyContent === 'object' && Object.keys(responseBodyContent).length === 0) || (typeof responseBodyContent === 'string' && responseBodyContent === ''))) {
                        pass = true; actualValue = responseBodyContent; evalError = undefined;
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
              default: evalError = `Unknown assertion source: ${(assertion as any).source}`;
            }
          } catch (e: any) {
            resolvedLogger.error("Error during assertion evaluation:", { assertion, error: e.message });
            evalError = `Evaluation error: ${e.message}`;
          }
          assertionResults.push({ assertion, pass, actualValue, error: evalError });
        });
      }

      res.status(200).json({
        success: true, status: responseStatus, headers: responseHeaders,
        body: responseBodyContent, duration: duration, assertionResults: assertionResults,
      });

    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      resolvedLogger.error("Error in /api/proxy-api-request:", {
        message: error.message, stack: error.stack, url: baseUrl, method: method, type: error.name, cause: error.cause
      });
      let errorMessage = "Failed to make API request.";
      if (error.name === 'AbortError') { errorMessage = "Request timed out after 30 seconds."; }
      else if (error instanceof TypeError && error.message.includes('Invalid URL')) { errorMessage = "Invalid URL provided."; }
      else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') { errorMessage = `Could not connect to the server at ${baseUrl}. Please check the URL and network.`; }
      else if (error.cause && typeof error.cause === 'object' && 'code' in error.cause) { // More specific network errors
        errorMessage = `Network error: ${error.cause.code}`;
      }
      res.status(500).json({ success: false, error: errorMessage, details: error.message, duration: duration });
    }
  });

  app.get("/api/projects", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;

    try {
      const userProjects = await db
        .select()
        .from(projects)
        .where(eq(projects.userId, userId))
        .orderBy(asc(projects.name)); // Order by project name ascending

      res.status(200).json(userProjects);
    } catch (error: any) {
      resolvedLogger.error({ // Ensure resolvedLogger is defined in this scope or use logger directly
        message: `Error fetching projects for user ${userId}`,
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  const detectElementsBodySchema = z.object({
    url: z.string().url({ message: "Invalid URL for element detection" }),
  });
  app.post("/api/detect-elements", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { // Ensure user is authenticated
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const parseResult = detectElementsBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({ message: "POST /api/detect-elements - Invalid request body", errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ success: false, error: "Invalid request payload", details: parseResult.error.flatten() });
    }
    const { url } = parseResult.data;
    const userId = (req.user as any)?.id as number | undefined;

    resolvedLogger.http(`POST /api/detect-elements - Handler reached. URL: ${url}, UserID: ${userId}`);
    resolvedLogger.debug({ message: "POST /api/detect-elements - Request body:", body: req.body });


    try {
      resolvedLogger.debug({ message: `POST /api/detect-elements - Calling playwrightService.detectElements`, url, userId });
      const elements = await playwrightService.detectElements(url, userId);
      resolvedLogger.debug({ message: `POST /api/detect-elements - playwrightService.detectElements returned`, elementCount: elements?.length, url, userId });

      res.json({ success: true, elements: elements });
    } catch (error: any) {
      resolvedLogger.error({ message: "POST /api/detect-elements - Error in route handler", error: error.message, stack: error.stack, url, userId });
      const errorMessage = error instanceof Error ? error.message : 'Unknown internal server error';
      res.status(500).json({ success: false, error: `Internal server error during element detection: ${errorMessage}` });
    }
  });

  app.post("/api/projects", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;

    // Validate payload using insertProjectSchema (which expects 'name')
    // insertProjectSchema already has .pick({ name: true })
    // and also validates name: z.string().min(1, "Project name cannot be empty")
    const parseResult = insertProjectSchema.safeParse(req.body);

    if (!parseResult.success) {
      resolvedLogger.warn({
        message: "POST /api/projects - Invalid payload",
        errors: parseResult.error.flatten(),
        userId,
      });
      return res.status(400).json({ error: "Invalid project data", details: parseResult.error.flatten() });
    }

    const { name } = parseResult.data;

    try {
      const newProject = await db
        .insert(projects)
        .values({
          name,
          userId,
          // createdAt is handled by default in schema
        })
        .returning(); // Return all fields of the new project

      if (newProject.length === 0) {
        resolvedLogger.error({ message: "Project creation failed, no record returned.", name, userId });
        return res.status(500).json({ error: "Failed to create project." });
      }
      res.status(201).json(newProject[0]);
    } catch (error: any) {
      resolvedLogger.error({
        message: "Error creating project",
        userId,
        projectName: name,
        error: error.message,
        stack: error.stack,
      });
      // Check for unique constraint errors if project names must be unique per user (not explicitly defined but common)
      // if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') { // Example for SQLite
      //   return res.status(409).json({ error: "A project with this name already exists." });
      // }
      res.status(500).json({ error: "Failed to create project" });
    }
  });
  app.delete("/api/projects/:projectId", async (req, res) => {
    // Ensure 'projects', 'eq', 'and', 'db', 'resolvedLogger' are correctly imported/available in scope.
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;
    const projectIdString = req.params.projectId;
    const parsedProjectId = parseInt(projectIdString, 10);

    if (isNaN(parsedProjectId)) {
      return res.status(400).json({ error: "Invalid project ID format." });
    }

    try {
      const projectToDelete = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, parsedProjectId), eq(projects.userId, userId)))
        .limit(1);

      if (projectToDelete.length === 0) {
        return res.status(404).json({ error: "Project not found or not owned by user." });
      }

      await db
        .delete(projects)
        .where(and(eq(projects.id, parsedProjectId), eq(projects.userId, userId)));

      res.status(204).send();

    } catch (error: any) {
      resolvedLogger.error({
        message: `Error deleting project ${parsedProjectId} for user ${userId}`,
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to delete project due to a server error." });
    }
  });

  app.get("/api/tests", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;

    try {
      const userInterfaceTests = await db
        .select({
          ...getTableColumns(tests), // Selects all columns from the 'tests' table
          projectName: projects.name,
          creatorUsername: users.username, // Added creatorUsername
        })
        .from(tests)
        .leftJoin(projects, eq(tests.projectId, projects.id))
        .leftJoin(users, eq(tests.userId, users.id)) // Join with users table
        .where(eq(tests.userId, userId))
        .orderBy(desc(tests.updatedAt));

      // No manual JSON.parse needed here if tests.sequence and tests.elements are { mode: 'json' }
      // Drizzle should handle the parsing.
      res.json(userInterfaceTests);
    } catch (error: any) {
      resolvedLogger.error({
        message: `Error fetching UI tests for user ${userId}`,
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to fetch UI tests" });
    }
  });

  // Schema for creating a new test (general UI test, not API test)
  const createTestBodySchema = insertTestSchema.extend({
    projectId: z.number().int().positive(), // Make projectId explicitly required
    sequence: z.array(AdhocTestStepSchema), // Expect an array of AdhocTestStepSchema
    elements: z.array(AdhocDetectedElementSchema), // Expect an array of AdhocDetectedElementSchema
    // name and url are already required by insertTestSchema via the base 'tests' table definition
  }).omit({ userId: true }); // userId will come from the session

  app.post("/api/tests", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;

    const parseResult = createTestBodySchema.safeParse(req.body);

    if (!parseResult.success) {
      resolvedLogger.warn({
        message: "POST /api/tests - Invalid payload",
        errors: parseResult.error.flatten(),
        userId,
      });
      return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() });
    }

    const { name, url, sequence, elements, projectId, status } = parseResult.data;

    try {
      const newTest = await db
        .insert(tests)
        .values({
          userId,
          projectId,
          name,
          url,
          sequence: JSON.stringify(sequence), // Stringify sequence array
          elements: JSON.stringify(elements), // Stringify elements array
          status: status || "draft", // Default to draft if not provided
          // createdAt and updatedAt are handled by default in schema
        })
        .returning();

      if (newTest.length === 0) {
        resolvedLogger.error({ message: "Test creation failed, no record returned.", name, userId });
        return res.status(500).json({ error: "Failed to create test." });
      }
      res.status(201).json(newTest[0]);
    } catch (error: any) {
      resolvedLogger.error({
        message: "Error creating test",
        userId,
        testName: name,
        error: error.message,
        stack: error.stack,
      });
      if (error.message && error.message.includes('FOREIGN KEY constraint failed')) {
        return res.status(400).json({ error: "Invalid project ID or project does not exist." });
      }
      res.status(500).json({ error: "Failed to create test" });
    }
  });
  app.put("/api/tests/:id", async (req, res) => { /* ... existing code ... */ });
  app.post("/api/tests/:id/execute", async (req, res) => { /* ... existing code ... */ });
  app.get("/api/settings", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const settings = await db.select().from(userSettings).where(eq(userSettings.userId, req.user.id)).limit(1);

      if (settings.length > 0) {
        return res.json(settings[0]);
      } else {
        // No settings found, create default settings
        const defaultSettings = {
          userId: req.user.id,
          theme: "light",
          defaultTestUrl: "",
          playwrightBrowser: "chromium",
          playwrightHeadless: true,
          playwrightDefaultTimeout: 30000,
          playwrightWaitTime: 1000,
          language: "en",
        };

        const newSettings = await db.insert(userSettings).values(defaultSettings).returning();
        return res.json(newSettings[0]);
      }
    } catch (error: any) {
      resolvedLogger.error({ message: "Failed to fetch user settings", userId: (req.user as any)?.id, error: error.message, stack: error.stack });
      return res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parseResult = userSettingsBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({ message: "POST /api/settings - Invalid payload", errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    try {
      const existingSettings = await db.select().from(userSettings).where(eq(userSettings.userId, req.user.id)).limit(1);

      if (existingSettings.length > 0) {
        // Update existing settings
        const updatedSettings = await db.update(userSettings)
          .set({ ...parseResult.data, updatedAt: sql`datetime('now')` as any })
          .where(eq(userSettings.userId, req.user.id))
          .returning();
        return res.json(updatedSettings[0]);
      } else {
        // Insert new settings
        const newSettings = await db.insert(userSettings)
          .values({ ...parseResult.data, userId: req.user.id })
          .returning();
        return res.json(newSettings[0]);
      }
    } catch (error: any) {
      resolvedLogger.error({ message: "Failed to save user settings", userId: (req.user as any)?.id, error: error.message, stack: error.stack, body: req.body });
      return res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.post("/api/execute-test-direct", async (req, res) => {
    const userId = (req.user as any)?.id;
    resolvedLogger.http({ message: "POST /api/execute-test-direct - Handler Reached.", userId });
    resolvedLogger.debug({ message: "POST /api/execute-test-direct - Request body:", body: req.body, userId });

    if (!req.isAuthenticated() || !userId) {
      resolvedLogger.warn({ message: "POST /api/execute-test-direct - Unauthorized access attempt.", userId });
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const parseResult = executeDirectTestSchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({ message: "POST /api/execute-test-direct - Invalid request payload", errors: parseResult.error.flatten(), userId });
      return res.status(400).json({ success: false, error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    const payload = parseResult.data;
    let resultFromService: any; // Keep it flexible to hold partial results in case of error

    try {
      resolvedLogger.debug({ message: "POST /api/execute-test-direct - Calling playwrightService.executeAdhocSequence.", userId, testName: payload.name });
      resultFromService = await playwrightService.executeAdhocSequence(payload, userId);
      resolvedLogger.debug({ message: "POST /api/execute-test-direct - playwrightService.executeAdhocSequence returned.", userId, testName: payload.name, serviceSuccess: resultFromService?.success });
      resolvedLogger.debug({ message: "POST /api/execute-test-direct - Result from service:", result: resultFromService, userId });

      // Ensure that even if executeAdhocSequence returns a non-standard error structure, we handle it
      if (typeof resultFromService?.success === 'boolean') {
        res.json(resultFromService);
      } else {
        // This case implies executeAdhocSequence might have thrown an error that was caught by the outer try-catch
        // or returned an unexpected structure.
        resolvedLogger.error({ message: "POST /api/execute-test-direct - Unexpected structure from playwrightService.executeAdhocSequence.", resultFromService, userId, testName: payload.name });
        res.status(500).json({
          success: false,
          error: "Internal server error: Unexpected response from test execution service.",
          steps: [],
          detectedElements: [],
          duration: 0
        });
      }
    } catch (error: any) {
      resolvedLogger.error({ message: `POST /api/execute-test-direct - ERROR during playwrightService.executeAdhocSequence call or response sending`, error: error.message, stack: error.stack, userId, testName: payload.name });
      const responseError = {
        success: false,
        error: "Error executing test sequence: " + error.message,
        steps: resultFromService?.steps || [],
        detectedElements: resultFromService?.detectedElements || [],
        duration: resultFromService?.duration || 0,
      };
      if (!res.headersSent) {
        res.status(500).json(responseError);
      }
    } finally {
      let logData: any = {
        message: "POST /api/execute-test-direct - Handler complete.",
        userId,
        testName: payload.name
      };
      if (resultFromService) {
        logData.overallSuccess = resultFromService.success;
        logData.stepsReturned = resultFromService.steps?.length;
        logData.error = resultFromService.success ? undefined : resultFromService.error; // This is service error, not our log error
      } else {
        logData.overallSuccess = false;
        // logData.error already indicates resultFromService was undefined if it's not set by error block
      }
      resolvedLogger.http(logData); // Changed to http for summary log

      resolvedLogger.debug({
        message: "POST /api/execute-test-direct - Full response that was/would be sent:",
        responseDetails: resultFromService || "Error response sent in catch block or resultFromService was undefined",
        userId
      });
    }
  });
  // --- Recording API Endpoints ---
  app.post("/api/start-recording", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const startRecordingSchema = z.object({
      url: z.string().url("Invalid URL format")
    });
    
    const parseResult = startRecordingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: "Invalid request data", 
        details: parseResult.error.flatten() 
      });
    }
    
    try {
      const { url } = parseResult.data;
      const result = await playwrightService.startRecordingSession(url, req.user.id);
      
      if (result.success) {
        res.json({ 
          success: true, 
          sessionId: result.sessionId 
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: result.error || "Failed to start recording session" 
        });
      }
    } catch (error: any) {
      resolvedLogger.error({ message: "Error starting recording session", error: error.message, stack: error.stack, url: req.body?.url, userId: (req.user as any)?.id });
      res.status(500).json({ 
        success: false, 
        error: "Internal server error" 
      });
    }
  });
  
  app.post("/api/stop-recording", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const stopRecordingSchema = z.object({
      sessionId: z.string().min(1, "Session ID is required")
    });
    
    const parseResult = stopRecordingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: "Invalid request data", 
        details: parseResult.error.flatten() 
      });
    }
    
    try {
      const { sessionId } = parseResult.data;
      const result = await playwrightService.stopRecordingSession(sessionId, req.user.id);
      
      if (result.success) {
        res.json({ 
          success: true, 
          sequence: result.actions || [] 
        });
      } else {
        res.status(404).json({ 
          success: false, 
          error: result.error || "Recording session not found" 
        });
      }
    } catch (error: any) {
      resolvedLogger.error({ message: "Error stopping recording session", error: error.message, stack: error.stack, sessionId: req.body?.sessionId, userId: (req.user as any)?.id });
      res.status(500).json({ 
        success: false, 
        error: "Internal server error" 
      });
    }
  });
  
  app.get("/api/get-recorded-actions", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const getRecordedActionsSchema = z.object({
      sessionId: z.string().min(1, "Session ID is required")
    });
    
    const parseResult = getRecordedActionsSchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: "Invalid request data", 
        details: parseResult.error.flatten() 
      });
    }
    
    try {
      const { sessionId } = parseResult.data;
      const result = await playwrightService.getRecordedActions(sessionId, req.user.id);
      
      if (result.success) {
        res.json({ 
          success: true, 
          actions: result.actions || [] 
        });
      } else {
        res.status(404).json({ 
          success: false, 
          error: result.error || "Recording session not found" 
        });
      }
    } catch (error: any) {
      resolvedLogger.error({ message: "Error getting recorded actions", error: error.message, stack: error.stack, sessionId: req.query?.sessionId, userId: (req.user as any)?.id });
      res.status(500).json({ 
        success: false, 
        error: "Internal server error" 
      });
    }
  });

  // --- API Test History Endpoints ---
  app.post("/api/api-test-history", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const parseResult = insertApiTestHistorySchema.safeParse(req.body);
    if (!parseResult.success) { resolvedLogger.warn({ message: "POST /api/api-test-history - Invalid payload", errors: parseResult.error.flatten(), userId: (req.user as any)?.id }); return res.status(400).json({ error: "Invalid history data", details: parseResult.error.flatten() }); }
    try {
      const newHistoryEntry = await db.insert(apiTestHistory).values({ ...parseResult.data, userId: req.user.id }).returning();
      res.status(201).json(newHistoryEntry[0]);
    } catch (error: any) { resolvedLogger.error({ message: "Error creating API test history entry", error: error.message, stack: error.stack, requestBody: req.body, userId: (req.user as any)?.id }); res.status(500).json({ error: "Failed to save API test history" }); }
  });

  app.get("/api/api-test-history", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    try {
      const historyEntries = await db.select().from(apiTestHistory).where(eq(apiTestHistory.userId, req.user.id)).orderBy(desc(apiTestHistory.createdAt)).limit(limit).offset(offset);
      const totalResult = await db.select({ count: sql`count(*)` }).from(apiTestHistory).where(eq(apiTestHistory.userId, req.user.id));
      const total = totalResult[0]?.count || 0;
      res.json({ items: historyEntries, page, limit, totalItems: Number(total), totalPages: Math.ceil(Number(total) / limit) });
    } catch (error: any) { resolvedLogger.error({ message: "Error fetching API test history", error: error.message, stack: error.stack, userId: (req.user as any)?.id, query: req.query }); res.status(500).json({ error: "Failed to fetch API test history" }); }
  });

  app.delete("/api/api-test-history/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const id = parseInt(req.params.id);
    if (isNaN(id)) { return res.status(400).json({ error: "Invalid history ID" }); }
    try {
      const result = await db.delete(apiTestHistory).where(and(eq(apiTestHistory.id, id), eq(apiTestHistory.userId, req.user.id))).returning();
      if (result.length === 0) { return res.status(404).json({ error: "History entry not found or not owned by user" }); }
      res.status(204).send();
    } catch (error: any) { resolvedLogger.error({ message: `Error deleting API test history entry ${id}`, error: error.message, stack: error.stack, userId: (req.user as any)?.id }); res.status(500).json({ error: "Failed to delete history entry" }); }
  });

  // --- Saved API Tests Endpoints ---
  app.post("/api/api-tests", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const postApiTestSchema = insertApiTestSchema.extend({ projectId: z.number().int().positive().optional().nullable() });
    const parseResult = postApiTestSchema.safeParse(req.body);
    if (!parseResult.success) { resolvedLogger.warn({ message: "POST /api/api-tests - Invalid payload", errors: parseResult.error.flatten(), userId: (req.user as any)?.id }); return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() }); }
    try {
      const { projectId, ...testData } = parseResult.data;
      const newTest = await db.insert(apiTests).values({
          ...testData, userId: req.user.id, projectId: projectId,
          // Stringify JSON fields
          queryParams: testData.queryParams ? JSON.stringify(testData.queryParams) : null,
          requestHeaders: testData.requestHeaders ? JSON.stringify(testData.requestHeaders) : null,
          requestBody: testData.requestBody ? (typeof testData.requestBody === 'string' ? testData.requestBody : JSON.stringify(testData.requestBody)) : null,
          assertions: testData.assertions ? JSON.stringify(testData.assertions) : null,
          authParams: testData.authParams ? JSON.stringify(testData.authParams) : null,
          bodyFormData: testData.bodyFormData ? JSON.stringify(testData.bodyFormData) : null,
          bodyUrlEncoded: testData.bodyUrlEncoded ? JSON.stringify(testData.bodyUrlEncoded) : null,
        }).returning();
      res.status(201).json(newTest[0]);
    } catch (error: any) {
      resolvedLogger.error({ message: "Error creating API test", error: error.message, stack: error.stack, requestBody: req.body, userId: (req.user as any)?.id });
      if (error.message && error.message.includes('FOREIGN KEY constraint failed')) { return res.status(400).json({ error: "Invalid project ID or project does not exist." }); }
      res.status(500).json({ error: "Failed to create API test" });
    }
  });

  app.get("/api/api-tests", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;

    try {
      const userTestsWithDetails = await db
        .select({
          ...getTableColumns(apiTests),
          creatorUsername: users.username,
          projectName: projects.name,
        })
        .from(apiTests)
        .leftJoin(users, eq(apiTests.userId, users.id))
        .leftJoin(projects, eq(apiTests.projectId, projects.id))
        .where(eq(apiTests.userId, userId))
        .orderBy(desc(apiTests.updatedAt));

      res.json(userTestsWithDetails);
    } catch (error: any) {
      resolvedLogger.error({
        message: "Error fetching API tests with details",
        userId,
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to fetch API tests" });
    }
  });

  app.get("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;
    const testId = parseInt(req.params.id);

    if (isNaN(testId)) {
      return res.status(400).json({ error: "Invalid test ID format" });
    }

    try {
      const result = await db
        .select({
          ...getTableColumns(apiTests),
          creatorUsername: users.username,
          projectName: projects.name,
        })
        .from(apiTests)
        .leftJoin(users, eq(apiTests.userId, users.id))
        .leftJoin(projects, eq(apiTests.projectId, projects.id))
        .where(and(eq(apiTests.id, testId), eq(apiTests.userId, userId)))
        .limit(1);

      if (result.length === 0) {
        return res.status(404).json({ error: "API Test not found or not authorized" });
      }
      // The result from Drizzle is an array, even with limit(1), so return the first element.
      res.json(result[0]);
    } catch (error: any) {
      resolvedLogger.error({
        message: `Error fetching API test with ID ${testId}`,
        userId,
        testId,
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to fetch API test" });
    }
  });

  app.put("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const id = parseInt(req.params.id);
    if (isNaN(id)) { return res.status(400).json({ error: "Invalid test ID" }); }
    const putApiTestSchema = updateApiTestSchema.extend({ projectId: z.number().int().positive().optional().nullable() });
    const parseResult = putApiTestSchema.safeParse(req.body);
    if (!parseResult.success) { resolvedLogger.warn({ message: `PUT /api/api-tests/${id} - Invalid payload`, errors: parseResult.error.flatten(), userId: (req.user as any)?.id }); return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() }); }
    try {
      const { projectId, ...testData } = parseResult.data;
      const existingTest = await db.select({id: apiTests.id}).from(apiTests).where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user.id)));
      if (existingTest.length === 0) { return res.status(404).json({ error: "Test not found or not owned by user" }); }

      const updatedValues: Partial<typeof apiTests.$inferInsert> = { ...testData, projectId, updatedAt: sql`datetime('now')` as any };
      // Conditionally stringify JSON fields if they are provided in the payload
      if (testData.queryParams !== undefined) updatedValues.queryParams = testData.queryParams ? JSON.stringify(testData.queryParams) : null;
      if (testData.requestHeaders !== undefined) updatedValues.requestHeaders = testData.requestHeaders ? JSON.stringify(testData.requestHeaders) : null;
      if (testData.requestBody !== undefined) updatedValues.requestBody = testData.requestBody ? (typeof testData.requestBody === 'string' ? testData.requestBody : JSON.stringify(testData.requestBody)) : null;
      if (testData.assertions !== undefined) updatedValues.assertions = testData.assertions ? JSON.stringify(testData.assertions) : null;
      if (testData.authParams !== undefined) updatedValues.authParams = testData.authParams ? JSON.stringify(testData.authParams) : null;
      if (testData.bodyFormData !== undefined) updatedValues.bodyFormData = testData.bodyFormData ? JSON.stringify(testData.bodyFormData) : null;
      if (testData.bodyUrlEncoded !== undefined) updatedValues.bodyUrlEncoded = testData.bodyUrlEncoded ? JSON.stringify(testData.bodyUrlEncoded) : null;
      // Fields like authType, bodyType, bodyRawContentType, bodyGraphqlQuery, bodyGraphqlVariables are plain text or handled by ...testData

      const updatedTest = await db.update(apiTests).set(updatedValues).where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user.id))).returning();
      if (updatedTest.length === 0) { return res.status(404).json({ error: "Test not found after update attempt" }); }
      res.json(updatedTest[0]);
    } catch (error: any) {
      resolvedLogger.error({ message: `Error updating API test ${id}`, error: error.message, stack: error.stack, requestBody: req.body, userId: (req.user as any)?.id });
      if (error.message && error.message.includes('FOREIGN KEY constraint failed')) { return res.status(400).json({ error: "Invalid project ID or project does not exist." }); }
      res.status(500).json({ error: "Failed to update API test" });
    }
  });

  app.delete("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id;
    const testId = parseInt(req.params.id);

    if (isNaN(testId)) {
      return res.status(400).json({ error: "Invalid test ID format" });
    }

    try {
      const result = await db
        .delete(apiTests)
        .where(and(eq(apiTests.id, testId), eq(apiTests.userId, userId)))
        .returning(); // .returning() might not be supported on all SQLite drivers for DELETE or might return empty array.
                      // For DELETE, checking affectedRows is more common if driver supports it, or just assume success if no error.

      // Check if any row was actually deleted. Drizzle's delete().returning() might return the deleted row(s).
      // If it returns an empty array, it means no row matched the condition (either not found or not authorized).
      if (result.length === 0) {
         // To distinguish between not found and not authorized, one might do a select first,
         // but for a delete operation, simply stating "not found" is often sufficient.
        return res.status(404).json({ error: "API Test not found or not authorized" });
      }

      res.status(204).send(); // Successfully deleted, no content to return.
    } catch (error: any) {
      resolvedLogger.error({
        message: `Error deleting API test with ID ${testId}`,
        userId,
        testId,
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to delete API test" });
    }
  });

  // --- Schedules API Endpoints ---

  // GET /api/schedules - List all schedules for the authenticated user
  // (Note: The current schedules schema does not have a userId.
  //  If multi-tenancy is required, userId should be added to schedules table and queries.)
  app.get("/api/schedules", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const result = await db
        .select({
          // Select all columns from schedules table
          id: schedules.id,
          scheduleName: schedules.scheduleName,
          testPlanId: schedules.testPlanId,
          frequency: schedules.frequency,
          nextRunAt: schedules.nextRunAt,
          createdAt: schedules.createdAt,
          updatedAt: schedules.updatedAt,
          // Select testPlanName from the joined testPlans table
          testPlanName: testPlans.name,
        })
        .from(schedules)
        .leftJoin(testPlans, eq(schedules.testPlanId, testPlans.id))
        .orderBy(desc(schedules.createdAt));
        // Add .where(eq(schedules.userId, req.user.id)) if user-specific

      res.json(result);
    } catch (error: any) {
      resolvedLogger.error({ message: "Error fetching schedules", error: error.message, stack: error.stack, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to fetch schedules" });
    }
  });

  // POST /api/schedules - Create a new schedule
  app.post("/api/schedules", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // insertScheduleSchema already expects testPlanId and does not include testPlanName
    const parseResult = insertScheduleSchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({ message: "POST /api/schedules - Invalid payload", errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    try {
      const newScheduleData = parseResult.data;
      const scheduleId = uuidv4();

      let nextRunAtTimestamp: number;
      if (newScheduleData.nextRunAt instanceof Date) {
        nextRunAtTimestamp = Math.floor(newScheduleData.nextRunAt.getTime() / 1000);
      } else {
        nextRunAtTimestamp = newScheduleData.nextRunAt;
      }

      // The 'id' field in insertScheduleSchema might need to be explicitly handled if not auto-generated by DB or if client must provide it.
      // Based on previous patterns, client-generated ID was assumed for text PKs.
      // The subtask for schedule API creation used server-generated UUID for schedules.id.
      // The Zod schema `insertScheduleSchema` should be `omit({id: true})` if server generates ID.
      // Let's re-check the definition of insertScheduleSchema. It is:
      // .omit({ createdAt: true, updatedAt: true }); -> This means `id` and `testPlanId` are required by Zod.
      // The previous POST handler for schedules had `insertScheduleSchema.omit({ id: true })`
      // For consistency, let's assume server generates schedule ID.

      const valuesToInsert = {
        ...newScheduleData, // Contains testPlanId (validated by Zod to be present)
        id: scheduleId,    // Server-generated schedule ID
        nextRunAt: nextRunAtTimestamp,
        updatedAt: Math.floor(Date.now() / 1000),
      };

      const createdScheduleResult = await db.insert(schedules).values(valuesToInsert).returning();

      if (createdScheduleResult.length === 0) {
        resolvedLogger.error({ message: "Schedule creation failed, no record returned", valuesToInsert, userId: (req.user as any)?.id });
        return res.status(500).json({ error: "Failed to create schedule." });
      }

      // Fetch the newly created schedule with testPlanName for the response
      const finalResult = await db
        .select({
          id: schedules.id, scheduleName: schedules.scheduleName, testPlanId: schedules.testPlanId,
          frequency: schedules.frequency, nextRunAt: schedules.nextRunAt, createdAt: schedules.createdAt,
          updatedAt: schedules.updatedAt, testPlanName: testPlans.name,
        })
        .from(schedules)
        .leftJoin(testPlans, eq(schedules.testPlanId, testPlans.id))
        .where(eq(schedules.id, scheduleId))
        .limit(1);

      if (finalResult.length === 0) {
         resolvedLogger.error({ message: "Failed to fetch newly created schedule with test plan name", scheduleId, userId: (req.user as any)?.id });
         return res.status(500).json({ error: "Failed to retrieve created schedule details." });
      }

      res.status(201).json(finalResult[0]);
    } catch (error: any) {
      resolvedLogger.error({ message: "Error creating schedule", error: error.message, stack: error.stack, requestBody: req.body, userId: (req.user as any)?.id });
      if (error.message && error.message.toLowerCase().includes('foreign key constraint failed')) {
        return res.status(400).json({ error: "Invalid Test Plan ID: The specified Test Plan does not exist." });
      }
      res.status(500).json({ error: "Failed to create schedule" });
    }
  });

  // PUT /api/schedules/:id - Update an existing schedule
  app.put("/api/schedules/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const scheduleId = req.params.id;

    // updateScheduleSchema does not include testPlanName
    const parseResult = updateScheduleSchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({ message: `PUT /api/schedules/${scheduleId} - Invalid payload`, errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    try {
      const updates = parseResult.data;
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No update data provided." });
      }

      let nextRunAtTimestamp: number | undefined = undefined;
      if (updates.nextRunAt !== undefined) {
        if (updates.nextRunAt instanceof Date) {
          nextRunAtTimestamp = Math.floor(updates.nextRunAt.getTime() / 1000);
        } else { // Assuming it's already a number (timestamp) or Zod validated it
          nextRunAtTimestamp = updates.nextRunAt;
        }
      }

      const valuesToUpdate: Partial<typeof schedules.$inferInsert> = {
        ...updates, // scheduleName, testPlanId, frequency are from Zod schema
        nextRunAt: nextRunAtTimestamp,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      // Remove undefined fields from valuesToUpdate to avoid issues with Drizzle set
      Object.keys(valuesToUpdate).forEach(key => valuesToUpdate[key as keyof typeof valuesToUpdate] === undefined && delete valuesToUpdate[key as keyof typeof valuesToUpdate]);


      const updatedScheduleResult = await db
        .update(schedules)
        .set(valuesToUpdate)
        .where(eq(schedules.id, scheduleId))
        .returning({ updatedId: schedules.id }); // Drizzle returns only specified fields after update

      if (updatedScheduleResult.length === 0) {
        return res.status(404).json({ error: "Schedule not found or no changes made." });
      }

      // Fetch the updated schedule with testPlanName for the response
      const finalResult = await db
        .select({
          id: schedules.id, scheduleName: schedules.scheduleName, testPlanId: schedules.testPlanId,
          frequency: schedules.frequency, nextRunAt: schedules.nextRunAt, createdAt: schedules.createdAt,
          updatedAt: schedules.updatedAt, testPlanName: testPlans.name,
        })
        .from(schedules)
        .leftJoin(testPlans, eq(schedules.testPlanId, testPlans.id))
        .where(eq(schedules.id, scheduleId))
        .limit(1);

      if (finalResult.length === 0) {
         resolvedLogger.error({ message: "Failed to fetch updated schedule with test plan name", scheduleId, userId: (req.user as any)?.id });
         return res.status(404).json({ error: "Schedule not found after update." });
      }
      res.json(finalResult[0]);

    } catch (error: any) {
      resolvedLogger.error({ message: `Error updating schedule ${scheduleId}`, error: error.message, stack: error.stack, requestBody: req.body, userId: (req.user as any)?.id });
      if (error.message && error.message.toLowerCase().includes('foreign key constraint failed')) {
        return res.status(400).json({ error: "Invalid Test Plan ID: The specified Test Plan does not exist." });
      }
      res.status(500).json({ error: "Failed to update schedule" });
    }
  });

  // DELETE /api/schedules/:id - Delete a schedule
  // No changes needed here regarding testPlanName as it's already removed from schedules table
  app.delete("/api/schedules/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const scheduleId = req.params.id;
    try {
      const result = await db
        .delete(schedules)
        .where(eq(schedules.id, scheduleId))
        .returning();

      if (result.length === 0) {
        return res.status(404).json({ error: "Schedule not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      resolvedLogger.error({ message: `Error deleting schedule ${scheduleId}`, error: error.message, stack: error.stack, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to delete schedule" });
    }
  });

  // --- Test Plans API Endpoints ---

  // GET /api/test-plans - List all test plans
  app.get("/api/test-plans", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      // Add .where(eq(testPlans.userId, req.user.id)) if userId is added to testPlans table for multi-tenancy
      const allTestPlans = await db.select().from(testPlans).orderBy(desc(testPlans.createdAt));
      res.json(allTestPlans);
    } catch (error: any) {
      resolvedLogger.error({ message: "Error fetching test plans", error: error.message, stack: error.stack, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to fetch test plans" });
    }
  });

  // GET /api/test-plans/:id - Get a single test plan by ID
  app.get("/api/test-plans/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const testPlanId = req.params.id;
    try {
      // Add .where(and(eq(testPlans.id, testPlanId), eq(testPlans.userId, req.user.id))) if user-specific
      const result = await db.select().from(testPlans).where(eq(testPlans.id, testPlanId));
      if (result.length === 0) {
        return res.status(404).json({ error: "Test plan not found" });
      }
      res.json(result[0]);
    } catch (error: any) {
      resolvedLogger.error({ message: `Error fetching test plan ${testPlanId}`, error: error.message, stack: error.stack, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to fetch test plan" });
    }
  });

  // POST /api/test-plans - Create a new test plan
  app.post("/api/test-plans", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parseResult = insertTestPlanSchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({message: "POST /api/test-plans - Invalid payload", errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    try {
      const newPlanData = parseResult.data;
      const planId = uuidv4(); // Generate new UUID

      // createdAt and updatedAt have defaults in schema (strftime('%s', 'now'))
      // Drizzle ORM should respect these for SQLite on insert.
      const createdPlan = await db
        .insert(testPlans)
        .values({
          ...newPlanData,
          id: planId,
          // userId: req.user.id, // Add if user-specific and if userId is part of testPlans schema
        })
        .returning();

      if (createdPlan.length === 0) {
        resolvedLogger.error("Test plan creation failed, no record returned.");
        return res.status(500).json({ error: "Failed to create test plan." });
      }
      res.status(201).json(createdPlan[0]);
    } catch (error: any) {
      resolvedLogger.error({ message: "Error creating test plan", error: error.message, stack: error.stack, requestBody: req.body, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to create test plan" });
    }
  });

  // PUT /api/test-plans/:id - Update an existing test plan
  app.put("/api/test-plans/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const testPlanId = req.params.id;

    const parseResult = updateTestPlanSchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({message: `PUT /api/test-plans/${testPlanId} - Invalid payload`, errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    try {
      const updates = parseResult.data;
      if (Object.keys(updates).length === 0) {
        // If no update data is provided, check if the plan exists first.
        const existingPlan = await db.select({ id: testPlans.id }).from(testPlans).where(eq(testPlans.id, testPlanId));
        if (existingPlan.length === 0) {
            return res.status(404).json({ error: "Test plan not found." });
        }
        // If the plan exists but no data was provided for update.
        return res.status(400).json({ error: "No update data provided." });
      }

      // Proceed with update if updates object is not empty
      const updatedPlan = await db
        .update(testPlans)
        .set({
          ...updates,
          updatedAt: Math.floor(Date.now() / 1000), // Explicitly set updatedAt Unix timestamp
        })
        .where(eq(testPlans.id, testPlanId))
        // Add .where(and(eq(testPlans.id, testPlanId), eq(testPlans.userId, req.user.id))) if user-specific
        .returning();

      if (updatedPlan.length === 0) {
        return res.status(404).json({ error: "Test plan not found or no changes made." });
      }
      res.json(updatedPlan[0]);
    } catch (error: any) {
      resolvedLogger.error({ message: `Error updating test plan ${testPlanId}`, error: error.message, stack: error.stack, requestBody: req.body, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to update test plan" });
    }
  });

  // DELETE /api/test-plans/:id - Delete a test plan
  app.delete("/api/test-plans/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const testPlanId = req.params.id;

    try {
      // onDelete: 'cascade' is defined in the schedules.testPlanId FK.
      // This means deleting a test plan will automatically delete associated schedules.
      const result = await db
        .delete(testPlans)
        .where(eq(testPlans.id, testPlanId))
        // Add .where(and(eq(testPlans.id, testPlanId), eq(testPlans.userId, req.user.id))) if user-specific
        .returning();

      if (result.length === 0) {
        return res.status(404).json({ error: "Test plan not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      resolvedLogger.error({ message: `Error deleting test plan ${testPlanId}`, error: error.message, stack: error.stack, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to delete test plan" });
    }
  });

  // --- System Settings API Endpoints ---

  // GET /api/system-settings - List all system settings
  app.get("/api/system-settings", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      // Assuming admin rights might be needed here, or specific user settings vs system settings
      // For now, just basic auth check
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const settings = await db.select().from(systemSettings);
      res.json(settings);
    } catch (error: any) {
      resolvedLogger.error({ message: "Error fetching system settings", error: error.message, stack: error.stack, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to fetch system settings" });
    }
  });

  // GET /api/system-settings/:key - Get a single system setting by key
  app.get("/api/system-settings/:key", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { key } = req.params;
    try {
      const result = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
      if (result.length === 0) {
        return res.status(404).json({ error: "Setting not found" });
      }
      res.json(result[0]);
    } catch (error: any) {
      resolvedLogger.error({ message: `Error fetching system setting ${key}`, error: error.message, stack: error.stack, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to fetch system setting" });
    }
  });

  // POST /api/system-settings - Create or update a system setting (upsert)
  app.post("/api/system-settings", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      // Potentially restrict this to admin users in a real application
      return res.status(401).json({ error: "Unauthorized" });
    }
    const parseResult = insertSystemSettingSchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({ message: "POST /api/system-settings - Invalid payload", errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }
    try {
      const { key, value } = parseResult.data;

      // For SQLite, Drizzle's .onConflictDoUpdate().returning() might not return the inserted/updated row directly in all cases.
      // It's safer to perform the upsert and then select the row.
      await db.insert(systemSettings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: value }, // For SQLite, directly set the value. `sql`excluded.value` is more for PostgreSQL.
        });

      // Fetch the (potentially) updated or newly inserted row
      const finalResult = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);

      if (finalResult.length === 0) {
         // This case should ideally not be reached if upsert is successful
         resolvedLogger.error({ message: "System setting upsert failed, no record found post-operation", key, value, userId: (req.user as any)?.id });
         return res.status(500).json({ error: "Failed to create or update system setting, and could not retrieve it." });
      }
      // Respond with 201 if it was an insert, 200 if an update.
      // For simplicity, we'll just return 200/201 with the final state.
      // Checking if it was an insert or update might require another query or different DB driver behavior.
      const savedSetting = finalResult[0];
      res.status(200).json(savedSetting); // Could be 201 if we knew it was an insert

      // After successfully saving, if the key is logLevel, update the logger instance
      if (savedSetting.key === 'logLevel' && savedSetting.value) {
        try {
          await updateLogLevel(savedSetting.value);
          resolvedLogger.info({ message: `Log level dynamically updated to: ${savedSetting.value} via API`, key: savedSetting.key, value: savedSetting.value, userId: (req.user as any)?.id });
        } catch (updateError: any) {
          resolvedLogger.error({ message: `Failed to dynamically update log level to ${savedSetting.value} after saving setting`, error: updateError.message, stack: updateError.stack, key: savedSetting.key, value: savedSetting.value, userId: (req.user as any)?.id });
          // Do not fail the entire request, as the setting was saved to DB.
          // The logger will pick up the new level on next restart if dynamic update fails.
        }
      }

    } catch (error: any) {
      resolvedLogger.error({ message: "Error creating/updating system setting", error: error.message, stack: error.stack, requestBody: req.body, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to create or update system setting" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
