import { and, desc, eq, inArray, isNotNull, max } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  auditLog,
  organizations,
  testPublications,
  testReviews,
  testVersions,
  tests,
  type TestPublicationKind,
  type TestVersion,
} from '@shared/schema';
import { privilegedDb } from './db';
import type { TenantTx } from './middleware/tenancy';
import { recordAudit, type AuditActor } from './audit';

/**
 * Which version of a test plans run, and how a version gets there.
 *
 * A saved test is a working copy. Publishing points tests.published_version at a version in its
 * history; plans run that version. A test never published runs its working copy, as every test
 * did before — unless the organization requires review, in which case a plan skips it rather
 * than run something nobody approved.
 *
 * Every change goes through here, inside the caller's tenant transaction, with its line in the
 * publication history and in the audit trail. Row-level security still decides who may change a
 * test at all (restricted projects, migration 0031): publishing is an update of the test row.
 */

export class PublishingError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = 'PublishingError';
  }
}

/** Whether this organization requires an approved review to publish. */
export async function reviewRequired(tx: TenantTx, organizationId: number): Promise<boolean> {
  const [row] = await tx
    .select({ required: organizations.testReviewRequired })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.required ?? false;
}

export async function latestVersionOf(tx: TenantTx, testId: number): Promise<number | null> {
  const [row] = await tx.select({ version: max(testVersions.version) }).from(testVersions).where(eq(testVersions.testId, testId));
  const version = Number(row?.version);
  return Number.isFinite(version) && version > 0 ? version : null;
}

async function versionRow(tx: TenantTx, testId: number, version: number): Promise<TestVersion | null> {
  const [row] = await tx
    .select()
    .from(testVersions)
    .where(and(eq(testVersions.testId, testId), eq(testVersions.version, version)))
    .limit(1);
  return row ?? null;
}

/**
 * Points a test at a version (or at none), and writes it down. The one place
 * tests.published_version changes.
 */
async function setPublished(
  tx: TenantTx,
  input: { testId: number; organizationId: number; version: number | null; kind: TestPublicationKind; reviewId?: number | null; actor: AuditActor },
) {
  const updated = await tx.update(tests).set({ publishedVersion: input.version }).where(eq(tests.id, input.testId)).returning();
  // Visible but not changed: row-level security refused it (a viewer on a restricted project).
  if (updated.length === 0) throw new PublishingError('project_read_only', "You can view this test's project but not change it.", 403);

  await tx.insert(testPublications).values({
    organizationId: input.organizationId,
    testId: input.testId,
    version: input.version,
    kind: input.kind,
    reviewId: input.reviewId ?? null,
    publishedBy: input.actor.id,
  });

  const action =
    input.kind === 'rollback' ? AUDIT_ACTIONS.TEST_ROLLED_BACK : input.kind === 'unpublish' ? AUDIT_ACTIONS.TEST_UNPUBLISHED : AUDIT_ACTIONS.TEST_PUBLISHED;
  await recordAudit(tx, {
    action,
    actor: input.actor,
    targetType: 'test',
    targetId: input.testId,
    metadata: { name: updated[0].name, version: input.version, ...(input.reviewId ? { reviewId: input.reviewId } : {}) },
  });
  return updated[0];
}

async function requireTest(tx: TenantTx, testId: number) {
  const [test] = await tx.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!test) throw new PublishingError('test_not_found', 'Test not found', 404);
  return test;
}

/**
 * Publishes a version directly — the latest if none is named. Not allowed where review is
 * required: there the way to publish is an approved review.
 */
export async function publish(tx: TenantTx, testId: number, organizationId: number, actor: AuditActor, version?: number) {
  const test = await requireTest(tx, testId);
  if (await reviewRequired(tx, organizationId)) {
    throw new PublishingError('review_required', 'Your organization requires a review to publish. Ask for one instead.', 409);
  }
  const target = version ?? (await latestVersionOf(tx, testId));
  if (target === null || !(await versionRow(tx, testId, target))) {
    throw new PublishingError('version_not_found', 'That version does not exist.', 404);
  }
  if (test.publishedVersion === target) throw new PublishingError('already_published', `Version ${target} is already published.`, 409);
  return setPublished(tx, { testId, organizationId, version: target, kind: 'publish', actor });
}

/**
 * Puts back a version that was live before. Allowed under the review policy too: it was
 * approved (or published) once already, and this is the way out of a bad publication without
 * waiting for a reviewer.
 */
export async function rollback(tx: TenantTx, testId: number, organizationId: number, actor: AuditActor, version: number) {
  const test = await requireTest(tx, testId);
  const [wasLive] = await tx
    .select({ id: testPublications.id })
    .from(testPublications)
    .where(and(eq(testPublications.testId, testId), eq(testPublications.version, version)))
    .limit(1);
  if (!wasLive) throw new PublishingError('never_published', `Version ${version} was never published, so there is nothing to roll back to.`, 409);
  if (test.publishedVersion === version) throw new PublishingError('already_published', `Version ${version} is already published.`, 409);
  return setPublished(tx, { testId, organizationId, version, kind: 'rollback', actor });
}

/** Stops publishing: plans run the working copy again. Not where review is required. */
export async function unpublish(tx: TenantTx, testId: number, organizationId: number, actor: AuditActor) {
  const test = await requireTest(tx, testId);
  if (await reviewRequired(tx, organizationId)) {
    throw new PublishingError('review_required', 'Your organization requires reviewed tests; plans would skip this one. Roll back to an earlier version instead.', 409);
  }
  if (test.publishedVersion === null) throw new PublishingError('not_published', 'This test is not published.', 409);
  return setPublished(tx, { testId, organizationId, version: null, kind: 'unpublish', actor });
}

// ─── Reviews ──────────────────────────────────────────────────────────────────

/** Asks for the latest version to be reviewed. One open request per test. */
export async function requestReview(tx: TenantTx, testId: number, organizationId: number, actor: AuditActor, note?: string) {
  const test = await requireTest(tx, testId);
  const version = await latestVersionOf(tx, testId);
  if (version === null) throw new PublishingError('version_not_found', 'This test has no saved version to review.', 409);
  if (test.publishedVersion === version) throw new PublishingError('already_published', `Version ${version} is already published.`, 409);
  const [open] = await tx
    .select({ id: testReviews.id })
    .from(testReviews)
    .where(and(eq(testReviews.testId, testId), eq(testReviews.status, 'pending')))
    .limit(1);
  if (open) throw new PublishingError('review_pending', 'A review of this test is already waiting.', 409);

  const [review] = await tx
    .insert(testReviews)
    .values({ organizationId, testId, version, note: note?.trim() || null, requestedBy: actor.id })
    .returning();
  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TEST_REVIEW_REQUESTED,
    actor,
    targetType: 'test',
    targetId: testId,
    metadata: { name: test.name, version, reviewId: review.id },
  });
  return review;
}

async function pendingReview(tx: TenantTx, reviewId: number) {
  const [review] = await tx.select().from(testReviews).where(eq(testReviews.id, reviewId)).limit(1);
  if (!review) throw new PublishingError('review_not_found', 'Review not found', 404);
  if (review.status !== 'pending') throw new PublishingError('review_closed', `This review is already ${review.status}.`, 409);
  return review;
}

async function closeReview(tx: TenantTx, reviewId: number, status: 'approved' | 'rejected' | 'withdrawn', actor: AuditActor, comment?: string) {
  const [closed] = await tx
    .update(testReviews)
    .set({ status, decidedBy: actor.id, decidedAt: new Date(), decisionComment: comment?.trim() || null })
    // Still pending at the moment of writing: two reviewers deciding at once get one decision.
    .where(and(eq(testReviews.id, reviewId), eq(testReviews.status, 'pending')))
    .returning();
  if (!closed) throw new PublishingError('review_closed', 'This review was decided a moment ago.', 409);
  return closed;
}

/**
 * Approves and publishes the reviewed version. Four eyes: the approver can be neither the
 * person who asked nor the author of that version.
 */
export async function approveReview(tx: TenantTx, reviewId: number, organizationId: number, actor: AuditActor, comment?: string) {
  const review = await pendingReview(tx, reviewId);
  const version = await versionRow(tx, review.testId, review.version);
  if (review.requestedBy === actor.id || version?.createdBy === actor.id) {
    throw new PublishingError('own_change', 'Someone other than its author has to approve a change.', 403);
  }
  const closed = await closeReview(tx, reviewId, 'approved', actor, comment);
  await setPublished(tx, { testId: review.testId, organizationId, version: review.version, kind: 'review', reviewId, actor });
  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TEST_REVIEW_APPROVED,
    actor,
    targetType: 'test',
    targetId: review.testId,
    metadata: { version: review.version, reviewId },
  });
  return closed;
}

export async function rejectReview(tx: TenantTx, reviewId: number, actor: AuditActor, comment: string) {
  const review = await pendingReview(tx, reviewId);
  if (review.requestedBy === actor.id) throw new PublishingError('own_change', 'Withdraw your own request instead.', 403);
  const closed = await closeReview(tx, reviewId, 'rejected', actor, comment);
  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TEST_REVIEW_REJECTED,
    actor,
    targetType: 'test',
    targetId: review.testId,
    metadata: { version: review.version, reviewId, comment },
  });
  return closed;
}

export async function withdrawReview(tx: TenantTx, reviewId: number, actor: AuditActor) {
  const review = await pendingReview(tx, reviewId);
  if (review.requestedBy !== actor.id) throw new PublishingError('not_yours', 'Only the person who asked can withdraw a review.', 403);
  const closed = await closeReview(tx, reviewId, 'withdrawn', actor);
  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TEST_REVIEW_WITHDRAWN,
    actor,
    targetType: 'test',
    targetId: review.testId,
    metadata: { version: review.version, reviewId },
  });
  return closed;
}

// ─── What a plan runs ─────────────────────────────────────────────────────────

export interface RunnableContent {
  version: number;
  name: string;
  url: string;
  sequence: unknown;
  elements: unknown;
  preconditions: unknown;
  dataset: unknown;
}

/**
 * The published content of each of these tests that has one, in one query. The runner lays it
 * over the working copy it loaded, so what a plan executes is the version that was published.
 */
export async function publishedContentOf(tx: TenantTx, testIds: number[]): Promise<Map<number, RunnableContent>> {
  const content = new Map<number, RunnableContent>();
  const wanted = Array.from(new Set(testIds));
  if (wanted.length === 0) return content;
  const rows = await tx
    .select({ testId: tests.id, version: testVersions })
    .from(tests)
    .innerJoin(testVersions, and(eq(testVersions.testId, tests.id), eq(testVersions.version, tests.publishedVersion)))
    .where(and(inArray(tests.id, wanted), isNotNull(tests.publishedVersion)));
  for (const { testId, version } of rows) {
    content.set(testId, {
      version: version.version,
      name: version.name,
      url: version.url,
      sequence: version.sequence,
      elements: version.elements,
      preconditions: version.preconditions,
      dataset: version.dataset,
    });
  }
  return content;
}

/** Everything the publishing panel of one test shows. */
export async function publishingStateOf(tx: TenantTx, testId: number, organizationId: number) {
  const test = await requireTest(tx, testId);
  const [latest, required, reviews, publications] = await Promise.all([
    latestVersionOf(tx, testId),
    reviewRequired(tx, organizationId),
    tx.select().from(testReviews).where(eq(testReviews.testId, testId)).orderBy(desc(testReviews.requestedAt)).limit(20),
    tx.select().from(testPublications).where(eq(testPublications.testId, testId)).orderBy(desc(testPublications.publishedAt), desc(testPublications.id)).limit(50),
  ]);
  return {
    testId,
    publishedVersion: test.publishedVersion,
    latestVersion: latest,
    // What a plan would run now.
    runs: test.publishedVersion !== null ? 'published' : required ? 'nothing' : 'working_copy',
    hasUnpublishedChanges: latest !== null && latest !== test.publishedVersion,
    reviewRequired: required,
    pendingReview: reviews.find((r) => r.status === 'pending') ?? null,
    reviews,
    publications,
    // Versions a rollback may go back to: live once, not live now.
    rollbackTargets: Array.from(new Set(publications.map((p) => p.version).filter((v): v is number => v !== null && v !== test.publishedVersion))),
  };
}

/**
 * Requires, or stops requiring, review before publishing. Privileged because app_user may only
 * read organizations; the organization is the owner's own, from their session.
 */
export async function setReviewRequired(organizationId: number, actor: AuditActor, required: boolean): Promise<void> {
  await privilegedDb.transaction(async (tx) => {
    await tx.update(organizations).set({ testReviewRequired: required }).where(eq(organizations.id, organizationId));
    await tx.insert(auditLog).values({
      organizationId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      apiKeyId: actor.apiKeyId ?? null,
      ipAddress: actor.ipAddress ?? null,
      action: AUDIT_ACTIONS.TEST_REVIEW_POLICY_CHANGED,
      targetType: 'organization',
      targetId: String(organizationId),
      metadata: { required },
    });
  });
}
