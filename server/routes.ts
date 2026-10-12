import { createServer, type Server } from 'http';
import { Express } from 'express';
import { setupAuth } from './identity/auth';

import projectsRoutes from './http/routes/projects.routes';
import testsRoutes from './http/routes/tests.routes';
import catalogRoutes from './http/routes/catalog.routes';
import testPlansRoutes from './http/routes/test-plans.routes';
import uploadsRoutes from './http/routes/uploads.routes';
import reportsRoutes from './http/routes/reports.routes';
import artifactsRoutes from './http/routes/artifacts.routes';
import apiKeysRoutes from './http/routes/api-keys.routes';
import serviceAccountsRoutes from './http/routes/service-accounts.routes';
import mfaRoutes from './http/routes/mfa.routes';
import ssoRoutes from './http/routes/sso.routes';
import testPublishingRoutes from './http/routes/test-publishing.routes';
import runnersRoutes from './http/routes/runners.routes';
import suitesRoutes from './http/routes/suites.routes';
import requirementsRoutes from './http/routes/requirements.routes';
import testDataRoutes from './http/routes/test-data.routes';
import impactRulesRoutes from './http/routes/impact-rules.routes';
import smsInboxRoutes from './http/routes/sms-inbox.routes';
import commentsRoutes from './http/routes/comments.routes';
import dashboardLayoutRoutes from './http/routes/dashboard-layout.routes';
import dashboardsRoutes from './http/routes/dashboards.routes';
import mailDeliveryRoutes, { mailDeliveryWebhookRouter } from './http/routes/mail-delivery.routes';
import mailSettingsRoutes from './http/routes/mail-settings.routes';
import mailTemplateRoutes from './http/routes/mail-templates.routes';
import { mailProviderWebhookRouter } from './http/routes/mail-provider.routes';
import testManagementRoutes from './http/routes/test-management.routes';
import mobileTestsRoutes from './http/routes/mobile-tests.routes';
import quarantineRoutes from './http/routes/quarantine.routes';
import { requireMfaEnrollment } from './http/middleware/require-mfa-enrollment';
import { requireSso } from './http/middleware/require-sso';
import apiV1Routes from './http/routes/api-v1.routes';
import cliRoutes from './http/routes/cli.routes';
import agentsRoutes from './http/routes/agents.routes';
import bddRoutes from './http/routes/bdd.routes';
import sourceHostsRoutes from './http/routes/source-hosts.routes';
import webhookManagementRoutes from './http/routes/webhooks.routes';
import stepGroupsRoutes from './http/routes/step-groups.routes';
import mobileStepGroupsRoutes from './http/routes/mobile-step-groups.routes';
import loadTestsRoutes from './http/routes/load-tests.routes';
import customActionsRoutes from './http/routes/custom-actions.routes';
import manualResultsRoutes from './http/routes/manual-results.routes';
import failureAnalysisRoutes from './http/routes/failure-analysis.routes';
import debugSessionsRoutes from './http/routes/debug-sessions.routes';
import browserGridsRoutes from './http/routes/browser-grids.routes';
import projectElementsRoutes from './http/routes/project-elements.routes';
import nlAuthoringRoutes from './http/routes/nl-authoring.routes';
import tagsRoutes from './http/routes/tags.routes';
import testVersionsRoutes from './http/routes/test-versions.routes';
import issueTrackersRoutes from './http/routes/issue-trackers.routes';
import issuesRoutes from './http/routes/issues.routes';
import authRoutes from './http/routes/auth.routes';
import observabilityRoutes from './http/routes/observability.routes';
import environmentRoutes from './http/routes/environments.routes';
import analyticsRoutes from './http/routes/analytics.routes';
import organizationRoutes from './http/routes/organization.routes';
import organizationMembershipsRoutes from './http/routes/organization-memberships.routes';
import tenantQuotaAdminRoutes from './http/routes/tenant-quota-admin.routes';
import billingRoutes from './http/routes/billing.routes';
import billingAdminRoutes from './http/routes/billing-admin.routes';
import { billingWebhookRouter } from './http/routes/billing-webhooks.routes';
import apiTesterRoutes from './http/routes/api-tester.routes';
import browserTasksRoutes from './http/routes/browser-tasks.routes';
import recordingRoutes from './http/routes/recording.routes';
import selectableTestsRoutes from './http/routes/selectable-tests.routes';
import settingsRoutes from './http/routes/settings.routes';
import { tenancyMiddleware } from './platform/middleware/tenancy';
import { apiKeyAuth } from './http/middleware/api-key-auth';
import { apiRateLimit, sessionRateLimit } from './http/middleware/rate-limits';

/**
 * Mounts the request pipeline: authentication, tenancy, then every router. No handler is
 * defined here; each lives in the server/http/routes/ module of its domain, where
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
  // (server/http/middleware/rate-limits.ts).
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
