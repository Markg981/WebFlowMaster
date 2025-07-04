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
  AssertionSchema,
  testPlans,
  insertTestPlanSchema,
  updateTestPlanSchema,
  selectTestPlanSchema,
  testPlanSelectedTests,
  users,
  systemSettings,
  insertSystemSettingSchema,
  // Updated schema imports for schedules and executions
  testPlanSchedules,
  insertTestPlanScheduleSchema,
  updateTestPlanScheduleSchema,
  selectTestPlanScheduleSchema,
  testPlanExecutions,
  insertTestPlanExecutionSchema,
  selectTestPlanExecutionSchema
} from "@shared/schema";
import { z } from "zod";
import { v4 as uuidv4 } from 'uuid'; // For generating IDs
import { createInsertSchema } from 'drizzle-zod';
import { db } from "./db";
import { eq, and, desc, sql, leftJoin, getTableColumns, asc, or, like, ilike, inArray, isNull } from "drizzle-orm"; // Added or, like, ilike, inArray, isNull
import { playwrightService } from "./playwright-service";
import type { Logger as WinstonLogger } from 'winston';
import schedulerService from "./scheduler-service"; // Import schedulerService


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
          ...getTableColumns(tests),
          projectName: projects.name,
          // creatorUsername: users.username, // Temporarily removed
        })
        .from(tests)
        .leftJoin(projects, eq(tests.projectId, projects.id))
        // .leftJoin(users, eq(tests.userId, users.id)) // Temporarily removed
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

  // --- Test Plan Schedules API Endpoints (formerly /api/schedules) ---

  // GET /api/test-plan-schedules - List all schedules
  // Add .where(eq(testPlanSchedules.userId, req.user.id)) if user-specific access control is added to schedules
  app.get("/api/test-plan-schedules", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const result = await db
        .select({
          ...getTableColumns(testPlanSchedules), // Select all columns from testPlanSchedules
          testPlanName: testPlans.name, // And the name from the joined testPlans table
        })
        .from(testPlanSchedules)
        .leftJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id))
        .orderBy(desc(testPlanSchedules.createdAt));

      // Manually parse JSON fields for client
      const parsedResults = result.map(schedule => ({
        ...schedule,
        browsers: typeof schedule.browsers === 'string' ? JSON.parse(schedule.browsers) : schedule.browsers,
        notificationConfigOverride: typeof schedule.notificationConfigOverride === 'string' ? JSON.parse(schedule.notificationConfigOverride) : schedule.notificationConfigOverride,
        executionParameters: typeof schedule.executionParameters === 'string' ? JSON.parse(schedule.executionParameters) : schedule.executionParameters,
      }));
      res.json(parsedResults);
    } catch (error: any) {
      resolvedLogger.error({ message: "Error fetching test plan schedules", error: error.message, stack: error.stack, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to fetch test plan schedules" });
    }
  });

  // GET /api/test-plan-schedules/plan/:planId - List schedules for a specific test plan
  app.get("/api/test-plan-schedules/plan/:planId", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { planId } = req.params;
    if (!planId) {
      return res.status(400).json({ error: "Test Plan ID is required." });
    }

    try {
      const result = await db
        .select({
          ...getTableColumns(testPlanSchedules),
          testPlanName: testPlans.name,
        })
        .from(testPlanSchedules)
        .leftJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id))
        .where(eq(testPlanSchedules.testPlanId, planId))
        .orderBy(desc(testPlanSchedules.createdAt));

      const parsedResults = result.map(schedule => ({
        ...schedule,
        browsers: typeof schedule.browsers === 'string' ? JSON.parse(schedule.browsers) : schedule.browsers,
        notificationConfigOverride: typeof schedule.notificationConfigOverride === 'string' ? JSON.parse(schedule.notificationConfigOverride) : schedule.notificationConfigOverride,
        executionParameters: typeof schedule.executionParameters === 'string' ? JSON.parse(schedule.executionParameters) : schedule.executionParameters,
      }));
      res.json(parsedResults);
    } catch (error: any) {
      resolvedLogger.error({ message: `Error fetching schedules for plan ${planId}`, error: error.message, stack: error.stack, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to fetch schedules for the specified plan" });
    }
  });


  // POST /api/test-plan-schedules - Create a new schedule
  app.post("/api/test-plan-schedules", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parseResult = insertTestPlanScheduleSchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({ message: "POST /api/test-plan-schedules - Invalid payload", errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    try {
      const newScheduleData = parseResult.data;
      const scheduleId = uuidv4(); // Server-generated ID

      let nextRunAtTimestamp: number;
      if (newScheduleData.nextRunAt instanceof Date) {
        nextRunAtTimestamp = Math.floor(newScheduleData.nextRunAt.getTime() / 1000);
      } else {
        nextRunAtTimestamp = newScheduleData.nextRunAt;
      }

      const valuesToInsert: typeof testPlanSchedules.$inferInsert = {
        ...newScheduleData,
        id: scheduleId,
        nextRunAt: nextRunAtTimestamp,
        // Ensure JSON fields are stringified
        browsers: newScheduleData.browsers ? JSON.stringify(newScheduleData.browsers) : null,
        notificationConfigOverride: newScheduleData.notificationConfigOverride ? JSON.stringify(newScheduleData.notificationConfigOverride) : null,
        executionParameters: newScheduleData.executionParameters ? JSON.stringify(newScheduleData.executionParameters) : null,
        updatedAt: Math.floor(Date.now() / 1000),
        // userId: req.user.id, // If schedules become user-specific
      };

      const createdScheduleResult = await db.insert(testPlanSchedules).values(valuesToInsert).returning();

      if (createdScheduleResult.length === 0) {
        resolvedLogger.error({ message: "Schedule creation failed, no record returned", valuesToInsert, userId: (req.user as any)?.id });
        return res.status(500).json({ error: "Failed to create schedule." });
      }
      const createdSchedule = createdScheduleResult[0];

      // Add job to scheduler
      await schedulerService.addScheduleJob(createdSchedule);

      // Fetch with testPlanName for response consistency
      const finalResult = await db
        .select({ ...getTableColumns(testPlanSchedules), testPlanName: testPlans.name })
        .from(testPlanSchedules)
        .leftJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id))
        .where(eq(testPlanSchedules.id, createdSchedule.id))
        .limit(1);

      if (finalResult.length === 0) {
         resolvedLogger.error({ message: "Failed to fetch newly created schedule with test plan name", scheduleId: createdSchedule.id, userId: (req.user as any)?.id });
         return res.status(500).json({ error: "Failed to retrieve created schedule details." });
      }
      const responseSchedule = {
        ...finalResult[0],
        browsers: typeof finalResult[0].browsers === 'string' ? JSON.parse(finalResult[0].browsers) : finalResult[0].browsers,
        notificationConfigOverride: typeof finalResult[0].notificationConfigOverride === 'string' ? JSON.parse(finalResult[0].notificationConfigOverride) : finalResult[0].notificationConfigOverride,
        executionParameters: typeof finalResult[0].executionParameters === 'string' ? JSON.parse(finalResult[0].executionParameters) : finalResult[0].executionParameters,
      };
      res.status(201).json(responseSchedule);

    } catch (error: any) {
      resolvedLogger.error({ message: "Error creating test plan schedule", error: error.message, stack: error.stack, requestBody: req.body, userId: (req.user as any)?.id });
      if (error.message && error.message.toLowerCase().includes('foreign key constraint failed')) {
        return res.status(400).json({ error: "Invalid Test Plan ID: The specified Test Plan does not exist." });
      }
      res.status(500).json({ error: "Failed to create test plan schedule" });
    }
  });

  // PUT /api/test-plan-schedules/:id - Update an existing schedule
  app.put("/api/test-plan-schedules/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const scheduleId = req.params.id;

    const parseResult = updateTestPlanScheduleSchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({ message: `PUT /api/test-plan-schedules/${scheduleId} - Invalid payload`, errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    try {
      const updates = parseResult.data;
      if (Object.keys(updates).length === 0) {
        // Check if schedule exists to return 404, otherwise 400
        const existing = await db.select({id: testPlanSchedules.id}).from(testPlanSchedules).where(eq(testPlanSchedules.id, scheduleId)).limit(1);
        if(existing.length === 0) return res.status(404).json({ error: "Schedule not found." });
        return res.status(400).json({ error: "No update data provided." });
      }

      let nextRunAtTimestamp: number | undefined = undefined;
      if (updates.nextRunAt !== undefined) {
        if (updates.nextRunAt instanceof Date) {
          nextRunAtTimestamp = Math.floor(updates.nextRunAt.getTime() / 1000);
        } else {
          nextRunAtTimestamp = updates.nextRunAt;
        }
      }

      const valuesToUpdate: Partial<typeof testPlanSchedules.$inferInsert> = {
        ...updates,
        nextRunAt: nextRunAtTimestamp,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      // Stringify JSON fields if they are part of the update
      if (updates.browsers !== undefined) valuesToUpdate.browsers = updates.browsers ? JSON.stringify(updates.browsers) : null;
      if (updates.notificationConfigOverride !== undefined) valuesToUpdate.notificationConfigOverride = updates.notificationConfigOverride ? JSON.stringify(updates.notificationConfigOverride) : null;
      if (updates.executionParameters !== undefined) valuesToUpdate.executionParameters = updates.executionParameters ? JSON.stringify(updates.executionParameters) : null;

      // Remove undefined fields to avoid Drizzle errors on setting undefined
      Object.keys(valuesToUpdate).forEach(key => (valuesToUpdate as any)[key] === undefined && delete (valuesToUpdate as any)[key]);

      const updatedScheduleResult = await db
        .update(testPlanSchedules)
        .set(valuesToUpdate)
        .where(eq(testPlanSchedules.id, scheduleId))
        .returning();

      if (updatedScheduleResult.length === 0) {
        return res.status(404).json({ error: "Schedule not found or no changes made." });
      }
      const updatedSchedule = updatedScheduleResult[0];

      // Update job in scheduler
      await schedulerService.updateScheduleJob(updatedSchedule);

      const finalResult = await db
        .select({ ...getTableColumns(testPlanSchedules), testPlanName: testPlans.name })
        .from(testPlanSchedules)
        .leftJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id))
        .where(eq(testPlanSchedules.id, scheduleId))
        .limit(1);

      if (finalResult.length === 0) {
         resolvedLogger.error({ message: "Failed to fetch updated schedule with test plan name", scheduleId, userId: (req.user as any)?.id });
         return res.status(404).json({ error: "Schedule not found after update." });
      }
      const responseSchedule = {
        ...finalResult[0],
        browsers: typeof finalResult[0].browsers === 'string' ? JSON.parse(finalResult[0].browsers) : finalResult[0].browsers,
        notificationConfigOverride: typeof finalResult[0].notificationConfigOverride === 'string' ? JSON.parse(finalResult[0].notificationConfigOverride) : finalResult[0].notificationConfigOverride,
        executionParameters: typeof finalResult[0].executionParameters === 'string' ? JSON.parse(finalResult[0].executionParameters) : finalResult[0].executionParameters,
      };
      res.json(responseSchedule);

    } catch (error: any) {
      resolvedLogger.error({ message: `Error updating schedule ${scheduleId}`, error: error.message, stack: error.stack, requestBody: req.body, userId: (req.user as any)?.id });
      if (error.message && error.message.toLowerCase().includes('foreign key constraint failed')) {
        return res.status(400).json({ error: "Invalid Test Plan ID: The specified Test Plan does not exist." });
      }
      res.status(500).json({ error: "Failed to update schedule" });
    }
  });

  // DELETE /api/test-plan-schedules/:id - Delete a schedule
  app.delete("/api/test-plan-schedules/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const scheduleId = req.params.id;
    try {
      const result = await db
        .delete(testPlanSchedules)
        .where(eq(testPlanSchedules.id, scheduleId))
        .returning();

      if (result.length === 0) {
        return res.status(404).json({ error: "Schedule not found" });
      }
      // Remove job from scheduler
      schedulerService.removeScheduleJob(scheduleId);
      res.status(204).send();
    } catch (error: any) {
      resolvedLogger.error({ message: `Error deleting schedule ${scheduleId}`, error: error.message, stack: error.stack, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to delete schedule" });
    }
  });

  // --- Test Plan Executions API Endpoints ---
  app.get("/api/test-plan-executions", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { planId, scheduleId, limit = 10, offset = 0, status, triggeredBy } = req.query;
    const pageLimit = Math.min(Math.max(1, parseInt(limit as string)), 100); // Clamp limit between 1 and 100
    const pageOffset = Math.max(0, parseInt(offset as string));

    try {
      let query = db.select({
          ...getTableColumns(testPlanExecutions),
          testPlanName: testPlans.name,
          scheduleName: testPlanSchedules.scheduleName,
        })
        .from(testPlanExecutions)
        .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
        .leftJoin(testPlanSchedules, eq(testPlanExecutions.scheduleId, testPlanSchedules.id))
        .$dynamic(); // Prepare for dynamic conditions

      const conditions = [];
      // TODO: Add userId filter if executions are user-specific
      // conditions.push(eq(testPlanExecutions.userId, req.user.id));

      if (planId && typeof planId === 'string') {
        conditions.push(eq(testPlanExecutions.testPlanId, planId));
      }
      if (scheduleId && typeof scheduleId === 'string') {
        conditions.push(eq(testPlanExecutions.scheduleId, scheduleId));
      }
      if (status && typeof status === 'string') {
        conditions.push(eq(testPlanExecutions.status, status as any)); // Cast status
      }
      if (triggeredBy && typeof triggeredBy === 'string') {
        conditions.push(eq(testPlanExecutions.triggeredBy, triggeredBy as any)); // Cast triggeredBy
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      const executions = await query.orderBy(desc(testPlanExecutions.startedAt)).limit(pageLimit).offset(pageOffset);

      // Count total for pagination (can be slow on large tables without specific indexing)
      // A simpler count without joins might be faster if only filtering by execution table fields.
      // const totalRecordsResult = await db.select({ count: sql`count(*)` }).from(testPlanExecutions).where(and(...conditions));
      // const totalRecords = Number(totalRecordsResult[0]?.count) || 0;

      const parsedExecutions = executions.map(exec => ({
        ...exec,
        results: typeof exec.results === 'string' ? JSON.parse(exec.results) : exec.results,
        browsers: typeof exec.browsers === 'string' ? JSON.parse(exec.browsers) : exec.browsers,
      }));

      // For now, returning items without total count for simplicity to avoid complex count query
      res.json({ items: parsedExecutions, limit: pageLimit, offset: pageOffset });

    } catch (error: any) {
      resolvedLogger.error({ message: "Error fetching test plan executions", error: error.message, stack: error.stack, query: req.query, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to fetch test plan executions" });
    }
  });


  // Zod Schema for Test Plan API Payloads (including selected tests)
  const testPlanApiPayloadSchema = insertTestPlanSchema.extend({
    selectedTests: z.array(z.object({
      id: z.number().int(), // This will be either tests.id or apiTests.id
      type: z.enum(['ui', 'api'])
    })).optional().default([])
  });

  const updateTestPlanApiPayloadSchema = updateTestPlanSchema.extend({
    selectedTests: z.array(z.object({
      id: z.number().int(),
      type: z.enum(['ui', 'api'])
    })).optional() // On update, if not provided, selected tests are not changed. If an empty array is provided, all are removed.
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

    const parseResult = testPlanApiPayloadSchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({message: "POST /api/test-plans - Invalid payload", errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    try {
      const { selectedTests, ...newPlanData } = parseResult.data;
      const planId = uuidv4(); // Generate new UUID

      const createdPlanResult = await db.transaction(async (tx) => {
        const insertedPlan = await tx
          .insert(testPlans)
          .values({
            ...newPlanData,
            id: planId,
            // userId: req.user.id, // Future consideration
            // Ensure JSON fields are stringified if Zod schema returns them as objects
            testMachinesConfig: newPlanData.testMachinesConfig ? JSON.stringify(newPlanData.testMachinesConfig) : null,
            notificationSettings: newPlanData.notificationSettings ? JSON.stringify(newPlanData.notificationSettings) : null,
          })
          .returning();

        if (insertedPlan.length === 0) {
          resolvedLogger.error("Test plan main record creation failed within transaction.");
          throw new Error("Failed to create test plan main record.");
        }
        const mainPlan = insertedPlan[0];

        if (selectedTests && selectedTests.length > 0) {
          const selectedTestValues = selectedTests.map(st => ({
            testPlanId: mainPlan.id,
            testId: st.type === 'ui' ? st.id : null,
            apiTestId: st.type === 'api' ? st.id : null,
            testType: st.type,
          }));
          await tx.insert(testPlanSelectedTests).values(selectedTestValues);
        }
        return mainPlan;
      });

      // Fetch the full plan with selected tests to return
      // (This might be complex if we need to join with tests/apiTests names, for now just return the created plan object)
      // For simplicity, returning the direct result from the transaction.
      // Client might need to re-fetch or this endpoint could be enhanced to return joined data.
      res.status(201).json(createdPlanResult);

    } catch (error: any) {
      // Enhanced error logging
      const errorDetails = {
        messageFromError: error.message,
        stackTrace: error.stack,
        errorCode: (error as any).code, // For SQLite errors like SQLITE_CONSTRAINT
        requestBodyAttempted: req.body,
        userId: (req.user as any)?.id,
      };
      resolvedLogger.error({ message: "Critical error creating test plan with selected tests", details: errorDetails });

      if (error.message.includes("FOREIGN KEY constraint failed")) {
        return res.status(400).json({ error: "Invalid reference: One or more selected tests, or the project ID, do not exist."});
      }
      // Generic error for client, specific details logged on server
      res.status(500).json({ error: "Failed to create test plan due to an internal server error." });
    }
  });

  // PUT /api/test-plans/:id - Update an existing test plan
  app.put("/api/test-plans/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const testPlanId = req.params.id;

    const parseResult = updateTestPlanApiPayloadSchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({message: `PUT /api/test-plans/${testPlanId} - Invalid payload`, errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    try {
      const { selectedTests, ...planUpdates } = parseResult.data;

      // Check if there's anything to update for the main plan or selected tests
      if (Object.keys(planUpdates).length === 0 && selectedTests === undefined) {
        // Check if the plan exists first to return 404 if not, otherwise 400 for no data
        const existingPlanCheck = await db.select({ id: testPlans.id }).from(testPlans).where(eq(testPlans.id, testPlanId));
        if (existingPlanCheck.length === 0) {
            return res.status(404).json({ error: "Test plan not found." });
        }
        return res.status(400).json({ error: "No update data provided." });
      }

      const updatedPlanResult = await db.transaction(async (tx) => {
        let mainPlanUpdated;
        if (Object.keys(planUpdates).length > 0) {
          // Stringify JSON fields before updating
          const updatesToApply = { ...planUpdates } as any;
          if (planUpdates.testMachinesConfig !== undefined) {
            updatesToApply.testMachinesConfig = planUpdates.testMachinesConfig ? JSON.stringify(planUpdates.testMachinesConfig) : null;
          }
          if (planUpdates.notificationSettings !== undefined) {
            updatesToApply.notificationSettings = planUpdates.notificationSettings ? JSON.stringify(planUpdates.notificationSettings) : null;
          }

          mainPlanUpdated = await tx
            .update(testPlans)
            .set({
              ...updatesToApply,
              updatedAt: Math.floor(Date.now() / 1000),
            })
            .where(eq(testPlans.id, testPlanId))
            .returning();

          if (mainPlanUpdated.length === 0) {
            resolvedLogger.warn(`PUT /api/test-plans/${testPlanId} - Test plan not found during main record update.`);
            throw new Error("Test plan not found or no changes to main record."); // Will be caught and result in 404 like
          }
        } else {
          // If only selectedTests are being updated, fetch the current plan to return
          const currentPlan = await tx.select().from(testPlans).where(eq(testPlans.id, testPlanId));
          if (currentPlan.length === 0) {
            throw new Error("Test plan not found.");
          }
          mainPlanUpdated = currentPlan;
        }


        if (selectedTests !== undefined) { // If selectedTests is provided (even an empty array)
          await tx.delete(testPlanSelectedTests).where(eq(testPlanSelectedTests.testPlanId, testPlanId));

          if (selectedTests.length > 0) {
            const selectedTestValues = selectedTests.map(st => ({
              testPlanId: testPlanId,
              testId: st.type === 'ui' ? st.id : null,
              apiTestId: st.type === 'api' ? st.id : null,
              testType: st.type,
            }));
            await tx.insert(testPlanSelectedTests).values(selectedTestValues);
          }
        }
        return mainPlanUpdated[0]; // Return the first element of the (potentially) updated plan
      });

      if (!updatedPlanResult) { // Should be caught by transaction error handling but as a safeguard
        return res.status(404).json({ error: "Test plan not found or no effective changes made." });
      }
      res.json(updatedPlanResult);

    } catch (error: any) {
      resolvedLogger.error({ message: `Error updating test plan ${testPlanId}`, error: error.message, stack: error.stack, requestBody: req.body, userId: (req.user as any)?.id });
       if (error.message.toLowerCase().includes("test plan not found")) { // Custom error from transaction
        return res.status(404).json({ error: "Test plan not found." });
      }
      if (error.message.includes("FOREIGN KEY constraint failed")) {
        return res.status(400).json({ error: "One or more selected tests do not exist."})
      }
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
      // Also, test_plan_selected_tests and test_plan_runs have onDelete: 'cascade' for testPlanId.
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

  // POST /api/run-test-plan/:id - Execute a test plan
  app.post("/api/run-test-plan/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const testPlanId = req.params.id;
    const userId = req.user.id;

    resolvedLogger.http({ message: `POST /api/run-test-plan/${testPlanId} - Handler reached`, testPlanId, userId });

    try {
      // Dynamically import runTestPlan to avoid circular dependencies if test-execution-service grows
      const { runTestPlan } = await import("./test-execution-service");
      const executionResult = await runTestPlan(testPlanId, userId);

      if (executionResult.error) {
        // Check if a specific status code was suggested by runTestPlan
        const statusCode = executionResult.status && typeof executionResult.status === 'number' ? executionResult.status : 500;
        resolvedLogger.error({ message: `Test plan execution failed for plan ${testPlanId}`, error: executionResult.error, testPlanRunId: executionResult.testPlanRunId });
        return res.status(statusCode).json({ success: false, error: executionResult.error, data: executionResult });
      }

      resolvedLogger.info({ message: `Test plan ${testPlanId} executed successfully. Run ID: ${executionResult.id}` });
      // executionResult should be the full TestPlanRun object
      res.status(200).json({ success: true, data: executionResult });

    } catch (error: any) {
      resolvedLogger.error({
        message: `Critical error in /api/run-test-plan/${testPlanId} route handler`,
        testPlanId,
        userId,
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ success: false, error: "Internal server error during test plan execution." });
    }
  });


  // GET /api/selectable-tests - List UI and API tests for selection in Test Plans
  app.get("/api/selectable-tests", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id; // Assuming tests are user-specific

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10; // Default to 10 items per page
    const offset = (page - 1) * limit;
    const searchTerm = req.query.search as string | undefined;

    try {
      // Base queries
      let uiTestsQuery = db.select({
          id: tests.id,
          name: tests.name,
          description: sql<string>`null`.as('description'), // UI tests don't have a description field in the schema
          type: sql<string>`'ui'`.as('type'),
          updatedAt: tests.updatedAt
        })
        .from(tests)
        .where(eq(tests.userId, userId));

      let apiTestsQuery = db.select({
          id: apiTests.id,
          name: apiTests.name,
          description: sql<string>`null`.as('description'), // API tests also don't have a dedicated description field
          type: sql<string>`'api'`.as('type'),
          updatedAt: apiTests.updatedAt
        })
        .from(apiTests)
        .where(eq(apiTests.userId, userId));

      // Apply search term if provided
      if (searchTerm) {
        const searchPattern = `%${searchTerm}%`;
        uiTestsQuery = uiTestsQuery.where(ilike(tests.name, searchPattern));
        apiTestsQuery = apiTestsQuery.where(ilike(apiTests.name, searchPattern));
      }

      const uiTestResults = await uiTestsQuery;
      const apiTestResults = await apiTestsQuery;

      // Combine results
      let combinedResults = [...uiTestResults, ...apiTestResults];

      // Sort combined results (e.g., by name or updatedAt)
      combinedResults.sort((a, b) => {
        // Sort by name alphabetically by default
        return a.name.localeCompare(b.name);
        // Or sort by updatedAt if preferred:
        // return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

      const totalItems = combinedResults.length;
      const paginatedItems = combinedResults.slice(offset, offset + limit);
      const totalPages = Math.ceil(totalItems / limit);

      res.json({
        items: paginatedItems,
        totalItems,
        totalPages,
        currentPage: page,
        itemsPerPage: limit,
      });

    } catch (error: any) {
      resolvedLogger.error({ message: "Error fetching selectable tests", error: error.message, stack: error.stack, userId, query: req.query });
      res.status(500).json({ error: "Failed to fetch selectable tests" });
    }
  });

// --- Test Report Page API Endpoint ---
app.get("/api/test-plan-executions/:executionId/report", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { executionId } = req.params;
  const userId = req.user.id; // Assuming reports might be user-scoped in the future or for auth checks

  resolvedLogger.http({ message: `GET /api/test-plan-executions/${executionId}/report - Handler reached`, executionId, userId });

  if (!executionId) {
    return res.status(400).json({ error: "Execution ID is required." });
  }

  try {
    // 1. Fetch the main TestPlanExecution record and its associated TestPlan
    const executionDetailsResult = await db
      .select({
        execution: getTableColumns(testPlanExecutions),
        plan: getTableColumns(testPlans),
      })
      .from(testPlanExecutions)
      .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
      .where(eq(testPlanExecutions.id, executionId))
      // Add user ID check if necessary: and(eq(testPlanExecutions.id, executionId), eq(testPlans.userId, userId)))
      // Or if testPlanExecutions has a userId: and(eq(testPlanExecutions.id, executionId), eq(testPlanExecutions.userId, userId)))
      .limit(1);

    if (executionDetailsResult.length === 0) {
      resolvedLogger.warn({ message: `Execution ID ${executionId} not found.`, userId });
      return res.status(404).json({ error: "Test plan execution not found." });
    }

    const { execution, plan } = executionDetailsResult[0];

    // 2. Fetch all reportTestCaseResults for this execution
    // Ensure reportTestCaseResults is imported from @shared/schema
    const testCaseResults = await db
      .select()
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, executionId))
      .orderBy(desc(reportTestCaseResults.status), asc(reportTestCaseResults.testName)); // Example ordering

    // 3. Calculate Key Metrics
    const totalTests = testCaseResults.length;
    const passedTests = testCaseResults.filter(r => r.status === 'Passed').length;
    const failedTests = testCaseResults.filter(r => r.status === 'Failed').length;
    const skippedTests = testCaseResults.filter(r => r.status === 'Skipped').length;
    // Add other statuses if needed (e.g., 'Error', 'Pending')

    let totalDurationMs = 0;
    testCaseResults.forEach(r => {
      if (r.durationMs !== null && r.durationMs !== undefined) {
        totalDurationMs += r.durationMs;
      }
    });
    const averageTimePerTest = totalTests > 0 ? Math.round(totalDurationMs / totalTests) : 0;

    // 4. Prepare data for charts
    const passFailSkippedDistribution = {
      passed: passedTests,
      failed: failedTests,
      skipped: skippedTests,
    };

    const priorityDistribution: Record<string, { passed: number, failed: number, skipped: number, total: number }> = {};
    testCaseResults.forEach(r => {
      const prio = r.priority || 'N/A';
      if (!priorityDistribution[prio]) {
        priorityDistribution[prio] = { passed: 0, failed: 0, skipped: 0, total: 0 };
      }
      priorityDistribution[prio].total++;
      if (r.status === 'Passed') priorityDistribution[prio].passed++;
      else if (r.status === 'Failed') priorityDistribution[prio].failed++;
      else if (r.status === 'Skipped') priorityDistribution[prio].skipped++;
    });

    const detailedSeverityDistribution: Record<string, { passed: number, failed: number, skipped: number, total: number }> = {};
     testCaseResults.forEach(r => {
      const sev = r.severity || 'N/A';
      if (!detailedSeverityDistribution[sev]) {
        detailedSeverityDistribution[sev] = { passed: 0, failed: 0, skipped: 0, total: 0 };
      }
      detailedSeverityDistribution[sev].total++;
      if (r.status === 'Passed') detailedSeverityDistribution[sev].passed++;
      else if (r.status === 'Failed') detailedSeverityDistribution[sev].failed++;
      else if (r.status === 'Skipped') detailedSeverityDistribution[sev].skipped++;
    });

    // 5. Detailed View of Failed Tests
    const failedTestDetails = testCaseResults
      .filter(r => r.status === 'Failed')
      .map(r => ({
        id: r.id,
        testName: r.testName,
        reasonForFailure: r.reasonForFailure,
        screenshotUrl: r.screenshotUrl,
        detailedLog: r.detailedLog,
        component: r.component,
        priority: r.priority,
        severity: r.severity,
        durationMs: r.durationMs,
        uiTestId: r.uiTestId,
        apiTestId: r.apiTestId,
        testType: r.testType,
      }));

    // 6. Expandable Test Groupings (by module, then by component as an example)
    const groupedByModule: Record<string, {
        passed: number, failed: number, skipped: number, total: number,
        components: Record<string, {
            passed: number, failed: number, skipped: number, total: number,
            tests: Array<typeof testCaseResults[0]> // Using the inferred type of elements in testCaseResults
        }>
    }> = {};

    testCaseResults.forEach(r => {
      const moduleName = r.module || 'Uncategorized Module';
      const componentName = r.component || 'Uncategorized Component';

      if (!groupedByModule[moduleName]) {
        groupedByModule[moduleName] = { passed: 0, failed: 0, skipped: 0, total: 0, components: {} };
      }
      if (!groupedByModule[moduleName].components[componentName]) {
        groupedByModule[moduleName].components[componentName] = { passed: 0, failed: 0, skipped: 0, total: 0, tests: [] };
      }

      groupedByModule[moduleName].total++;
      groupedByModule[moduleName].components[componentName].total++;
      groupedByModule[moduleName].components[componentName].tests.push(r);

      if (r.status === 'Passed') {
        groupedByModule[moduleName].passed++;
        groupedByModule[moduleName].components[componentName].passed++;
      } else if (r.status === 'Failed') {
        groupedByModule[moduleName].failed++;
        groupedByModule[moduleName].components[componentName].failed++;
      } else if (r.status === 'Skipped') {
        groupedByModule[moduleName].skipped++;
        groupedByModule[moduleName].components[componentName].skipped++;
      }
    });

    const reportData = {
      header: {
        testSuiteName: plan?.name || 'N/A',
        environment: execution.environment || 'N/A',
        browsers: execution.browsers ? JSON.parse(execution.browsers as string) : [],
        dateTime: execution.startedAt ? new Date(execution.startedAt * 1000).toISOString() : 'N/A',
        completedAt: execution.completedAt ? new Date(execution.completedAt * 1000).toISOString() : null,
        status: execution.status,
        triggeredBy: execution.triggeredBy,
        executionId: execution.id,
        testPlanId: execution.testPlanId,
      },
      keyMetrics: {
        totalTests: execution.totalTests ?? totalTests, // Prefer pre-calculated, fallback to fresh calculation
        passedTests: execution.passedTests ?? passedTests,
        failedTests: execution.failedTests ?? failedTests,
        skippedTests: execution.skippedTests ?? skippedTests,
        passRate: (execution.totalTests ?? totalTests) > 0 ?
                  parseFloat((((execution.passedTests ?? passedTests) / (execution.totalTests ?? totalTests)) * 100).toFixed(2)) : 0,
        averageTimePerTestMs: averageTimePerTest, // This needs fresh calculation from reportTestCaseResults
        totalTestCasesDurationMs: totalDurationMs, // Sum of individual test case durations
        executionDurationMs: execution.executionDurationMs ?? ((execution.completedAt && execution.startedAt) ? (execution.completedAt - execution.startedAt) * 1000 : null),
      },
      charts: {
        passFailSkippedDistribution,
        priorityDistribution,
        severityDistribution: detailedSeverityDistribution,
      },
      failedTestDetails,
      testGroupings: groupedByModule,
      allTests: testCaseResults, // For frontend flexibility
    };

    res.json(reportData);

  } catch (error: any) {
    resolvedLogger.error({
      message: `Error fetching report for execution ${executionId}`,
      error: error.message,
      stack: error.stack,
      userId,
    });
    res.status(500).json({ error: "Failed to fetch test execution report." });
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
