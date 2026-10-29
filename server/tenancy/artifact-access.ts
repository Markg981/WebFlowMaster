import { eq, inArray } from 'drizzle-orm';
import { API_SCOPES, type ApiScope } from '@shared/api-scopes';
import { executionUnits, mobileTests, reportTestCaseResults, tests } from '@shared/schema';
import type { TenantTx } from '../platform/middleware/tenancy';

/**
 * Who may open which file a run left behind: one decision, made here, for every way in.
 *
 * A run's files are served by the report's own route, by /api/v1, listed by /api/v1, and read
 * again by the exports. Each of those used to decide on its own, and all of them decided the same
 * thing: anyone in the organization who can see the run can open every file of it. That is right
 * for a screenshot and wrong for a Playwright trace, which carries the DOM, the network — request
 * bodies included — and the console at every step: whatever the test typed into a password field
 * is in there, in clear. Hiding the link in the page would not have changed that, and neither would
 * a check on the `.zip` suffix alone: the URL is guessable and the suffix is not a classification.
 *
 * So the server classifies the file by what the runner names it, and decides:
 *
 *  - Recognised files that show what a person could see on the screen — screenshots, the video,
 *    the Lighthouse report, a file the test downloaded — stay open to every member who sees the run.
 *    They are not sanitised either: a screenshot shows what was on the screen, and nothing here
 *    claims otherwise (docs: security/data-protection.md).
 *  - Traces and HAR files are raw evidence: open to the editor role and above, and to an API key
 *    only with the `runs:evidence` scope.
 *  - Anything else — a file from before this classification, or a name nothing here recognises — is
 *    treated as raw evidence. Refusing a harmless file costs a viewer a click; serving an unknown
 *    one could cost a credential.
 *
 * On top of that, a file that belongs to a test of a restricted project the caller is not on is
 * absent, not forbidden: the unit directory names its test (`ui_<id>`, `mobile_<id>`), or the run's
 * manifest does (`units/<unit>/attempt_<n>/…`, every attempt and dataset row of it), and RLS already
 * hides that test from the caller, so the file answers like a file that does not exist.
 */

export type ArtifactKind =
  'screenshot' | 'video' | 'lighthouse-report' | 'download' | 'trace' | 'network' | 'unknown';

export interface ArtifactClassification {
  kind: ArtifactKind;
  /** Raw evidence: needs the sensitive-evidence permission. */
  sensitive: boolean;
}

/** The scope a key needs, besides the role, to open raw evidence. */
export const SENSITIVE_EVIDENCE_SCOPE: ApiScope = 'runs:evidence';

/**
 * What a stored file is, by the name the runner gives it (server/runtime/run-evidence.ts,
 * server/web/visual-testing.ts, server/web/web-performance.ts, server/web/step-executor.ts).
 *
 * The raw kinds are tested first: a download the application under test named `x_trace.zip` is
 * stored as `download_…_x_trace.zip`, and is refused like a trace rather than trusted like a download.
 */
export function classifyArtifact(relativePath: string): ArtifactClassification {
  const name = relativePath.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
  if (name.endsWith('_trace.zip')) return { kind: 'trace', sensitive: true };
  if (name.endsWith('.har')) return { kind: 'network', sensitive: true };
  if (name.startsWith('download_')) return { kind: 'download', sensitive: false };
  if (/\.(png|jpe?g|webp)$/.test(name)) return { kind: 'screenshot', sensitive: false };
  if (/\.(webm|mp4)$/.test(name)) return { kind: 'video', sensitive: false };
  if (name.endsWith('.report.html')) return { kind: 'lighthouse-report', sensitive: false };
  return { kind: 'unknown', sensitive: true };
}

/** Who is asking: the role they act with, and the scopes of the key they used, if a scoped one. */
export interface EvidencePrincipal {
  role: string;
  /** Null or absent for a session, or a key from before scopes: bounded by the role alone. */
  scopes?: readonly string[] | null;
}

const RANK: Record<string, number> = { viewer: 0, editor: 1, owner: 2 };

/** Why raw evidence is refused, or null when it is not. */
export function sensitiveEvidenceRefusal(
  principal: EvidencePrincipal | null | undefined,
): 'insufficient_role' | 'insufficient_scope' | null {
  const minimum = API_SCOPES[SENSITIVE_EVIDENCE_SCOPE].minimumRole;
  if (!principal || !(principal.role in RANK) || RANK[principal.role] < RANK[minimum]) {
    return 'insufficient_role';
  }
  if (principal.scopes && !principal.scopes.includes(SENSITIVE_EVIDENCE_SCOPE)) {
    return 'insufficient_scope';
  }
  return null;
}

/**
 * The part of a stored path below the run's own directory, or null when it is not one.
 *
 * Stored paths are what `path.join` produced on the machine that ran the test — Windows
 * separators included — or `/results/…` URLs of the same directory. Both reduce to this.
 */
export function relativeArtifactPath(
  executionId: string,
  storedPath: string | null | undefined,
): string | null {
  if (!storedPath || typeof storedPath !== 'string' || storedPath.startsWith('data:')) return null;
  const normalized = storedPath.replace(/\\/g, '/');
  const marker = `/${executionId}/`;
  const index = normalized.indexOf(marker);
  if (index === -1) return null;
  const relative = normalized.slice(index + marker.length);
  if (!relative || relative.includes('..')) return null;
  return relative;
}

/**
 * Marks a file of a `units/<unit>/…` directory whose unit is not in this run's manifest: a path
 * nobody was handed, answered like one that does not exist.
 */
const UNKNOWN_UNIT = 'unit:unknown';

/**
 * The test a unit directory belongs to: `ui_<id>[_<browser>]/…`, `mobile_<id>/…`, or — for a run
 * with a manifest — `units/<unit>/…`, whose test the manifest knows (shared/execution-identity.ts).
 */
function ownerOf(relativePath: string, unitOwners: Map<string, string | null>): string | null {
  const [first, second] = relativePath.replace(/\\/g, '/').split('/');
  if (first === 'units') {
    if (!second || !unitOwners.has(second)) return UNKNOWN_UNIT;
    return unitOwners.get(second) ?? null;
  }
  const ui = /^ui_(\d+)(?:_|$)/.exec(first);
  if (ui) return `ui:${ui[1]}`;
  const mobile = /^mobile_(\d+)$/.exec(first);
  if (mobile) return `mobile:${mobile[1]}`;
  return null;
}

/**
 * The test each unit of the run's manifest runs, as `ui:<id>` / `mobile:<id>` (null for an API
 * test, which keeps no files, or a test that no longer exists).
 *
 * A unit with a result takes its test from the result row, whose id is cleared when the test is
 * deleted — exactly as a `ui_<id>` directory is judged. A unit still without one (running, or lost)
 * takes it from the manifest, and a hidden test's evidence stays hidden while it runs.
 */
async function unitOwnersOf(
  tx: TenantTx,
  executionId: string,
  rows: Array<{ unit: string | null; ui: number | null; mobile: number | null }>,
): Promise<Map<string, string | null>> {
  const units = await tx
    .select({ unitId: executionUnits.unitId, coordinates: executionUnits.coordinates })
    .from(executionUnits)
    .where(eq(executionUnits.executionId, executionId));
  const recorded = new Map(rows.filter((r) => r.unit).map((r) => [r.unit!, r]));
  const owners = new Map<string, string | null>();
  for (const { unitId, coordinates } of units) {
    const row = recorded.get(unitId);
    if (row)
      owners.set(unitId, row.ui ? `ui:${row.ui}` : row.mobile ? `mobile:${row.mobile}` : null);
    else if (coordinates.testId !== null && coordinates.testType !== 'api')
      owners.set(unitId, `${coordinates.testType}:${coordinates.testId}`);
    else owners.set(unitId, null);
  }
  return owners;
}

/**
 * The tests of this run the caller may not see, as `ui:<id>` / `mobile:<id>`, and which test each
 * unit of its manifest runs.
 *
 * Runs inside the caller's tenant transaction, so RLS answers "visible". A UI result's test id is
 * cleared when the test is deleted (ON DELETE SET NULL), so an id still on the row names a test that
 * exists, and one RLS does not show is hidden from this caller. A mobile result's id has no such
 * key: a mobile test that is gone and one that is hidden look alike, and both are treated as hidden.
 */
async function hiddenOwners(
  tx: TenantTx,
  executionId: string,
): Promise<{ hidden: Set<string>; unitOwners: Map<string, string | null> }> {
  const rows = await tx
    .select({
      unit: reportTestCaseResults.executionUnitId,
      ui: reportTestCaseResults.uiTestId,
      mobile: reportTestCaseResults.mobileTestId,
    })
    .from(reportTestCaseResults)
    .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
  const unitOwners = await unitOwnersOf(tx, executionId, rows);
  const owned = (kind: string) =>
    Array.from(unitOwners.values())
      .filter((owner): owner is string => !!owner && owner.startsWith(`${kind}:`))
      .map((owner) => Number(owner.slice(kind.length + 1)));
  const uiIds = Array.from(
    new Set([...rows.map((r) => r.ui).filter((id): id is number => !!id), ...owned('ui')]),
  );
  const mobileIds = Array.from(
    new Set([...rows.map((r) => r.mobile).filter((id): id is number => !!id), ...owned('mobile')]),
  );
  const hidden = new Set<string>();
  if (uiIds.length > 0) {
    const visible = new Set(
      (await tx.select({ id: tests.id }).from(tests).where(inArray(tests.id, uiIds))).map(
        (r) => r.id,
      ),
    );
    for (const id of uiIds) if (!visible.has(id)) hidden.add(`ui:${id}`);
  }
  if (mobileIds.length > 0) {
    const visible = new Set(
      (
        await tx
          .select({ id: mobileTests.id })
          .from(mobileTests)
          .where(inArray(mobileTests.id, mobileIds))
      ).map((r) => r.id),
    );
    for (const id of mobileIds) if (!visible.has(id)) hidden.add(`mobile:${id}`);
  }
  hidden.add(UNKNOWN_UNIT);
  return { hidden, unitOwners };
}

/** What the caller may do with one file of the run. */
export type ArtifactDecision =
  | { allowed: true; classification: ArtifactClassification }
  /** The file belongs to a test the caller cannot see: answer as if it did not exist. */
  | { allowed: false; reason: 'hidden'; classification: ArtifactClassification }
  /** Raw evidence and the caller lacks the permission: 403, without opening the store. */
  | {
      allowed: false;
      reason: 'insufficient_role' | 'insufficient_scope';
      classification: ArtifactClassification;
    };

export interface RunArtifactAccess {
  decide(relativePath: string): ArtifactDecision;
  /** Whether a link to this file may be handed to the caller at all. */
  linkable(relativePath: string): boolean;
  /** Whether the file is withheld only for lack of the raw-evidence permission. */
  restricted(relativePath: string): boolean;
  /** Whether a result row belongs to a test the caller cannot see: its detail is not theirs. */
  hiddenResult(row: { uiTestId?: number | null; mobileTestId?: number | null }): boolean;
}

/**
 * The caller's access to one run's files. Call inside the request's tenant transaction, after the
 * run itself was found there (RLS decides the run; this decides its files).
 */
export async function runArtifactAccess(
  tx: TenantTx,
  input: { organizationId: number; executionId: string; principal: EvidencePrincipal | null },
): Promise<RunArtifactAccess> {
  const { hidden, unitOwners } = await hiddenOwners(tx, input.executionId);
  const refusal = sensitiveEvidenceRefusal(input.principal);
  const decide = (relativePath: string): ArtifactDecision => {
    const classification = classifyArtifact(relativePath);
    const owner = ownerOf(relativePath, unitOwners);
    if (owner && hidden.has(owner)) return { allowed: false, reason: 'hidden', classification };
    if (classification.sensitive && refusal) {
      return { allowed: false, reason: refusal, classification };
    }
    return { allowed: true, classification };
  };
  return {
    decide,
    linkable: (relativePath) => decide(relativePath).allowed,
    restricted: (relativePath) => {
      const decision = decide(relativePath);
      return !decision.allowed && decision.reason !== 'hidden';
    },
    hiddenResult: (row) =>
      (!!row.uiTestId && hidden.has(`ui:${row.uiTestId}`)) ||
      (!!row.mobileTestId && hidden.has(`mobile:${row.mobileTestId}`)),
  };
}
