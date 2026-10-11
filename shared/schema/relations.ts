/** Drizzle relations between tables of different domains, kept apart so no domain file has to import every other. */
import { relations } from 'drizzle-orm';
import { apiTestHistory, apiTests } from './api-testing';
import { detectedElements, excelSequencesMap, testRuns, tests } from './authoring';
import { environments, secrets } from './environments';
import {
  reportTestCaseResults,
  testPlanExecutions,
  testPlanSchedules,
  testPlanSelectedTests,
  testPlans,
} from './execution';
import { projects, userSettings, users } from './identity';

// Relation Definitions
export const usersRelations = relations(users, ({ many, one }) => ({
  userSettings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
  projects: many(projects),
  tests: many(tests),
  apiTestHistory: many(apiTestHistory),
  apiTests: many(apiTests),
  environments: many(environments),
  secrets: many(secrets),
}));

export const environmentsRelations = relations(environments, ({ one, many }) => ({
  user: one(users, { fields: [environments.userId], references: [users.id] }),
  secrets: many(secrets),
}));

export const secretsRelations = relations(secrets, ({ one }) => ({
  environment: one(environments, {
    fields: [secrets.environmentId],
    references: [environments.id],
  }),
  user: one(users, { fields: [secrets.userId], references: [users.id] }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  tests: many(tests),
  apiTests: many(apiTests),
}));

export const testsRelations = relations(tests, ({ one, many }) => ({
  user: one(users, { fields: [tests.userId], references: [users.id] }),
  project: one(projects, {
    fields: [tests.projectId],
    references: [projects.id],
  }),
  runs: many(testRuns),
  detectedElements: many(detectedElements),
  // reportResults: many(reportTestCaseResults, { relationName: 'uiTestReportResults' }) // Optional: if direct link needed
}));

export const detectedElementsRelations = relations(detectedElements, ({ one }) => ({
  test: one(tests, { fields: [detectedElements.testId], references: [tests.id] }),
}));

export const testRunsRelations = relations(testRuns, ({ one }) => ({
  test: one(tests, { fields: [testRuns.testId], references: [tests.id] }),
}));

export const excelSequencesMapRelations = relations(excelSequencesMap, ({ one }) => ({
  test: one(tests, { fields: [excelSequencesMap.testId], references: [tests.id] }),
}));

export const apiTestHistoryRelations = relations(apiTestHistory, ({ one }) => ({
  user: one(users, { fields: [apiTestHistory.userId], references: [users.id] }),
}));

export const apiTestsRelations = relations(apiTests, ({ one }) => ({
  user: one(users, { fields: [apiTests.userId], references: [users.id] }),
  project: one(projects, {
    fields: [apiTests.projectId],
    references: [projects.id],
  }),
  // reportResults: many(reportTestCaseResults, { relationName: 'apiTestReportResults' }) // Optional: if direct link needed
}));

export const testPlansRelations = relations(testPlans, ({ many }) => ({
  selectedTests: many(testPlanSelectedTests, {
    relationName: 'selectedTestsForPlan',
  }),
  schedules: many(testPlanSchedules),
  executions: many(testPlanExecutions),
}));

export const testPlanSchedulesRelations = relations(testPlanSchedules, ({ one, many }) => ({
  testPlan: one(testPlans, {
    fields: [testPlanSchedules.testPlanId],
    references: [testPlans.id],
  }),
  executions: many(testPlanExecutions),
}));

export const testPlanExecutionsRelations = relations(testPlanExecutions, ({ one, many }) => ({
  testPlan: one(testPlans, {
    fields: [testPlanExecutions.testPlanId],
    references: [testPlans.id],
  }),
  schedule: one(testPlanSchedules, {
    fields: [testPlanExecutions.scheduleId],
    references: [testPlanSchedules.id],
  }),
  detailedResults: many(reportTestCaseResults),
}));

export const reportTestCaseResultsRelations = relations(reportTestCaseResults, ({ one }) => ({
  testPlanExecution: one(testPlanExecutions, {
    fields: [reportTestCaseResults.testPlanExecutionId],
    references: [testPlanExecutions.id],
  }),
  uiTest: one(tests, {
    fields: [reportTestCaseResults.uiTestId],
    references: [tests.id],
  }),
  apiTest: one(apiTests, {
    fields: [reportTestCaseResults.apiTestId],
    references: [apiTests.id],
  }),
}));

export const testPlanSelectedTestsRelations = relations(testPlanSelectedTests, ({ one }) => ({
  testPlan: one(testPlans, {
    fields: [testPlanSelectedTests.testPlanId],
    references: [testPlans.id],
    relationName: 'selectedTestsForPlan',
  }),
  uiTest: one(tests, {
    fields: [testPlanSelectedTests.testId],
    references: [tests.id],
  }),
  apiTest: one(apiTests, {
    fields: [testPlanSelectedTests.apiTestId],
    references: [apiTests.id],
  }),
}));
