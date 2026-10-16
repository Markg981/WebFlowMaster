import { createHash } from 'node:crypto';
import type { TenantTx } from '../platform/middleware/tenancy';
import {
  asSteps,
  expandSequenceForRun,
  expandStepGroups,
  loadStepGroups,
  referencedGroupIds,
  type LoadedStepGroup,
  type SequenceStep,
} from './step-groups';
import {
  loadRepositoryElements,
  referencedElementIds,
  resolveSequenceForRun,
  resolveStepElements,
  type RepositoryElement,
} from './step-elements';
import {
  expandCustomActions,
  loadCustomActions,
  referencedCustomActionIds,
  type LoadedCustomAction,
} from './custom-actions';
import { canonical, withTestProvenance } from './step-provenance';

/**
 * What a UI test calls, written down with the test (C04).
 *
 * A test stores references: "call the login group", "click the repository's Buy button", "run the
 * custom action Seed cart". Resolved at run time, they made a reviewed and published version mean
 * whatever those shared things said on the day it ran — a group edited after the approval
 * changed what the approved version did, and nothing recorded it.
 *
 * The bundle is the referenced things themselves, transitively (a group's own elements and
 * custom actions too), captured in the caller's transaction so it is consistent with the version
 * or the run it belongs to. It holds definitions as their authors wrote them — `{{name}}`
 * placeholders stay placeholders, so no secret value is ever in it. The runner resolves a frozen
 * test from the bundle alone and never reads the live tables.
 *
 * Where it is kept: a UI version's `snapshot` column (null for UI versions until now, so no new
 * table), and each frozen definition of a queued run.
 */

/** The bundle format this code reads and writes. A different one is refused, never guessed at. */
export const DEPENDENCY_PROTOCOL = 1 as const;

export interface BundledGroup extends LoadedStepGroup {
  updatedAt: string | null;
}
export interface BundledElement extends RepositoryElement {
  name: string;
  projectId: number;
  updatedAt: string | null;
}
export interface BundledCustomAction extends LoadedCustomAction {
  updatedAt: string | null;
}

export interface DependencyBundle {
  protocol: typeof DEPENDENCY_PROTOCOL;
  groups: BundledGroup[];
  elements: BundledElement[];
  customActions: BundledCustomAction[];
  /**
   * Named and not found when captured: deleted, another tenant's, or in a project the author
   * cannot see. Kept so the run fails (groups, actions) or falls back (elements) exactly as it
   * would have then, and says so.
   */
  missing: { groups: string[]; elements: string[]; customActions: string[] };
  /** Over what executes only: touching a group without changing it is not a new dependency. */
  fingerprint: string;
}

/** How a queued definition's dependencies were obtained, or why it cannot run. */
export type FrozenDependencies =
  | { bundle: DependencyBundle; origin: 'version' | 'enqueue' }
  | { error: string; reason: 'corrupt' | 'unsupported' };

/** The bundle a stored value holds, told apart from none at all and from one that is broken. */
export type BundleRead =
  | { kind: 'ok'; bundle: DependencyBundle }
  | { kind: 'legacy' }
  | { kind: 'corrupt'; reason: string }
  | { kind: 'unsupported'; protocol: unknown };

const byId = <T extends { id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function dependencyFingerprint(bundle: Omit<DependencyBundle, 'fingerprint'>): string {
  const executable = {
    protocol: bundle.protocol,
    groups: byId(bundle.groups).map(({ id, name, sequence }) => ({ id, name, sequence })),
    elements: byId(bundle.elements).map(({ id, selector, frameSelector }) => ({
      id,
      selector,
      frameSelector: frameSelector ?? null,
    })),
    customActions: byId(bundle.customActions).map(({ id, name, parameters, script }) => ({
      id,
      name,
      parameters,
      script,
    })),
    missing: {
      groups: [...bundle.missing.groups].sort(),
      elements: [...bundle.missing.elements].sort(),
      customActions: [...bundle.missing.customActions].sort(),
    },
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(executable)))
    .digest('hex');
}

const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null);

/**
 * Everything a sequence calls, transitively, as the caller's transaction sees it.
 *
 * Groups are walked breadth-first with a visited set, so a group that calls itself or one that
 * calls back into it is captured once and the walk ends; the expansion then refuses the nested
 * call as it always has. Repeated calls are captured once.
 */
export async function captureDependencies(
  tx: TenantTx,
  sequence: unknown,
): Promise<DependencyBundle> {
  const groups: BundledGroup[] = [];
  const missingGroups: string[] = [];
  const seen = new Set<string>();
  let pending = referencedGroupIds(sequence);
  while (pending.length > 0) {
    pending.forEach((id) => seen.add(id));
    const loaded = await loadStepGroups(tx, pending);
    const found = new Set(loaded.map((group) => group.id));
    missingGroups.push(...pending.filter((id) => !found.has(id)));
    const next: string[] = [];
    for (const group of loaded) {
      groups.push({
        id: group.id,
        name: group.name,
        sequence: group.sequence,
        updatedAt: iso(group.updatedAt),
      });
      for (const id of referencedGroupIds(group.sequence))
        if (!seen.has(id) && !next.includes(id)) next.push(id);
    }
    pending = next;
  }

  const sequences = [asSteps(sequence), ...groups.map((group) => asSteps(group.sequence))];
  const elementIds = [...new Set(sequences.flatMap((steps) => referencedElementIds(steps)))];
  const actionIds = [...new Set(sequences.flatMap((steps) => referencedCustomActionIds(steps)))];
  const [elements, actions] = [
    await loadRepositoryElements(tx, elementIds),
    await loadCustomActions(tx, actionIds),
  ];
  const foundElements = new Set(elements.map((row) => row.id));
  const foundActions = new Set(actions.map((row) => row.id));

  const bundle: Omit<DependencyBundle, 'fingerprint'> = {
    protocol: DEPENDENCY_PROTOCOL,
    groups,
    elements: elements.map((row) => ({
      id: row.id,
      name: row.name,
      projectId: row.projectId,
      selector: row.selector,
      frameSelector: row.frameSelector ?? null,
      updatedAt: iso(row.updatedAt),
    })),
    customActions: actions.map((row) => ({
      id: row.id,
      name: row.name,
      parameters: row.parameters,
      script: row.script,
      updatedAt: iso(row.updatedAt),
    })),
    missing: {
      groups: missingGroups,
      elements: elementIds.filter((id) => !foundElements.has(id)),
      customActions: actionIds.filter((id) => !foundActions.has(id)),
    },
  };
  // The persisted JSON form, so a fingerprint taken now matches one taken after a round trip.
  const persisted = JSON.parse(JSON.stringify(bundle)) as Omit<DependencyBundle, 'fingerprint'>;
  return { ...persisted, fingerprint: dependencyFingerprint(persisted) };
}

/** Where a UI version keeps its bundle in `test_versions.snapshot`. */
export function versionSnapshotWith(bundle: DependencyBundle): Record<string, unknown> {
  return { executable: { protocol: DEPENDENCY_PROTOCOL, dependencies: bundle } };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The bundle a UI version row holds.
 *
 * `legacy`: a version written before bundles existed (no `executable` key) — it has none, and
 * the caller decides what that means. `corrupt` and `unsupported` are never read as legacy: a
 * caller that fell back to live dependencies for them would run something nobody reviewed.
 */
export function readVersionBundle(snapshot: unknown): BundleRead {
  if (snapshot === null || snapshot === undefined) return { kind: 'legacy' };
  if (!isObject(snapshot))
    return { kind: 'corrupt', reason: 'The version snapshot is not an object.' };
  if (!('executable' in snapshot)) return { kind: 'legacy' };
  const executable = snapshot.executable;
  if (!isObject(executable))
    return { kind: 'corrupt', reason: 'The version dependency record is not an object.' };
  if (executable.protocol !== DEPENDENCY_PROTOCOL)
    return { kind: 'unsupported', protocol: executable.protocol };
  return readBundle(executable.dependencies);
}

/** A bundle as stored, checked for shape and for its own fingerprint. */
export function readBundle(value: unknown): BundleRead {
  if (!isObject(value)) return { kind: 'corrupt', reason: 'The dependency bundle is missing.' };
  if (value.protocol !== DEPENDENCY_PROTOCOL)
    return { kind: 'unsupported', protocol: value.protocol };
  const missing = value.missing as Record<string, unknown> | undefined;
  if (
    !Array.isArray(value.groups) ||
    !Array.isArray(value.elements) ||
    !Array.isArray(value.customActions) ||
    !isObject(missing) ||
    !Array.isArray(missing.groups) ||
    !Array.isArray(missing.elements) ||
    !Array.isArray(missing.customActions) ||
    typeof value.fingerprint !== 'string'
  )
    return { kind: 'corrupt', reason: 'The dependency bundle is incomplete.' };
  const bundle = value as unknown as DependencyBundle;
  const { fingerprint, ...rest } = bundle;
  if (dependencyFingerprint(rest) !== fingerprint)
    return { kind: 'corrupt', reason: 'The dependency bundle does not match its fingerprint.' };
  return { kind: 'ok', bundle };
}

/** The message a run reports for a definition whose dependencies cannot be used. */
export function unusableBundleMessage(read: Exclude<BundleRead, { kind: 'ok' | 'legacy' }>): {
  error: string;
  reason: 'corrupt' | 'unsupported';
} {
  return read.kind === 'unsupported'
    ? {
        reason: 'unsupported',
        error: `This test version records its dependencies in format ${JSON.stringify(read.protocol)}, which this server does not support; it was not run with live dependencies instead.`,
      }
    : {
        reason: 'corrupt',
        error: `This test version's recorded dependencies are unreadable (${read.reason}); it was not run with live dependencies instead.`,
      };
}

export interface PreparedSequence {
  steps: SequenceStep[];
  /** Why the sequence cannot run as written. Not empty means the test fails before a browser starts. */
  errors: string[];
  /** Repository elements named and not available: those steps keep their own selector. */
  unresolved: string[];
  /** True when a group call or a custom action was replaced, so the run log can say so. */
  expanded: boolean;
}

/**
 * Groups, then custom actions (including those a group uses), then repository elements — the
 * same order the live path has always used — from the bundle alone. Pure.
 */
export function expandWithBundle(sequence: unknown, bundle: DependencyBundle): PreparedSequence {
  const groups = expandStepGroups(sequence, bundle.groups);
  const actions = expandCustomActions(groups.steps, bundle.customActions);
  const elements = resolveStepElements(actions.steps, bundle.elements);
  return {
    steps: elements.steps,
    errors: [...groups.errors, ...actions.errors],
    unresolved: elements.unresolved,
    expanded: groups.expanded || actions.steps !== groups.steps,
  };
}

/**
 * The steps a test runs.
 *
 * With frozen dependencies, from them and nothing else: a group, element or custom action edited
 * or deleted since cannot change what a queued or published definition does. Without (an ad-hoc
 * run of the working copy, or a run queued before bundles existed), from the live tables as
 * before. A definition whose recorded dependencies are unusable fails here, by name.
 *
 * Every step comes out with its provenance (server/authoring/step-provenance.ts): the test's or
 * the group's sequence it is written in, and where, which is what healing writes back to.
 */
export async function prepareSequence(
  written: unknown,
  frozen?: FrozenDependencies,
): Promise<PreparedSequence> {
  if (frozen && 'error' in frozen)
    return { steps: [], errors: [frozen.error], unresolved: [], expanded: false };
  const sequence = withTestProvenance(asSteps(written));
  if (frozen) return expandWithBundle(sequence, frozen.bundle);
  const expansion = await expandSequenceForRun(sequence);
  if (expansion.errors.length > 0)
    return { steps: expansion.steps, errors: expansion.errors, unresolved: [], expanded: false };
  const resolution = await resolveSequenceForRun(expansion.steps);
  return {
    steps: resolution.steps,
    errors: [],
    unresolved: resolution.unresolved,
    expanded: expansion.expanded,
  };
}

/** What changed in what a test calls, in a phrase for the version history; '' when nothing did. */
export function describeDependencyChange(
  previous: DependencyBundle | null,
  next: DependencyBundle,
): string {
  if (!previous)
    return next.groups.length || next.elements.length || next.customActions.length
      ? 'shared dependencies recorded'
      : '';
  if (previous.fingerprint === next.fingerprint) return '';
  const parts = [
    ...changedNames('step group', previous.groups, next.groups, ({ name, sequence }) => ({
      name,
      sequence,
    })),
    ...changedNames(
      'custom action',
      previous.customActions,
      next.customActions,
      ({ name, parameters, script }) => ({ name, parameters, script }),
    ),
    ...changedNames(
      'shared element',
      previous.elements,
      next.elements,
      ({ selector, frameSelector }) => ({ selector, frameSelector: frameSelector ?? null }),
    ),
  ];
  return parts.length ? parts.join(', ') : 'shared dependencies changed';
}

/** "step group "Login", "Logout" changed" for the rows added, removed or changed in what runs. */
function changedNames<T extends { id: string; name: string }>(
  label: string,
  before: T[],
  after: T[],
  executable: (row: T) => unknown,
): string[] {
  const key = (row: T) => JSON.stringify(canonical(executable(row)));
  const previous = new Map(before.map((row) => [row.id, key(row)]));
  const names = [
    ...after.filter((row) => previous.get(row.id) !== key(row)),
    ...before.filter((row) => !after.some((other) => other.id === row.id)),
  ].map((row) => `"${row.name}"`);
  return names.length ? [`${label} ${names.join(', ')} changed`] : [];
}
