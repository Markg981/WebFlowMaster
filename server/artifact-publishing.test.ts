import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { PNG } from 'pngjs';
import { privilegedDb } from './db';
import {
  reportTestCaseResults,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  tests as testsTable,
  users,
} from '@shared/schema';
import { createTestOrganization } from './tests/factories';
import { createS3ArtifactStore, setArtifactStoreForTest } from './artifact-store';
import { fakeS3 } from './tests/fake-s3';

/**
 * A run's evidence, and the visual baselines, in a bucket every worker shares.
 *
 * The browser is not launched: the stand-in for a test's run writes a screenshot where the real
 * one would, which is the part that has to end up in the bucket.
 */

const executeTestSequence = vi.fn();
vi.mock('./playwright-service', () => ({
  playwrightService: { executeTestSequence: (...args: any[]) => executeTestSequence(...args) },
}));

const { processTestPlanJob } = await import('./test-execution-service');
const { compareStepScreenshot } = await import('./visual-testing');

let organizationId: number;
let userId: number;
let planId: string;
let client: ReturnType<typeof fakeS3>;

beforeEach(async () => {
  await privilegedDb.delete(reportTestCaseResults);
  await privilegedDb.delete(testPlanSelectedTests);
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(testsTable);
  await privilegedDb.delete(users);

  organizationId = await createTestOrganization('Bucket Org');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `bucket-${uuidv4().slice(0, 8)}`, password: 'x', organizationId })
    .returning();
  userId = user.id;

  client = fakeS3();
  setArtifactStoreForTest(createS3ArtifactStore({ client, bucket: 'evidence' }));

  executeTestSequence.mockReset();
  executeTestSequence.mockImplementation(async (_test: unknown, _user: number, screenshotDir: string) => {
    await fs.ensureDir(screenshotDir);
    const shot = path.join(screenshotDir, 'step_Click_1.png');
    await fs.writeFile(shot, 'png-bytes');
    return { success: true, steps: [{ name: 'Click', type: 'click', status: 'passed', screenshot: shot }], duration: 5 };
  });
});

afterEach(async () => {
  setArtifactStoreForTest(undefined);
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('a run with a bucket for its evidence', () => {
  it('uploads each test\'s screenshots under the key the report asks for, and leaves nothing on the worker', async () => {
    planId = uuidv4();
    await privilegedDb.insert(testPlans).values({ id: planId, name: 'Bucket plan', userId, organizationId } as any);
    const [test] = await privilegedDb
      .insert(testsTable)
      .values({ userId, organizationId, name: 'Login', url: 'https://example.test', sequence: [], elements: [] })
      .returning();
    await privilegedDb.insert(testPlanSelectedTests).values({ testPlanId: planId, testType: 'ui', testId: test.id, organizationId } as any);
    const executionId = uuidv4();
    await privilegedDb.insert(testPlanExecutions).values({ id: executionId, organizationId, testPlanId: planId, status: 'queued', triggeredBy: 'manual' } as any);

    await processTestPlanJob(planId, executionId, userId);

    const key = `results/${planId}/${executionId}/ui_${test.id}/step_Click_1.png`;
    expect(client.objects.get(key)?.body.toString()).toBe('png-bytes');
    expect(await fs.pathExists(path.resolve(process.cwd(), 'results', planId, executionId))).toBe(false);

    // What the report links to is the key that was uploaded.
    const [row] = await privilegedDb
      .select()
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
    const { stepsWithArtifactUrls } = await import('./routes/artifacts.routes');
    expect(stepsWithArtifactUrls(executionId, row.detailedLog)[0].screenshot).toBe(
      `/api/test-plan-executions/${executionId}/artifacts/ui_${test.id}/step_Click_1.png`,
    );
  });
});

describe('visual baselines in a bucket', () => {
  const png = (shade: number) => {
    const image = new PNG({ width: 4, height: 4 });
    image.data.fill(shade);
    return PNG.sync.write(image);
  };
  const ctx = () => ({ organizationId: 7, testId: 3, browser: 'chromium' });

  it('are recorded once and compared against by every worker', async () => {
    const first = await compareStepScreenshot(ctx(), 0, png(200));
    // Another worker, with nothing on its disk, compares against the same baseline.
    const second = await compareStepScreenshot(ctx(), 0, png(200));
    const changed = await compareStepScreenshot(ctx(), 0, png(20));

    expect(first.kind).toBe('baseline-created');
    expect(client.objects.has('visual-baselines/org_7/test_3/chromium/step_000.png')).toBe(true);
    expect(second.kind).toBe('match');
    expect(changed.kind).toBe('diff');
  });
});
