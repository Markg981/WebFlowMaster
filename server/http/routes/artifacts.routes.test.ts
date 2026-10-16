import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from '../../platform/db';
import {
  projects,
  reportTestCaseResults,
  testPlans,
  testPlanExecutions,
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
  app.use(artifactsRoutes);
});

beforeEach(async () => {
  currentUser = { id: userId, organizationId, role: 'editor' };

  planId = uuidv4();
  executionId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'Artifacts Plan', userId, organizationId });
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
  await fs.writeFile(
    path.join(runDir, 'visual_chromium_step_000_diff.png'),
    Buffer.from('diff-image-bytes'),
  );
});

afterEach(async () => {
  // These are real files under the real results directory; a test suite that leaves them
  // behind grows one run's worth of images every time it is run.
  await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('GET /api/test-plan-executions/:executionId/artifacts/*', () => {
  it('serves a file the run wrote', async () => {
    const response = await request(app)
      .get(
        `/api/test-plan-executions/${executionId}/artifacts/ui_1_chromium/visual_chromium_step_000_diff.png`,
      )
      .expect(200);

    expect(response.body.toString()).toBe('diff-image-bytes');
  });

  it("does not serve another organization's run, and does not say it exists", async () => {
    currentUser = { id: otherUserId, organizationId: otherOrganizationId, role: 'editor' };

    await request(app)
      .get(
        `/api/test-plan-executions/${executionId}/artifacts/ui_1_chromium/visual_chromium_step_000_diff.png`,
      )
      .expect(404);
  });

  it('refuses a path that climbs out of the run directory', async () => {
    await request(app)
      .get(
        `/api/test-plan-executions/${executionId}/artifacts/${encodeURIComponent('../../../package.json')}`,
      )
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
    const { setArtifactStoreForTest } = await import('../../tenancy/artifact-store');
    setArtifactStoreForTest(undefined);
  });

  it('serves what a worker on another machine uploaded, with its type, under the same URL', async () => {
    const { createS3ArtifactStore, setArtifactStoreForTest } =
      await import('../../tenancy/artifact-store');
    const { fakeS3 } = await import('../../tests/fake-s3');
    const client = fakeS3();
    const store = createS3ArtifactStore({ client, bucket: 'evidence' });
    setArtifactStoreForTest(store);
    await store.write(
      `results/${planId}/${executionId}/ui_1_chromium/row_1/video.webm`,
      Buffer.from('webm-bytes'),
    );

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
    expect(client.commands).toContain(
      `get evidence/results/${planId}/${executionId}/ui_1_chromium/row_1/video.webm`,
    );
  });

  it('404s on an object the bucket does not have, and still refuses a climbing path', async () => {
    const { createS3ArtifactStore, setArtifactStoreForTest } =
      await import('../../tenancy/artifact-store');
    const { fakeS3 } = await import('../../tests/fake-s3');
    const client = fakeS3();
    setArtifactStoreForTest(createS3ArtifactStore({ client, bucket: 'evidence' }));

    await request(app)
      .get(`/api/test-plan-executions/${executionId}/artifacts/ui_1_chromium/nothing.png`)
      .expect(404);
    await request(app)
      .get(
        `/api/test-plan-executions/${executionId}/artifacts/${encodeURIComponent('../other-exec/secret.png')}`,
      )
      .expect(400);
    expect(client.commands.filter((c) => c.includes('other-exec'))).toEqual([]);
  });

  it('says the store could not be reached rather than that the file does not exist', async () => {
    const { createS3ArtifactStore, setArtifactStoreForTest } =
      await import('../../tenancy/artifact-store');
    setArtifactStoreForTest(
      createS3ArtifactStore({
        client: {
          send: async () => {
            throw Object.assign(new Error('connect ETIMEDOUT'), { name: 'TimeoutError' });
          },
        },
        bucket: 'evidence',
      }),
    );

    await request(app)
      .get(`/api/test-plan-executions/${executionId}/artifacts/ui_1_chromium/a.png`)
      .expect(502);
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
    expect(steps[0].screenshot).toBe(
      '/api/test-plan-executions/exec-1/artifacts/ui_5/step_click.png',
    );
    expect(steps[0].visual?.diffImage).toBe(
      '/api/test-plan-executions/exec-1/artifacts/ui_5/visual_step_000_diff.png',
    );
    expect(steps[0].visual?.diffRatio).toBeCloseTo(0.042);
  });

  it('survives a log that is empty, malformed or not a list', async () => {
    const { stepsWithArtifactUrls } = await import('./artifacts.routes');

    expect(stepsWithArtifactUrls('exec-1', null)).toEqual([]);
    expect(stepsWithArtifactUrls('exec-1', 'not json')).toEqual([]);
    expect(stepsWithArtifactUrls('exec-1', '{"not":"a list"}')).toEqual([]);
  });
});

describe('raw evidence: one decision on the server, whoever asks and however (P03)', () => {
  const SENTINEL = 'Sentinel-Trace-Pw-4d1e';
  const url = (relative: string) =>
    `/api/test-plan-executions/${executionId}/artifacts/${relative}`;

  beforeEach(async () => {
    // A trace of a login: the password typed into the form is in it, in clear.
    await fs.writeFile(path.join(runDir, 'login_trace.zip'), `password=${SENTINEL}`);
    await fs.writeFile(path.join(runDir, 'login_network.har'), `{"password":"${SENTINEL}"}`);
    await fs.writeFile(path.join(runDir, 'login_run.webm'), 'video-bytes');
    await fs.writeFile(path.join(runDir, 'legacy-dump.zip'), `password=${SENTINEL}`);
  });

  it('refuses a viewer the trace, the HAR and an unrecognised file, even with the URL in hand', async () => {
    currentUser = { id: userId, organizationId, role: 'viewer' };
    for (const file of ['login_trace.zip', 'login_network.har', 'legacy-dump.zip']) {
      const response = await request(app)
        .get(url(`ui_1_chromium/${file}`))
        .expect(403);
      expect(JSON.stringify(response.body)).not.toContain(SENTINEL);
      expect(JSON.stringify(response.body)).not.toContain(file);
      expect(response.body.code).toBe('insufficient_role');
    }
  });

  it('answers a viewer the same for a trace that does not exist: a refusal says nothing about the file', async () => {
    currentUser = { id: userId, organizationId, role: 'viewer' };
    await request(app).get(url('ui_1_chromium/never_trace.zip')).expect(403);
  });

  it('keeps the recognised, non-raw evidence open to a viewer', async () => {
    currentUser = { id: userId, organizationId, role: 'viewer' };
    await request(app).get(url('ui_1_chromium/visual_chromium_step_000_diff.png')).expect(200);
    await request(app).get(url('ui_1_chromium/login_run.webm')).expect(200);
  });

  it('serves the trace to an editor and an owner', async () => {
    for (const role of ['editor', 'owner']) {
      currentUser = { id: userId, organizationId, role };
      const response = await request(app)
        .get(url('ui_1_chromium/login_trace.zip'))
        .responseType('blob')
        .expect(200);
      expect(Buffer.from(response.body).toString()).toContain(SENTINEL);
    }
  });

  it("does not serve another organization's trace to its editor, and does not say it exists", async () => {
    currentUser = { id: otherUserId, organizationId: otherOrganizationId, role: 'editor' };
    const response = await request(app).get(url('ui_1_chromium/login_trace.zip')).expect(404);
    expect(JSON.stringify(response.body)).not.toContain(SENTINEL);
  });

  it('treats the files of a test in a restricted project the caller is not on as absent', async () => {
    const [secret] = await privilegedDb
      .insert(projects)
      .values({ name: 'Secret', userId, organizationId, restricted: true })
      .returning();
    const [hidden] = await privilegedDb
      .insert(tests)
      .values({
        name: 'Payroll login',
        url: 'https://x.test',
        sequence: [],
        elements: [],
        userId,
        organizationId,
        projectId: secret.id,
      } as any)
      .returning();
    await privilegedDb.insert(reportTestCaseResults).values({
      id: uuidv4(),
      organizationId,
      testPlanExecutionId: executionId,
      uiTestId: hidden.id,
      testName: 'Payroll login',
      testType: 'ui',
      status: 'Failed',
      startedAt: new Date(),
    } as any);
    const unit = `ui_${hidden.id}_chromium`;
    const dir = path.resolve(process.cwd(), 'results', planId, executionId, unit);
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'step_1.png'), 'payroll-screen');
    await fs.writeFile(path.join(dir, 'payroll_trace.zip'), `password=${SENTINEL}`);

    // An editor of the organization who is not on the project: a 404, like a file never written.
    const outsider = await createTestUser(organizationId, `not-on-project-${uuidv4().slice(0, 6)}`);
    currentUser = { id: outsider, organizationId, role: 'editor' };
    await request(app)
      .get(url(`${unit}/step_1.png`))
      .expect(404);
    const trace = await request(app)
      .get(url(`${unit}/payroll_trace.zip`))
      .expect(404);
    expect(trace.body).toEqual({ error: 'Artifact not found.' });
    // A viewer not on it gets the same 404, not a 403 that would confirm the file is there.
    currentUser = { id: outsider, organizationId, role: 'viewer' };
    await request(app)
      .get(url(`${unit}/payroll_trace.zip`))
      .expect(404);
    // The organization's owner sees every project.
    currentUser = { id: userId, organizationId, role: 'owner' };
    await request(app)
      .get(url(`${unit}/payroll_trace.zip`))
      .expect(200);
    // The rest of the run is unaffected: a unit no hidden test owns stays open.
    const open = path.resolve(process.cwd(), 'results', planId, executionId, 'ui_999999_chromium');
    await fs.ensureDir(open);
    await fs.writeFile(path.join(open, 'step_1.png'), 'public-screen');
    currentUser = { id: outsider, organizationId, role: 'viewer' };
    await request(app).get(url('ui_999999_chromium/step_1.png')).expect(200);
  });
});

describe('classifyArtifact', () => {
  it('recognises what the runner writes, and calls everything else raw', async () => {
    const { classifyArtifact } = await import('../../tenancy/artifact-access');
    expect(classifyArtifact('ui_1/login_trace.zip')).toEqual({ kind: 'trace', sensitive: true });
    expect(classifyArtifact('ui_1/login_network.har')).toEqual({
      kind: 'network',
      sensitive: true,
    });
    expect(classifyArtifact('ui_1/step_1.png')).toEqual({ kind: 'screenshot', sensitive: false });
    expect(classifyArtifact('ui_1/login_run.webm')).toEqual({ kind: 'video', sensitive: false });
    expect(classifyArtifact('ui_1/home.report.html').sensitive).toBe(false);
    expect(classifyArtifact('ui_1/download_1_invoice.pdf').sensitive).toBe(false);
    // A download named like a trace is refused like one; anything unknown is raw.
    expect(classifyArtifact('ui_1/download_1_x_trace.zip').sensitive).toBe(true);
    expect(classifyArtifact('ui_1/old.zip').sensitive).toBe(true);
    expect(classifyArtifact('ui_1/console.log').sensitive).toBe(true);
    expect(classifyArtifact('ui_1/page.html').sensitive).toBe(true);
  });

  it('asks a scoped key for runs:evidence on top of the editor role', async () => {
    const { sensitiveEvidenceRefusal } = await import('../../tenancy/artifact-access');
    expect(sensitiveEvidenceRefusal({ role: 'viewer' })).toBe('insufficient_role');
    expect(sensitiveEvidenceRefusal({ role: 'viewer', scopes: ['runs:evidence'] })).toBe(
      'insufficient_role',
    );
    expect(sensitiveEvidenceRefusal({ role: 'editor', scopes: ['runs:read'] })).toBe(
      'insufficient_scope',
    );
    expect(
      sensitiveEvidenceRefusal({ role: 'editor', scopes: ['runs:read', 'runs:evidence'] }),
    ).toBeNull();
    expect(sensitiveEvidenceRefusal({ role: 'editor', scopes: null })).toBeNull();
    expect(sensitiveEvidenceRefusal({ role: 'auditor' })).toBe('insufficient_role');
    expect(sensitiveEvidenceRefusal(null)).toBe('insufficient_role');
  });
});
