import { createServer, type Server } from 'http';
import { Express } from 'express';
import { setupAuth } from './auth';
import {
  userSettings,
  tests,
  AdhocTestStepSchema,
  AdhocDetectedElementSchema,
  PreconditionSchema,
  CleanupSchema,
  apiTestHistory,
  apiTests,
  mobileTests,
  insertApiTestHistorySchema,
  AssertionSchema,
  ExtractionSchema,
  AuthParamsSchema,
  testPlans,
  systemSettings,
  insertSystemSettingSchema,
  testPlanSchedules,
  AUDIT_ACTIONS,
} from '@shared/schema';
import { auditActor, recordAudit } from './audit';
import { z } from 'zod';
// For generating IDs
import { createInsertSchema } from 'drizzle-zod';
import { privilegedDb } from './db';
import { eq, and, desc, sql, getTableColumns, ilike, inArray, type SQL } from 'drizzle-orm';
import { playwrightService } from './playwright-service';
import { BrowserTaskError, browserTasks } from './browser-tasks';
// Import schedulerService
import loggerPromise, { updateLogLevel } from './logger';

import projectsRoutes from './routes/projects.routes';
import testsRoutes from './routes/tests.routes';
import catalogRoutes from './routes/catalog.routes';
import testPlansRoutes from './routes/test-plans.routes';
import uploadsRoutes from './routes/uploads.routes';
import reportsRoutes from './routes/reports.routes';
import artifactsRoutes from './routes/artifacts.routes';
import apiKeysRoutes from './routes/api-keys.routes';
import serviceAccountsRoutes from './routes/service-accounts.routes';
import mfaRoutes from './routes/mfa.routes';
import ssoRoutes from './routes/sso.routes';
import testPublishingRoutes from './routes/test-publishing.routes';
import runnersRoutes from './routes/runners.routes';
import suitesRoutes from './routes/suites.routes';
import requirementsRoutes from './routes/requirements.routes';
import testDataRoutes from './routes/test-data.routes';
import impactRulesRoutes from './routes/impact-rules.routes';
import smsInboxRoutes from './routes/sms-inbox.routes';
import commentsRoutes from './routes/comments.routes';
import dashboardLayoutRoutes from './routes/dashboard-layout.routes';
import dashboardsRoutes from './routes/dashboards.routes';
import mailDeliveryRoutes, { mailDeliveryWebhookRouter } from './routes/mail-delivery.routes';
import mailSettingsRoutes from './routes/mail-settings.routes';
import mailTemplateRoutes from './routes/mail-templates.routes';
import { mailProviderWebhookRouter } from './routes/mail-provider.routes';
import testManagementRoutes from './routes/test-management.routes';
import mobileTestsRoutes from './routes/mobile-tests.routes';
import quarantineRoutes from './routes/quarantine.routes';
import { requireMfaEnrollment } from './middleware/require-mfa-enrollment';
import { requireSso } from './middleware/require-sso';
import apiV1Routes from './routes/api-v1.routes';
import cliRoutes from './routes/cli.routes';
import agentsRoutes from './routes/agents.routes';
import bddRoutes from './routes/bdd.routes';
import sourceHostsRoutes from './routes/source-hosts.routes';
import webhookManagementRoutes from './routes/webhooks.routes';
import stepGroupsRoutes from './routes/step-groups.routes';
import mobileStepGroupsRoutes from './routes/mobile-step-groups.routes';
import loadTestsRoutes from './routes/load-tests.routes';
import customActionsRoutes from './routes/custom-actions.routes';
import manualResultsRoutes from './routes/manual-results.routes';
import failureAnalysisRoutes from './routes/failure-analysis.routes';
import debugSessionsRoutes from './routes/debug-sessions.routes';
import browserGridsRoutes from './routes/browser-grids.routes';
import projectElementsRoutes from './routes/project-elements.routes';
import nlAuthoringRoutes from './routes/nl-authoring.routes';
import tagsRoutes from './routes/tags.routes';
import { tagsOfTests, testIdsWithTags } from './test-tags';
import testVersionsRoutes from './routes/test-versions.routes';
import issueTrackersRoutes from './routes/issue-trackers.routes';
import issuesRoutes from './routes/issues.routes';
import authRoutes from './routes/auth.routes';
import observabilityRoutes from './routes/observability.routes';
import environmentRoutes from './routes/environments.routes';
import analyticsRoutes from './routes/analytics.routes';
import organizationRoutes from './routes/organization.routes';
import tenantQuotaAdminRoutes from './routes/tenant-quota-admin.routes';
import { tenancyMiddleware, withTenantTransaction } from './middleware/tenancy';
import { SharedDataError, expandSharedDataset } from './test-data';
import { sharedSetIdOf } from '@shared/test-data';
import { apiKeyAuth } from './middleware/api-key-auth';
import { apiRateLimit, sharedHeavyRateLimit } from './middleware/rate-limits';
import { requireInstallationAdmin } from './installation-admin';
import { runApiRequest } from './api-test-runner';
import { withExecutionUsage } from './execution-usage';
import { quotaErrorBody } from './tenant-quotas';
import { ProtocolConfigSchema } from '@shared/api-protocol-config';
import { defaultVariables, resolveVariables } from './variables';
import { redactHistoryEntry } from './history-redaction';
import { requireRole } from './middleware/require-role';

export async function registerRoutes(app: Express): Promise<Server> {
  const resolvedLogger = await loggerPromise;
  // After requireRole, so it counts for the user the role check has already established.
  const heavyLimit = sharedHeavyRateLimit();

  const loadWebsiteBodySchema = z.object({
    url: z.string().url({ message: 'Invalid URL' }),
  });

  const proxyApiRequestBodySchema = z.object({
    method: z.string(),
    // Not .url(): saved tests legitimately hold {{baseUrl}}/... here. The URL is
    // validated below, once the variables have been resolved.
    url: z.string().min(1),
    queryParams: z.record(z.any()).optional(),
    headers: z.record(z.string()).optional(),
    body: z.any().optional(),
    // A form-data or binary body, which cannot travel in `body`: a browser FormData or File
    // serialises to `{}`. See ApiRequestSpec.multipart.
    multipart: z
      .array(
        z.discriminatedUnion('type', [
          z.object({ key: z.string().min(1), type: z.literal('text'), value: z.string() }),
          z.object({
            key: z.string().min(1),
            type: z.literal('file'),
            fileName: z.string(),
            contentType: z.string().optional().nullable(),
            base64: z.string(),
          }),
        ]),
      )
      .optional()
      .nullable(),
    binary: z
      .object({ contentType: z.string().optional().nullable(), base64: z.string() })
      .optional()
      .nullable(),
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
    // A gRPC test's service definition.
    protoDefinition: z.string().max(500_000).optional().nullable(),
    protocolConfig: ProtocolConfigSchema.optional().nullable(),
  });

  const userSettingsBodySchema = createInsertSchema(userSettings).omit({
    userId: true,
    updatedAt: true,
  });

  const executeDirectTestSchema = z.object({
    name: z.string(),
    url: z.string().url(),
    sequence: z.array(AdhocTestStepSchema),
    elements: z.array(AdhocDetectedElementSchema),
    // Preconditions are part of a saved test and are run by the scheduled runner, so the
    // ad-hoc preview must accept and run them too — otherwise "Execute Test" exercises a
    // different setup than the real run.
    preconditions: z.array(PreconditionSchema).optional().nullable(),
    // And cleaned up after, as a saved run is (server/cleanup-runner.ts).
    cleanups: z.array(CleanupSchema).max(50).optional().nullable(),
    // Which environment resolves `{{name}}` placeholders. The organization it must belong
    // to is taken from the session, so naming another tenant's environment resolves nothing.
    environmentId: z.number().int().positive().optional().nullable(),
    // Rows the preview runs over, so it runs as many times as the saved test will.
    dataset: z.array(z.record(z.string())).optional().nullable(),
  });

  // Auth First
  setupAuth(app); // Attaches passport strategies
  app.use(mailDeliveryWebhookRouter);
  app.use(mailProviderWebhookRouter);

  // A request may authenticate as a person (the session passport just attached) or as a
  // pipeline (an API key). This turns the second into the first, so everything after it —
  // the tenancy binding, requireRole, every handler — has exactly one notion of who is
  // calling, and no route has to be audited twice.
  app.use(apiKeyAuth);

  // Machines are limited per minute: each API key, and anonymous calls to /api/v1
  // (server/middleware/rate-limits.ts).
  app.use(apiRateLimit());

  // Before every router: establishes the ambient organization for the request, which
  // withTenantTransaction requires and refuses to run without.
  app.use(tenancyMiddleware);

  // A password session of a member whose organization requires single sign-on ends here.
  app.use(requireSso);

  // A member whose organization requires a second factor, and who has none, reaches only
  // enrolment until they set one up.
  app.use(requireMfaEnrollment);

  // API Routers
  // First: /api/v1 answers everything under it in its own words, including unknown paths.
  app.use(cliRoutes);
  app.use(agentsRoutes);
  app.use(bddRoutes);
  app.use(sourceHostsRoutes);
  app.use(apiV1Routes);
  app.use(authRoutes);
  app.use(organizationRoutes);
  app.use(tenantQuotaAdminRoutes);
  app.use(projectsRoutes);
  app.use(testsRoutes);
  app.use(catalogRoutes);
  app.use(testPlansRoutes);
  app.use(uploadsRoutes);
  app.use(reportsRoutes);
  app.use(artifactsRoutes);
  app.use(apiKeysRoutes);
  app.use(serviceAccountsRoutes);
  app.use(mfaRoutes);
  app.use(ssoRoutes);
  app.use(testPublishingRoutes);
  app.use(runnersRoutes);
  app.use(suitesRoutes);
  app.use(requirementsRoutes);
  app.use(testDataRoutes);
  app.use(impactRulesRoutes);
  app.use(smsInboxRoutes);
  app.use(commentsRoutes);
  app.use(dashboardLayoutRoutes);
  app.use(dashboardsRoutes);
  app.use(mailDeliveryRoutes);
  app.use(mailSettingsRoutes);
  app.use(mailTemplateRoutes);
  app.use(testManagementRoutes);
  app.use(mobileTestsRoutes);
  app.use(mobileStepGroupsRoutes);
  app.use(loadTestsRoutes);
  app.use(quarantineRoutes);
  app.use(webhookManagementRoutes);
  app.use(stepGroupsRoutes);
  app.use(customActionsRoutes);
  app.use(manualResultsRoutes);
  app.use(failureAnalysisRoutes);
  app.use(debugSessionsRoutes);
  app.use(browserGridsRoutes);
  app.use(projectElementsRoutes);
  app.use(nlAuthoringRoutes);
  app.use(tagsRoutes);
  app.use(testVersionsRoutes);
  app.use(issueTrackersRoutes);
  app.use(issuesRoutes);
  app.use(observabilityRoutes);
  app.use(environmentRoutes);
  app.use(analyticsRoutes);

  app.post('/api/load-website', requireRole('editor'), heavyLimit, async (req, res) => {
    resolvedLogger.http(
      `POST /api/load-website - Handler reached. UserId: ${(req.user as any)?.id}`,
    );
    resolvedLogger.debug({ message: 'POST /api/load-website - Request body:', body: req.body });

    const parseResult = loadWebsiteBodySchema.safeParse(req.body);

    if (!parseResult.success) {
      resolvedLogger.warn({
        message: 'POST /api/load-website - Invalid request body',
        errors: parseResult.error.flatten(),
        userId: (req.user as any)?.id,
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid request payload',
        details: parseResult.error.flatten(),
      });
    }

    const { url } = parseResult.data;
    const userId = (req.user as any)?.id as number | undefined;

    try {
      resolvedLogger.debug({
        message: `POST /api/load-website - Submitting the page load`,
        url,
        userId,
      });
      const result = await browserTasks.run<
        Awaited<ReturnType<typeof playwrightService.loadWebsite>>
      >({
        task: { kind: 'load-website', url },
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
      });
      resolvedLogger.debug({
        message: `POST /api/load-website - playwrightService.loadWebsite returned`,
        success: result?.success,
        url,
        userId,
      });

      if (result.success) {
        res.json({ success: true, screenshot: result.screenshot, html: result.html });
      } else {
        resolvedLogger.error({
          message: `POST /api/load-website - playwrightService.loadWebsite failed`,
          error: result.error,
          url,
          userId,
        });
        res.status(500).json({
          success: false,
          error: result.error || 'Failed to load website using Playwright service.',
        });
      }
    } catch (error: any) {
      const quota = quotaErrorBody(error);
      if (quota) return res.status(429).json(quota);
      if (error instanceof BrowserTaskError) {
        return res
          .status(error.status)
          .json({ success: false, error: error.message, code: error.code });
      }
      resolvedLogger.error({
        message: 'POST /api/load-website - Critical error in route handler',
        error: error.message,
        stack: error.stack,
        url,
        userId,
      });
      const errorMessage = error instanceof Error ? error.message : 'Unknown internal server error';
      res.status(500).json({ success: false, error: `Internal server error: ${errorMessage}` });
    }
  });

  app.post('/api/proxy-api-request', requireRole('editor'), heavyLimit, async (req, res) => {
    const parseResult = proxyApiRequestBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({
        message: 'POST /api/proxy-api-request - Invalid payload',
        errors: parseResult.error.flatten(),
        userId: (req.user as any)?.id,
      });
      return res
        .status(400)
        .json({ error: 'Invalid request payload', details: parseResult.error.flatten() });
    }

    const {
      method,
      url,
      queryParams,
      headers,
      body,
      multipart,
      binary,
      assertions,
      extractions,
      auth,
      environmentId,
      protoDefinition,
      protocolConfig,
    } = parseResult.data;

    // The environment supplies the variables here exactly as it does for a scheduled run,
    // so a request that works in the tester works in a plan. Its id is the caller's; the
    // organization it must belong to is the session's.
    const vars = await resolveVariables({
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
      environmentId: Number.isInteger(environmentId) ? environmentId : null,
    });

    // One implementation, shared with the scheduled runner. Keeping a second copy here is
    // what let the two drift until test-execution-service gave up and shipped
    // `Math.random() > 0.2` in place of executing anything at all.
    let result: Awaited<ReturnType<typeof runApiRequest>>;
    try {
      result = await withExecutionUsage('api', () =>
        runApiRequest(
          {
            method,
            url,
            queryParams,
            headers,
            body,
            multipart,
            binary,
            assertions,
            extractions,
            auth,
            protoDefinition,
            protocolConfig,
          },
          vars,
        ),
      );
    } catch (error) {
      const quota = quotaErrorBody(error);
      if (quota) return res.status(429).json(quota);
      resolvedLogger.error({
        message: 'Direct API execution failed',
        error: (error as Error).message,
      });
      return res.status(500).json({ error: 'The API request could not be executed.' });
    }

    if (result.error) {
      resolvedLogger.error('Error in /api/proxy-api-request:', {
        error: result.error,
        url,
        method,
      });
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
    url: z.string().url({ message: 'Invalid URL for element detection' }),
  });
  app.post('/api/detect-elements', requireRole('editor'), heavyLimit, async (req, res) => {
    const parseResult = detectElementsBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({
        message: 'POST /api/detect-elements - Invalid request body',
        errors: parseResult.error.flatten(),
        userId: (req.user as any)?.id,
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid request payload',
        details: parseResult.error.flatten(),
      });
    }
    const { url } = parseResult.data;
    const userId = (req.user as any)?.id as number | undefined;

    resolvedLogger.http(
      `POST /api/detect-elements - Handler reached. URL: ${url}, UserID: ${userId}`,
    );
    resolvedLogger.debug({ message: 'POST /api/detect-elements - Request body:', body: req.body });

    try {
      resolvedLogger.debug({
        message: `POST /api/detect-elements - Submitting the element survey`,
        url,
        userId,
      });
      const detection = await browserTasks.run<
        Awaited<ReturnType<typeof playwrightService.detectElements>>
      >({
        task: { kind: 'detect-elements', url },
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
      });
      resolvedLogger.debug({
        message: `POST /api/detect-elements - playwrightService.detectElements returned`,
        elementCount: detection.elements.length,
        url,
        userId,
      });

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
      const quota = quotaErrorBody(error);
      if (quota) return res.status(429).json(quota);
      if (error instanceof BrowserTaskError) {
        return res
          .status(error.status)
          .json({ success: false, error: error.message, code: error.code });
      }
      resolvedLogger.error({
        message: 'POST /api/detect-elements - Error in route handler',
        error: error.message,
        stack: error.stack,
        url,
        userId,
      });
      const errorMessage = error instanceof Error ? error.message : 'Unknown internal server error';
      res.status(500).json({
        success: false,
        error: `Internal server error during element detection: ${errorMessage}`,
      });
    }
  });

  app.get('/api/settings', requireRole('viewer'), async (req, res) => {
    try {
      const settings = await privilegedDb
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, req.user!.id))
        .limit(1);

      if (settings.length > 0) {
        return res.json(settings[0]);
      } else {
        // No settings found, create default settings
        const defaultSettings = {
          userId: req.user!.id,
          theme: 'light',
          defaultTestUrl: '',
          playwrightBrowser: 'chromium',
          playwrightHeadless: true,
          playwrightDefaultTimeout: 30000,
          playwrightWaitTime: 1000,
          language: 'en',
        };

        const newSettings = await privilegedDb
          .insert(userSettings)
          .values(defaultSettings)
          .returning();
        return res.json(newSettings[0]);
      }
    } catch (error: any) {
      resolvedLogger.error({
        message: 'Failed to fetch user settings',
        userId: (req.user as any)?.id,
        error: error.message,
        stack: error.stack,
      });
      return res.status(500).json({ error: 'Failed to fetch settings' });
    }
  });

  app.post('/api/settings', requireRole('viewer'), async (req, res) => {
    const parseResult = userSettingsBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({
        message: 'POST /api/settings - Invalid payload',
        errors: parseResult.error.flatten(),
        userId: (req.user as any)?.id,
      });
      return res
        .status(400)
        .json({ error: 'Invalid request payload', details: parseResult.error.flatten() });
    }

    try {
      const existingSettings = await privilegedDb
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, req.user!.id))
        .limit(1);

      if (existingSettings.length > 0) {
        // Update existing settings
        const updatedSettings = await privilegedDb
          .update(userSettings)
          .set({ ...parseResult.data, updatedAt: new Date() })
          .where(eq(userSettings.userId, req.user!.id))
          .returning();
        return res.json(updatedSettings[0]);
      } else {
        // Insert new settings
        const newSettings = await privilegedDb
          .insert(userSettings)
          .values({ ...parseResult.data, userId: req.user!.id })
          .returning();
        return res.json(newSettings[0]);
      }
    } catch (error: any) {
      resolvedLogger.error({
        message: 'Failed to save user settings',
        userId: (req.user as any)?.id,
        error: error.message,
        stack: error.stack,
        body: req.body,
      });
      return res.status(500).json({ error: 'Failed to save settings' });
    }
  });

  app.post('/api/execute-test-direct', requireRole('editor'), async (req, res) => {
    const userId = (req.user as any)?.id;
    resolvedLogger.http({ message: 'POST /api/execute-test-direct - Handler Reached.', userId });
    resolvedLogger.debug({
      message: 'POST /api/execute-test-direct - Request body:',
      body: req.body,
      userId,
    });

    if (!req.isAuthenticated() || !userId) {
      resolvedLogger.warn({
        message: 'POST /api/execute-test-direct - Unauthorized access attempt.',
        userId,
      });
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const parseResult = executeDirectTestSchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({
        message: 'POST /api/execute-test-direct - Invalid request payload',
        errors: parseResult.error.flatten(),
        userId,
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid request payload',
        details: parseResult.error.flatten(),
      });
    }

    // A test running over a shared data set runs over its rows here too (shared/test-data.ts).
    let payload: typeof parseResult.data = parseResult.data;
    try {
      if (sharedSetIdOf(payload.dataset) !== null)
        payload = await withTenantTransaction((tx) => expandSharedDataset(tx, parseResult.data));
    } catch (error) {
      if (error instanceof SharedDataError)
        return res.status(400).json({ success: false, error: error.message });
      throw error;
    }
    let resultFromService: any; // Keep it flexible to hold partial results in case of error

    try {
      resolvedLogger.debug({
        message: 'POST /api/execute-test-direct - Calling playwrightService.executeAdhocSequence.',
        userId,
        testName: payload.name,
      });
      // organizationId comes from the session, not the payload: the schema does not accept
      // it, so a client cannot name a tenant whose environment secrets it would resolve.
      resultFromService = await browserTasks.run({
        task: { kind: 'adhoc-sequence', payload },
        userId,
        organizationId: (req.user as any).organizationId,
      });
      resolvedLogger.debug({
        message: 'POST /api/execute-test-direct - playwrightService.executeAdhocSequence returned.',
        userId,
        testName: payload.name,
        serviceSuccess: resultFromService?.success,
      });
      resolvedLogger.debug({
        message: 'POST /api/execute-test-direct - Result from service:',
        result: resultFromService,
        userId,
      });

      // Ensure that even if executeAdhocSequence returns a non-standard error structure, we handle it
      if (typeof resultFromService?.success === 'boolean') {
        res.json(resultFromService);
      } else {
        // This case implies executeAdhocSequence might have thrown an error that was caught by the outer try-catch
        // or returned an unexpected structure.
        resolvedLogger.error({
          message:
            'POST /api/execute-test-direct - Unexpected structure from playwrightService.executeAdhocSequence.',
          resultFromService,
          userId,
          testName: payload.name,
        });
        res.status(500).json({
          success: false,
          error: 'Internal server error: Unexpected response from test execution service.',
          steps: [],
          detection: undefined,
          duration: 0,
        });
      }
    } catch (error: any) {
      const quota = quotaErrorBody(error);
      if (quota) return res.status(429).json(quota);
      if (error instanceof BrowserTaskError && !res.headersSent) {
        res
          .status(error.status)
          .json({ success: false, error: error.message, code: error.code, steps: [], duration: 0 });
        return;
      }
      resolvedLogger.error({
        message: `POST /api/execute-test-direct - ERROR during playwrightService.executeAdhocSequence call or response sending`,
        error: error.message,
        stack: error.stack,
        userId,
        testName: payload.name,
      });
      const responseError = {
        success: false,
        error: 'Error executing test sequence: ' + error.message,
        steps: resultFromService?.steps || [],
        detectedElements: resultFromService?.detectedElements || [],
        duration: resultFromService?.duration || 0,
      };
      if (!res.headersSent) {
        res.status(500).json(responseError);
      }
    } finally {
      const logData: any = {
        message: 'POST /api/execute-test-direct - Handler complete.',
        userId,
        testName: payload.name,
      };
      if (resultFromService) {
        logData.overallSuccess = resultFromService.success;
        logData.stepsReturned = resultFromService.steps?.length;
        logData.error = resultFromService.success ? undefined : resultFromService.error; // This is service error, not our log error
      } else {
        logData.overallSuccess = false;
        // logData.error already indicates resultFromService was undefined if it's not set by error block
      }
      resolvedLogger.http(logData);

      resolvedLogger.debug({
        message: 'POST /api/execute-test-direct - Full response that was/would be sent:',
        responseDetails:
          resultFromService ||
          'Error response sent in catch block or resultFromService was undefined',
        userId,
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
  app.get('/api/recording-capability', requireRole('viewer'), async (req, res) => {
    const headlessOnly = process.platform === 'linux' && !process.env.DISPLAY;
    res.json({
      supported: !headlessOnly,
      reason: headlessOnly ? 'no-display' : undefined,
      // Always reported: the window appears here, which is only useful to the user when
      // the server runs on their own machine.
      serverPlatform: process.platform,
    });
  });

  app.post('/api/start-recording', requireRole('editor'), heavyLimit, async (req, res) => {
    const startRecordingSchema = z.object({
      url: z.string().url('Invalid URL format'),
    });

    const parseResult = startRecordingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: parseResult.error.flatten(),
      });
    }

    try {
      const { url } = parseResult.data;
      const result = await playwrightService.startRecordingSession(url, req.user!.id);

      if (result.success) {
        res.json({
          success: true,
          sessionId: result.sessionId,
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error || 'Failed to start recording session',
        });
      }
    } catch (error: any) {
      resolvedLogger.error({
        message: 'Error starting recording session',
        error: error.message,
        stack: error.stack,
        url: req.body?.url,
        userId: (req.user as any)?.id,
      });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * Saves the recorder browser's current session against an environment.
   *
   * Called after the tester has signed in inside the recorder window, so runs against that
   * environment start authenticated instead of replaying the login every time.
   */
  app.post('/api/recording-login-state', requireRole('editor'), async (req, res) => {
    const schema = z.object({
      sessionId: z.string().min(1, 'Session ID is required'),
      environmentId: z.number().int().positive(),
    });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res
        .status(400)
        .json({ error: 'Invalid request data', details: parseResult.error.flatten() });
    }

    try {
      const { sessionId, environmentId } = parseResult.data;
      // organizationId comes from the session: the environment written to has to be one
      // this caller's tenant owns, whatever id the body names.
      const saved = await playwrightService.captureLoginState(sessionId, {
        environmentId,
        organizationId: req.user!.organizationId,
      });

      if (!saved) {
        return res.status(404).json({
          success: false,
          error: 'That recording session is not open, so there was no browser session to save.',
        });
      }
      res.json({ success: true });
    } catch (error: any) {
      resolvedLogger.error({
        message: 'Error capturing login state',
        error: error.message,
        stack: error.stack,
        userId: (req.user as any)?.id,
      });
      res.status(500).json({ success: false, error: 'Failed to save the login state' });
    }
  });

  app.post('/api/stop-recording', requireRole('editor'), async (req, res) => {
    const stopRecordingSchema = z.object({
      sessionId: z.string().min(1, 'Session ID is required'),
    });

    const parseResult = stopRecordingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: parseResult.error.flatten(),
      });
    }

    try {
      const { sessionId } = parseResult.data;
      const result = await playwrightService.stopRecordingSession(sessionId, req.user!.id);

      if (result.success) {
        res.json({
          success: true,
          sequence: result.sequence || [],
        });
      } else {
        res.status(404).json({
          success: false,
          error: result.error || 'Recording session not found',
        });
      }
    } catch (error: any) {
      resolvedLogger.error({
        message: 'Error stopping recording session',
        error: error.message,
        stack: error.stack,
        sessionId: req.body?.sessionId,
        userId: (req.user as any)?.id,
      });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  app.get('/api/get-recorded-actions', requireRole('editor'), async (req, res) => {
    const getRecordedActionsSchema = z.object({
      sessionId: z.string().min(1, 'Session ID is required'),
    });

    const parseResult = getRecordedActionsSchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: parseResult.error.flatten(),
      });
    }

    try {
      const { sessionId } = parseResult.data;
      const result = await playwrightService.getRecordedActions(sessionId, req.user!.id);

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
          error: result.error || 'Recording session not found',
        });
      }
    } catch (error: any) {
      resolvedLogger.error({
        message: 'Error getting recorded actions',
        error: error.message,
        stack: error.stack,
        sessionId: req.query?.sessionId,
        userId: (req.user as any)?.id,
      });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  // --- API Test History Endpoints ---
  app.post('/api/api-test-history', requireRole('editor'), async (req, res) => {
    const parseResult = insertApiTestHistorySchema.safeParse(req.body);
    if (!parseResult.success) {
      resolvedLogger.warn({
        message: 'POST /api/api-test-history - Invalid payload',
        errors: parseResult.error.flatten(),
        userId: (req.user as any)?.id,
      });
      return res
        .status(400)
        .json({ error: 'Invalid history data', details: parseResult.error.flatten() });
    }
    try {
      // The environment the request ran in, so its values can be taken back out of what is
      // stored. Only the environment's own values: the defaults (baseUrl) are configuration,
      // not secrets, and replacing them would only make entries harder to read.
      const environmentId = Number(req.body?.environmentId);
      const resolved =
        Number.isInteger(environmentId) && environmentId > 0
          ? await resolveVariables({
              userId: req.user!.id,
              organizationId: req.user!.organizationId,
              environmentId,
            })
          : {};
      const defaults = defaultVariables();
      const environmentValues = Object.fromEntries(
        Object.entries(resolved).filter(([name, value]) => defaults[name] !== value),
      );
      const entry = redactHistoryEntry(parseResult.data, environmentValues);
      const newHistoryEntry = await withTenantTransaction((tx) =>
        tx
          .insert(apiTestHistory)
          .values({ ...entry, userId: req.user!.id, organizationId: req.user!.organizationId })
          .returning(),
      );
      res.status(201).json(newHistoryEntry[0]);
    } catch (error: any) {
      resolvedLogger.error({
        message: 'Error creating API test history entry',
        error: error.message,
        stack: error.stack,
        userId: (req.user as any)?.id,
      });
      res.status(500).json({ error: 'Failed to save API test history' });
    }
  });

  app.get('/api/api-test-history', requireRole('viewer'), async (req, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    try {
      // Both inside one tenant transaction: RLS bounds them to the caller's organization, and
      // the count must be taken under the same binding as the page it describes.
      const { historyEntries, totalResult } = await withTenantTransaction(async (tx) => ({
        historyEntries: await tx
          .select()
          .from(apiTestHistory)
          .where(eq(apiTestHistory.userId, req.user!.id))
          .orderBy(desc(apiTestHistory.createdAt))
          .limit(limit)
          .offset(offset),
        totalResult: await tx
          .select({ count: sql`count(*)` })
          .from(apiTestHistory)
          .where(eq(apiTestHistory.userId, req.user!.id)),
      }));
      const total = totalResult[0]?.count || 0;
      res.json({
        items: historyEntries,
        page,
        limit,
        totalItems: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      });
    } catch (error: any) {
      resolvedLogger.error({
        message: 'Error fetching API test history',
        error: error.message,
        stack: error.stack,
        userId: (req.user as any)?.id,
        query: req.query,
      });
      res.status(500).json({ error: 'Failed to fetch API test history' });
    }
  });

  app.delete('/api/api-test-history/:id', requireRole('editor'), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid history ID' });
    }
    try {
      const result = await withTenantTransaction((tx) =>
        tx
          .delete(apiTestHistory)
          .where(and(eq(apiTestHistory.id, id), eq(apiTestHistory.userId, req.user!.id)))
          .returning(),
      );
      if (result.length === 0) {
        return res.status(404).json({ error: 'History entry not found or not owned by user' });
      }
      res.status(204).send();
    } catch (error: any) {
      resolvedLogger.error({
        message: `Error deleting API test history entry ${id}`,
        error: error.message,
        stack: error.stack,
        userId: (req.user as any)?.id,
      });
      res.status(500).json({ error: 'Failed to delete history entry' });
    }
  });

  // --- Test Plan Schedules API Endpoints (formerly /api/schedules) ---

  // GET /api/test-plan-schedules/plan/:planId - List schedules for a specific test plan
  app.get('/api/test-plan-schedules/plan/:planId', requireRole('viewer'), async (req, res) => {
    const { planId } = req.params;
    if (!planId) {
      return res.status(400).json({ error: 'Test Plan ID is required.' });
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
        browsers:
          typeof schedule.browsers === 'string' ? JSON.parse(schedule.browsers) : schedule.browsers,
        notificationConfigOverride:
          typeof schedule.notificationConfigOverride === 'string'
            ? JSON.parse(schedule.notificationConfigOverride)
            : schedule.notificationConfigOverride,
        executionParameters:
          typeof schedule.executionParameters === 'string'
            ? JSON.parse(schedule.executionParameters)
            : schedule.executionParameters,
      }));
      res.json(parsedResults);
    } catch (error: any) {
      resolvedLogger.error({
        message: `Error fetching schedules for plan ${planId}`,
        error: error.message,
        stack: error.stack,
        userId: (req.user as any)?.id,
      });
      res.status(500).json({ error: 'Failed to fetch schedules for the specified plan' });
    }
  });

  app.get('/api/selectable-tests', requireRole('viewer'), async (req, res) => {
    const userId = req.user!.id;

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
      // Every test of the organization the requester can see, not only their own: a plan is the
      // organization's, and one built by a colleague has to be able to include anybody's tests.
      const uiConditions: SQL[] = [];
      const apiConditions: SQL[] = [];
      const mobileConditions: SQL[] = [];

      if (searchTerm) {
        const searchPattern = `%${searchTerm}%`;
        uiConditions.push(ilike(tests.name, searchPattern));
        apiConditions.push(ilike(apiTests.name, searchPattern));
        mobileConditions.push(ilike(mobileTests.name, searchPattern));
      }

      // Execute queries
      // One tenant transaction for both: RLS bounds them to the caller's organization and hides
      // the restricted projects they are not on.
      const { uiTestResults, apiTestResults, mobileTestResults, tagsByTest } =
        await withTenantTransaction(async (tx) => {
          if (tagIds.length > 0) {
            // A tag filter that matches nothing must offer nothing. inArray on an empty list is
            // not a predicate, so the empty case is answered here rather than by a query that
            // would quietly return everything.
            const [uiIds, apiIds, mobileIds] = await Promise.all([
              testIdsWithTags(tx, { tagIds, testType: 'ui' }),
              testIdsWithTags(tx, { tagIds, testType: 'api' }),
              testIdsWithTags(tx, { tagIds, testType: 'mobile' }),
            ]);
            if (mobileIds.length === 0) mobileConditions.push(sql`false`);
            else mobileConditions.push(inArray(mobileTests.id, mobileIds));
            if (uiIds.length === 0) uiConditions.push(sql`false`);
            else uiConditions.push(inArray(tests.id, uiIds));
            if (apiIds.length === 0) apiConditions.push(sql`false`);
            else apiConditions.push(inArray(apiTests.id, apiIds));
          }

          const uiTestResults = await tx
            .select({
              id: tests.id,
              name: tests.name,
              description: sql<string>`null`.as('description'),
              type: sql<string>`'ui'`.as('type'),
              updatedAt: tests.updatedAt,
            })
            .from(tests)
            .where(and(...uiConditions));
          const apiTestResults = await tx
            .select({
              id: apiTests.id,
              name: apiTests.name,
              description: sql<string>`null`.as('description'),
              type: sql<string>`'api'`.as('type'),
              updatedAt: apiTests.updatedAt,
            })
            .from(apiTests)
            .where(and(...apiConditions));
          // Mobile app tests (migrations 0053, 0056), narrowed by name and tags like the others.
          const mobileTestResults = await tx
            .select({
              id: mobileTests.id,
              name: mobileTests.name,
              description: sql<string>`null`.as('description'),
              type: sql<string>`'mobile'`.as('type'),
              updatedAt: mobileTests.updatedAt,
            })
            .from(mobileTests)
            .where(and(...mobileConditions));

          return {
            uiTestResults,
            apiTestResults,
            mobileTestResults,
            // Shown beside each name, so somebody picking tests can see what they are picking
            // rather than recognising it from the name alone.
            tagsByTest: await tagsOfTests(tx, {
              testIds: uiTestResults.map((row) => row.id),
              apiTestIds: apiTestResults.map((row) => row.id),
              mobileTestIds: mobileTestResults.map((row) => row.id),
            }),
          };
        });

      // Combine results
      const combinedResults = [
        ...uiTestResults.map((row) => ({ ...row, tags: tagsByTest.ui.get(row.id) ?? [] })),
        ...apiTestResults.map((row) => ({ ...row, tags: tagsByTest.api.get(row.id) ?? [] })),
        ...mobileTestResults.map((row) => ({ ...row, tags: tagsByTest.mobile.get(row.id) ?? [] })),
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
      resolvedLogger.error({
        message: 'Error fetching selectable tests',
        error: error.message,
        stack: error.stack,
        userId,
        query: req.query,
      });
      res.status(500).json({ error: 'Failed to fetch selectable tests' });
    }
  });

  // --- System Settings API Endpoints ---

  // GET /api/system-settings - List all system settings. Owners only, like changing them:
  // nothing in the client lists them, and the keys everyone needs (workspaceName,
  // clientLogLevel) are read one at a time below.
  app.get('/api/system-settings', requireRole('owner'), async (req, res) => {
    try {
      const settings = await privilegedDb.select().from(systemSettings);
      res.json(settings);
    } catch (error: any) {
      resolvedLogger.error({
        message: 'Error fetching system settings',
        error: error.message,
        stack: error.stack,
        userId: (req.user as any)?.id,
      });
      res.status(500).json({ error: 'Failed to fetch system settings' });
    }
  });

  // GET /api/system-settings/:key - Get a single system setting by key
  app.get('/api/system-settings/:key', requireRole('viewer'), async (req, res) => {
    const { key } = req.params;
    try {
      const result = await privilegedDb
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, key))
        .limit(1);
      if (result.length === 0) {
        return res.status(404).json({ error: 'Setting not found' });
      }
      res.json(result[0]);
    } catch (error: any) {
      resolvedLogger.error({
        message: `Error fetching system setting ${key}`,
        error: error.message,
        stack: error.stack,
        userId: (req.user as any)?.id,
      });
      res.status(500).json({ error: 'Failed to fetch system setting' });
    }
  });

  // POST /api/system-settings - Create or update a system setting (upsert)
  // system_settings is deliberately global (logRetentionDays, logLevel, clientLogLevel), so
  // this is gated to owners rather than any authenticated user of any organization: a
  // viewer or editor should not be able to reconfigure logging for every tenant.
  app.post(
    '/api/system-settings',
    requireRole('owner'),
    requireInstallationAdmin,
    async (req, res) => {
      const parseResult = insertSystemSettingSchema.safeParse(req.body);
      if (!parseResult.success) {
        resolvedLogger.warn({
          message: 'POST /api/system-settings - Invalid payload',
          errors: parseResult.error.flatten(),
          userId: (req.user as any)?.id,
        });
        return res
          .status(400)
          .json({ error: 'Invalid request payload', details: parseResult.error.flatten() });
      }
      try {
        const { key, value } = parseResult.data;

        // For SQLite, Drizzle's .onConflictDoUpdate().returning() might not return the inserted/updated row directly in all cases.
        // It's safer to perform the upsert and then select the row.
        await privilegedDb
          .insert(systemSettings)
          .values({ key, value })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value: value }, // For SQLite, directly set the value. `sql`excluded.value` is more for PostgreSQL.
          });

        // Fetch the (potentially) updated or newly inserted row
        const finalResult = await privilegedDb
          .select()
          .from(systemSettings)
          .where(eq(systemSettings.key, key))
          .limit(1);

        if (finalResult.length === 0) {
          // This case should ideally not be reached if upsert is successful
          resolvedLogger.error({
            message: 'System setting upsert failed, no record found post-operation',
            key,
            value,
            userId: (req.user as any)?.id,
          });
          return res.status(500).json({
            error: 'Failed to create or update system setting, and could not retrieve it.',
          });
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
            resolvedLogger.info({
              message: `Log level dynamically updated to: ${savedSetting.value} via API`,
              key: savedSetting.key,
              value: savedSetting.value,
              userId: (req.user as any)?.id,
            });
          } catch (updateError: any) {
            resolvedLogger.error({
              message: `Failed to dynamically update log level to ${savedSetting.value} after saving setting`,
              error: updateError.message,
              stack: updateError.stack,
              key: savedSetting.key,
              value: savedSetting.value,
              userId: (req.user as any)?.id,
            });
            // Do not fail the entire request, as the setting was saved to DB.
            // The logger will pick up the new level on next restart if dynamic update fails.
          }
        }
      } catch (error: any) {
        resolvedLogger.error({
          message: 'Error creating/updating system setting',
          error: error.message,
          stack: error.stack,
          requestBody: req.body,
          userId: (req.user as any)?.id,
        });
        res.status(500).json({ error: 'Failed to create or update system setting' });
      }
    },
  );

  const httpServer = createServer(app);
  return httpServer;
}
