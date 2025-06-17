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
  AssertionSchema // Import AssertionSchema
} from "@shared/schema";
import { z } from "zod";
import { createInsertSchema } from 'drizzle-zod';
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
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

export function registerRoutes(app: Express): Server {
  setupAuth(app);

  app.post("/api/load-website", async (req, res) => { /* ... existing code ... */ });

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
        logger.warn("Failed to parse response body as JSON, falling back to text", { url: targetUrl.toString(), contentType, error: parseError });
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
            logger.error("Error during assertion evaluation:", { assertion, error: e.message });
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
      logger.error("Error in /api/proxy-api-request:", {
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
  app.get("/api/settings", async (req, res) => { /* ... existing code ... */ });
  app.post("/api/settings", async (req, res) => { /* ... existing code ... */ });
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
    } catch (error) { logger.error("Error creating API test history entry:", error); res.status(500).json({ error: "Failed to save API test history" }); }
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
    } catch (error) { logger.error("Error fetching API test history:", error); res.status(500).json({ error: "Failed to fetch API test history" }); }
  });

  app.delete("/api/api-test-history/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const id = parseInt(req.params.id);
    if (isNaN(id)) { return res.status(400).json({ error: "Invalid history ID" }); }
    try {
      const result = await db.delete(apiTestHistory).where(and(eq(apiTestHistory.id, id), eq(apiTestHistory.userId, req.user.id))).returning();
      if (result.length === 0) { return res.status(404).json({ error: "History entry not found or not owned by user" }); }
      res.status(204).send();
    } catch (error) { logger.error(`Error deleting API test history entry ${id}:`, error); res.status(500).json({ error: "Failed to delete history entry" }); }
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
      logger.error("Error creating API test:", error);
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
      logger.error(`Error updating API test ${id}:`, error);
      if (error.message && error.message.includes('FOREIGN KEY constraint failed')) { return res.status(400).json({ error: "Invalid project ID or project does not exist." }); }
      res.status(500).json({ error: "Failed to update API test" });
    }
  });

  app.delete("/api/api-tests/:id", async (req, res) => { /* ... existing code ... */ });

  const httpServer = createServer(app);
  return httpServer;
}
