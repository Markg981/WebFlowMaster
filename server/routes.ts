import { createServer, type Server } from 'http';
import { Express } from 'express';
import { setupAuth } from './identity/auth';

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
import testVersionsRoutes from './routes/test-versions.routes';
import issueTrackersRoutes from './routes/issue-trackers.routes';
import issuesRoutes from './routes/issues.routes';
import authRoutes from './routes/auth.routes';
import observabilityRoutes from './routes/observability.routes';
import environmentRoutes from './routes/environments.routes';
import analyticsRoutes from './routes/analytics.routes';
import organizationRoutes from './routes/organization.routes';
import organizationMembershipsRoutes from './routes/organization-memberships.routes';
import tenantQuotaAdminRoutes from './routes/tenant-quota-admin.routes';
import billingRoutes from './routes/billing.routes';
import billingAdminRoutes from './routes/billing-admin.routes';
import { billingWebhookRouter } from './routes/billing-webhooks.routes';
import apiTesterRoutes from './routes/api-tester.routes';
import browserTasksRoutes from './routes/browser-tasks.routes';
import recordingRoutes from './routes/recording.routes';
import selectableTestsRoutes from './routes/selectable-tests.routes';
import settingsRoutes from './routes/settings.routes';
import { tenancyMiddleware } from './middleware/tenancy';
import { apiKeyAuth } from './middleware/api-key-auth';
import { apiRateLimit, sessionRateLimit } from './middleware/rate-limits';

/**
 * Mounts the request pipeline: authentication, tenancy, then every router. No handler is
 * defined here; each lives in the server/routes/ module of its domain, where
 * server/tests/architecture.test.ts can see it.
 */
export async function registerRoutes(app: Express): Promise<Server> {
  // Auth First
  setupAuth(app); // Attaches passport strategies
  app.use(mailDeliveryWebhookRouter);
  app.use(mailProviderWebhookRouter);
  // The billing provider's messages, authenticated by their signature, not by a session.
  app.use(billingWebhookRouter);

  // A request may authenticate as a person (the session passport just attached) or as a
  // pipeline (an API key). This turns the second into the first, so everything after it —
  // the tenancy binding, requireRole, every handler — has exactly one notion of who is
  // calling, and no route has to be audited twice.
  app.use(apiKeyAuth);

  // Machines are limited per minute: each API key, and anonymous calls to /api/v1
  // (server/middleware/rate-limits.ts).
  app.use(apiRateLimit());
  // And people: each signed-in user, on /api only, so the client's own assets are not counted.
  app.use('/api', sessionRateLimit());

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
  app.use(organizationMembershipsRoutes);
  app.use(tenantQuotaAdminRoutes);
  app.use(billingRoutes);
  app.use(billingAdminRoutes);
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
  app.use(browserTasksRoutes);
  app.use(apiTesterRoutes);
  app.use(settingsRoutes);
  app.use(recordingRoutes);
  app.use(selectableTestsRoutes);

  const httpServer = createServer(app);
  return httpServer;
}
