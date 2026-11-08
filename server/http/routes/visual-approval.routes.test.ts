import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from '../../platform/db';
import {
  auditLog,
  projectMembers,
  projects,
  reportTestCaseResults,
  testPlanExecutions,
  testPlans,
  tests,
} from '@shared/schema';
import { createTestOrganization, createTestUser } from '../../tests/factories';

vi.mock('../../platform/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  },
  updateLogLevel: vi.fn(),
}));

/** Approving a failed visual comparison's image as the step's new baseline (R-1). */

let app: express.Express;
let organizationId: number;
let editorId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };
let planId: string;
let executionId: string;
let resultId: string;
let testId: number;
let baselineDir: string;
let baselineFile: string;

const ACTUAL = Buffer.from('actual-image-bytes');

async function seed(projectId?: number) {
  planId = uuidv4();
  executionId = uuidv4();
  resultId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'Visual Plan', userId: editorId, organizationId });
  await privilegedDb.insert(testPlanExecutions).values({
    id: executionId,
    organizationId,
    testPlanId: planId,
    status: 'completed',
    startedAt: new Date(),
    triggeredBy: 'manual',
  });
  const [test] = await privilegedDb
    .insert(tests)
    .values({
      userId: editorId,
      organizationId,
      projectId,
      name: `Visual ${uuidv4().slice(0, 4)}`,
      url: '',
      sequence: [],
      elements: [],
    } as never)
    .returning();
  testId = test.id;
  const key = `visual-baselines/org_${organizationId}/test_${testId}/chromium/step_000.png`;
  baselineFile = path.join(baselineDir, key.slice('visual-baselines/'.length));
  await fs.outputFile(baselineFile, 'old-baseline');
  const dir = path.resolve(process.cwd(), 'results', planId, executionId, `ui_${testId}_chromium`);
  await fs.outputFile(path.join(dir, 'visual_chromium_step_000_actual.png'), ACTUAL);
  const steps = [
    {
      name: 'Open',
      type: 'navigate',
      status: 'failed',
      details: '',
      visual: {
        outcome: 'diff',
        detail: 'Visual difference',
        diffRatio: 0.2,
        baselineKey: key,
        actualImage: path.join(dir, 'visual_chromium_step_000_actual.png'),
      },
    },
  ];
  await privilegedDb.insert(reportTestCaseResults).values({
    id: resultId,
    organizationId,
    testPlanExecutionId: executionId,
    uiTestId: testId,
    testName: 'Visual',
    testType: 'ui',
    status: 'Failed',
    startedAt: new Date(),
    detailedLog: JSON.stringify(steps),
  } as never);
}

const approve = (stepIndex = 0) =>
  request(app).post(
    `/api/test-plan-executions/${executionId}/results/${resultId}/steps/${stepIndex}/visual/approve`,
  );

beforeAll(async () => {
  organizationId = await createTestOrganization('Visual Approval Org');
  editorId = await createTestUser(organizationId, 'visual-editor');
  otherOrganizationId = await createTestOrganization('Visual Other Org');
  otherUserId = await createTestUser(otherOrganizationId, 'visual-other');
  const { default: routes } = await import('./artifacts.routes');
  const { runWithTenant } = await import('../../platform/middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), {
      userId: currentUser.id,
      role: currentUser.role,
    });
  });
  app.use(routes);
});

beforeEach(async () => {
  baselineDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-baselines-'));
  process.env.VISUAL_BASELINE_DIR = baselineDir;
  currentUser = { id: editorId, username: 'visual-editor', organizationId, role: 'editor' };
});

afterEach(async () => {
  delete process.env.VISUAL_BASELINE_DIR;
  await fs.remove(baselineDir);
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('POST .../visual/approve', () => {
  it('replaces the baseline with the run image and records who and when, with an audit row', async () => {
    await seed();
    const response = await approve().expect(200);
    expect(response.body.approval).toMatchObject({ userId: editorId, username: 'visual-editor' });
    expect(await fs.readFile(baselineFile)).toEqual(ACTUAL);

    const [row] = await privilegedDb
      .select()
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.id, resultId));
    expect(JSON.parse(row.detailedLog!)[0].visual.approval.userId).toBe(editorId);

    const entries = await privilegedDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, executionId));
    expect(entries.map((e) => e.action)).toContain('visual_baseline.approved');

    await approve().expect(409);
  });

  it('refuses a viewer and leaves the baseline alone', async () => {
    await seed();
    currentUser = { ...currentUser, role: 'viewer' };
    await approve().expect(403);
    expect(await fs.readFile(baselineFile, 'utf8')).toBe('old-baseline');
  });

  it("answers 404 for another organization's run", async () => {
    await seed();
    currentUser = {
      id: otherUserId,
      username: 'visual-other',
      organizationId: otherOrganizationId,
      role: 'owner',
    };
    await approve().expect(404);
    expect(await fs.readFile(baselineFile, 'utf8')).toBe('old-baseline');
  });

  it('answers 403 to an editor who only views the restricted project', async () => {
    const [restricted] = await privilegedDb
      .insert(projects)
      .values({ name: 'Locked visual', userId: editorId, organizationId, restricted: true })
      .returning();
    const viewerId = await createTestUser(organizationId, `visual-viewer-${uuidv4().slice(0, 4)}`);
    await privilegedDb
      .insert(projectMembers)
      .values({ projectId: restricted.id, userId: viewerId, organizationId, role: 'viewer' });
    await seed(restricted.id);
    currentUser = { id: viewerId, username: 'v', organizationId, role: 'editor' };
    const refused = await approve().expect(403);
    expect(refused.body.code).toBe('project_read_only');
    expect(await fs.readFile(baselineFile, 'utf8')).toBe('old-baseline');
  });

  it('answers 404 for a step that does not exist', async () => {
    await seed();
    await approve(5).expect(404);
  });
});
