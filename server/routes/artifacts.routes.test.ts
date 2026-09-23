import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from '../db';
import { testPlans, testPlanExecutions } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * Serving a run's screenshots and visual diffs.
 *
 * Report rows have carried `/results/…` links since they existed, and nothing ever answered
 * on that path — so the report's "View Screenshot" button went nowhere, and a visual diff
 * would have been a verdict with its evidence unreachable. These are the rules of the route
 * that answers now: it belongs to an execution, and an execution belongs to an organization.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; organizationId: number; role: string };

let planId: string;
let executionId: string;
let runDir: string;

beforeAll(async () => {
  organizationId = await createTestOrganization('Artifacts Org');
  userId = await createTestUser(organizationId, 'artifacts-user');
  otherOrganizationId = await createTestOrganization('Other Artifacts Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-artifacts-user');

  const { default: artifactsRoutes } = await import('./artifacts.routes');
  const { runWithTenant } = await import('../middleware/tenancy');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(artifactsRoutes);
});

beforeEach(async () => {
  currentUser = { id: userId, organizationId, role: 'editor' };

  planId = uuidv4();
  executionId = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Artifacts Plan', userId, organizationId });
  await privilegedDb.insert(testPlanExecutions).values({
    id: executionId,
    organizationId,
    testPlanId: planId,
    status: 'completed',
    startedAt: new Date(),
    triggeredBy: 'manual',
  });

  runDir = path.resolve(process.cwd(), 'results', planId, executionId, 'ui_1_chromium');
  await fs.ensureDir(runDir);
  await fs.writeFile(path.join(runDir, 'visual_chromium_step_000_diff.png'), Buffer.from('diff-image-bytes'));
});

afterEach(async () => {
  // These are real files under the real results directory; a test suite that leaves them
  // behind grows one run's worth of images every time it is run.
  await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('GET /api/test-plan-executions/:executionId/artifacts/*', () => {
  it("serves a file the run wrote", async () => {
    const response = await request(app)
      .get(`/api/test-plan-executions/${executionId}/artifacts/ui_1_chromium/visual_chromium_step_000_diff.png`)
      .expect(200);

    expect(response.body.toString()).toBe('diff-image-bytes');
  });

  it("does not serve another organization's run, and does not say it exists", async () => {
    currentUser = { id: otherUserId, organizationId: otherOrganizationId, role: 'editor' };

    await request(app)
      .get(`/api/test-plan-executions/${executionId}/artifacts/ui_1_chromium/visual_chromium_step_000_diff.png`)
      .expect(404);
  });

  it('refuses a path that climbs out of the run directory', async () => {
    await request(app)
      .get(`/api/test-plan-executions/${executionId}/artifacts/${encodeURIComponent('../../../package.json')}`)
      .expect(400);
  });

  it('404s on a file the run never wrote', async () => {
    await request(app)
      .get(`/api/test-plan-executions/${executionId}/artifacts/ui_1_chromium/nothing-here.png`)
      .expect(404);
  });
});

describe('serving from a bucket', () => {
  afterEach(async () => {
    const { setArtifactStoreForTest } = await import('../artifact-store');
    setArtifactStoreForTest(undefined);
  });

  it('serves what a worker on another machine uploaded, with its type, under the same URL', async () => {
    const { createS3ArtifactStore, setArtifactStoreForTest } = await import('../artifact-store');
    const { fakeS3 } = await import('../tests/fake-s3');
    const client = fakeS3();
    const store = createS3ArtifactStore({ client, bucket: 'evidence' });
    setArtifactStoreForTest(store);
    await store.write(`results/${planId}/${executionId}/ui_1_chromium/row_1/video.webm`, Buffer.from('webm-bytes'));

    const response = await request(app)
      .get(`/api/test-plan-executions/${executionId}/artifacts/ui_1_chromium/row_1/video.webm`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(response.headers['content-type']).toBe('video/webm');
    expect((response.body as Buffer).toString()).toBe('webm-bytes');
    // The file on this machine's disk is not what answered.
    expect(client.commands).toContain(`get evidence/results/${planId}/${executionId}/ui_1_chromium/row_1/video.webm`);
  });

  it('404s on an object the bucket does not have, and still refuses a climbing path', async () => {
    const { createS3ArtifactStore, setArtifactStoreForTest } = await import('../artifact-store');
    const { fakeS3 } = await import('../tests/fake-s3');
    const client = fakeS3();
    setArtifactStoreForTest(createS3ArtifactStore({ client, bucket: 'evidence' }));

    await request(app).get(`/api/test-plan-executions/${executionId}/artifacts/ui_1_chromium/nothing.png`).expect(404);
    await request(app)
      .get(`/api/test-plan-executions/${executionId}/artifacts/${encodeURIComponent('../other-exec/secret.png')}`)
      .expect(400);
    expect(client.commands.filter((c) => c.includes('other-exec'))).toEqual([]);
  });

  it('says the store could not be reached rather than that the file does not exist', async () => {
    const { createS3ArtifactStore, setArtifactStoreForTest } = await import('../artifact-store');
    setArtifactStoreForTest(
      createS3ArtifactStore({
        client: { send: async () => { throw Object.assign(new Error('connect ETIMEDOUT'), { name: 'TimeoutError' }); } },
        bucket: 'evidence',
      }),
    );

    await request(app).get(`/api/test-plan-executions/${executionId}/artifacts/ui_1_chromium/a.png`).expect(502);
  });
});

describe('artifactUrl', () => {
  it('turns a stored path into something the report can open, whichever separator wrote it', async () => {
    const { artifactUrl } = await import('./artifacts.routes');

    expect(artifactUrl('exec-1', `results\\plan-1\\exec-1\\ui_5_firefox\\step_click.png`)).toBe(
      '/api/test-plan-executions/exec-1/artifacts/ui_5_firefox/step_click.png',
    );
    expect(artifactUrl('exec-1', '/results/plan-1/exec-1/ui_5/step.png')).toBe(
      '/api/test-plan-executions/exec-1/artifacts/ui_5/step.png',
    );
  });

  it('leaves an inline screenshot alone and refuses anything outside the run', async () => {
    const { artifactUrl } = await import('./artifacts.routes');

    expect(artifactUrl('exec-1', 'data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(artifactUrl('exec-1', '/results/plan-1/other-exec/step.png')).toBeNull();
    expect(artifactUrl('exec-1', null)).toBeNull();
  });
});

describe('stepsWithArtifactUrls', () => {
  it('hands the report the step list it already recorded, with openable images', async () => {
    const { stepsWithArtifactUrls } = await import('./artifacts.routes');

    const steps = stepsWithArtifactUrls(
      'exec-1',
      JSON.stringify([
        {
          name: 'Click Save',
          type: 'click',
          status: 'failed',
          details: 'Visual difference: 4.20% of pixels changed',
          error: 'Visual difference: 4.20% of pixels changed',
          screenshot: 'results/plan-1/exec-1/ui_5/step_click.png',
          visual: {
            outcome: 'diff',
            detail: 'Visual difference: 4.20% of pixels changed',
            diffRatio: 0.042,
            baselineImage: 'results/plan-1/exec-1/ui_5/visual_step_000_baseline.png',
            actualImage: 'results/plan-1/exec-1/ui_5/visual_step_000_actual.png',
            diffImage: 'results/plan-1/exec-1/ui_5/visual_step_000_diff.png',
          },
        },
      ]),
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe('failed');
    expect(steps[0].screenshot).toBe('/api/test-plan-executions/exec-1/artifacts/ui_5/step_click.png');
    expect(steps[0].visual?.diffImage).toBe('/api/test-plan-executions/exec-1/artifacts/ui_5/visual_step_000_diff.png');
    expect(steps[0].visual?.diffRatio).toBeCloseTo(0.042);
  });

  it('survives a log that is empty, malformed or not a list', async () => {
    const { stepsWithArtifactUrls } = await import('./artifacts.routes');

    expect(stepsWithArtifactUrls('exec-1', null)).toEqual([]);
    expect(stepsWithArtifactUrls('exec-1', 'not json')).toEqual([]);
    expect(stepsWithArtifactUrls('exec-1', '{"not":"a list"}')).toEqual([]);
  });
});
