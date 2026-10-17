import { and, desc, eq } from 'drizzle-orm';
import { tests, testVersions } from '@shared/schema';
import { withTenantTransaction } from '../platform/middleware/tenancy';
import { publishedContentOf } from '../authoring/test-publishing';
import {
  expandWithBundle,
  prepareSequence,
  readVersionBundle,
  unusableBundleMessage,
  type PreparedSequence,
} from '../authoring/executable-definition';
import type { ExportableStep, ExportableTest, ExportSource } from './playwright-export';

/**
 * Which definition GET /api/tests/:id/playwright exports (P15, M04):
 *  - `run` (the default): what a plan runs now: the published version, else the latest saved
 *    version, else the working copy, as freezeTestDefinitions picks it.
 *  - `published`: the published version, or 409 when there is none.
 *  - `working`: the working copy, saved or not.
 *  - a number: that saved version, or 404.
 * The steps are expanded with the dependencies that definition runs with: a version's recorded
 * bundle when it has one, the live groups, elements and custom actions otherwise. A version whose
 * bundle is unreadable is refused (409) rather than exported with live dependencies.
 */
export type ExportSelector = 'run' | 'published' | 'working' | number;

export function parseExportSelector(value: unknown): ExportSelector | null {
  if (value === undefined || value === '' || value === 'run') return 'run';
  if (value === 'published' || value === 'working') return value;
  if (typeof value === 'string' && /^[1-9]\d{0,8}$/.test(value)) return Number(value);
  return null;
}

type Loaded = { ok: true; test: ExportableTest } | { ok: false; status: 404 | 409; error: string };

type Refused = { status: 404 | 409; error: string };
/** snapshot: the version's own column (its dependency bundle); undefined for live dependencies. */
type Picked = { content: Content; source: ExportSource; snapshot: unknown };

interface Content {
  name: string;
  url: string;
  sequence: unknown;
  preconditions: unknown;
  cleanups: unknown;
  dataset: unknown;
}

export async function loadExportDefinition(
  testId: number,
  selector: ExportSelector,
): Promise<Loaded> {
  // Read everything in one transaction; dependency expansion with live tables opens its own,
  // so it runs after this one has finished.
  const picked = await withTenantTransaction(async (tx): Promise<Picked | Refused> => {
    const [row] = await tx.select().from(tests).where(eq(tests.id, testId)).limit(1);
    if (!row) return { status: 404 as const, error: 'Test not found' };
    const working = {
      content: row as Content,
      source: { kind: 'working', version: null } as ExportSource,
    };
    if (selector === 'working') return { ...working, snapshot: undefined };
    if (typeof selector === 'number') {
      const [version] = await tx
        .select()
        .from(testVersions)
        .where(and(eq(testVersions.testId, testId), eq(testVersions.version, selector)))
        .limit(1);
      if (!version)
        return { status: 404 as const, error: `Version ${selector} of this test does not exist.` };
      const kind = row.publishedVersion === selector ? 'published' : 'version';
      return {
        content: version as Content,
        source: { kind, version: selector } as ExportSource,
        snapshot: version.snapshot ?? null,
      };
    }
    const published = (await publishedContentOf(tx, [testId])).get(testId);
    if (published)
      return {
        content: published as Content,
        source: { kind: 'published', version: published.version } as ExportSource,
        snapshot: published.versionSnapshot ?? null,
      };
    if (selector === 'published')
      return { status: 409 as const, error: 'This test has no published version to export.' };
    const [latest] = await tx
      .select()
      .from(testVersions)
      .where(eq(testVersions.testId, testId))
      .orderBy(desc(testVersions.version))
      .limit(1);
    // A plan runs the latest unpublished version with the dependencies live when it is queued.
    if (latest)
      return {
        content: latest as Content,
        source: { kind: 'version', version: latest.version } as ExportSource,
        snapshot: undefined,
      };
    return { ...working, snapshot: undefined };
  });
  if (!('content' in picked)) return { ok: false, status: picked.status, error: picked.error };

  let prepared: PreparedSequence;
  if (picked.snapshot === undefined) prepared = await prepareSequence(picked.content.sequence);
  else {
    const read = readVersionBundle(picked.snapshot);
    if (read.kind === 'ok') prepared = expandWithBundle(picked.content.sequence, read.bundle);
    else if (read.kind === 'legacy') prepared = await prepareSequence(picked.content.sequence);
    else return { ok: false, status: 409, error: unusableBundleMessage(read).error };
  }
  if (prepared.errors.length > 0)
    return { ok: false, status: 409, error: prepared.errors.join(' ') };

  const { content } = picked;
  return {
    ok: true,
    test: {
      name: content.name,
      url: content.url,
      sequence: prepared.steps as ExportableStep[],
      preconditions: (content.preconditions as ExportableTest['preconditions']) ?? null,
      cleanups: (content.cleanups as ExportableTest['cleanups']) ?? null,
      dataset: content.dataset ?? null,
      source: picked.source,
    },
  };
}
