import type { Express } from "express";
import { createServer, type Server } from "http";
import logger from "./logger"; // Import Winston logger
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
import { eq, and, desc, sql, leftJoin } from "drizzle-orm"; // Added leftJoin
import { playwrightService } from "./playwright-service";

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

export async function registerRoutes(app: Express): Promise<Server> { // Make function async and return Promise<Server>
  const resolvedLogger = await logger; // Resolve the logger promise
  setupAuth(app);

  const loadWebsiteBodySchema = z.object({
    url: z.string().min(1, { message: "URL cannot be empty" }).url({ message: "Invalid URL format" }),
  });

  app.post("/api/load-website", async (req, res) => {
    (resolvedLogger.info || console.log)("SERVER: /api/load-website route handler reached. Request body:", req.body);

    const parseResult = loadWebsiteBodySchema.safeParse(req.body);

    if (!parseResult.success) {
      (resolvedLogger.error || console.error)("SERVER: /api/load-website - Invalid request body:", parseResult.error.flatten());
      return res.status(400).json({ success: false, error: 'Invalid request payload', details: parseResult.error.flatten() });
    }

    const { url } = parseResult.data;
    const userId = (req.user as any)?.id as number | undefined; // Safely access user ID

    try {
      (resolvedLogger.info || console.log)(`SERVER: /api/load-website - Calling playwrightService.loadWebsite with URL: ${url}`);
      const result = await playwrightService.loadWebsite(url, userId);
      (resolvedLogger.info || console.log)(`SERVER: /api/load-website - playwrightService.loadWebsite call returned. Success: ${result?.success}`);

      if (result.success) {
        res.json({ success: true, screenshot: result.screenshot, html: result.html });
      } else {
        (resolvedLogger.error || console.error)(`SERVER: /api/load-website - playwrightService.loadWebsite failed. Error: ${result.error}`);
        res.status(500).json({ success: false, error: result.error || 'Failed to load website using Playwright service.' });
      }
    } catch (error: any) {
      (resolvedLogger.error || console.error)("SERVER: /api/load-website - Critical error in route handler:", error);
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
      resolvedLogger.error("Invalid /api/proxy-api-request payload:", { errors: parseResult.error.flatten() });
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

  app.get("/api/projects", async (req, res) => { /* ... existing code ... */ });
  app.post("/api/detect-elements", async (req, res) => { /* ... existing code ... */ });
  app.post("/api/projects", async (req, res) => { /* ... existing code ... */ });
  app.delete("/api/projects/:projectId", async (req, res) => { /* ... existing code ... */ });
  app.get("/api/tests", async (req, res) => { /* ... existing code ... */ });
  app.post("/api/tests", async (req, res) => { /* ... existing code ... */ });
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
    } catch (error) {
      resolvedLogger.error("Failed to fetch settings:", error);
      return res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parseResult = userSettingsBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.error("Invalid /api/settings payload:", { errors: parseResult.error.flatten() });
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
    } catch (error) {
      resolvedLogger.error("Failed to save settings:", error);
      return res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.post("/api/execute-test-direct", async (req, res) => { /* ... existing code ... */ });
  app.post("/api/start-recording", async (req, res) => { /* ... existing code ... */ });
  app.post("/api/stop-recording", async (req, res) => { /* ... existing code ... */ });
  app.get("/api/get-recorded-actions", async (req, res) => { /* ... existing code ... */ });

  // --- API Test History Endpoints ---
  app.post("/api/api-test-history", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const parseResult = insertApiTestHistorySchema.safeParse(req.body);
    if (!parseResult.success) { return res.status(400).json({ error: "Invalid history data", details: parseResult.error.flatten() }); }
    try {
      const newHistoryEntry = await db.insert(apiTestHistory).values({ ...parseResult.data, userId: req.user.id }).returning();
      res.status(201).json(newHistoryEntry[0]);
    } catch (error) { resolvedLogger.error("Error creating API test history entry:", error); res.status(500).json({ error: "Failed to save API test history" }); }
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
    } catch (error) { resolvedLogger.error("Error fetching API test history:", error); res.status(500).json({ error: "Failed to fetch API test history" }); }
  });

  app.delete("/api/api-test-history/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const id = parseInt(req.params.id);
    if (isNaN(id)) { return res.status(400).json({ error: "Invalid history ID" }); }
    try {
      const result = await db.delete(apiTestHistory).where(and(eq(apiTestHistory.id, id), eq(apiTestHistory.userId, req.user.id))).returning();
      if (result.length === 0) { return res.status(404).json({ error: "History entry not found or not owned by user" }); }
      res.status(204).send();
    } catch (error) { resolvedLogger.error(`Error deleting API test history entry ${id}:`, error); res.status(500).json({ error: "Failed to delete history entry" }); }
  });

  // --- Saved API Tests Endpoints ---
  app.post("/api/api-tests", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const postApiTestSchema = insertApiTestSchema.extend({ projectId: z.number().int().positive().optional().nullable() });
    const parseResult = postApiTestSchema.safeParse(req.body);
    if (!parseResult.success) { return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() }); }
    try {
      const { projectId, ...testData } = parseResult.data;
      const newTest = await db.insert(apiTests).values({
          ...testData, userId: req.user.id, projectId: projectId,
          queryParams: testData.queryParams ? JSON.stringify(testData.queryParams) : null,
          requestHeaders: testData.requestHeaders ? JSON.stringify(testData.requestHeaders) : null,
          requestBody: testData.requestBody ? (typeof testData.requestBody === 'string' ? testData.requestBody : JSON.stringify(testData.requestBody)) : null,
          assertions: testData.assertions ? JSON.stringify(testData.assertions) : null,
        }).returning();
      res.status(201).json(newTest[0]);
    } catch (error: any) {
      resolvedLogger.error("Error creating API test:", error);
      if (error.message && error.message.includes('FOREIGN KEY constraint failed')) { return res.status(400).json({ error: "Invalid project ID or project does not exist." }); }
      res.status(500).json({ error: "Failed to create API test" });
    }
  });

  app.get("/api/api-tests", async (req, res) => { /* ... existing code ... */ });
  app.get("/api/api-tests/:id", async (req, res) => { /* ... existing code ... */ });

  app.put("/api/api-tests/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const id = parseInt(req.params.id);
    if (isNaN(id)) { return res.status(400).json({ error: "Invalid test ID" }); }
    const putApiTestSchema = updateApiTestSchema.extend({ projectId: z.number().int().positive().optional().nullable() });
    const parseResult = putApiTestSchema.safeParse(req.body);
    if (!parseResult.success) { return res.status(400).json({ error: "Invalid test data", details: parseResult.error.flatten() }); }
    try {
      const { projectId, ...testData } = parseResult.data;
      const existingTest = await db.select({id: apiTests.id}).from(apiTests).where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user.id)));
      if (existingTest.length === 0) { return res.status(404).json({ error: "Test not found or not owned by user" }); }

      const updatedValues: Partial<typeof apiTests.$inferInsert> = { ...testData, projectId, updatedAt: sql`datetime('now')` as any };
      if (testData.queryParams !== undefined) updatedValues.queryParams = testData.queryParams ? JSON.stringify(testData.queryParams) : null;
      if (testData.requestHeaders !== undefined) updatedValues.requestHeaders = testData.requestHeaders ? JSON.stringify(testData.requestHeaders) : null;
      if (testData.requestBody !== undefined) updatedValues.requestBody = testData.requestBody ? (typeof testData.requestBody === 'string' ? testData.requestBody : JSON.stringify(testData.requestBody)) : null;
      if (testData.assertions !== undefined) updatedValues.assertions = testData.assertions ? JSON.stringify(testData.assertions) : null;

      const updatedTest = await db.update(apiTests).set(updatedValues).where(and(eq(apiTests.id, id), eq(apiTests.userId, req.user.id))).returning();
      if (updatedTest.length === 0) { return res.status(404).json({ error: "Test not found after update attempt" }); }
      res.json(updatedTest[0]);
    } catch (error: any) {
      resolvedLogger.error(`Error updating API test ${id}:`, error);
      if (error.message && error.message.includes('FOREIGN KEY constraint failed')) { return res.status(400).json({ error: "Invalid project ID or project does not exist." }); }
      res.status(500).json({ error: "Failed to update API test" });
    }
  });

  app.delete("/api/api-tests/:id", async (req, res) => { /* ... existing code ... */ });

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
    } catch (error) {
      logger.error("Error fetching schedules:", error);
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
      logger.error("Invalid /api/schedules POST payload:", { errors: parseResult.error.flatten() });
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
      // Let's assume insertScheduleSchema requires 'id' or we generate it here.
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
        logger.error("Schedule creation failed, no record returned.");
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
         logger.error("Failed to fetch newly created schedule with test plan name.");
         return res.status(500).json({ error: "Failed to retrieve created schedule details." });
      }

      res.status(201).json(finalResult[0]);
    } catch (error: any) {
      logger.error("Error creating schedule:", error);
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
      logger.error(`Invalid /api/schedules/${scheduleId} PUT payload:`, { errors: parseResult.error.flatten() });
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
         logger.error("Failed to fetch updated schedule with test plan name.");
         return res.status(404).json({ error: "Schedule not found after update." });
      }
      res.json(finalResult[0]);

    } catch (error: any) {
      logger.error(`Error updating schedule ${scheduleId}:`, error);
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
    } catch (error) {
      logger.error(`Error deleting schedule ${scheduleId}:`, error);
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
    } catch (error) {
      resolvedLogger.error("Error fetching test plans:", error);
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
    } catch (error) {
      resolvedLogger.error(`Error fetching test plan ${testPlanId}:`, error);
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
      resolvedLogger.error("Invalid /api/test-plans POST payload:", { errors: parseResult.error.flatten() });
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
    } catch (error) {
      resolvedLogger.error("Error creating test plan:", error);
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
      resolvedLogger.error(`Invalid /api/test-plans/${testPlanId} PUT payload:`, { errors: parseResult.error.flatten() });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    try {
      const updates = parseResult.data;
      if (Object.keys(updates).length === 0) {
        // Allow PUT for just touching updatedAt if desired, otherwise return 400
        // For now, require at least one actual field to change beyond just updatedAt
         if (Object.keys(updates).length === 0) {
            const existingPlan = await db.select({ id: testPlans.id }).from(testPlans).where(eq(testPlans.id, testPlanId));
            if (existingPlan.length === 0) {
                 return res.status(404).json({ error: "Test plan not found." });
            }
            // If only wanting to update `updatedAt`
            // const touchUpdate = await db.update(testPlans).set({ updatedAt: Math.floor(Date.now() / 1000) }).where(eq(testPlans.id, testPlanId)).returning();
            // return res.json(touchUpdate[0]);
             return res.status(400).json({ error: "No update data provided." });
         }
      }

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
    } catch (error) {
      resolvedLogger.error(`Error updating test plan ${testPlanId}:`, error);
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
    } catch (error) {
      resolvedLogger.error(`Error deleting test plan ${testPlanId}:`, error);
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
    } catch (error) {
      resolvedLogger.error("Error fetching system settings:", error);
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
    } catch (error) {
      resolvedLogger.error(`Error fetching system setting ${key}:`, error);
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
      resolvedLogger.error("Invalid /api/system-settings POST payload:", { errors: parseResult.error.flatten() });
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
         resolvedLogger.error("System setting upsert failed, no record found post-operation for key:", key);
         return res.status(500).json({ error: "Failed to create or update system setting, and could not retrieve it." });
      }
      // Respond with 201 if it was an insert, 200 if an update.
      // For simplicity, we'll just return 200/201 with the final state.
      // Checking if it was an insert or update might require another query or different DB driver behavior.
      res.status(200).json(finalResult[0]); // Could be 201 if we knew it was an insert

    } catch (error) {
      resolvedLogger.error("Error creating/updating system setting:", error);
      res.status(500).json({ error: "Failed to create or update system setting" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
