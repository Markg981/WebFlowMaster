import { createServer, type Server } from "http";
import { Express } from "express";
import { setupAuth } from "./auth";
import {
  userSettings,
  projects,
  tests,
  AdhocTestStepSchema,
  AdhocDetectedElementSchema,
  PreconditionSchema,
  apiTestHistory,
  apiTests,
  insertApiTestHistorySchema,
  AssertionSchema,
  ExtractionSchema,
  AuthParamsSchema,
  testPlans,
  updateTestPlanApiPayloadSchema,
  testPlanSelectedTests,
  systemSettings,
  insertSystemSettingSchema,
  // Updated schema imports for schedules and executions
  testPlanSchedules,
  testPlanExecutions,
  reportTestCaseResults,
  ReportTestCaseResult,
  executionLogs,
  AUDIT_ACTIONS,
} from "@shared/schema";
import { auditActor, changedFields, recordAudit } from "./audit";
import { z } from "zod";
// For generating IDs
import { createInsertSchema } from 'drizzle-zod';
import { privilegedDb } from "./db";
import { eq, and, desc, sql, getTableColumns, asc, ilike, inArray } from "drizzle-orm"; // Added or, like, ilike, inArray, isNull
import { playwrightService } from "./playwright-service";
import { BrowserTaskError, browserTasks } from "./browser-tasks";
// Import schedulerService
import loggerPromise, { updateLogLevel } from "./logger";

import projectsRoutes from "./routes/projects.routes";
import testsRoutes from "./routes/tests.routes";
import testPlansRoutes from "./routes/test-plans.routes";
import uploadsRoutes from "./routes/uploads.routes";
import reportsRoutes from "./routes/reports.routes";
import artifactsRoutes, { artifactUrl, stepsWithArtifactUrls } from "./routes/artifacts.routes";
import apiKeysRoutes from "./routes/api-keys.routes";
import serviceAccountsRoutes from "./routes/service-accounts.routes";
import mfaRoutes from "./routes/mfa.routes";
import testPublishingRoutes from "./routes/test-publishing.routes";
import runnersRoutes from "./routes/runners.routes";
import suitesRoutes from "./routes/suites.routes";
import quarantineRoutes from "./routes/quarantine.routes";
import { requireMfaEnrollment } from "./middleware/require-mfa-enrollment";
import apiV1Routes from "./routes/api-v1.routes";
import cliRoutes from "./routes/cli.routes";
import agentsRoutes from "./routes/agents.routes";
import sourceHostsRoutes from "./routes/source-hosts.routes";
import webhookManagementRoutes from "./routes/webhooks.routes";
import stepGroupsRoutes from "./routes/step-groups.routes";
import projectElementsRoutes from "./routes/project-elements.routes";
import nlAuthoringRoutes from "./routes/nl-authoring.routes";
import tagsRoutes from "./routes/tags.routes";
import { tagsOfTests, testIdsWithTags } from "./test-tags";
import testVersionsRoutes from "./routes/test-versions.routes";
import issueTrackersRoutes from "./routes/issue-trackers.routes";
import issuesRoutes from "./routes/issues.routes";
import authRoutes from "./routes/auth.routes";
import observabilityRoutes from "./routes/observability.routes";
import environmentRoutes from "./routes/environments.routes";
import analyticsRoutes from "./routes/analytics.routes";
import organizationRoutes from "./routes/organization.routes";
import { tenancyMiddleware, withTenantTransaction } from "./middleware/tenancy";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { runApiRequest } from "./api-test-runner";
import { resolveVariables } from "./variables";
import { requireRole } from "./middleware/require-role";
import { assertSelectedTestsBelongTo, SELECTED_TESTS_NOT_FOUND } from "./routes/selected-tests";

export async function registerRoutes(app: Express): Promise<Server> {
    const resolvedLogger = await loggerPromise;

  const loadWebsiteBodySchema = z.object({
    url: z.string().url({ message: "Invalid URL" }),
  });

  const proxyApiRequestBodySchema = z.object({
    method: z.string(),
    // Not .url(): saved tests legitimately hold {{baseUrl}}/... here. The URL is
    // validated below, once the variables have been resolved.
    url: z.string().min(1),
    queryParams: z.record(z.any()).optional(),
    headers: z.record(z.string()).optional(),
    body: z.any().optional(),
    assertions: z.array(AssertionSchema).optional(),
    // Captured here as well as in a plan, so the tester can see what a request would hand
    // to the next one rather than finding out only when the plan runs.
    extractions: z.array(ExtractionSchema).optional(),
    // The settings, not the finished header. The page used to build the Authorization
    // header in the browser and send only that, which meant `{{name}}` in a token reached
    // the target literally — the environment's values are here, not there — and the same
    // test authenticated one way from the page and another from a schedule.
    auth: AuthParamsSchema.optional().nullable(),
    // Which environment resolves `{{name}}`. The organization it must belong to comes from
    // the session, so naming another tenant's environment resolves nothing.
    environmentId: z.number().int().positive().optional().nullable(),
  });

  const userSettingsBodySchema = createInsertSchema(userSettings).omit({ userId: true, updatedAt: true });

  const executeDirectTestSchema = z.object({
    name: z.string(),
    url: z.string().url(),
    sequence: z.array(AdhocTestStepSchema),
    elements: z.array(AdhocDetectedElementSchema),
    // Preconditions are part of a saved test and are run by the scheduled runner, so the
    // ad-hoc preview must accept and run them too — otherwise "Execute Test" exercises a
    // different setup than the real run.
    preconditions: z.array(PreconditionSchema).optional().nullable(),
    // Which environment resolves `{{name}}` placeholders. The organization it must belong
    // to is taken from the session, so naming another tenant's environment resolves nothing.
    environmentId: z.number().int().positive().optional().nullable(),
    // Rows the preview runs over, so it runs as many times as the saved test will.
    dataset: z.array(z.record(z.string())).optional().nullable(),
  });

    // Auth First
    setupAuth(app); // Attaches passport strategies

    // A request may authenticate as a person (the session passport just attached) or as a
    // pipeline (an API key). This turns the second into the first, so everything after it —
    // the tenancy binding, requireRole, every handler — has exactly one notion of who is
    // calling, and no route has to be audited twice.
    app.use(apiKeyAuth);

    // Before every router: establishes the ambient organization for the request, which
    // withTenantTransaction requires and refuses to run without.
    app.use(tenancyMiddleware);

    // A member whose organization requires a second factor, and who has none, reaches only
    // enrolment until they set one up.
    app.use(requireMfaEnrollment);

    // API Routers
    // First: /api/v1 answers everything under it in its own words, including unknown paths.
    app.use(cliRoutes);
    app.use(agentsRoutes);
    app.use(sourceHostsRoutes);
    app.use(apiV1Routes);
    app.use(authRoutes);
    app.use(organizationRoutes);
    app.use(projectsRoutes);
    app.use(testsRoutes);
    app.use(testPlansRoutes);
    app.use(uploadsRoutes);
    app.use(reportsRoutes);
    app.use(artifactsRoutes);
    app.use(apiKeysRoutes);
    app.use(serviceAccountsRoutes);
    app.use(mfaRoutes);
    app.use(testPublishingRoutes);
    app.use(runnersRoutes);
    app.use(suitesRoutes);
    app.use(quarantineRoutes);
    app.use(webhookManagementRoutes);
    app.use(stepGroupsRoutes);
    app.use(projectElementsRoutes);
    app.use(nlAuthoringRoutes);
    app.use(tagsRoutes);
    app.use(testVersionsRoutes);
    app.use(issueTrackersRoutes);
    app.use(issuesRoutes);
    app.use(observabilityRoutes);
    app.use(environmentRoutes);
    app.use(analyticsRoutes);

  app.post("/api/load-website", requireRole('editor'), async (req, res) => {
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
      resolvedLogger.debug({ message: `POST /api/load-website - Submitting the page load`, url, userId });
      const result = await browserTasks.run<Awaited<ReturnType<typeof playwrightService.loadWebsite>>>({
        task: { kind: 'load-website', url },
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
      });
      resolvedLogger.debug({ message: `POST /api/load-website - playwrightService.loadWebsite returned`, success: result?.success, url, userId });

      if (result.success) {
        res.json({ success: true, screenshot: result.screenshot, html: result.html });
      } else {
        resolvedLogger.error({ message: `POST /api/load-website - playwrightService.loadWebsite failed`, error: result.error, url, userId });
        res.status(500).json({ success: false, error: result.error || 'Failed to load website using Playwright service.' });
      }
    } catch (error: any) {
      if (error instanceof BrowserTaskError) {
        return res.status(error.status).json({ success: false, error: error.message, code: error.code });
      }
      resolvedLogger.error({ message: "POST /api/load-website - Critical error in route handler", error: error.message, stack: error.stack, url, userId });
      const errorMessage = error instanceof Error ? error.message : 'Unknown internal server error';
      res.status(500).json({ success: false, error: `Internal server error: ${errorMessage}` });
    }
  });

  app.post("/api/proxy-api-request", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parseResult = proxyApiRequestBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({ message: "POST /api/proxy-api-request - Invalid payload", errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    const { method, url, queryParams, headers, body, assertions, extractions, auth, environmentId } = parseResult.data;

    // The environment supplies the variables here exactly as it does for a scheduled run,
    // so a request that works in the tester works in a plan. Its id is the caller's; the
    // organization it must belong to is the session's.
    const vars = await resolveVariables({
      userId: req.user.id,
      organizationId: req.user.organizationId,
      environmentId: Number.isInteger(environmentId) ? environmentId : null,
    });

    // One implementation, shared with the scheduled runner. Keeping a second copy here is
    // what let the two drift until test-execution-service gave up and shipped
    // `Math.random() > 0.2` in place of executing anything at all.
    const result = await runApiRequest(
      { method, url, queryParams, headers, body, assertions, extractions, auth },
      vars,
    );

    if (result.error) {
      resolvedLogger.error("Error in /api/proxy-api-request:", { error: result.error, url, method });
      return res.status(500).json({
        success: false,
        error: result.error,
        details: result.error,
        duration: result.durationMs,
      });
    }

    res.status(200).json({
      success: true,
      status: result.status,
      headers: result.headers,
      body: result.body,
      duration: result.durationMs,
      assertionResults: result.assertions,
      // Present so the tester can see what a request would hand to the next one in a plan,
      // rather than finding out only when the plan runs.
      extracted: result.extracted,
      extractionErrors: result.extractionErrors,
    });
  });


  const detectElementsBodySchema = z.object({
    url: z.string().url({ message: "Invalid URL for element detection" }),
  });
  app.post("/api/detect-elements", requireRole('editor'), async (req, res) => {
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
      resolvedLogger.debug({ message: `POST /api/detect-elements - Submitting the element survey`, url, userId });
      const detection = await browserTasks.run<Awaited<ReturnType<typeof playwrightService.detectElements>>>({
        task: { kind: 'detect-elements', url },
        userId: req.user.id,
        organizationId: req.user.organizationId,
      });
      resolvedLogger.debug({ message: `POST /api/detect-elements - playwrightService.detectElements returned`, elementCount: detection.elements.length, url, userId });

      // The screenshot travels with the elements so the preview and the boxes drawn on it
      // come from one page load. `summary` lets the panel say "showing 300 of 812" rather
      // than presenting a truncated list as though it were the whole page.
      res.json({
        success: true,
        elements: detection.elements,
        screenshot: detection.screenshot,
        summary: detection.summary,
      });
    } catch (error: any) {
      if (error instanceof BrowserTaskError) {
        return res.status(error.status).json({ success: false, error: error.message, code: error.code });
      }
      resolvedLogger.error({ message: "POST /api/detect-elements - Error in route handler", error: error.message, stack: error.stack, url, userId });
      const errorMessage = error instanceof Error ? error.message : 'Unknown internal server error';
      res.status(500).json({ success: false, error: `Internal server error during element detection: ${errorMessage}` });
    }
  });

  app.delete("/api/projects/:projectId", requireRole('editor'), async (req, res) => {
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
      // Inside the tenant transaction, so RLS bounds both statements to the caller's
      // organization. The userId predicate stays as the ownership rule it always was —
      // organizationId is the security boundary, userId is attribution, and this handler
      // previously relied on the latter for both.
      const deleted = await withTenantTransaction(async (tx) => {
        const projectToDelete = await tx
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(and(eq(projects.id, parsedProjectId), eq(projects.userId, userId)))
          .limit(1);

        if (projectToDelete.length === 0) return false;

        await tx
          .delete(projects)
          .where(and(eq(projects.id, parsedProjectId), eq(projects.userId, userId)));
        await recordAudit(tx, {
          action: AUDIT_ACTIONS.PROJECT_DELETED,
          actor: auditActor(req),
          targetType: 'project',
          targetId: parsedProjectId,
          metadata: { name: projectToDelete[0].name },
        });
        return true;
      });

      if (!deleted) {
        return res.status(404).json({ error: "Project not found or not owned by user." });
      }

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

  app.get("/api/settings", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const settings = await privilegedDb.select().from(userSettings).where(eq(userSettings.userId, req.user.id)).limit(1);

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

        const newSettings = await privilegedDb.insert(userSettings).values(defaultSettings).returning();
        return res.json(newSettings[0]);
      }
    } catch (error: any) {
      resolvedLogger.error({ message: "Failed to fetch user settings", userId: (req.user as any)?.id, error: error.message, stack: error.stack });
      return res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parseResult = userSettingsBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({ message: "POST /api/settings - Invalid payload", errors: parseResult.error.flatten(), userId: (req.user as any)?.id });
      return res.status(400).json({ error: "Invalid request payload", details: parseResult.error.flatten() });
    }

    try {
      const existingSettings = await privilegedDb.select().from(userSettings).where(eq(userSettings.userId, req.user.id)).limit(1);

      if (existingSettings.length > 0) {
        // Update existing settings
        const updatedSettings = await privilegedDb.update(userSettings)
          .set({ ...parseResult.data, updatedAt: new Date() })
          .where(eq(userSettings.userId, req.user.id))
          .returning();
        return res.json(updatedSettings[0]);
      } else {
        // Insert new settings
        const newSettings = await privilegedDb.insert(userSettings)
          .values({ ...parseResult.data, userId: req.user.id })
          .returning();
        return res.json(newSettings[0]);
      }
    } catch (error: any) {
      resolvedLogger.error({ message: "Failed to save user settings", userId: (req.user as any)?.id, error: error.message, stack: error.stack, body: req.body });
      return res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.post("/api/execute-test-direct", requireRole('editor'), async (req, res) => {
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
      // organizationId comes from the session, not the payload: the schema does not accept
      // it, so a client cannot name a tenant whose environment secrets it would resolve.
      resultFromService = await browserTasks.run({
        task: { kind: 'adhoc-sequence', payload },
        userId,
        organizationId: (req.user as any).organizationId,
      });
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
          detection: undefined,
          duration: 0
        });
      }
    } catch (error: any) {
      if (error instanceof BrowserTaskError && !res.headersSent) {
        res.status(error.status).json({ success: false, error: error.message, code: error.code, steps: [], duration: 0 });
        return;
      }
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
      const logData: any = {
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

  /**
   * Whether this server can open the visible browser window a recording needs.
   *
   * Recording is inherently local: Playwright launches the window on the machine running
   * this process, not in the user's browser. The one thing the server can check for certain
   * is whether it has a display at all — a Linux container without DISPLAY never will — so
   * the UI can disable the button with a real reason instead of failing at launch time.
   */
  app.get("/api/recording-capability", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const headlessOnly = process.platform === 'linux' && !process.env.DISPLAY;
    res.json({
      supported: !headlessOnly,
      reason: headlessOnly ? 'no-display' : undefined,
      // Always reported: the window appears here, which is only useful to the user when
      // the server runs on their own machine.
      serverPlatform: process.platform,
    });
  });

  app.post("/api/start-recording", requireRole('editor'), async (req, res) => {
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
  
  /**
   * Saves the recorder browser's current session against an environment.
   *
   * Called after the tester has signed in inside the recorder window, so runs against that
   * environment start authenticated instead of replaying the login every time.
   */
  app.post("/api/recording-login-state", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const schema = z.object({
      sessionId: z.string().min(1, "Session ID is required"),
      environmentId: z.number().int().positive(),
    });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid request data", details: parseResult.error.flatten() });
    }

    try {
      const { sessionId, environmentId } = parseResult.data;
      // organizationId comes from the session: the environment written to has to be one
      // this caller's tenant owns, whatever id the body names.
      const saved = await playwrightService.captureLoginState(sessionId, {
        environmentId,
        organizationId: req.user.organizationId,
      });

      if (!saved) {
        return res.status(404).json({
          success: false,
          error: "That recording session is not open, so there was no browser session to save.",
        });
      }
      res.json({ success: true });
    } catch (error: any) {
      resolvedLogger.error({ message: "Error capturing login state", error: error.message, stack: error.stack, userId: (req.user as any)?.id });
      res.status(500).json({ success: false, error: "Failed to save the login state" });
    }
  });

  app.post("/api/stop-recording", requireRole('editor'), async (req, res) => {
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
          sequence: result.sequence || []
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
  
  app.get("/api/get-recorded-actions", requireRole('editor'), async (req, res) => {
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

      // The field is `sequence` on every recording endpoint — start, stop and poll — so the
      // client has one shape to parse. It used to be `actions` only here, which is why the
      // live action list stayed empty for the whole recording.
      if (result.success) {
        res.json({
          success: true,
          sequence: result.sequence || [],
          sessionEnded: result.sessionEnded || false,
          error: result.error,
        });
      } else {
        res.status(404).json({
          success: false,
          sequence: [],
          sessionEnded: result.sessionEnded || false,
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
  app.post("/api/api-test-history", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const parseResult = insertApiTestHistorySchema.safeParse(req.body);
    if (!parseResult.success) { resolvedLogger.warn({ message: "POST /api/api-test-history - Invalid payload", errors: parseResult.error.flatten(), userId: (req.user as any)?.id }); return res.status(400).json({ error: "Invalid history data", details: parseResult.error.flatten() }); }
    try {
      const newHistoryEntry = await withTenantTransaction((tx) =>
        tx.insert(apiTestHistory).values({ ...parseResult.data, userId: req.user!.id, organizationId: req.user!.organizationId }).returning(),
      );
      res.status(201).json(newHistoryEntry[0]);
    } catch (error: any) { resolvedLogger.error({ message: "Error creating API test history entry", error: error.message, stack: error.stack, requestBody: req.body, userId: (req.user as any)?.id }); res.status(500).json({ error: "Failed to save API test history" }); }
  });

  app.get("/api/api-test-history", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    try {
      // Both inside one tenant transaction: RLS bounds them to the caller's organization, and
      // the count must be taken under the same binding as the page it describes.
      const { historyEntries, totalResult } = await withTenantTransaction(async (tx) => ({
        historyEntries: await tx.select().from(apiTestHistory).where(eq(apiTestHistory.userId, req.user!.id)).orderBy(desc(apiTestHistory.createdAt)).limit(limit).offset(offset),
        totalResult: await tx.select({ count: sql`count(*)` }).from(apiTestHistory).where(eq(apiTestHistory.userId, req.user!.id)),
      }));
      const total = totalResult[0]?.count || 0;
      res.json({ items: historyEntries, page, limit, totalItems: Number(total), totalPages: Math.ceil(Number(total) / limit) });
    } catch (error: any) { resolvedLogger.error({ message: "Error fetching API test history", error: error.message, stack: error.stack, userId: (req.user as any)?.id, query: req.query }); res.status(500).json({ error: "Failed to fetch API test history" }); }
  });

  app.delete("/api/api-test-history/:id", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) { return res.status(401).json({ error: "Unauthorized" }); }
    const id = parseInt(req.params.id);
    if (isNaN(id)) { return res.status(400).json({ error: "Invalid history ID" }); }
    try {
      const result = await withTenantTransaction((tx) =>
        tx.delete(apiTestHistory).where(and(eq(apiTestHistory.id, id), eq(apiTestHistory.userId, req.user!.id))).returning(),
      );
      if (result.length === 0) { return res.status(404).json({ error: "History entry not found or not owned by user" }); }
      res.status(204).send();
    } catch (error: any) { resolvedLogger.error({ message: `Error deleting API test history entry ${id}`, error: error.message, stack: error.stack, userId: (req.user as any)?.id }); res.status(500).json({ error: "Failed to delete history entry" }); }
  });

  // --- Test Plan Schedules API Endpoints (formerly /api/schedules) ---

  // GET /api/test-plan-schedules/plan/:planId - List schedules for a specific test plan
  app.get("/api/test-plan-schedules/plan/:planId", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { planId } = req.params;
    if (!planId) {
      return res.status(400).json({ error: "Test Plan ID is required." });
    }

    try {
      // Scoped to the ambient tenant transaction rather than privilegedDb: RLS is silently
      // inert under a superuser, so an unscoped privilegedDb query here returned every
      // organization's schedules for any plan id, including another tenant's.
      const result = await withTenantTransaction((tx) =>
        tx
          .select({
            ...getTableColumns(testPlanSchedules),
            testPlanName: testPlans.name,
          })
          .from(testPlanSchedules)
          .leftJoin(testPlans, eq(testPlanSchedules.testPlanId, testPlans.id))
          .where(eq(testPlanSchedules.testPlanId, planId))
          .orderBy(desc(testPlanSchedules.createdAt)),
      );

      const parsedResults = result.map((schedule: any) => ({
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

  // testPlanApiPayloadSchema / updateTestPlanApiPayloadSchema now live in shared/schema.ts
  // so server/routes/test-plans.routes.ts can validate against the same shape.


  // --- Test Plans API Endpoints ---

  // GET /api/test-plans - List all test plans

  // GET /api/test-plans/:id - Get a single test plan by ID

  // POST /api/test-plans - Create a new test plan

  // PUT /api/test-plans/:id - Update an existing test plan
  app.put("/api/test-plans/:id", requireRole('editor'), async (req, res) => {
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
        const existingPlanCheck = await withTenantTransaction((tx) =>
          tx.select({ id: testPlans.id }).from(testPlans).where(eq(testPlans.id, testPlanId)),
        );
        if (existingPlanCheck.length === 0) {
            return res.status(404).json({ error: "Test plan not found." });
        }
        return res.status(400).json({ error: "No update data provided." });
      }

      // withTenantTransaction, not privilegedDb.transaction: RLS is silently inert under a
      // superuser, so the explicit organizationId predicates below were the only thing scoping
      // this handler. They stay, but they are now belt as well as braces.
      const updatedPlanResult = await withTenantTransaction(async (tx) => {
        let mainPlanUpdated;
        if (Object.keys(planUpdates).length > 0) {
          // Stringify JSON fields before updating: both columns are typed as their parsed
          // object shape while the DB stores them as text.
          const updatesToApply = { ...planUpdates } as Record<string, unknown>;
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
              // A Date, not unix seconds: updatedAt is a `timestamp` column, and drizzle
              // calls .toISOString() on whatever it is given. The previous number made every
              // PUT that touched a plan field fail with "value.toISOString is not a function".
              updatedAt: new Date(),
            })
            // Scoped to the caller's organization, so another tenant's plan is simply not
            // there. Without this the handler would happily update any plan by id, and the
            // join rows below would then be stamped with the foreign plan's organization
            // while naming tests from the caller's — a row that is internally cross-tenant.
            .where(and(eq(testPlans.id, testPlanId), eq(testPlans.organizationId, req.user.organizationId)))
            .returning();

          if (mainPlanUpdated.length === 0) {
            resolvedLogger.warn(`PUT /api/test-plans/${testPlanId} - Test plan not found during main record update.`);
            throw new Error("Test plan not found or no changes to main record."); // Will be caught and result in 404 like
          }
        } else {
          // If only selectedTests are being updated, fetch the current plan to return.
          // Same organization scope as the update branch above.
          const currentPlan = await tx
            .select()
            .from(testPlans)
            .where(and(eq(testPlans.id, testPlanId), eq(testPlans.organizationId, req.user.organizationId)));
          if (currentPlan.length === 0) {
            throw new Error("Test plan not found.");
          }
          mainPlanUpdated = currentPlan;
        }


        if (selectedTests !== undefined) { // If selectedTests is provided (even an empty array)
          await tx.delete(testPlanSelectedTests).where(eq(testPlanSelectedTests.testPlanId, testPlanId));

          if (selectedTests.length > 0) {
            await assertSelectedTestsBelongTo(tx, req.user.organizationId, selectedTests);
            const selectedTestValues = selectedTests.map((st) => ({
              testPlanId: testPlanId,
              // Taken from the plan these rows hang off, not from the session: a join row must
              // belong to the same organization as its parent, and those can differ whenever
              // the caller reaches a plan that isn't theirs.
              organizationId: mainPlanUpdated[0].organizationId,
              testId: st.type === 'ui' ? st.id : null,
              apiTestId: st.type === 'api' ? st.id : null,
              testType: st.type,
            }));
            await tx.insert(testPlanSelectedTests).values(selectedTestValues);
          }
        }

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.PLAN_UPDATED,
          actor: auditActor(req),
          targetType: 'test_plan',
          targetId: testPlanId,
          metadata: {
            name: mainPlanUpdated[0].name,
            fields: changedFields(parseResult.data as Record<string, unknown>),
            ...(selectedTests !== undefined ? { tests: selectedTests.length } : {}),
          },
        });
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
      // Either the DB rejected an id that doesn't exist at all, or assertSelectedTestsBelongTo
      // rejected one that exists in another organization. Both are the caller naming a test
      // that is not theirs to name, and both answer the same way — a distinct message for the
      // second would tell them which ids exist in other tenants.
      if (/foreign key/i.test(error.message || '') || SELECTED_TESTS_NOT_FOUND.test(error.message || '')) {
        return res.status(400).json({ error: "One or more selected tests do not exist."})
      }
      res.status(500).json({ error: "Failed to update test plan" });
    }
  });

  // DELETE /api/test-plans/:id - Delete a test plan
  app.delete("/api/test-plans/:id", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const testPlanId = req.params.id;

    try {
      // onDelete: 'cascade' is defined in the schedules.testPlanId FK.
      // This means deleting a test plan will automatically delete associated schedules.
      // Also, test_plan_selected_tests and test_plan_runs have onDelete: 'cascade' for testPlanId.
      //
      // Scoped to the caller's organization (matching the PUT handler above) and run inside
      // the tenant transaction, so another tenant's plan is simply not there rather than
      // being destroyed along with its schedules and execution history.
      const result = await withTenantTransaction(async (tx) => {
        const rows = await tx
          .delete(testPlans)
          .where(and(eq(testPlans.id, testPlanId), eq(testPlans.organizationId, req.user!.organizationId)))
          .returning();
        if (rows.length > 0) {
          await recordAudit(tx, {
            action: AUDIT_ACTIONS.PLAN_DELETED,
            actor: auditActor(req),
            targetType: 'test_plan',
            targetId: testPlanId,
            // Its schedules and run history went with it (cascade), which is worth saying.
            metadata: { name: rows[0].name },
          });
        }
        return rows;
      });

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
  app.post("/api/run-test-plan/:id", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const testPlanId = req.params.id;
    const userId = req.user.id;

    resolvedLogger.http({ message: `POST /api/run-test-plan/${testPlanId} - Handler reached`, testPlanId, userId });

    try {
      // Ownership gate: runTestPlan (test-execution-service.ts) and everything it kicks off
      // — processTestPlanJob, the selected-tests and inArray test loads, the report writes —
      // all query privilegedDb with no organization filter, and the execution row it inserts
      // is stamped with *the plan's* organizationId, not the caller's. Without this check a
      // session in one organization could execute, and receive results for, another tenant's
      // test plan. Converting test-execution-service itself to run inside the tenant context
      // is a larger change (it also runs as a background job with no ambient tenant) and is
      // deliberately out of scope here; this closes the one wire-reachable entry point.
      const owned = await withTenantTransaction((tx) =>
        tx.select({ id: testPlans.id }).from(testPlans).where(eq(testPlans.id, testPlanId)).limit(1),
      );
      if (owned.length === 0) {
        return res.status(404).json({ error: "Test plan not found" });
      }

      // A pipeline that retries this request after a timeout sends the same key and gets the
      // run it already started, instead of a second one.
      const idempotencyKey = req.get('Idempotency-Key')?.trim() || undefined;
      if (idempotencyKey && idempotencyKey.length > 255) {
        return res.status(400).json({ success: false, error: "Idempotency-Key must be at most 255 characters." });
      }

      // Dynamically import runTestPlan to avoid circular dependencies if test-execution-service grows
      const { runTestPlan } = await import("./test-execution-service");
      // `updateBaselines` is how a legitimate redesign gets a visually-tested plan out of red:
      // this run's screenshots become the baselines the next one is measured against.
      const executionResult = await runTestPlan(testPlanId, userId, {
        environmentId: typeof req.body?.environmentId === 'number' ? req.body.environmentId : undefined,
        updateBaselines: req.body?.updateBaselines === true,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });

      if ("error" in executionResult) {
        const errorResult = executionResult as { error: string; status?: number; testPlanRunId?: string };
        // Check if a specific status code was suggested by runTestPlan
        const statusCode = errorResult.status && typeof errorResult.status === 'number' ? errorResult.status : 500;
        resolvedLogger.error({ message: `Test plan execution failed for plan ${testPlanId}`, error: errorResult.error, testPlanRunId: errorResult.testPlanRunId });
        return res.status(statusCode).json({ success: false, error: errorResult.error, data: executionResult });
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
  app.get("/api/selectable-tests", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = req.user.id; // Assuming tests are user-specific

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10; // Default to 10 items per page
    const offset = (page - 1) * limit;
    const searchTerm = req.query.search as string | undefined;

    // Which tags a test must carry to be offered. Every one of them, not any: "smoke and
    // checkout" means the tests that are both, which is what narrowing a list down means.
    const tagIds = String(req.query.tags ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');

    try {
      // Build conditions
      const uiConditions = [eq(tests.userId, userId)];
      const apiConditions = [eq(apiTests.userId, userId)];

      if (searchTerm) {
        const searchPattern = `%${searchTerm}%`;
        uiConditions.push(ilike(tests.name, searchPattern));
        apiConditions.push(ilike(apiTests.name, searchPattern));
      }

      // Execute queries
      // One tenant transaction for both: RLS bounds them to the caller's organization. The
      // userId predicates stay as the ownership filter they were, but they are no longer what
      // keeps another tenant's rows out — organizationId is the boundary, userId attribution.
      const { uiTestResults, apiTestResults, tagsByTest } = await withTenantTransaction(async (tx) => {
        if (tagIds.length > 0) {
          // A tag filter that matches nothing must offer nothing. inArray on an empty list is
          // not a predicate, so the empty case is answered here rather than by a query that
          // would quietly return everything.
          const [uiIds, apiIds] = await Promise.all([
            testIdsWithTags(tx, { tagIds, testType: 'ui' }),
            testIdsWithTags(tx, { tagIds, testType: 'api' }),
          ]);
          if (uiIds.length === 0) uiConditions.push(sql`false`);
          else uiConditions.push(inArray(tests.id, uiIds));
          if (apiIds.length === 0) apiConditions.push(sql`false`);
          else apiConditions.push(inArray(apiTests.id, apiIds));
        }

        const uiTestResults = await tx.select({
            id: tests.id,
            name: tests.name,
            description: sql<string>`null`.as('description'),
            type: sql<string>`'ui'`.as('type'),
            updatedAt: tests.updatedAt
          })
          .from(tests)
          .where(and(...uiConditions));
        const apiTestResults = await tx.select({
            id: apiTests.id,
            name: apiTests.name,
            description: sql<string>`null`.as('description'),
            type: sql<string>`'api'`.as('type'),
            updatedAt: apiTests.updatedAt
          })
          .from(apiTests)
          .where(and(...apiConditions));

        return {
          uiTestResults,
          apiTestResults,
          // Shown beside each name, so somebody picking tests can see what they are picking
          // rather than recognising it from the name alone.
          tagsByTest: await tagsOfTests(tx, {
            testIds: uiTestResults.map((row) => row.id),
            apiTestIds: apiTestResults.map((row) => row.id),
          }),
        };
      });

      // Combine results
      const combinedResults = [
        ...uiTestResults.map((row) => ({ ...row, tags: tagsByTest.ui.get(row.id) ?? [] })),
        ...apiTestResults.map((row) => ({ ...row, tags: tagsByTest.api.get(row.id) ?? [] })),
      ];

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

// --- Test Execution Logs API Endpoint ---
app.get("/api/test-plan-executions/:executionId/logs", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { executionId } = req.params;

  try {
    // Scoped to the tenant transaction: execution_logs carries test steps and substituted
    // values, so an unscoped privilegedDb query here handed a foreign execution's full log
    // body to any authenticated caller who guessed its id.
    const logs = await withTenantTransaction((tx) =>
      tx
        .select()
        .from(executionLogs)
        .where(eq(executionLogs.testPlanExecutionId, executionId))
        .orderBy(asc(executionLogs.timestamp)),
    );

    res.json(logs);
  } catch (error: any) {
    resolvedLogger.error({ message: "Error fetching execution logs", error: error.message, executionId });
    res.status(500).json({ error: "Failed to fetch execution logs" });
  }
});

// --- Test Report Page API Endpoint ---
app.get("/api/test-plan-executions/:executionId/report", requireRole('viewer'), async (req, res) => {
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
    // Both queries run inside the same tenant transaction: unscoped privilegedDb queries
    // here returned a foreign execution's full report — including plan and test-case names
    // — to any authenticated caller who guessed its id.
    const reportSource = await withTenantTransaction(async (tx) => {
      // 1. Fetch the main TestPlanExecution record and its associated TestPlan
      const executionDetailsResult = await tx
        .select({
          execution: getTableColumns(testPlanExecutions),
          plan: getTableColumns(testPlans),
        })
        .from(testPlanExecutions)
        .leftJoin(testPlans, eq(testPlanExecutions.testPlanId, testPlans.id))
        .where(eq(testPlanExecutions.id, executionId))
        .limit(1);

      if (executionDetailsResult.length === 0) {
        return null;
      }

      // 2. Fetch all reportTestCaseResults for this execution
      // Ensure reportTestCaseResults is imported from @shared/schema
      const testCaseResults: ReportTestCaseResult[] = await tx
        .select()
        .from(reportTestCaseResults)
        .where(eq(reportTestCaseResults.testPlanExecutionId, executionId))
        .orderBy(desc(reportTestCaseResults.status), asc(reportTestCaseResults.testName)); // Example ordering

      // The attempt that followed this one, when a schedule's retry policy queued one — so a
      // failed attempt's report can point at the run that decided the verdict.
      const thisRun = executionDetailsResult[0].execution;
      const [nextAttempt] = await tx
        .select({ id: testPlanExecutions.id, status: testPlanExecutions.status, attempt: testPlanExecutions.attempt })
        .from(testPlanExecutions)
        .where(and(
          eq(testPlanExecutions.retryOfExecutionId, thisRun.retryOfExecutionId ?? thisRun.id),
          eq(testPlanExecutions.attempt, thisRun.attempt + 1),
        ))
        .limit(1);

      return { ...executionDetailsResult[0], testCaseResults, nextAttempt: nextAttempt ?? null };
    });

    if (!reportSource) {
      resolvedLogger.warn({ message: `Execution ID ${executionId} not found.`, userId });
      return res.status(404).json({ error: "Test plan execution not found." });
    }

    const { execution, plan, testCaseResults, nextAttempt } = reportSource;

    // A run whose evidence retention has removed links to nothing: its images would all be
    // broken, and the header says why they are not there instead.
    const purged = !!execution.artifactsPurgedAt;
    const openable = (storedPath: string | null | undefined) => (purged ? null : artifactUrl(executionId, storedPath));
    const stepsOf = (detailedLog: string | null | undefined) => {
      const steps = stepsWithArtifactUrls(executionId, detailedLog);
      if (!purged) return steps;
      return steps.map((step) => ({
        ...step,
        screenshot: null,
        visual: step.visual ? { ...step.visual, baselineImage: null, actualImage: null, diffImage: null } : undefined,
      }));
    };

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
        // Which browser this failure came from. A plan covering two browsers fails a test on
        // one and passes it on the other, and the two rows are otherwise identical.
        browser: r.browser,
        // Which version of the test this was. Null for a result recorded before versions were,
        // and for API tests, which have no history to point at.
        testVersion: r.testVersion,
        reasonForFailure: r.reasonForFailure,
        // In quarantine when it ran: shown, and not held against the run.
        quarantined: r.quarantined,
        // How many times the plan ran it before this result stood.
        attempts: r.attempts,
        screenshotUrl: openable(r.screenshotUrl),
        // A recording of the run, and a trace of it, when the plan kept them. The trace is the
        // one that answers what a screenshot cannot: the DOM, the network and the console at
        // every step.
        videoUrl: openable(r.videoUrl),
        traceUrl: openable(r.traceUrl),
        // The page's requests: the file, and the failed and slow ones read out of it.
        harUrl: openable(r.harUrl),
        networkSummary: r.networkSummary,
        detailedLog: r.detailedLog,
        // The step list the runner already recorded, with its images made openable. The
        // report had no way to show which step failed; the row's reason string was all of it.
        steps: stepsOf(r.detailedLog),
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
      // The row as stored, plus its steps and an openable screenshot: the grouped table is
      // where a passing test's visual baselines are looked at, not only a failing one's.
      groupedByModule[moduleName].components[componentName].tests.push({
        ...r,
        screenshotUrl: openable(r.screenshotUrl),
        videoUrl: openable(r.videoUrl),
        traceUrl: openable(r.traceUrl),
        harUrl: openable(r.harUrl),
        steps: stepsOf(r.detailedLog),
      } as typeof r);

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
        browsers: typeof execution.browsers === 'string' ? JSON.parse(execution.browsers) : (execution.browsers ?? []),
        dateTime: execution.startedAt ? execution.startedAt.toISOString() : 'N/A',
        completedAt: execution.completedAt ? execution.completedAt.toISOString() : null,
        status: execution.status,
        triggeredBy: execution.triggeredBy,
        // Which runner took it: where to look when one machine is the one that fails.
        runnerId: execution.runnerId ?? null,
        // The build, commit and branch that asked for it, when a pipeline did.
        ci: execution.ciContext ?? null,
        executionId: execution.id,
        testPlanId: execution.testPlanId,
        // Which attempt of its scheduled occurrence this run is, and where the others are.
        attempt: execution.attempt,
        maxAttempts: execution.maxAttempts,
        firstAttemptId: execution.retryOfExecutionId,
        nextAttempt,
        // Why a run ended the way it did when that was not its tests: cancelled, out of time,
        // its worker lost.
        failureCode: execution.failureCode,
        failureMessage: execution.failureMessage,
        // When retention removed this run's screenshots, videos and traces.
        artifactsPurgedAt: execution.artifactsPurgedAt ? execution.artifactsPurgedAt.toISOString() : null,
        // Tests that passed only after being run again: a pass, and a finding of its own.
        flakyTests: testCaseResults.filter((r) => r.status === 'Passed' && (r.attempts ?? 1) > 1).length,
        // Failures of tests in quarantine: counted in the failed figure, not in the verdict.
        quarantinedFailures: testCaseResults.filter((r) => r.quarantined && (r.status === 'Failed' || r.status === 'Error')).length,
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
        executionDurationMs: execution.executionDurationMs ?? ((execution.completedAt && execution.startedAt) ? (new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()) : null),
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
  app.get("/api/system-settings", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      // Assuming admin rights might be needed here, or specific user settings vs system settings
      // For now, just basic auth check
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const settings = await privilegedDb.select().from(systemSettings);
      res.json(settings);
    } catch (error: any) {
      resolvedLogger.error({ message: "Error fetching system settings", error: error.message, stack: error.stack, userId: (req.user as any)?.id });
      res.status(500).json({ error: "Failed to fetch system settings" });
    }
  });

  // GET /api/system-settings/:key - Get a single system setting by key
  app.get("/api/system-settings/:key", requireRole('viewer'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { key } = req.params;
    try {
      const result = await privilegedDb.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
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
  // system_settings is deliberately global (logRetentionDays, logLevel, clientLogLevel), so
  // this is gated to owners rather than any authenticated user of any organization: a
  // viewer or editor should not be able to reconfigure logging for every tenant.
  app.post("/api/system-settings", requireRole('owner'), async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
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
      await privilegedDb.insert(systemSettings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: value }, // For SQLite, directly set the value. `sql`excluded.value` is more for PostgreSQL.
        });

      // Fetch the (potentially) updated or newly inserted row
      const finalResult = await privilegedDb.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);

      if (finalResult.length === 0) {
         // This case should ideally not be reached if upsert is successful
         resolvedLogger.error({ message: "System setting upsert failed, no record found post-operation", key, value, userId: (req.user as any)?.id });
         return res.status(500).json({ error: "Failed to create or update system setting, and could not retrieve it." });
      }
      // Respond with 201 if it was an insert, 200 if an update.
      // For simplicity, we'll just return 200/201 with the final state.
      // Checking if it was an insert or update might require another query or different DB driver behavior.
      const savedSetting = finalResult[0];

      // In the owner's organization, since that is where an owner looks. Not in the same
      // transaction as the change: system_settings is installation-wide and has no tenant, so
      // the upsert above cannot run under one. The key and not the value, which may be anything.
      await withTenantTransaction((tx) =>
        recordAudit(tx, {
          action: AUDIT_ACTIONS.SYSTEM_SETTINGS_CHANGED,
          actor: auditActor(req),
          targetType: 'system_settings',
          targetId: key,
          metadata: { key },
        }),
      );

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

